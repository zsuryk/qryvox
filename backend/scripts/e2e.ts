// pnpm e2e -- --web <frontend url> --api <api url> [--token <judge token>] [--out <dir>] [--case <larkspur case id>]
//
// The pre-pitch end-to-end run (#73): the whole product as a judge would use it, in a real Chrome, through the
// browser only. Run it against a stack that `pnpm demo:seed` has built (it reads Larkspur's case by the id the
// seed derives from the pack, or take it with --case). Not part of CI: it calls the live model for the typed
// intent and for the client's explanation, so it takes a few minutes and costs a few thousand tokens.
//
//   pnpm e2e -- --web https://qryvox.vercel.app --api https://qryvox-api.vercel.app --token $JUDGE_TOKEN --out ./e2e-out
//
// Steps, in order (each is timed and screenshotted; a failed step does not stop the ones that do not need it):
//   1 home                 the intake page, and the way into a reviewed case
//   2 canvas               Larkspur's live canvas: dock a card, pin one, discard one, Similar, a typed intent
//   2b canvas full screen  the surface edge to edge with the pins kept, a sheet in it, back out on Escape (#83)
//   3 client (繁體中文)    /start: answer once, land on the list, still waiting for the adviser
//   4 adviser              /advise/<client>: the vulnerable-client confirmation, a pick, Approve the whole list
//   5 client list          the list appears by itself; only the pick is "Recommended"; open it, the explanation is written
//   6 replay               the scrubber at /cases/<id>/record, by keyboard
//   7 phone 390x844        the canvas and the client's list, with no sideways scroll; the whole canvas
//                          section full screen and back, with the chrome exactly as it was (#83)
//   8 chains               both products' hash chains verify intact on the API
//
// Fails loudly: any page error, console error, or 4xx/5xx response from the app is a failure of the run, wherever
// it happened, except the browser's own /favicon.ico request. Exit code 1 lists them all.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// pnpm forwards the "--" in `pnpm e2e -- --web ...`, and parseArgs would read everything after it as positional.
const argv = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--"));
const { values: args } = parseArgs({
  args: argv,
  options: {
    web: { type: "string" },
    api: { type: "string" },
    token: { type: "string" },
    out: { type: "string" },
    case: { type: "string" },
    headed: { type: "boolean" },
  },
});
const WEB = (args.web ?? "").replace(/\/$/, "");
const API = (args.api ?? "").replace(/\/$/, "");
const TOKEN = args.token ?? process.env.JUDGE_TOKEN ?? "";
if (!WEB || !API) {
  console.error("usage: pnpm e2e -- --web <frontend url> --api <api url> [--token <judge token>] [--out <dir>] [--case <case id>]");
  process.exit(2);
}
const OUT = resolve(args.out ?? `e2e-out-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(OUT, { recursive: true });

// The case ids the seed derives from a pack (backend/scripts/demo-seed.ts, derivedId): the same function.
function derivedId(...parts: string[]): string {
  const bytes = createHash("sha256").update(["qryvox-demo-seed", ...parts].join("/")).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const LARKSPUR = args.case ?? derivedId("case", "larkspur-v2");
const WRENFIELD = derivedId("case", "wrenfield-v1");

// --- What the app must never do ---------------------------------------------------------------------------

const problems: string[] = [];
let where = "start";

function watch(page: Page, who: string): void {
  const note = (what: string) => problems.push(`[${where}] ${who}: ${what}`);
  page.on("pageerror", (error) => note(`page error: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.location().url.endsWith("/favicon.ico")) note(`console error: ${msg.text()} (${msg.location().url})`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && !new URL(res.url()).pathname.endsWith("/favicon.ico")) note(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
}

async function newPage(browser: Browser, who: string, options: Parameters<Browser["newContext"]>[0]): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  watch(page, who);
  return { page, context };
}

