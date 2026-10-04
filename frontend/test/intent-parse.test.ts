import { fold, resolveIntent, SlimEvent } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { fixtureEvents } from "../lib/canvas-source";
import { statusLines } from "../lib/canvas-status";
import {
  chipsOf,
  intentRefusal,
  parsedAlready,
  parseRequest,
  parseRunFor,
  playIntent,
  RECORDED_INTENTS,
  recordedIntent,
  restoredOff,
  standingParseRun,
} from "../lib/intent-parse";

// The analyst's words on the canvas (#69): the parse step as the browser sends it and as the log reads it.

const base = fixtureEvents();
const RUN = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-04T10:00:00.000Z";
const played = (words: string, run = RUN, from = base) => [...from, ...playIntent(from, words, run, AT)!];

// A parse run that failed, as the backend would append it (a 422 on a malformed reply).
function failed(from: readonly SlimEvent[], words: string, run: string): SlimEvent[] {
  const last = from.at(-1)!;
  const payload = { step: "parse", model: "kimi-k3", prompt_version: "parse@1", input_run_id: null, intent: words };
  const at = (n: number, type: "step.started" | "step.failed", extra = {}) =>
    SlimEvent.parse({
      seq: last.seq + n,
      event_id: crypto.randomUUID(),
      case_id: last.case_id,
      actor: "demo-analyst",
      at: AT,
      step_run_id: run,
      type,
      v: 1,
      payload: { ...payload, ...extra },
    });
  return [...from, at(1, "step.started"), at(2, "step.failed", { error: "the model's reply is not chips", raw_response: null })];
}

describe("the intent request", () => {
  it("is a parse run that reads no earlier run, carrying the words", () => {
    expect(parseRequest("  fees in the PPM ", RUN)).toEqual({ step_run_id: RUN, step: "parse", input_run_id: null, intent: "fees in the PPM" });
  });

  it("refuses empty words and a brief, and nothing else", () => {
    expect(intentRefusal("   ")).not.toBeNull();
    expect(intentRefusal("x".repeat(501))).not.toBeNull();
    expect(intentRefusal("fees")).toBeNull();
  });
});

describe("a canned sentence on the fixture", () => {
  it("records parse step.started and step.completed on the log, with no network", () => {
    const events = played("fee contradictions in the PPM");
    const lines = statusLines(events).filter((l) => l.kind === "run" && l.label === "Read intent");
    expect(lines).toMatchObject([{ status: "completed", detail: "“fee contradictions in the PPM”", result: "1 intent chip" }]);
    expect(events.slice(-2).map((e) => e.type)).toEqual(["step.started", "step.completed"]);
  });

  it("yields its chips, through the shared resolveIntent", () => {
    const events = played("fee contradictions in the PPM");
    const run = standingParseRun(events);
    expect(run).toBe(RUN);
    expect(resolveIntent(events, run, [])).toEqual({
      source: "parse",
      chips: [{ category: "fees", authority: "ppm", step_kind: "contradictions" }],
    });
  });

  it("reads a sentence however it is spaced and cased, and in Chinese", () => {
    expect(recordedIntent("  Fee   CONTRADICTIONS in the ppm ")).toBeDefined();
    expect(chipsOf(played("PPM 裡的費用"), RUN)).toEqual([{ category: "fees", authority: "ppm", step_kind: null }]);
  });

  it("gives nothing for a sentence that was not recorded, rather than a guess", () => {
    expect(playIntent(base, "something else entirely", RUN, AT)).toBeNull();
  });

  it("records every sentence it knows as events the log accepts", () => {
    for (const { words, chips } of RECORDED_INTENTS) expect(chipsOf(played(words), RUN)).toEqual(chips);
  });
});

describe("chips merging with the ones picked by hand", () => {
  const manual = [{ category: null, authority: "deck" as const, step_kind: null }];

  it("puts the hand-picked chips first and the parsed ones after, once each", () => {
    const events = played("fee contradictions in the PPM");
    expect(resolveIntent(events, RUN, manual).chips).toEqual([...manual, { category: "fees", authority: "ppm", step_kind: "contradictions" }]);
    const same = [{ category: "fees" as const, authority: "ppm" as const, step_kind: "contradictions" as const }];
    expect(resolveIntent(events, RUN, same).chips).toEqual(same);
  });

  it("keeps them when the words map onto nothing", () => {
    const events = played("what a lovely afternoon");
    expect(chipsOf(events, RUN)).toEqual([]);
    expect(resolveIntent(events, standingParseRun(events), manual)).toEqual({ chips: manual, source: "parse" });
  });

  it("keeps them, and the chip set as it was, when a parse run failed", () => {
    const events = failed(played("fee contradictions in the PPM"), "garbled", "22222222-2222-4222-8222-222222222222");
    expect(fold(events).stepRuns.at(-1)).toMatchObject({ step: "parse", status: "failed" });
    // The run whose chips stand is still the last that completed.
    expect(standingParseRun(events)).toBe(RUN);
    expect(resolveIntent(events, standingParseRun(events), manual).chips).toHaveLength(2);
    // With no run that completed, the hand-picked chips stand alone.
    const alone = failed(base, "garbled", "22222222-2222-4222-8222-222222222222");
    expect(resolveIntent(alone, standingParseRun(alone), manual)).toEqual({ chips: manual, source: "manual" });
  });

  it("shows a failed run in the status panel with its reason", () => {
    const events = failed(base, "garbled", "22222222-2222-4222-8222-222222222222");
    expect(statusLines(events).at(-1)).toMatchObject({ label: "Read intent", status: "failed", error: "the model's reply is not chips" });
  });
});

describe("sending the same words again", () => {
  it("is a retry under the run id they went out under, so no second model call is made", () => {
    const events = played("fee contradictions in the PPM");
    expect(parseRunFor(events, " fee contradictions in the PPM")).toBe(RUN);
    expect(parsedAlready(events, "fee contradictions in the PPM")).toBe(true);
    expect(parseRunFor(events, "other words")).toBeNull();
  });

  it("is a retry of a failed run under its own id, which has not completed", () => {
    const events = failed(base, "garbled", "22222222-2222-4222-8222-222222222222");
    expect(parseRunFor(events, "garbled")).toBe("22222222-2222-4222-8222-222222222222");
    expect(parsedAlready(events, "garbled")).toBe(false);
  });
});

describe("a canvas opening on a log that already has a parse run", () => {
  it("has that run's chips switched off, so the whole canvas shows", () => {
    expect([...restoredOff(played("fee contradictions in the PPM"))]).toEqual(["fees|ppm|contradictions"]);
    expect([...restoredOff(played("PPM 裡的費用"))]).toEqual(["fees|ppm|null"]);
  });

  it("has nothing switched off where there is no completed run, or the words mapped onto nothing", () => {
    expect(restoredOff(base).size).toBe(0);
    expect(restoredOff(failed(base, "garbled", "22222222-2222-4222-8222-222222222222")).size).toBe(0);
    expect(restoredOff(played("what a lovely afternoon")).size).toBe(0);
  });
});
