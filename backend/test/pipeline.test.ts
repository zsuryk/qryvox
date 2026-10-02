import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { activeFindings, GroundTruth } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { board, caseWithPack, factsheet, feeTable, pipelineLlm, REPLIES, runPipeline, step } from "./fake-pipeline";
import { setup } from "./helpers";

describe("the four-step pipeline", () => {
  it("produces findings whose quotes are present in the ingested document text", async () => {
    const t = await setup({ llm: pipelineLlm() });
    const caseId = await caseWithPack(t);

    await runPipeline(t, caseId);

    const { state } = await board(t, caseId);
    const [finding] = activeFindings(state);
    expect(activeFindings(state)).toHaveLength(1);
    expect(finding).toMatchObject({
      category: "fees",
      kind: "contradiction",
      severity: "high",
      claim: "The factsheet states a 0.85% management fee; the fee table states 1.25%.",
      citation: { document_id: "factsheet", page: 1, quote: "Management fee: 0.85% per annum." },
      counterpart: { document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value" },
    });
    expect(factsheet.pages[0]).toContain(finding!.citation.quote);
    expect(feeTable.pages[0]).toContain(finding!.counterpart!.quote);
  });

  it("records every step run as completed with its prompt version, each consuming the run before it", async () => {
    const t = await setup({ llm: pipelineLlm() });
    const caseId = await caseWithPack(t);

    const runs = await runPipeline(t, caseId);

    const { state } = await board(t, caseId);
    expect(state.stepRuns.map((r) => [r.step, r.status, r.promptVersion, r.inputRunId])).toEqual([
      ["extract", "completed", "extract@1", null],
      ["decompose", "completed", "decompose@1", runs.extract.step_run_id],
      ["contradictions", "completed", "contradictions@1", runs.decompose.step_run_id],
      ["findings", "completed", "findings@1", runs.contradictions.step_run_id],
    ]);
  });

  it("never passes the ground truth to any step", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    await runPipeline(t, await caseWithPack(t));

    const groundTruth = GroundTruth.parse(
      JSON.parse(readFileSync(new URL("../../frontend/public/eval/ground-truth.json", import.meta.url), "utf8")),
    );
    const sent = JSON.stringify(llm.calls);
    for (const entry of groundTruth.entries) {
      expect(sent).not.toContain(entry.summary);
      expect(sent).not.toContain(entry.id);
    }
  });
});

describe("step inputs", () => {
  it("a step needs a completed run of the step before it, and spends nothing otherwise", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    const caseId = await caseWithPack(t);
    const runs = await runPipeline(t, caseId);
    const calls = llm.calls.length;

    expect((await step(t, caseId, "decompose", null)).status).toBe(409);
    expect((await step(t, caseId, "decompose", randomUUID())).status).toBe(409);
    expect((await step(t, caseId, "findings", runs.decompose.step_run_id)).status).toBe(409);
    expect((await step(t, caseId, "extract", runs.extract.step_run_id)).status).toBe(409);
    expect(llm.calls).toHaveLength(calls);
  });
});

describe("grounding", () => {
  it("drops claims whose quote is not on the cited page", async () => {
    const invented = {
      claims: [
        ...REPLIES.decompose.claims,
        { id: "c3", document_id: "factsheet", page: 1, quote: "Capital is guaranteed.", category: "risk", topic: "capital", assertion: "capital guaranteed" },
      ],
    };
    const t = await setup({ llm: pipelineLlm({ decompose: invented }) });
    const caseId = await caseWithPack(t);

    const runs = await runPipeline(t, caseId);

    expect((runs.decompose.output.claims as { id: string }[]).map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("drops issues that cite unknown claims, contradict within one document, or repeat", async () => {
    const issues = {
      issues: [
        ...REPLIES.contradictions.issues,
        { kind: "contradiction", category: "fees", claim_id: "c1", counterpart_claim_id: "c2", explanation: "duplicate" },
        { kind: "contradiction", category: "fees", claim_id: "c9", counterpart_claim_id: "c2", explanation: "unknown claim" },
        { kind: "contradiction", category: "fees", claim_id: "c1", counterpart_claim_id: "c1", explanation: "same document" },
        { kind: "unsupported_claim", category: "strategy", claim_id: "c1", counterpart_claim_id: null, explanation: "kept" },
      ],
    };
    const t = await setup({ llm: pipelineLlm({ contradictions: issues }) });
    const caseId = await caseWithPack(t);

    const runs = await runPipeline(t, caseId);

    expect((runs.contradictions.output.issues as { explanation: string }[]).map((i) => i.explanation)).toEqual([
      "Factsheet says 0.85%, fee table says 1.25%.",
      "kept",
    ]);
  });

  it("turns every issue into a finding, even one the model left unrated", async () => {
    const t = await setup({ llm: pipelineLlm({ findings: { findings: [] } }) });
    const caseId = await caseWithPack(t);

    await runPipeline(t, caseId);

    const { state } = await board(t, caseId);
    expect(activeFindings(state)).toEqual([
      expect.objectContaining({ severity: "medium", claim: "Factsheet says 0.85%, fee table says 1.25%." }),
    ]);
  });
});

describe("re-running findings", () => {
  it("supersedes the previous run's findings: they leave the board but stay in the log", async () => {
    const t = await setup({ llm: pipelineLlm() });
    const caseId = await caseWithPack(t);
    const runs = await runPipeline(t, caseId);

    const rerun = await step(t, caseId, "findings", runs.contradictions.step_run_id);
    expect(rerun.status).toBe(200);

    const { events, state } = await board(t, caseId);
    const [first, second] = state.findings;
    expect(state.findings).toHaveLength(2);
    expect(first!.supersededAtSeq).not.toBeNull();
    expect(second!.supersededAtSeq).toBeNull();
    expect(activeFindings(state)).toEqual([second]);

    // The supersession committed in the same transaction as the run that caused it.
    const completedSeq = events.findLast((e) => e.type === "step.completed")!.seq;
    expect(first!.supersededAtSeq).toBe(completedSeq + 1);
  });
});

describe("concurrent findings runs", () => {
  it("leave one completed run and only the winner's findings: the loser rolls back whole", async () => {
    // The delay lets both identical calls pass the "already completed?" check before either commits.
    const t = await setup({ llm: pipelineLlm({}, 30) });
    const caseId = await caseWithPack(t);
    const runs = await runPipeline(t, caseId);
    const stepRunId = randomUUID();

    const [a, b] = await Promise.all([
      step(t, caseId, "findings", runs.contradictions.step_run_id, stepRunId),
      step(t, caseId, "findings", runs.contradictions.step_run_id, stepRunId),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    const { events, state } = await board(t, caseId);
    const ofRun = events.filter((e) => e.step_run_id === stepRunId).map((e) => e.type);
    expect(ofRun).toEqual(["step.started", "step.started", "step.completed", "finding.superseded", "finding.created"]);
    expect(activeFindings(state)).toHaveLength(1);
  });
});
