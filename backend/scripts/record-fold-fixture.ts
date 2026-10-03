// pnpm record:fixture — drives the real API against a throwaway database and records the slim event
// stream into shared/fixtures, so the fold tests fold what the API actually emits and the browser has a
// case to fold with no model key.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DOCUMENTS } from "@qryvox/shared/pack-source";
import { EventPage, type IngestedDocument, PackManifest, PDFJS_VERSION, type StepName, StepResult } from "@qryvox/shared";
import { createApp } from "../src/app";
import { openDatabase, runMigrations } from "../src/db/client";
import { LlmError, type Llm } from "../src/llm";
import { ATTRIBUTES_SYSTEM_PROMPT } from "../src/steps/attributes";
import { COMPLIANCE_SYSTEM_PROMPT } from "../src/steps/compliance";
import { EXPLAIN_SYSTEM_PROMPT } from "../src/steps/explain";
import { CONTRADICTIONS_SYSTEM_PROMPT } from "../src/steps/contradictions";
import { DECOMPOSE_SYSTEM_PROMPT } from "../src/steps/decompose";
import { EXTRACT_SYSTEM_PROMPT } from "../src/steps/extract";
import { FINDINGS_SYSTEM_PROMPT } from "../src/steps/findings";

const out = fileURLToPath(new URL("../../shared/fixtures/case-recorded.json", import.meta.url));

