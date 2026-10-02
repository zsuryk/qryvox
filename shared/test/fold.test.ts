import { describe, expect, it } from "vitest";
import { Event, emptyCaseState, fold } from "../src";

describe("fold", () => {
  it("folds zero events into an empty case state", () => {
    expect(fold([])).toEqual(emptyCaseState());
  });

  it("folds a case.opened event into an open case", () => {
    const opened = Event.parse({
      seq: 1,
      event_id: "5b0c6a3e-2f4d-4c1a-9b8e-0d6f2a7c9e11",
      case_id: "case-1",
      v: 1,
      actor: "analyst",
      at: "2026-10-01T09:00:00.000Z",
      step_run_id: null,
      type: "case.opened",
      payload: {},
    });

    expect(fold([opened])).toEqual({ caseId: "case-1", openedAt: "2026-10-01T09:00:00.000Z", lastSeq: 1 });
  });
});