// The judge-link token rides on the first load of each tab, as the demo link carries it (?k=).
async function open(page: Page, path: string): Promise<void> {
  const url = new URL(WEB + path);
  if (TOKEN) url.searchParams.set("k", TOKEN);
  await page.goto(url.toString(), { waitUntil: "networkidle" });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

async function expectText(page: Page, text: string | RegExp, timeout = 30_000): Promise<void> {
  await page.getByText(text).first().waitFor({ timeout });
}

// --- The steps --------------------------------------------------------------------------------------------

type Result = { step: string; ms: number; ok: boolean; note: string };
const results: Result[] = [];
const state: { clientId?: string; picked?: string } = {};

async function step(name: string, body: (note: (text: string) => void) => Promise<void>, page?: () => Page | undefined): Promise<void> {
  where = name;
  const notes: string[] = [];
  const started = Date.now();
  const before = problems.length;
  let ok = true;
  try {
    await body((text) => notes.push(text));
  } catch (error) {
    ok = false;
    notes.push(`FAILED: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
    const p = page?.();
    if (p) await p.screenshot({ path: `${OUT}/FAIL-${name.replace(/\W+/g, "-")}.png` }).catch(() => undefined);
  }
  const raised = problems.length - before;
  if (raised > 0) {
    ok = false;
    notes.push(`${raised} browser problem${raised === 1 ? "" : "s"}`);
  }
  const ms = Date.now() - started;
  results.push({ step: name, ms, ok, note: notes.join("; ") });
  console.log(`${ok ? "  ok " : "FAIL"}  ${name.padEnd(28)} ${(ms / 1000).toFixed(1).padStart(6)}s  ${notes.join("; ")}`);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: !args.headed });
console.log(`e2e: web ${WEB}, api ${API}, Larkspur ${LARKSPUR}\nscreenshots: ${OUT}\n`);

let desk: Page | undefined;
let client: Page | undefined;
let adviser: Page | undefined;

await step("1 home", async (note) => {
  ({ page: desk } = await newPage(browser, "desk", { viewport: { width: 1440, height: 1000 } }));
  await open(desk, "/");
  await expectText(desk, "Check a product before it reaches the shelf.");
  note("intake page up");
  await shot(desk, "1-home");
}, () => desk);

await step("2 canvas", async (note) => {
  const page = desk!;
  await open(page, `/cases/${LARKSPUR}/canvas`);
  const cards = page.locator("article.canvas-card");
  await cards.first().waitFor({ timeout: 30_000 });
  const summary = () => page.locator(".canvas-summary p.t-footnote").first().innerText();
  const said = () => page.locator(".canvas-summary [role=status]").innerText();
  const total = await cards.count();
  note(`${total} cards`);
  await shot(page, "2a-canvas");

  await cards.locator("button:not([disabled])", { hasText: /^Dock$/ }).first().click();
  await page.waitForFunction(() => /docked to the plan/.test(document.querySelector(".canvas-summary p")?.textContent ?? ""), null, { timeout: 15_000 });
  note("docked");
  await cards.locator("button:not([disabled])", { hasText: /^Pin$/ }).first().click();
  await page.waitForFunction(() => /\d+ pinned/.test(document.querySelector(".canvas-summary p")?.textContent ?? ""), null, { timeout: 15_000 });
  note("pinned");
  await cards.nth(1).getByRole("button", { name: "Discard" }).click();
  await page.waitForFunction(() => /\d+ discarded/.test(document.querySelector(".canvas-summary p")?.textContent ?? ""), null, { timeout: 15_000 });
  note("discarded");
  await cards.locator("button", { hasText: /^Similar$/ }).first().click();
  await page.waitForFunction(() => /Similar/.test(document.querySelector('.canvas-summary [role="status"]')?.textContent ?? ""), null, { timeout: 15_000 });
  note(`similar: ${(await said()).slice(0, 60)}`);
  await shot(page, "2b-canvas-operations");
  note(`summary: ${(await summary()).slice(0, 90)}`);

  const field = page.getByRole("textbox", { name: "What do you want to look at?" });
  await field.fill("fee contradictions in the PPM");
  const t0 = Date.now();
  await field.press("Enter");
  await page.locator('ul[aria-label="Intent chips"] button.chip').first().waitFor({ timeout: 90_000 });
  const chips = await page.locator('ul[aria-label="Intent chips"] button.chip').allInnerTexts();
  note(`intent -> ${chips.join(" / ")} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.waitForTimeout(800);
  const narrowed = await cards.count();
  if (narrowed >= total) throw new Error(`the chips did not narrow the canvas (${narrowed} of ${total} cards)`);
  note(`${total} -> ${narrowed} cards`);
  await shot(page, "2c-canvas-intent");
}, () => desk);

// Full screen on the desktop canvas (#83): the surface goes edge to edge, the cards are re-fitted into
// it with every pin where it was, Escape brings the page back exactly as it was, and the log is the same
// either way — a viewing preference decides nothing.
await step("2b canvas full screen", async (note) => {
  const page = desk!;
  const events = () => page.locator(".canvas-summary p.t-footnote").first().innerText();
  const before = await events();
  const pinnedBefore = await page.locator("article.canvas-card--pinned").count();
  await page.locator(".canvas__fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement !== null || !!document.querySelector("[data-fullscreen]"), null, { timeout: 10_000 });
  const pressed = await page.locator(".canvas__fullscreen").getAttribute("aria-pressed");
  if (pressed !== "true") throw new Error(`the control does not read itself as pressed (aria-pressed=${pressed})`);
  const bar = await page.evaluate(() => [window.innerWidth, window.innerHeight, document.documentElement.scrollWidth] as [number, number, number]);
  if (bar[2] > bar[0]) throw new Error(`a page scrollbar sits behind the full screen canvas (${bar[2]}px in ${bar[0]})`);
  const pinned = await page.locator("article.canvas-card--pinned").count();
  if (pinned !== pinnedBefore) throw new Error(`full screen unpinned a card (${pinnedBefore} -> ${pinned})`);
  note(`full screen ${bar[0]}x${bar[1]}, ${pinned} pinned card${pinned === 1 ? "" : "s"} kept`);
  await page.waitForTimeout(600);
  await shot(page, "2d-canvas-full-screen");

  // A sheet opened in full screen is inside it, so it is visible, and Escape closes the sheet alone.
  await page.locator(".canvas-card__chip").first().click();
  await page.locator('.sheet[role="dialog"]').waitFor({ timeout: 10_000 });
  if (!(await page.locator(".canvas .sheet[role=dialog]").count())) throw new Error("the sheet opened behind the full screen canvas");
  note("a sheet opens in full screen");
  await page.waitForTimeout(400);
  await shot(page, "2e-canvas-full-screen-sheet");
  await page.keyboard.press("Escape");
  await page.locator('.sheet[role="dialog"]').waitFor({ state: "detached", timeout: 10_000 });
  if (await page.evaluate(() => document.fullscreenElement === null && !document.querySelector("[data-fullscreen]"))) {
    throw new Error("one Escape closed the sheet and left full screen");
  }
  // Out of full screen the way a browser leaves it, and the control follows the browser down.
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await page.waitForFunction(() => document.fullscreenElement === null && !document.querySelector("[data-fullscreen]"), null, { timeout: 10_000 });
  const back = await page.locator(".canvas__fullscreen").getAttribute("aria-pressed");
  if (back !== "false") throw new Error(`the control still says full screen after leaving it (aria-pressed=${back})`);
  if ((await events()) !== before) throw new Error("full screen changed what the canvas says about the cards");
  note("out again, the log untouched");
  await shot(page, "2f-canvas-back");
}, () => desk);

// The client answers in 繁體中文, as a 65-year-old who relies on the income and may need the money soon.
await step("3 client answers (zh)", async (note) => {
  ({ page: client } = await newPage(browser, "client", { viewport: { width: 1000, height: 1100 }, colorScheme: "light", locale: "zh-HK" }));
  await open(client, "/start");
  await client.getByRole("button", { name: "繁體中文" }).click();
  await client.getByRole("button", { name: "2 年" }).click();
  for (const option of ["賣出部分", "以安全為主", "影響很大"]) await client.getByRole("button", { name: option, exact: true }).click();
  await client.getByRole("button", { name: "投資新手" }).click();
  await client.getByText("我依靠它派發的收入").click();
  await client.getByText("我可能需要在短時間內取回資金").click();
  await client.getByText("我今年 65 歲或以上").click();
  await shot(client, "3a-client-answered");
  await client.getByRole("button", { name: "看看是否適合我" }).click();
  await client.waitForURL(/\/list\//, { timeout: 120_000 });
  state.clientId = client.url().split("/list/")[1]!.split(/[?#/]/)[0];
  await client.waitForLoadState("networkidle");
  note(`client ${state.clientId}`);
  if (await client.locator("ol.list-plain li.card").count()) throw new Error("the client sees a list before the adviser has approved anything");
  note("waiting for the adviser, nothing shown");
  await shot(client, "3b-client-waiting");
}, () => client);

await step("4 adviser approves", async (note) => {
  if (!state.clientId) throw new Error("no client from step 3");
  ({ page: adviser } = await newPage(browser, "adviser", { viewport: { width: 1000, height: 1100 }, colorScheme: "light" }));
  await open(adviser, `/advise/${state.clientId}`);
  await adviser.locator("li.card").first().waitFor({ timeout: 30_000 });
  const products = await adviser.locator("li.card").count();
  note(`${products} products`);
  // Approving is refused until the vulnerable-client confirmation is given.
  const approve = adviser.getByRole("button", { name: "Approve the whole list" });
  if (!(await approve.isDisabled())) throw new Error("Approve is enabled before the vulnerable-client confirmation");
  await adviser.getByText("I have explained this advice to the client directly").click();
  const pick = adviser.getByText("Adviser's pick").first();
  state.picked = (await adviser.locator("li.card", { has: pick }).locator(".t-headline").first().innerText()).trim();
  await pick.click();
  await shot(adviser, "4a-adviser-before");
  await approve.click();
  await expectText(adviser, "The list is approved");
  note(`approved, pick: ${state.picked}`);
  await adviser.waitForLoadState("networkidle");
  await shot(adviser, "4b-adviser-approved");
}, () => adviser);

await step("5 client sees the list", async (note) => {
  const page = client!;
  if (!state.picked) throw new Error("nothing approved in step 4");
  await page.locator("ol.list-plain li.card").first().waitFor({ timeout: 60_000 });
  note("the list appeared by itself");
  const cards = page.locator("ol.list-plain > li.card");
  const n = await cards.count();
  const recommended = await cards.filter({ hasText: "你的顧問推薦" }).count();
  if (recommended !== 1) throw new Error(`${recommended} products are recommended, expected exactly the adviser's pick`);
  const rec = await cards.filter({ hasText: "你的顧問推薦" }).locator("h2").innerText();
  if (rec.trim() !== state.picked) throw new Error(`recommended "${rec}", the adviser picked "${state.picked}"`);
  note(`${n} products, 你的顧問推薦 on ${rec.trim()} only`);
  await shot(page, "5a-client-list-zh");
  await page.getByRole("button", { name: "English" }).click();
  await expectText(page, "Recommended by your adviser", 10_000);
  note("Recommended by your adviser (English)");
  await shot(page, "5b-client-list-en");
  await page.getByRole("button", { name: "繁體中文" }).click();

  // Open the pick: its explanation is written now, in Chinese. A refused attempt can be asked for again.
  await cards.filter({ hasText: "你的顧問推薦" }).getByRole("link").click();
  await page.waitForURL(/\/list\/.*\/.+/);
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const outcome = await Promise.any([
      page.waitForSelector(".verdict-hero p.t-body", { timeout: 240_000 }).then(() => "written"),
      page.getByText("暫時未能撰寫說明").waitFor({ timeout: 240_000 }).then(() => "failed"),
    ]);
    if (outcome === "written") {
      note(`explanation written in ${((Date.now() - t0) / 1000).toFixed(0)}s${attempt > 1 ? ` after ${attempt - 1} retr${attempt === 2 ? "y" : "ies"}` : ""}`);
      break;
    }
    if (attempt === 4) throw new Error("the explanation was refused four times");
    await page.getByRole("button", { name: "再試一次" }).click();
  }
  await page.waitForLoadState("networkidle");
  await shot(page, "5c-client-explanation-zh");
}, () => client);

await step("6 replay scrubber", async (note) => {
  const page = desk!;
  await open(page, `/cases/${LARKSPUR}/record`);
  const slider = page.getByRole("slider");
  await slider.waitFor({ timeout: 30_000 });
  const value = async () => Number(await slider.getAttribute("aria-valuenow"));
  const max = Number(await slider.getAttribute("aria-valuemax"));
  await slider.focus();
  await page.keyboard.press("Home");
  await page.waitForTimeout(700);
  const home = await value();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  const two = await value();
  await shot(page, "6a-replay-start");
  await page.keyboard.press("End");
  await page.waitForTimeout(700);
  const end = await value();
  if (!(home < two && two < end && end === max)) throw new Error(`the scrubber did not move: Home ${home}, two steps ${two}, End ${end} of ${max}`);
  note(`${max} events; Home ${home}, +2 ${two}, End ${end}`);
  await shot(page, "6b-replay-end");
}, () => desk);

await step("7 phone 390x844", async (note) => {
  const { page, context } = await newPage(browser, "phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  try {
    const sideways = async (label: string) => {
      const [scroll, inner] = (await page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")) as [number, number];
      if (scroll > inner) throw new Error(`${label} scrolls sideways on a phone (${scroll}px in ${inner})`);
    };
    await open(page, `/cases/${LARKSPUR}/canvas`);
    await page.locator("article.canvas-card").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await sideways("the canvas");
    await shot(page, "7a-phone-canvas");
    await page.locator(".canvas-status__head").click();
    await page.waitForTimeout(500);
    await shot(page, "7b-phone-activity");
    await page.keyboard.press("Escape");
    note("canvas ok");

    // Full screen on a phone (#83): the whole canvas section, the intent line and the Plan and Activity
    // buttons with it, at a card's life size so its buttons stay a finger's 44 points, and back out again
    // with the chrome exactly as it was.
    const chrome = await page.locator(".canvas-section > .canvas-summary").isVisible();
    await page.locator(".canvas__fullscreen").click();
    await page.waitForFunction(() => document.fullscreenElement !== null || !!document.querySelector("[data-fullscreen]"), null, { timeout: 10_000 });
    await page.waitForTimeout(600);
    const [sectionFull, plan, toolbar] = await Promise.all([
      page.evaluate(() => document.querySelector(".canvas-section")?.hasAttribute("data-fullscreen") || document.fullscreenElement?.classList.contains("canvas-section") === true),
      page.getByRole("button", { name: "Plan" }).isVisible(),
      page.locator(".canvas__toolbar").isVisible(),
    ]);
    if (!sectionFull) throw new Error("the canvas section did not go full screen on the phone");
    if (!plan || !toolbar) throw new Error("the phone's Plan button or the toolbar is not on screen full screen");
    // A card at life size is what keeps its buttons a finger's 44 points: the fit floors there (#83).
    const zoom = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".canvas__world")!).transform).a);
    if (zoom < 0.99) throw new Error(`the cards are not at life size in full screen (zoom ${zoom.toFixed(2)}), so their buttons are not a finger's 44 points`);
    await sideways("the full screen canvas");
    note(`section full screen at ${Math.round(zoom * 100)}%, Plan and toolbar on screen`);
    await shot(page, "7d-phone-full-screen");
    await page.getByRole("button", { name: "Plan" }).click();
    await page.locator('.sheet[role="dialog"]').waitFor({ timeout: 10_000 });
    await shot(page, "7e-phone-full-screen-plan");
    await page.keyboard.press("Escape");
    await page.locator('.sheet[role="dialog"]').waitFor({ state: "detached", timeout: 10_000 });
    if (await page.evaluate(() => document.fullscreenElement === null && !document.querySelector("[data-fullscreen]"))) {
      throw new Error("one Escape closed the sheet and left full screen");
    }
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    await page.waitForFunction(() => document.fullscreenElement === null && !document.querySelector("[data-fullscreen]"), null, { timeout: 10_000 });
    if (!(await page.locator(".canvas-section > .canvas-summary").isVisible()) || !chrome) throw new Error("the case chrome did not come back with it");
    await sideways("the canvas after full screen");
    note("back out, chrome as it was");
    await shot(page, "7f-phone-after-full-screen");
    if (state.clientId) {
      await open(page, `/list/${state.clientId}`);
      await page.locator("ol.list-plain li.card").first().waitFor({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      await sideways("the client's list");
      await shot(page, "7c-phone-client-list");
      note("client list ok");
    }
  } finally {
    await context.close();
  }
}, () => undefined);

await step("8 chains verify", async (note) => {
  for (const [label, id] of [["Larkspur", LARKSPUR], ["Wrenfield", WRENFIELD]] as const) {
    const res = await fetch(`${API}/cases/${id}/verify`);
    const body = (await res.json()) as { intact?: boolean; event_count?: number };
    if (res.status !== 200 || body.intact !== true) throw new Error(`${label}'s chain: ${res.status} ${JSON.stringify(body)}`);
    note(`${label} intact, ${body.event_count} events`);
  }
});

await browser.close();

// --- The record ---------------------------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
const table = [
  "| Step | Result | Time | Notes |",
  "| --- | --- | --- | --- |",
  ...results.map((r) => `| ${r.step} | ${r.ok ? "pass" : "FAIL"} | ${(r.ms / 1000).toFixed(1)} s | ${r.note.replace(/\|/g, "/")} |`),
  `| total | ${failed.length === 0 && problems.length === 0 ? "pass" : "FAIL"} | ${(results.reduce((sum, r) => sum + r.ms, 0) / 1000).toFixed(1)} s | |`,
].join("\n");
const report = `# e2e run ${new Date().toISOString()}\n\nweb ${WEB}\napi ${API}\n\n${table}\n\n${
  problems.length === 0 ? "No page errors, console errors or 4xx/5xx responses." : `## Browser problems\n\n${problems.map((p) => `- ${p}`).join("\n")}`
}\n`;
writeFileSync(`${OUT}/timings.md`, report);
console.log(`\n${table}\n`);
if (problems.length > 0) {
  console.error(`${problems.length} browser problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.error(`  ${p}`);
}
console.log(`written to ${OUT}`);
process.exit(failed.length === 0 && problems.length === 0 ? 0 : 1);
