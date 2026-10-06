// pnpm seed:demo -- --base <url> [--token <API token>] [--web <frontend url>]
//
// The Larkspur and Wrenfield packs it seeds are fabricated fixtures, not real products.
//
// Builds the demo state on any deployment, through the HTTP API only: two verified products (Larkspur,
// revised, and Wrenfield) with the five steps run, facts read, rationales written and every finding on the
// board dispositioned, then for each product's three personas a profile, a drafted advice, an explanation and
// the adviser's approval. Someone opening the deployment then finds what the local demo shows.
//
//   pnpm seed:demo -- --base https://qryvox-api.vercel.app --token $API_TOKEN --web https://qryvox.vercel.app
//
// Idempotent by product. A product's case id is derived from its pack, so a second run lands on the same case,
// reads its log, and does only what the log says is missing: a product already verified, dispositioned and
// approved costs no model call. Nothing here is a backend feature; it is what a person with a browser does.
//
// Dispositions (the rule): the answer key says which findings are planted. A finding on the board that matches
// a planted entry (same category, and either quote contains the planted quote: frontend/lib/eval.ts) is
// approved; every other finding is dismissed as noise. So the seeded board is the answer key, nothing more.
//
// Documents: read from the same PDFs the browser serves (frontend/public/pack) through the browser's own
// parseDocument and pdf.js build (frontend/lib/intake.ts), so the text and hashes are identical to a drop.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  activeFindings,
  type CaseState,
  dispositionOf,
  type DocumentKind,
  explanationFor,
  fold,
  GroundTruth,
  type GroundTruthEntry,
  type IngestedDocument,
  API_TOKEN_HEADER,
  PackManifest,
  PersonaSet,
  type SlimEvent,
  type StepName,
  type StepResult,
} from "@qryvox/shared";

// pnpm forwards the "--" in `pnpm seed:demo -- --base ...`, and parseArgs would read everything after it as positional.
const argv = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--"));
const { values: args } = parseArgs({
  args: argv,
  options: { base: { type: "string" }, token: { type: "string" }, web: { type: "string" } },
  allowPositionals: true,
});
const BASE = (args.base ?? process.env.SEED_BASE_URL ?? "").replace(/\/$/, "");
const TOKEN = args.token ?? process.env.API_TOKEN ?? "";
const WEB = (args.web ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("usage: pnpm seed:demo -- --base <api url> [--token <API token>] [--web <frontend url>]");
  process.exit(2);
}

// The retries a refused run gets: a grounding refusal (422) or an unreachable model (502) is the model's
// variance, so the same step is asked again under a new step_run_id, as a browser's retry would be.
const RETRIES = 3;

const frontend = (path: string) => new URL(`../../frontend/${path}`, import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(frontend(path), "utf8"));

// What the demo holds, in the order its cases are built: the pack's folder under public/pack and public/eval.
const PACKS = [
  { dir: "v2/", label: "Larkspur, revised" },
  { dir: "wrenfield/", label: "Wrenfield" },
] as const;

// --- Reading the pack the way the browser does ---------------------------------------------------------

type ParseDocument = (
  file: { filename: string; read: () => Promise<Uint8Array<ArrayBuffer>>; documentId: string; kind: DocumentKind },
  bytes: Uint8Array<ArrayBuffer>,
  assets: { standardFontDataUrl: string },
) => Promise<IngestedDocument>;

// Imported by path at run time, not statically: the frontend's code is the one place that knows how a PDF
// becomes a document.ingested, and a static import would drag the frontend into this package's typecheck.
const { parseDocument } = (await import(pathToFileURL(fileURLToPath(frontend("lib/intake.ts"))).href)) as { parseDocument: ParseDocument };
const assets = { standardFontDataUrl: fileURLToPath(new URL("../../frontend/node_modules/pdfjs-dist/standard_fonts/", import.meta.url)) };

