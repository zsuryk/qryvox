import { describe, expect, it } from "vitest";
import { fold, isSeedable, RunStepRequest, SlimEvent } from "../src";
import recorded from "../fixtures/case-recorded.json";

// The find-similar seed (#64), on the recorded pipeline run (see fold.test.ts) with a seeded contradictions
// run appended by hand at seq 28 onwards, the way the backend records one.
const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;
const RUN = "3b9e4f21-6c0d-4a7e-9f12-8d5c1e0a7b64";
const seed = { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.85% per annum" };
const decompose = fold(events).stepRuns.find((r) => r.step === "decompose" && r.status === "completed")!;

const run = { step: "contradictions", model: "recorded-fake-model", prompt_version: "contradictions@1", input_run_id: decompose.stepRunId, seed };

function seededEvent(seq: number, type: "step.started" | "step.completed" | "step.failed", extra: object = {}): SlimEvent {
  return SlimEvent.parse({
    seq,
    event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    case_id: caseId,
    actor: "demo-analyst",
    at: "2026-10-03T12:00:00.000Z",
    step_run_id: RUN,
    type,
    v: 1,
    payload: { ...run, ...extra },
  });
}

describe("the seed on a run request", () => {
  const request = { step_run_id: RUN, input_run_id: null };

  it("is taken by extract and contradictions, and refused on every other step", () => {
    expect(RunStepRequest.parse({ ...request, step: "extract", seed }).seed).toEqual(seed);
    expect(RunStepRequest.safeParse({ ...request, step: "contradictions", input_run_id: "r1", seed }).success).toBe(true);
    for (const step of ["decompose", "findings", "compliance", "attributes", "explain"] as const) {
      expect(isSeedable(step)).toBe(false);
      expect(RunStepRequest.safeParse({ ...request, step, seed }).success).toBe(false);
    }
    expect(RunStepRequest.safeParse({ ...request, step: "parse", intent: "fees", seed }).success).toBe(false);
  });

  it("is a citation: a document, a 1-based page and a quote", () => {
    expect(RunStepRequest.safeParse({ ...request, step: "extract", seed: { ...seed, page: 0 } }).success).toBe(false);
    expect(RunStepRequest.safeParse({ ...request, step: "extract", seed: { ...seed, quote: "" } }).success).toBe(false);
    // Every request written before the seed still parses.
    expect(RunStepRequest.safeParse({ ...request, step: "extract" }).success).toBe(true);
  });
});

describe("a seeded run in the log", () => {
  it("is recorded with its seed on step.started and step.completed", () => {
    const started = seededEvent(28, "step.started");
    const completed = seededEvent(29, "step.completed", { output: { issues: [] } });

    expect(started.type === "step.started" && started.payload.seed).toEqual(seed);
    expect(completed.type === "step.completed" && completed.payload.seed).toEqual(seed);
  });

  it("folds into the seeded runs and never into the pipeline's, so it is no step's latest run", () => {
    const before = fold(events);
    const after = fold([...events, seededEvent(28, "step.started"), seededEvent(29, "step.completed", { output: { issues: [] } })]);

    expect(after.stepRuns).toEqual(before.stepRuns);
    expect(after.seededRuns).toEqual([
      expect.objectContaining({ stepRunId: RUN, step: "contradictions", status: "completed", settledAtSeq: 29, seed }),
    ]);
    expect(after.findings).toEqual(before.findings);
    expect(after.board).toEqual(before.board);
  });

  it("settles as failed, and a retry under the same id completes it", () => {
    const failed = [...events, seededEvent(28, "step.started"), seededEvent(29, "step.failed", { error: "model output did not match" })];
    expect(fold(failed).seededRuns).toEqual([expect.objectContaining({ status: "failed", error: "model output did not match" })]);

    const retried = [...failed, seededEvent(30, "step.started"), seededEvent(31, "step.completed", { output: { issues: [] } })];
    expect(fold(retried).seededRuns).toEqual([expect.objectContaining({ status: "completed", settledAtSeq: 31, error: null })]);
  });

  it("leaves every recorded run unseeded", () => {
    expect(fold(events).seededRuns).toEqual([]);
    expect(fold(events).stepRuns.every((r) => r.seed === undefined)).toBe(true);
  });
});
