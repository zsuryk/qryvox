// pnpm record:fixture — drives the real API against a throwaway database and records the slim event
// stream into shared/test/fixtures, so the fold tests fold what the API actually emits.
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EventPage, type IngestedDocument, type StepName, StepResult } from "@qryvox/shared";
import { createApp } from "../src/app";
import { openDatabase, runMigrations } from "../src/db/client";
import { LlmError, type Llm } from "../src/llm";
import { CONTRADICTIONS_SYSTEM_PROMPT } from "../src/steps/contradictions";
import { DECOMPOSE_SYSTEM_PROMPT } from "../src/steps/decompose";
import { FINDINGS_SYSTEM_PROMPT } from "../src/steps/findings";

const out = fileURLToPath(new URL("../../shared/test/fixtures/case-recorded.json", import.meta.url));

const database = openDatabase(pathToFileURL(join(mkdtempSync(join(tmpdir(), "qryvox-fixture-")), "fixture.db")).href);
await runMigrations(database.db);
// A scripted model for the factsheet and PPM below: the first call fails as if the endpoint were down,
// then each step gets a canned reply that finds the one planted fee contradiction.
const factsheetFee = { document_id: "factsheet", page: 1, quote: "Management fee: 0.85% per annum." };
const ppmFee = { document_id: "ppm", page: 2, quote: "The management fee is 1.10% per annum." };
const replies: [string | null, unknown][] = [
  [DECOMPOSE_SYSTEM_PROMPT, {
    claims: [
      { id: "c1", ...factsheetFee, category: "fees", topic: "management fee", assertion: "management fee 0.85% per annum" },
      { id: "c2", ...ppmFee, category: "fees", topic: "management fee", assertion: "management fee 1.10% per annum" },
    ],
  }],
  [CONTRADICTIONS_SYSTEM_PROMPT, {
    issues: [{ kind: "contradiction", category: "fees", claim_id: "c1", counterpart_claim_id: "c2", explanation: "0.85% vs 1.10%." }],
  }],
  [FINDINGS_SYSTEM_PROMPT, {
    findings: [{ issue: 1, severity: "high", claim: "The factsheet states a 0.85% management fee; the PPM states 1.10%." }],
  }],
  [null, { statements: [factsheetFee, ppmFee] }],
];
let calls = 0;
const llm: Llm = {
  model: "recorded-fake-model",
  async complete(messages) {
    calls += 1;
    if (calls === 1) throw new LlmError("model endpoint unreachable: recorded outage");
    const content = JSON.stringify(replies.find(([prompt]) => prompt === null || prompt === messages[0]?.content)![1]);
    return { content, raw: { choices: [{ message: { content } }] } };
  },
};
const app = createApp({
  ...database,
  llm,
  guards: {
    allowedOrigins: ["http://localhost:3000"],
    ipHashSecret: "fixture-secret",
    limits: { windowSeconds: 3600, stepsPerIp: 1000, stepsPerCase: 1000 },
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

const documents: IngestedDocument[] = [
  {
    document_id: "factsheet",
    sha256: "1f".repeat(32),
    filename: "factsheet.pdf",
    kind: "factsheet",
    page_count: 1,
    pages: ["Management fee: 0.85% per annum."],
    pdfjs_version: "5.0.0",
  },
  {
    document_id: "ppm",
    sha256: "2e".repeat(32),
    filename: "ppm-excerpt.pdf",
    kind: "ppm",
    page_count: 2,
    pages: ["Investment objective.", "The management fee is 1.10% per annum."],
    pdfjs_version: "5.0.0",
  },
];

const { case_id } = (await call("POST", "/cases", { event_id: randomUUID() })) as { case_id: string };
for (const document of documents) {
  await call("POST", `/cases/${case_id}/documents`, { event_id: randomUUID(), document });
}
async function step(step: StepName, inputRunId: string | null, stepRunId = randomUUID(), ok?: number[]) {
  const body = { step_run_id: stepRunId, step, input_run_id: inputRunId };
  return call("POST", `/cases/${case_id}/steps`, body, ok);
}

// extract fails once and is retried under the same run id; then the pipeline runs through, and findings
// is run a second time so the first run's finding is superseded.
const extractRun = randomUUID();
await step("extract", null, extractRun, [502]);
await step("extract", null, extractRun);
let input: string = extractRun;
let contradictionsRun = "";
for (const name of ["decompose", "contradictions", "findings"] as const) {
  input = StepResult.parse(await step(name, input)).step_run_id;
  if (name === "contradictions") contradictionsRun = input;
}
await step("findings", contradictionsRun);

const { events } = EventPage.parse(await call("GET", `/cases/${case_id}/events`));

writeFileSync(out, JSON.stringify(events, null, 2) + "\n");
database.client.close();
console.log(`recorded ${events.length} events to ${out}`);