async function readPack(dir: string): Promise<{ manifest: PackManifest; documents: IngestedDocument[]; truth: GroundTruth; personas: PersonaSet }> {
  const manifest = PackManifest.parse(readJson(`public/pack/${dir}manifest.json`));
  const documents: IngestedDocument[] = [];
  for (const entry of manifest.documents) {
    const bytes = new Uint8Array(readFileSync(frontend(`public/pack/${dir}${entry.filename}`)));
    const file = { filename: entry.filename, documentId: entry.document_id, kind: entry.kind, read: async () => bytes };
    const document = await parseDocument(file, bytes, assets);
    if (document.sha256 !== entry.sha256) throw new Error(`${entry.filename} hashes to ${document.sha256}, not the manifest's ${entry.sha256}`);
    documents.push(document);
  }
  return {
    manifest,
    documents,
    truth: GroundTruth.parse(readJson(`public/eval/${dir}ground-truth.json`)),
    personas: PersonaSet.parse(readJson(`public/eval/${dir}personas.json`)),
  };
}

// A planted finding, by the browser's own definition (frontend/lib/eval.ts matches).
const normalise = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
function isPlanted(finding: { category: string; citation: { quote: string }; counterpart: { quote: string } | null }, entries: GroundTruthEntry[]): boolean {
  return entries.some((planted) => {
    if (finding.category !== planted.category) return false;
    const target = normalise(planted.citation.quote);
    return [finding.citation.quote, finding.counterpart?.quote]
      .filter((q): q is string => q !== undefined)
      .map(normalise)
      .some((q) => q.includes(target) || target.includes(q));
  });
}