// The four documents of the fabricated pack, ingested as the pack describes itself: the page text comes
// from the pack's one authored source, so every quote the run cites below is a line of it, exactly as
// pdf.js extracts it, and the identities and hashes come from the manifest the browser serves the pack
// from. The page text is dropped from the recorded stream — slim events carry no document text — but the
// run has to be grounded against it, so it has to be here.
const manifest = PackManifest.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../frontend/public/pack/manifest.json", import.meta.url)), "utf8")),
);
const documents: IngestedDocument[] = DOCUMENTS.map((source) => {
  const served = manifest.documents.find((d) => d.document_id === source.document_id);
  if (!served || served.filename !== source.filename || served.page_count !== source.pages.length) {
    throw new Error(`${source.document_id} is not in the served manifest as the pack source describes it`);
  }
  return {
    document_id: source.document_id,
    sha256: served.sha256,
    filename: served.filename,
    kind: source.kind,
    page_count: source.pages.length,
    // The markup tells the pack generator how to draw a line; pdf.js reads back the words.
    pages: source.pages.map((page) => page.map((line) => line.replace(/^#+ /, "")).join("\n")),
    pdfjs_version: PDFJS_VERSION,
  };
});

// One claim per planted passage, each quoting its page verbatim. The two claims of a planted
// contradiction share a topic so the contradictions step can pair them.
const claims = [
  { id: "c1", document_id: "factsheet", page: 1, quote: "Annual management fee: 0.85% per annum", category: "fees", topic: "management fee", assertion: "management fee 0.85% per annum" },
  { id: "c2", document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value", category: "fees", topic: "management fee", assertion: "management fee 1.25% of net asset value" },
  { id: "c3", document_id: "deck", page: 2, quote: "No entry or exit charges.", category: "fees", topic: "exit charge", assertion: "no entry or exit charges" },
  { id: "c4", document_id: "fee-table", page: 1, quote: "Redemption charge: 2.00% on units redeemed within 24 months of purchase", category: "fees", topic: "exit charge", assertion: "redemption charge 2.00% within 24 months" },
  { id: "c5", document_id: "factsheet", page: 1, quote: "The Fund invests only in investment-grade bonds.", category: "strategy", topic: "credit quality", assertion: "invests only in investment-grade bonds" },
  { id: "c6", document_id: "ppm", page: 1, quote: "3.3 The Fund may invest up to 40% of its net assets in sub-investment-grade bonds.", category: "strategy", topic: "credit quality", assertion: "may hold up to 40% sub-investment-grade" },
  { id: "c7", document_id: "deck", page: 1, quote: "Every holding is screened to exclude fossil fuel companies.", category: "strategy", topic: "esg screening", assertion: "screens out fossil fuel companies" },
  { id: "c8", document_id: "deck", page: 2, quote: "Target income of 6% a year, paid every month.", category: "risk", topic: "income", assertion: "targets 6% income paid monthly" },
  { id: "c9", document_id: "ppm", page: 2, quote: "5.2 Distributions are not guaranteed and may be paid out of capital.", category: "risk", topic: "income", assertion: "distributions not guaranteed, may come from capital" },
  { id: "c10", document_id: "factsheet", page: 1, quote: "Dealing: daily, on any business day", category: "terms", topic: "dealing frequency", assertion: "dealing daily on any business day" },
  { id: "c11", document_id: "ppm", page: 3, quote: "7.3 Redemptions are processed monthly, on the last business day of each month.", category: "terms", topic: "dealing frequency", assertion: "redemptions processed monthly" },
];

// The first contradictions run sees the pack before the fee table is cross-read and finds only the fee
// contradiction; the re-run below reads all four documents and finds the other five.
const firstIssue = {
  kind: "contradiction",
  category: "fees",
  claim_id: "c1",
  counterpart_claim_id: "c2",
  explanation: "The factsheet states 0.85% per annum; the fee table states 1.25% of net asset value.",
};
const issues = [
  firstIssue,
  { kind: "contradiction", category: "fees", claim_id: "c3", counterpart_claim_id: "c4", explanation: "The deck states no entry or exit charges; the fee table charges 2.00% within 24 months." },
  { kind: "contradiction", category: "strategy", claim_id: "c5", counterpart_claim_id: "c6", explanation: "The factsheet states investment-grade only; the PPM allows up to 40% sub-investment-grade." },
  { kind: "unsupported_claim", category: "strategy", claim_id: "c7", counterpart_claim_id: null, explanation: "The deck states a fossil fuel exclusion screen; the PPM investment policy describes none." },
  { kind: "disclosure_gap", category: "risk", claim_id: "c8", counterpart_claim_id: "c9", explanation: "The deck promises monthly income with no risk warning; the PPM says distributions are not guaranteed." },
  { kind: "contradiction", category: "terms", claim_id: "c10", counterpart_claim_id: "c11", explanation: "The factsheet offers daily dealing; the PPM processes redemptions monthly." },
];

const firstFinding = { issue: 1, severity: "high", claim: "The factsheet states a 0.85% management fee per annum; the fee table states 1.25% of net asset value." };
const findings = [
  firstFinding,
  { issue: 2, severity: "high", claim: "The deck states no entry or exit charges; the fee table charges 2.00% on units redeemed within 24 months." },
  { issue: 3, severity: "high", claim: "The factsheet states the Fund invests only in investment-grade bonds; the PPM allows up to 40% sub-investment-grade." },
  { issue: 4, severity: "medium", claim: "The deck states every holding is screened to exclude fossil fuel companies; the PPM investment policy describes no such screen." },
  { issue: 5, severity: "high", claim: "The deck promises a target income of 6% a year with no risk warning; the PPM states distributions are not guaranteed." },
  { issue: 6, severity: "medium", claim: "The factsheet states dealing is daily on any business day; the PPM processes redemptions monthly." },
];

// A scripted model answering call by call, so the run is told exactly which step each reply belongs to.
// Call 1 fails as if the endpoint were down; the retry reuses the same run id and spends no tokens.
const script: [step: StepName, reply: unknown][] = [
  ["extract", { statements: claims.map(({ document_id, page, quote }) => ({ document_id, page, quote })) }],
  ["decompose", { claims }],
  ["contradictions", { issues: [firstIssue] }],
  ["findings", { findings: [firstFinding] }],
  ["contradictions", { issues }],
  ["findings", { findings }],
];
const PROMPTS: Record<StepName, string> = {
  extract: EXTRACT_SYSTEM_PROMPT,
  decompose: DECOMPOSE_SYSTEM_PROMPT,
  contradictions: CONTRADICTIONS_SYSTEM_PROMPT,
  findings: FINDINGS_SYSTEM_PROMPT,
  compliance: COMPLIANCE_SYSTEM_PROMPT,
  attributes: ATTRIBUTES_SYSTEM_PROMPT,
  explain: EXPLAIN_SYSTEM_PROMPT,
};
let calls = 0;
const llm: Llm = {
  model: "recorded-fake-model",
  async complete(messages) {
    calls += 1;
    if (calls === 1) throw new LlmError("model endpoint unreachable: recorded outage");
    const [step, reply] = script[calls - 2]!;
    if (messages[0]?.content !== PROMPTS[step]) throw new Error(`call ${calls}: not the ${step} prompt`);
    const content = JSON.stringify(reply);
    return { content, raw: { choices: [{ message: { content } }] } };
  },
};

const database = openDatabase(pathToFileURL(join(mkdtempSync(join(tmpdir(), "qryvox-fixture-")), "fixture.db")).href);
await runMigrations(database.db);
const app = createApp({
  ...database,
  llm,
  guards: {
    allowedOrigins: ["http://localhost:3000"],
    ipHashSecret: "fixture-secret",
    limits: { windowSeconds: 3600, stepsPerIp: 1000, stepsPerCase: 1000 },
    judgeToken: null,
  },
});

async function call(method: string, path: string, body?: unknown, ok = [200, 201]): Promise<unknown> {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!ok.includes(res.status)) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const { case_id } = (await call("POST", "/cases", { event_id: randomUUID() })) as { case_id: string };
for (const document of documents) {
  await call("POST", `/cases/${case_id}/documents`, { event_id: randomUUID(), document });
}
async function step(step: StepName, inputRunId: string | null, stepRunId = randomUUID(), ok?: number[]) {
  const body = { step_run_id: stepRunId, step, input_run_id: inputRunId };
  return call("POST", `/cases/${case_id}/steps`, body, ok);
}

// extract fails once and is retried under the same run id; the pipeline then runs through, and
// contradictions and findings are each run a second time over the same decompose output, so the first
// findings run's finding is superseded by the second's six.
const extractRun = randomUUID();
await step("extract", null, extractRun, [502]);
await step("extract", null, extractRun);
const decomposeRun = StepResult.parse(await step("decompose", extractRun)).step_run_id;
const runOnce = async () => {
  const contradictionsRun = StepResult.parse(await step("contradictions", decomposeRun)).step_run_id;
  await step("findings", contradictionsRun);
};
await runOnce();
await runOnce();

const { events } = EventPage.parse(await call("GET", `/cases/${case_id}/events`));

writeFileSync(out, JSON.stringify(events, null, 2) + "\n");
database.client.close();
console.log(`recorded ${events.length} events to ${out}`);
