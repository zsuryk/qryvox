import { describe, expect, it } from "vitest";
import { activeFindings, emptyCaseState, fold, FoldError, SlimEvent } from "../src";
import recorded from "../fixtures/case-recorded.json";

// Recorded from the API by `pnpm --filter @qryvox/backend record:fixture`: the whole fabricated pack
// ingested, extract failing once and retried under the same run id, then the pipeline run through and run
// again, so the log carries one superseded finding and an active board spanning all four categories.
const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;
// The seq the first findings run put its finding on the board, before the re-run supersedes it.
const afterFirstFindings = events.filter((e) => e.type === "finding.created")[0]!.seq;

describe("fold", () => {
  it("folds zero events into an empty case state", () => {
    expect(fold([])).toEqual(emptyCaseState());
  });

  it("folds a recorded case into the open case and its ingested documents", () => {
    const state = fold(events);

    expect(state.caseId).toBe(caseId);
    expect(state.openedAt).toBe(events[0]!.at);
    expect(state.lastSeq).toBe(27);
    expect(state.documents.map((d) => [d.documentId, d.kind, d.pageCount, d.ingestedAtSeq])).toEqual([
      ["factsheet", "factsheet", 2, 2],
      ["ppm", "ppm", 3, 3],
      ["deck", "deck", 3, 4],
      ["fee-table", "fee_table", 1, 5],
    ]);
  });

  it("does not depend on the order events arrive in", () => {
    expect(fold([...events].reverse())).toEqual(fold(events));
  });

  it("folding up to seq N is the replay at N", () => {
    const atTwo = fold(events.filter((e) => e.seq <= 2));

    expect(atTwo.lastSeq).toBe(2);
    expect(atTwo.documents.map((d) => d.documentId)).toEqual(["factsheet"]);
  });

  it("tracks a step run that failed and then completed on retry under the same run id", () => {
    const runId = events.find((e) => e.type === "step.started")!.step_run_id;
    const runAt = (seq: number) => fold(events.filter((e) => e.seq <= seq)).stepRuns;

    expect(runAt(6)).toEqual([expect.objectContaining({ stepRunId: runId, step: "extract", status: "running" })]);
    expect(runAt(7)).toEqual([
      expect.objectContaining({ status: "failed", error: "model endpoint unreachable: recorded outage", settledAtSeq: 7 }),
    ]);
    expect(runAt(8)).toEqual([expect.objectContaining({ status: "running", startedAtSeq: 8, error: null })]);
    expect(runAt(9)).toEqual([
      expect.objectContaining({
        stepRunId: runId,
        status: "completed",
        model: "recorded-fake-model",
        promptVersion: "extract@1",
        inputRunId: null,
        settledAtSeq: 9,
      }),
    ]);
  });

  it("puts a findings run's findings on the board with their citations", () => {
    const state = fold(events.filter((e) => e.seq <= afterFirstFindings));

    expect(activeFindings(state)).toEqual([
      expect.objectContaining({
        category: "fees",
        kind: "contradiction",
        severity: "high",
        citation: { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.85% per annum" },
        counterpart: { document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value" },
        createdAtSeq: afterFirstFindings,
        supersededAtSeq: null,
      }),
    ]);
  });

  it("a re-run supersedes earlier findings: off the board, still in the log", () => {
    const state = fold(events);
    const [first, ...rest] = state.findings;

    expect(state.findings).toHaveLength(7);
    expect(first).toMatchObject({ createdAtSeq: afterFirstFindings, supersededAtSeq: 21 });
    expect(activeFindings(state)).toEqual(rest);
    expect(new Set(rest.map((f) => f.stepRunId)).size).toBe(1);
    expect(rest[0]!.stepRunId).not.toBe(first!.stepRunId);
  });

  it("the recorded board covers all four categories", () => {
    expect(activeFindings(fold(events)).map((f) => f.category).sort()).toEqual([
      "fees",
      "fees",
      "risk",
      "strategy",
      "strategy",
      "terms",
    ]);
  });

  it("replay before the re-run shows the board as it was", () => {
    expect(activeFindings(fold(events.filter((e) => e.seq <= 20)))).toEqual([
      expect.objectContaining({ createdAtSeq: afterFirstFindings, supersededAtSeq: null }),
    ]);
  });

  it("a late start from a concurrent duplicate does not reopen a completed run", () => {
    const started = events.find((e) => e.type === "step.started")!;
    const late = { ...started, seq: events.length + 1, event_id: "0f6c1f8e-6a3b-4f53-9d0b-3c1f5b2e7a90" };

    expect(fold([...events, late]).stepRuns).toEqual(fold(events).stepRuns);
  });

  it("fails hard on a missing seq rather than building a partial board", () => {
    const withGap = events.filter((e) => e.seq !== 2);

    expect(() => fold(withGap)).toThrow(FoldError);
    expect(() => fold(withGap)).toThrow("expected seq 2, got 3");
  });

  it("fails hard when the prefix does not start at seq 1", () => {
    expect(() => fold(events.slice(1))).toThrow("expected seq 1, got 2");
  });

  it("fails hard when events from two cases are mixed", () => {
    const other = { ...events[2]!, case_id: "another-case" };

    expect(() => fold([events[0]!, events[1]!, other])).toThrow(FoldError);
  });
});