// --- HTTP ----------------------------------------------------------------------------------------------

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (TOKEN) headers[API_TOKEN_HEADER] = TOKEN;
  for (let attempt = 0; ; attempt += 1) {
    // Every call here is safe to repeat (ids are the seed's, ADR-0002), so a dropped connection, as when a
    // local server restarts under a long step, is retried rather than fatal.
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    }).catch(async (cause) => {
      if (attempt >= 5) throw cause;
      console.log(`    ${method} ${path} dropped (${cause?.cause?.code ?? cause}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return null;
    });
    if (res === null) continue;
    // A rate limit is a wait, not a failure: the run is allowed again after Retry-After.
    if (res.status === 429 && attempt < 5) {
      const wait = Math.min(Number(res.headers.get("retry-after") ?? 30), 300);
      console.log(`    rate limited; waiting ${wait}s`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
  }
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await call("POST", path, body);
  if (res.status >= 300) throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json;
}

async function readLog(caseId: string): Promise<SlimEvent[]> {
  const events: SlimEvent[] = [];
  for (let after = 0; ; ) {
    const res = await call("GET", `/cases/${caseId}/events?after=${after}&limit=200`);
    if (res.status !== 200) throw new Error(`GET events of ${caseId} -> ${res.status}`);
    const page = res.json as { events: SlimEvent[]; has_more: boolean };
    events.push(...page.events);
    if (!page.has_more || page.events.length === 0) return events;
    after = page.events.at(-1)!.seq;
  }
}

// Ids the seed derives rather than draws, so a rerun names the same case, document and decision events and
// the server's appendOnce hands back what it already wrote: the same shape as the browser's documentEventId.
function derivedId(...parts: string[]): string {
  const bytes = createHash("sha256").update(["qryvox-demo-seed", ...parts].join("/")).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- Steps, with what they cost ------------------------------------------------------------------------

type Spend = { product: string; label: string; ms: number; tokens: number | null; attempts: number };
const spend: Spend[] = [];

// One step to completion: a 422 or 502 is retried under a new step_run_id, up to RETRIES more times.
// Returns the run id that completed. What it cost is read from the stored run's raw model response.
async function runStep(caseId: string, product: string, label: string, request: { step: StepName; input_run_id: string | null }): Promise<string> {
  let last = "";
  for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
    const stepRunId = randomUUID();
    const started = Date.now();
    const res = await call("POST", `/cases/${caseId}/steps`, { step_run_id: stepRunId, ...request });
    const ms = Date.now() - started;
    if (res.status === 200) {
      const result = res.json as StepResult;
      const stored = await call("GET", `/cases/${caseId}/events/${result.seq}/payload`);
      const usage = (stored.json as { payload?: { raw_response?: { usage?: { total_tokens?: number } } } } | null)?.payload?.raw_response?.usage;
      spend.push({ product, label, ms, tokens: usage?.total_tokens ?? null, attempts: attempt });
      console.log(`  ${label}: ok in ${(ms / 1000).toFixed(1)}s, ${usage?.total_tokens ?? "?"} tokens${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      return stepRunId;
    }
    last = `${res.status}: ${(res.json as { error?: string } | null)?.error ?? "no body"}`;
    if (res.status !== 422 && res.status !== 502) break;
    console.log(`  ${label}: refused (${last}); retrying`);
  }
  throw new Error(`${label} failed on ${caseId}: ${last}`);
}

const latestCompleted = (state: CaseState, step: StepName, inputRunId?: string | null) =>
  state.stepRuns.filter((r) => r.step === step && r.status === "completed" && (inputRunId === undefined || r.inputRunId === inputRunId)).at(-1)?.stepRunId ?? null;

// --- One product ---------------------------------------------------------------------------------------

type Pack = Awaited<ReturnType<typeof readPack>>;

// Opens the case, ingests the pack, and runs what the log does not yet hold: five steps in the browser's
// order (frontend/lib/pipeline.ts), the facts, the rationales, then the dispositions.
async function buildProduct(pack: Pack, label: string): Promise<string> {
  const product = pack.manifest.product;
  const caseId = derivedId("case", pack.manifest.pack_id);
  console.log(`\n${label}: ${product} (${pack.manifest.pack_id}), case ${caseId}`);
  await post("/cases", { event_id: caseId });

  let state = fold(await readLog(caseId));
  for (const document of pack.documents) {
    if (state.documents.some((d) => d.sha256 === document.sha256)) continue;
    await post(`/cases/${caseId}/documents`, { event_id: derivedId("document", caseId, document.sha256), document });
    console.log(`  ingested ${document.filename}`);
  }

  let previous: string | null = null;
  for (const step of ["extract", "decompose", "contradictions", "compliance", "findings"] as const) {
    state = fold(await readLog(caseId));
    const held = latestCompleted(state, step, previous);
    previous = held ?? (await runStep(caseId, product, step, { step, input_run_id: previous }));
  }
  const findingsRun = previous!;

  state = fold(await readLog(caseId));
  if (!latestCompleted(state, "attributes")) await runStep(caseId, product, "attributes", { step: "attributes", input_run_id: null });
  // Optional in the product: a failed rationale run leaves the cards on their derived line, so it never stops the seed.
  if (!state.stepRuns.some((r) => r.step === "rationale" && r.inputRunId === findingsRun && r.status === "completed")) {
    await runStep(caseId, product, "rationale", { step: "rationale", input_run_id: findingsRun }).catch((cause) => console.warn(`  rationale skipped: ${cause}`));
  }

  state = fold(await readLog(caseId));
  const board = activeFindings(state);
  let approved = 0;
  let dismissed = 0;
  for (const finding of board) {
    const disposition = isPlanted(finding, pack.truth.entries) ? "approved" : "dismissed";
    if (disposition === "approved") approved += 1;
    else dismissed += 1;
    if (dispositionOf(state, finding.finding_id)?.disposition === disposition) continue;
    await post(`/cases/${caseId}/dispositions`, { event_id: randomUUID(), finding_id: finding.finding_id, disposition });
  }
  console.log(`  findings: ${board.length} on the board, ${approved} approved (planted), ${dismissed} dismissed`);
  return caseId;
}

// For each persona: profile, draft, explain, approve. Run once every product is verified, so the draft's shelf
// comparison holds the other product.
async function advisePersonas(pack: Pack, caseId: string): Promise<void> {
  const product = pack.manifest.product;
  console.log(`\n${product}: personas`);
  for (const persona of pack.personas.personas) {
    const clientId = persona.profile.client_id;
    let state = fold(await readLog(caseId));
    const held = state.clients.find((c) => c.clientId === clientId);
    if (!held || JSON.stringify(held.profile) !== JSON.stringify(persona.profile)) {
      await post(`/cases/${caseId}/clients`, { event_id: derivedId("profile", caseId, clientId), profile: persona.profile });
      state = fold(await readLog(caseId));
    }

    let advice = state.advice.find((a) => a.client_id === clientId && a.supersededAtSeq === null);
    if (!advice) {
      await post(`/cases/${caseId}/advice`, { event_id: derivedId("advice", caseId, clientId), client_id: clientId });
      state = fold(await readLog(caseId));
      advice = state.advice.find((a) => a.client_id === clientId && a.supersededAtSeq === null);
    }
    if (!advice) throw new Error(`no advice in play for ${clientId} after drafting`);

    const events = await readLog(caseId);
    if (!explanationFor(events, advice.adviceId)) {
      await runStep(caseId, product, `explain ${persona.name}`, { step: "explain", input_run_id: advice.adviceId });
    }
    if (advice.decision?.decision !== "approved") {
      await post(`/cases/${caseId}/advice/${advice.adviceId}/decision`, {
        event_id: derivedId("decision", caseId, advice.adviceId),
        decision: "approved",
        confirmations: ["explained_directly"],
      });
    }
    const note = advice.verdict === persona.expected_verdict ? "as the answer key expects" : `ANSWER KEY EXPECTS ${persona.expected_verdict}`;
    console.log(`  ${persona.name}: ${advice.verdict} (${note}), approved, ${advice.shelf?.length ?? 0} other product(s) compared`);
  }
}

// --- Run -----------------------------------------------------------------------------------------------

// Printed before anything runs, so a run that dies half way still says what it was doing.
console.log("DEMO DATA — fabricated");
console.log(`seeding ${BASE}${TOKEN ? " (API token set)" : ""}`);
const health = await call("GET", "/health");
if (health.status !== 200) throw new Error(`GET /health -> ${health.status}: is ${BASE} an API?`);

const packs: { pack: Pack; label: string; caseId: string }[] = [];
for (const { dir, label } of PACKS) {
  const pack = await readPack(dir);
  packs.push({ pack, label, caseId: await buildProduct(pack, label) });
}
for (const { pack, caseId } of packs) await advisePersonas(pack, caseId);

console.log("\nVerification");
let failed = false;
for (const { pack, caseId } of packs) {
  const verify = (await call("GET", `/cases/${caseId}/verify`)).json as { intact: boolean; event_count: number };
  if (!verify.intact) failed = true;
  console.log(`  ${pack.manifest.product}: chain ${verify.intact ? "intact" : "BROKEN"}, ${verify.event_count} events`);
}

console.log("\nCases");
for (const { pack, caseId } of packs) {
  console.log(`  ${pack.manifest.product} (${pack.manifest.pack_id})`);
  console.log(`    case:    ${WEB ? `${WEB}/cases/${caseId}` : caseId}`);
  for (const persona of pack.personas.personas) console.log(`    ${persona.name.padEnd(8)} ${WEB ? `${WEB}/clients/${caseId}/${persona.profile.client_id}` : persona.profile.client_id}`);
}

console.log("\nSpend this run (steps already on the log cost nothing and are not listed)");
if (spend.length === 0) console.log("  none: everything was already built");
for (const row of spend) console.log(`  ${row.product.padEnd(32)} ${row.label.padEnd(22)} ${(row.ms / 1000).toFixed(1).padStart(6)}s ${String(row.tokens ?? "?").padStart(7)} tokens`);
if (spend.length > 0) {
  const total = spend.reduce((sum, r) => sum + (r.tokens ?? 0), 0);
  console.log(`  total ${(spend.reduce((s, r) => s + r.ms, 0) / 60000).toFixed(1)} min, ${total} tokens`);
}
process.exit(failed ? 1 : 0);
