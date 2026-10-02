import { describe, expect, it } from "vitest";
import { activeFindings, emptyCaseState, fold, FoldError, SlimEvent } from "../src";
import recorded from "./fixtures/case-recorded.json";

// Recorded from the API by `pnpm --filter @qryvox/backend record:fixture`.
const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;

describe("fold", () => {
  it("folds zero events into an empty case state", () => {
    expect(fold([])).toEqual(emptyCaseState());
  });

  it("folds a recorded case into the open case and its ingested documents", () => {
    const state = fold(events);

    expect(state.caseId).toBe(caseId);
    expect(state.openedAt).toBe(events[0]!.at);
    expect(state.lastSeq).toBe(18);
    expect(state.documents.map((d) => [d.documentId, d.kind, d.pageCount, d.ingestedAtSeq])).toEqual([
      ["factsheet", "factsheet", 1, 2],
      ["ppm", "ppm", 2, 3],
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

    expect(runAt(4)).toEqual([expect.objectContaining({ stepRunId: runId, step: "extract", status: "running" })]);
    expect(runAt(5)).toEqual([
      expect.objectContaining({ status: "failed", error: "model endpoint unreachable: recorded outage", settledAtSeq: 5 }),
    ]);
    expect(runAt(6)).toEqual([expect.objectContaining({ status: "running", startedAtSeq: 6, error: null })]);
    expect(runAt(7)).toEqual([
      expect.objectContaining({
        stepRunId: runId,
        status: "completed",
        model: "recorded-fake-model",
        promptVersion: "extract@1",
        inputRunId: null,
        settledAtSeq: 7,
      }),
    ]);
  });

  it("puts a findings run's findings on the board with their citations", () => {
    const state = fold(events.filter((e) => e.seq <= 14));

    expect(activeFindings(state)).toEqual([
      expect.objectContaining({
        category: "fees",
        kind: "contradiction",
        severity: "high",
        citation: { document_id: "factsheet", page: 1, quote: "Management fee: 0.85% per annum." },
        counterpart: { document_id: "ppm", page: 2, quote: "The management fee is 1.10% per annum." },
        createdAtSeq: 14,
        supersededAtSeq: null,
      }),
    ]);
  });

  it("a re-run supersedes earlier findings: off the board, still in the log", () => {
    const state = fold(events);
    const [first, second] = state.findings;

    expect(state.findings).toHaveLength(2);
    expect(first).toMatchObject({ createdAtSeq: 14, supersededAtSeq: 17 });
    expect(activeFindings(state)).toEqual([second]);
    expect(second!.stepRunId).not.toBe(first!.stepRunId);
  });

  it("replay before the re-run shows the board as it was", () => {
    expect(activeFindings(fold(events.filter((e) => e.seq <= 16)))).toEqual([
      expect.objectContaining({ createdAtSeq: 14, supersededAtSeq: null }),
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
