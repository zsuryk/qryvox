// A scripted four-step pipeline for HTTP tests: a factsheet and fee table with one planted fee
// contradiction, a fake model that answers each step by its prompt, and helpers to drive and fold a case.
import { randomUUID } from "node:crypto";
import { EventPage, fold, type IngestedDocument, type StepName, StepResult } from "@qryvox/shared";
import { expect } from "vitest";
import { ATTRIBUTES_SYSTEM_PROMPT } from "../src/steps/attributes";
import { EXPLAIN_SYSTEM_PROMPT } from "../src/steps/explain";
import { CONTRADICTIONS_SYSTEM_PROMPT } from "../src/steps/contradictions";
import { DECOMPOSE_SYSTEM_PROMPT } from "../src/steps/decompose";
import { EXTRACT_SYSTEM_PROMPT } from "../src/steps/extract";
import { FINDINGS_SYSTEM_PROMPT } from "../src/steps/findings";
import type { ChatMessage } from "../src/llm";
import { FakeLlm, sampleDocument, type TestApp } from "./helpers";

export const factsheet = sampleDocument();
export const feeTable: IngestedDocument = {
  document_id: "fee-table",
  sha256: "b".repeat(64),
  filename: "fee-table.pdf",
  kind: "fee_table",
  page_count: 1,
  pages: ["Annual management fee: 1.25% of net asset value"],
  pdfjs_version: "5.0.0",
};

// Canned replies for the factsheet + fee table above: one planted fee contradiction.
export const REPLIES = {
  extract: {
    statements: [
      { document_id: "factsheet", page: 1, quote: "Management fee: 0.85% per annum." },
      { document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value" },
    ],
  },
  decompose: {
    claims: [
      { id: "c1", document_id: "factsheet", page: 1, quote: "Management fee: 0.85% per annum.", category: "fees", topic: "management fee", assertion: "management fee is 0.85% per annum" },
      { id: "c2", document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value", category: "fees", topic: "management fee", assertion: "management fee is 1.25% of NAV" },
    ],
  },
  contradictions: {
    issues: [
      { kind: "contradiction", category: "fees", claim_id: "c1", counterpart_claim_id: "c2", explanation: "Factsheet says 0.85%, fee table says 1.25%." },
    ],
  },
  findings: {
    findings: [{ issue: 1, severity: "high", claim: "The factsheet states a 0.85% management fee; the fee table states 1.25%." }],
  },
  // These two documents state no product attributes; the attributes step has its own tests on the real pack.
  attributes: {},
  explain: {},
} satisfies Record<StepName, unknown>;

const PROMPTS: [string, StepName][] = [
  [EXTRACT_SYSTEM_PROMPT, "extract"],
  [DECOMPOSE_SYSTEM_PROMPT, "decompose"],
  [CONTRADICTIONS_SYSTEM_PROMPT, "contradictions"],
  [FINDINGS_SYSTEM_PROMPT, "findings"],
  [ATTRIBUTES_SYSTEM_PROMPT, "attributes"],
  [EXPLAIN_SYSTEM_PROMPT, "explain"],
];

function stepOf(messages: ChatMessage[]): StepName {
  const step = PROMPTS.find(([prompt]) => messages[0]?.content === prompt)?.[1];
  if (!step) throw new Error("unknown prompt");
  return step;
}

export function pipelineLlm(override: Partial<Record<StepName, unknown>> = {}, delayMs = 0) {
  return new FakeLlm(async (messages) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const step = stepOf(messages);
    return JSON.stringify(override[step] ?? REPLIES[step]);
  });
}

export async function caseWithPack(t: TestApp) {
  const caseId = await t.openCase();
  for (const document of [factsheet, feeTable]) {
    await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  }
  return caseId;
}

export async function step(t: TestApp, caseId: string, name: StepName, inputRunId: string | null, stepRunId = randomUUID()) {
  return t.request("POST", `/cases/${caseId}/steps`, { step_run_id: stepRunId, step: name, input_run_id: inputRunId });
}

export async function runPipeline(t: TestApp, caseId: string) {
  const runs: Partial<Record<StepName, StepResult>> = {};
  let input: string | null = null;
  for (const name of ["extract", "decompose", "contradictions", "findings"] as const) {
    const res = await step(t, caseId, name, input);
    expect(res.status, `${name} failed: ${await res.clone().text()}`).toBe(200);
    runs[name] = StepResult.parse(await res.json());
    input = runs[name].step_run_id;
  }
  return runs as Record<StepName, StepResult>;
}

export async function board(t: TestApp, caseId: string) {
  const { events } = EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json());
  return { events, state: fold(events) };
}
