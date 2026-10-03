import { describe, expect, it } from "vitest";
import { activeFindings, fold, PROMPT_VERSIONS, rationaleFor, RationaleOutput, SlimEvent } from "../src";
import recorded from "../fixtures/case-recorded.json";

// The recorded Larkspur case: one findings run superseded by a second, whose findings are on the board.
const events = SlimEvent.array().parse(recorded);
const state = fold(events);
const caseId = events[0]!.case_id;
const [active, otherActive] = activeFindings(state);
const superseded = state.findings.find((f) => f.supersededAtSeq !== null)!;

let next = events.length;
function rationaleRun(inputRunId: string, rationales: { finding_id: string; text: string }[], runId = `rationale-${next + 1}`): SlimEvent[] {
  const run = { step: "rationale", model: "fake-model", prompt_version: PROMPT_VERSIONS.rationale, input_run_id: inputRunId };
  const event = (type: string, payload: object) =>
    SlimEvent.parse({
      seq: ++next,
      event_id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
      case_id: caseId,
      actor: "demo-analyst",
      at: "2026-10-03T12:00:00.000Z",
      step_run_id: runId,
      type,
      v: 1,
      payload,
    });
  return [event("step.started", run), event("step.completed", { ...run, output: { rationales } })];
}

describe("rationaleFor (#62)", () => {
  it("is null before any rationale run, and for a finding the case does not have", () => {
    expect(rationaleFor(events, active!.finding_id)).toBeNull();
    expect(rationaleFor(events, "no-such-finding")).toBeNull();
  });

  it("reads the latest completed run that has one for the finding, falling back past a run that dropped it", () => {
    next = events.length;
    const log = [
      ...events,
      ...rationaleRun(active!.stepRunId, [
        { finding_id: active!.finding_id, text: "First." },
        { finding_id: otherActive!.finding_id, text: "Other, first." },
      ]),
      ...rationaleRun(active!.stepRunId, [{ finding_id: active!.finding_id, text: "Second." }]),
    ];

    expect(fold(log).stepRuns.filter((r) => r.step === "rationale" && r.status === "completed")).toHaveLength(2);
    expect(rationaleFor(log, active!.finding_id)).toBe("Second.");
    expect(rationaleFor(log, otherActive!.finding_id)).toBe("Other, first.");
  });

  it("is null for a superseded finding, even when a run on its findings run wrote one", () => {
    next = events.length;
    const log = [...events, ...rationaleRun(superseded.stepRunId, [{ finding_id: superseded.finding_id, text: "Stale." }])];
    expect(rationaleFor(log, superseded.finding_id)).toBeNull();
  });

  it("ignores a run on another findings run that names the finding", () => {
    next = events.length;
    const log = [...events, ...rationaleRun(superseded.stepRunId, [{ finding_id: active!.finding_id, text: "Wrong run." }])];
    expect(rationaleFor(log, active!.finding_id)).toBeNull();
  });

  it("holds a rationale to one sentence's length", () => {
    expect(RationaleOutput.safeParse({ rationales: [{ finding_id: "f", text: "x".repeat(401) }] }).success).toBe(false);
    expect(RationaleOutput.safeParse({ rationales: [{ finding_id: "f", text: "  " }] }).success).toBe(false);
  });
});
