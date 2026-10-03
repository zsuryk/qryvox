import { randomUUID } from "node:crypto";
import { activeFindings, type ClientProfile, ErrorResponse, EventPage, fold, GroundTruth, StepResult } from "@qryvox/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPLIANCE_SYSTEM_PROMPT } from "../src/steps/compliance";
import { FakeLlm, setup, type TestApp } from "./helpers";
import { larkspurLlm, pack } from "./larkspur";

const groundTruth = GroundTruth.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../frontend/public/eval/ground-truth.json", import.meta.url)), "utf8")),
);

async function larkspur(llm = larkspurLlm()) {
  const t = await setup({ llm });
  const caseId = await t.openCase();
  for (const document of pack) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  return { t, caseId };
}

const call = (t: TestApp, caseId: string, step: string, input: string | null) =>
  t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step, input_run_id: input });

async function run(t: TestApp, caseId: string, steps: string[], input: string | null = null) {
  for (const step of steps) {
    const res = await call(t, caseId, step, input);
    expect(res.status, `${step}: ${await res.clone().text()}`).toBe(200);
    input = StepResult.parse(await res.json()).step_run_id;
  }
  return input!;
}

async function board(t: TestApp, caseId: string) {
  return fold(EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json()).events);
}

// The Larkspur fake, with compliance answering as given and every other step as usual.
function answeringCompliance(gaps: unknown[]) {
  const usual = larkspurLlm();
  return new FakeLlm(async (messages, n) =>
    messages[0]?.content === COMPLIANCE_SYSTEM_PROMPT ? JSON.stringify({ gaps }) : (await usual.complete(messages)).content ?? String(n),
  );
}

describe("the five-step pipeline", () => {
  it("puts the factsheet's policy gaps on the board, each naming its rule and citing the PPM", async () => {
    const { t, caseId } = await larkspur();
    await run(t, caseId, ["extract", "decompose", "contradictions", "compliance", "findings"]);

    const gaps = activeFindings(await board(t, caseId)).filter((f) => f.kind === "policy_gap");
    expect(gaps.map((f) => [f.rule, f.category, f.citation.document_id, f.counterpart?.document_id])).toEqual([
      ["P1", "risk", "factsheet", "ppm"],
      ["P2", "risk", "factsheet", "ppm"],
      ["P3", "fees", "factsheet", "ppm"],
    ]);
  });

  it("raises them on the passages the ground truth plants", async () => {
    const { t, caseId } = await larkspur();
    await run(t, caseId, ["extract", "decompose", "contradictions", "compliance", "findings"]);

    const planted = groundTruth.entries.filter((e) => e.kind === "policy_gap" && e.citation.document_id === "factsheet");
    const raised = activeFindings(await board(t, caseId)).filter((f) => f.kind === "policy_gap");
    expect(raised.map((f) => [f.rule, f.citation.quote]).sort()).toEqual(planted.map((e) => [e.rule, e.citation.quote]).sort());
  });

  it("keeps the contradictions alongside the policy gaps", async () => {
    const { t, caseId } = await larkspur();
    await run(t, caseId, ["extract", "decompose", "contradictions", "compliance", "findings"]);

    expect(activeFindings(await board(t, caseId)).map((f) => f.kind)).toEqual([
      "contradiction",
      "contradiction",
      "policy_gap",
      "policy_gap",
      "policy_gap",
    ]);
  });

  it("still runs as four steps: findings takes the contradictions run directly", async () => {
    const { t, caseId } = await larkspur();
    await run(t, caseId, ["extract", "decompose", "contradictions", "findings"]);
    expect(activeFindings(await board(t, caseId)).every((f) => f.kind === "contradiction")).toBe(true);
  });

  it("discloses the factsheet's missing exit charge to a client (S6), citing the PPM", async () => {
    const { t, caseId } = await larkspur();
    await run(t, caseId, ["extract", "decompose", "contradictions", "compliance", "findings"]);
    await run(t, caseId, ["attributes"]);
    const chan: ClientProfile = {
      client_id: "persona-chan",
      goal: "income",
      horizon_years: 2,
      risk_level: 2,
      knowledge: "novice",
      relies_on_income: true,
      may_need_cash_at_short_notice: true,
      exclusions: [],
    };
    await t.request("POST", `/cases/${caseId}/clients`, { event_id: randomUUID(), profile: chan });
    await t.request("POST", `/cases/${caseId}/advice`, { event_id: randomUUID(), client_id: "persona-chan" });

    const disclosed = (await board(t, caseId)).advice[0]!.disclosures.map((d) => d.citation.quote);
    expect(disclosed).toContain("7.2 A redemption charge of 2.00% applies to units redeemed within 24 months of purchase.");
  });
});

describe("the gaps it keeps", () => {
  async function kept(gaps: unknown[]) {
    const { t, caseId } = await larkspur(answeringCompliance(gaps));
    const contradictions = await run(t, caseId, ["extract", "decompose", "contradictions"]);
    const res = await call(t, caseId, "compliance", contradictions);
    expect(res.status).toBe(200);
    return (StepResult.parse(await res.json()).output as { issues: { kind: string; rule?: string; claim_id: string }[] }).issues.filter(
      (i) => i.kind === "policy_gap",
    );
  }
  const gap = (rule: string, claim: string, counterpart: string | null) => ({
    rule,
    claim_id: claim,
    counterpart_claim_id: counterpart,
    explanation: "Something is missing.",
  });

  it("sets the category from the rule, not the model", async () => {
    expect(await kept([gap("P3", "c7", "c8")])).toMatchObject([{ rule: "P3", claim_id: "c7", category: "fees" }]);
  });

  it("drops a gap on a claim an earlier issue already raised", async () => {
    // c1 is the factsheet's management fee, already a contradiction.
    expect(await kept([gap("P3", "c1", "c8")])).toEqual([]);
  });

  it("drops a rule applied to a document it does not govern", async () => {
    // P2 governs the factsheet only; c4 is on the fee table.
    expect(await kept([gap("P2", "c4", "c10")])).toEqual([]);
  });

  it("drops a counterpart that is not in the PPM, an unknown claim, an unknown rule, and a repeat", async () => {
    const result = await kept([
      gap("P1", "c5", "c2"),
      gap("P1", "c99", "c6"),
      gap("P9", "c5", "c6"),
      gap("P2", "c9", "c10"),
      gap("P2", "c9", "c10"),
    ]);
    expect(result.map((i) => [i.rule, i.claim_id])).toEqual([["P2", "c9"]]);
  });
});

describe("what it reads", () => {
  it("shows the model the product rules in full", () => {
    expect(COMPLIANCE_SYSTEM_PROMPT).toContain("P3 (Exit charges are key facts): Any charge on leaving the product appears in the factsheet's key facts.");
  });

  it("takes a contradictions run, nothing else", async () => {
    const { t, caseId } = await larkspur();
    const decompose = await run(t, caseId, ["extract", "decompose"]);
    const res = await call(t, caseId, "compliance", decompose);
    expect(res.status).toBe(409);
    expect(ErrorResponse.parse(await res.json()).error).toMatch(/completed contradictions run/);
  });
});
