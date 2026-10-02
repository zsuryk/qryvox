import { describe, expect, it } from "vitest";
import { emptyCaseState, fold, FoldError, SlimEvent } from "../src";
import recorded from "./fixtures/case-ingested.json";

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
    expect(state.lastSeq).toBe(3);
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
