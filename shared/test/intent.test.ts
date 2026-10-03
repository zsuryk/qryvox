import { describe, expect, it } from "vitest";
import {
  fold,
  type IntentChip,
  IntentChip as IntentChipSchema,
  ParseOutput,
  PROMPT_VERSIONS,
  resolveIntent,
  RunStepRequest,
  SlimEvent,
} from "../src";
import recorded from "../fixtures/case-recorded.json";

// The recorded pipeline run (see fold.test.ts), with a parse run appended by hand at seq 28 onwards, the
// way the backend will record one: step.started, then step.completed or step.failed under the same run id.
const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;
const RUN = "7d1c2a4e-0b5f-4c39-8a61-2f0e9d3b4c58";

const run = { step: "parse", model: "recorded-fake-model", prompt_version: "parse@1", input_run_id: null, intent: "fee problems in the PPM" };

function parseEvent(seq: number, type: "step.started" | "step.completed" | "step.failed", extra: object = {}): SlimEvent {
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

const manual: IntentChip[] = [{ category: "fees", authority: null, step_kind: null }];
const feesInPpm: IntentChip = { category: "fees", authority: "ppm", step_kind: null };

describe("the parse step contract", () => {
  it("is a step with a prompt version, recorded like any other run", () => {
    const started = parseEvent(28, "step.started");
    const state = fold([...events, started]);

    expect(PROMPT_VERSIONS.parse).toBe("parse@1");
    expect(started.type === "step.started" && started.payload.intent).toBe("fee problems in the PPM");
    expect(state.stepRuns.at(-1)).toMatchObject({ stepRunId: RUN, step: "parse", status: "running", inputRunId: null });
  });

  it("takes free text on the run request, for parse and only for parse", () => {
    const request = { step_run_id: RUN, input_run_id: null };

    expect(RunStepRequest.parse({ ...request, step: "parse", intent: "  risk in the deck " }).intent).toBe("risk in the deck");
    expect(RunStepRequest.safeParse({ ...request, step: "parse" }).success).toBe(false);
    expect(RunStepRequest.safeParse({ ...request, step: "parse", intent: "   " }).success).toBe(false);
    expect(RunStepRequest.safeParse({ ...request, step: "extract", intent: "fees" }).success).toBe(false);
    // Every request written before parse still parses.
    expect(RunStepRequest.safeParse({ ...request, step: "extract" }).success).toBe(true);
  });

  it("outputs chips over the existing categories, document kinds and steps", () => {
    expect(ParseOutput.parse({ chips: [feesInPpm, { category: null, authority: null, step_kind: "compliance" }] }).chips).toHaveLength(2);
    expect(ParseOutput.parse({ chips: [] }).chips).toEqual([]);
    expect(IntentChipSchema.safeParse({ category: "liquidity", authority: null, step_kind: null }).success).toBe(false);
    expect(IntentChipSchema.safeParse({ category: null, authority: "prospectus", step_kind: null }).success).toBe(false);
    // A chip cannot ask for another parse, and a chip that names nothing is no chip.
    expect(IntentChipSchema.safeParse({ category: null, authority: null, step_kind: "parse" }).success).toBe(false);
    expect(IntentChipSchema.safeParse({ category: null, authority: null, step_kind: null }).success).toBe(false);
  });
});

describe("resolving intent", () => {
  it("adds a completed parse run's chips to the analyst's own, without duplicates", () => {
    const log = [
      ...events,
      parseEvent(28, "step.started"),
      parseEvent(29, "step.completed", { output: { chips: [manual[0], feesInPpm] } }),
    ];

    expect(resolveIntent(log, RUN, manual)).toEqual({ chips: [...manual, feesInPpm], source: "parse" });
  });

  it("falls back to the manual chips when the parse fails, and the board state is untouched", () => {
    const before = fold(events);
    const log = [...events, parseEvent(28, "step.started"), parseEvent(29, "step.failed", { error: "model output did not match the parse schema" })];
    const after = fold(log);

    expect(resolveIntent(log, RUN, manual)).toEqual({ chips: manual, source: "manual" });
    expect(after.board).toEqual(before.board);
    expect(after.findings).toEqual(before.findings);
    expect(after.dispositions).toEqual(before.dispositions);
    expect(after.stepRuns.at(-1)).toMatchObject({ step: "parse", status: "failed" });
  });

  it("falls back to the manual chips while the run is in flight, with no run, or on output that does not parse", () => {
    const started = [...events, parseEvent(28, "step.started")];
    const garbled = [...started, parseEvent(29, "step.completed", { output: { chips: [{ category: "liquidity" }] } })];

    expect(resolveIntent(started, RUN, manual).source).toBe("manual");
    expect(resolveIntent(events, null, manual)).toEqual({ chips: manual, source: "manual" });
    expect(resolveIntent(garbled, RUN, manual)).toEqual({ chips: manual, source: "manual" });
  });

  it("never reads another step's output as chips", () => {
    const extract = events.find((e) => e.type === "step.completed")!;

    expect(resolveIntent(events, extract.step_run_id, manual).source).toBe("manual");
  });
});
