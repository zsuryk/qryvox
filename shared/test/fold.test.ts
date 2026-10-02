import { describe, expect, it } from "vitest";
import {
  activeFindings,
  type Disposition,
  dispositionOf,
  emptyCaseState,
  fold,
  FoldError,
  SlimEvent,
} from "../src";
import recorded from "../fixtures/case-recorded.json";

// Recorded from the API by `pnpm --filter @qryvox/backend record:fixture`: the whole fabricated pack
// ingested, extract failing once and retried under the same run id, then the pipeline run through and run
// again, so the log carries one superseded finding and an active board spanning all four categories.
const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;
// The seq the first findings run put its finding on the board, before the re-run supersedes it.
const afterFirstFindings = events.filter((e) => e.type === "finding.created")[0]!.seq;

// The three active findings of the re-run, by the order the board lists them.
const activeIds = () => activeFindings(fold(events)).map((f) => f.finding_id);

// One disposition.changed appended to the recorded stream at the next free seq. The recorded fixture is a
// whole pipeline run with nobody in the room (no dispositions were ever recorded against it), and this is
// the only event in the vocabulary the browser originates rather than a step, so it is the one thing a
// fold test has to append by hand. Everything asserted below is read back off the folded log.
function decide(findingId: string, disposition: Disposition, seq: number): SlimEvent {
  return SlimEvent.parse({
    seq,
    event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    case_id: caseId,
    actor: "demo-analyst",
    at: "2026-10-01T12:00:00.000Z",
    step_run_id: null,
    type: "disposition.changed",
    v: 1,
    payload: { finding_id: findingId, disposition },
  });
}

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

describe("fold: dispositions", () => {
  it("leaves every finding undecided until the analyst decides, naming no actor", () => {
    const state = fold(events);

    expect(state.dispositions).toEqual([]);
    expect(activeIds().map((findingId) => dispositionOf(state, findingId))).toEqual(
      activeIds().map(() => null),
    );
  });

  it("records a decision against the finding, attributed to the actor on the event", () => {
    const [fees] = activeIds();
    const state = fold([...events, decide(fees!, "approved", 28)]);

    expect(dispositionOf(state, fees!)).toEqual({
      findingId: fees,
      disposition: "approved",
      actor: "demo-analyst",
      changedAtSeq: 28,
    });
  });

  it("resolves a finding to its latest decision when the analyst changes their mind", () => {
    const [fees] = activeIds();
    const approved = fold([...events, decide(fees!, "approved", 28)]);
    const dismissed = fold([...events, decide(fees!, "approved", 28), decide(fees!, "dismissed", 29)]);

    expect(dispositionOf(approved, fees!)!.disposition).toBe("approved");
    expect(dispositionOf(dismissed, fees!)).toEqual({
      findingId: fees,
      disposition: "dismissed",
      actor: "demo-analyst",
      changedAtSeq: 29,
    });
    // One entry per finding, so a repeated decision replaces rather than accumulates.
    expect(dismissed.dispositions).toHaveLength(1);
  });

  it("keeps a superseded finding's disposition in the log after the finding leaves the board", () => {
    const superseded = fold(events).findings[0]!;
    const withDecision = fold([...events, decide(superseded.finding_id, "dismissed", 28)]);

    expect(activeFindings(withDecision).map((f) => f.finding_id)).not.toContain(superseded.finding_id);
    expect(dispositionOf(withDecision, superseded.finding_id)).toMatchObject({
      disposition: "dismissed",
      changedAtSeq: 28,
    });
  });

  it("replays a disposition only from the seq that carried it, like every other event", () => {
    const [fees, , third] = activeIds();
    // seq 28 approves the fee finding and seq 29 dismisses the third; both ride on the recorded 1..27.
    const decided = [...events, decide(fees!, "approved", 28), decide(third!, "dismissed", 29)];
    const at28 = fold(decided.slice(0, 28));

    expect(at28.lastSeq).toBe(28);
    expect(dispositionOf(at28, fees!)).toMatchObject({ disposition: "approved", changedAtSeq: 28 });
    expect(dispositionOf(at28, third!)).toBeNull();
    expect(dispositionOf(fold(decided), third!)).toMatchObject({ disposition: "dismissed", changedAtSeq: 29 });
  });

  it("refuses a decision that is neither approve nor dismiss", () => {
    const [fees] = activeIds();

    expect(() => decide(fees!, "flagged" as Disposition, 28)).toThrow();
  });
});
