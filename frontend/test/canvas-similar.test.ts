import { SlimEvent, StepFailure } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import { StepFailureError } from "../lib/api";
import { cardModel } from "../lib/canvas-cards";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { candidatesOf, hasRecording, planSimilar, playback, similarFailure, similarRequest } from "../lib/canvas-similar";
import recordings from "../lib/similar-recorded.json";

// Find similar (#57): what a press on Similar runs, the fixture's recorded runs, and the words a failure
// comes to. Nothing here touches the network.
const view = canvasView(fixtureEvents());
const findingCard = view.cards.find((c) => c.kind === "finding")!;
const excerptCard = view.cards.find((c) => c.kind === "excerpt")!;
const decompose = view.state.stepRuns.filter((r) => r.step === "decompose" && r.status === "completed").at(-1)!;

describe("what Similar runs", () => {
  it("re-runs contradictions for a finding card, seeded with its citation, over the latest completed decompose run", () => {
    const planned = planSimilar(view, findingCard.cardId);
    expect(planned).toEqual({
      plan: { step: "contradictions", seed: findingCard.kind === "finding" && findingCard.finding.citation, inputRunId: decompose.stepRunId },
    });
  });

  it("re-runs extract for an excerpt card, seeded with its own passage, over the documents", () => {
    expect(planSimilar(view, excerptCard.cardId)).toEqual({
      plan: { step: "extract", seed: excerptCard.kind === "excerpt" && excerptCard.citation, inputRunId: null },
    });
  });

  it("sends each press as a run of its own, under the run id it is given", () => {
    const planned = planSimilar(view, excerptCard.cardId);
    if (!("plan" in planned)) throw new Error("expected a plan");
    expect(similarRequest(planned.plan, "run-1")).toEqual({ step_run_id: "run-1", step: "extract", input_run_id: null, seed: planned.plan.seed });
  });

  it("says why not for a finding card on a case with no completed decompose run, or a card no longer there", () => {
    // The recorded case with its decompose run's completion taken out: its findings stand, but there is
    // no completed decompose run left to look through.
    const events = SlimEvent.array().parse(recorded);
    const noDecompose = canvasView(events.filter((e) => !(e.step_run_id === decompose.stepRunId && e.type === "step.completed")).map((e, i) => ({ ...e, seq: i + 1 })));
    expect(planSimilar(noDecompose, findingCard.cardId)).toEqual({ refused: expect.stringContaining("no completed decompose run") });
    expect(planSimilar(view, "finding:gone")).toEqual({ refused: expect.stringContaining("no longer") });
  });
});

describe("the fixture's recorded runs", () => {
  it("cover every card on the recorded case, each recorded against its own log", () => {
    expect(recordings.length).toBeGreaterThan(0);
    for (const card of view.cards) expect(hasRecording(view, card.cardId), card.cardId).toBe(true);
  });

  it("play back as step.started and step.completed at the next seqs, whose passages arrive as candidates", () => {
    const planned = planSimilar(view, findingCard.cardId);
    if (!("plan" in planned)) throw new Error("expected a plan");
    const events = fixtureEvents();
    const played = playback(events, planned.plan, "5e2a9c47-1d3b-4f60-8a7e-0c9b6d2f4e18", "2026-10-03T12:00:00.000Z")!;

    expect(played.map((e) => [e.seq, e.type, e.step_run_id])).toEqual([
      [events.length + 1, "step.started", "5e2a9c47-1d3b-4f60-8a7e-0c9b6d2f4e18"],
      [events.length + 2, "step.completed", "5e2a9c47-1d3b-4f60-8a7e-0c9b6d2f4e18"],
    ]);
    const after = canvasView([...events, ...played]);
    expect(after.state.seededRuns).toEqual([expect.objectContaining({ step: "contradictions", status: "completed", seed: planned.plan.seed })]);
    // The board is untouched: the same findings, and the pipeline's runs as they were.
    expect(after.state.findings).toEqual(view.state.findings);
    expect(after.state.stepRuns).toEqual(view.state.stepRuns);
    // Every candidate is a card the canvas did not have.
    const added = candidatesOf(after, "5e2a9c47-1d3b-4f60-8a7e-0c9b6d2f4e18");
    expect(added.every((id) => !view.cards.some((c) => c.cardId === id))).toBe(true);
  });

  it("marks a candidate with the passage it was found from", () => {
    const planned = planSimilar(view, excerptCard.cardId);
    if (!("plan" in planned)) throw new Error("expected a plan");
    const after = canvasView([...fixtureEvents(), ...playback(fixtureEvents(), planned.plan, "run-x", "2026-10-03T12:00:00.000Z")!]);
    const [candidate] = candidatesOf(after, "run-x");
    const model = cardModel(after.cards.find((c) => c.cardId === candidate)!, after.state);
    expect(model).toMatchObject({ kind: "excerpt", candidate: true, similarTo: expect.stringMatching(/^Similar to “.+”, .+ page \d+$/) });
  });

  it("plays nothing back for a plan with no recording", () => {
    const plan = { step: "extract" as const, seed: { document_id: "ppm", page: 9, quote: "not recorded" }, inputRunId: null };
    expect(playback(fixtureEvents(), plan, "run", "2026-10-03T12:00:00.000Z")).toBeNull();
  });
});

describe("a run that did not finish", () => {
  it("says a failed run's own reason, and that it is on the record", () => {
    const failure = new StepFailureError(StepFailure.parse({ error: "quote not found on page 2", step_run_id: "r", seq: 40 }));
    expect(similarFailure(failure)).toMatch(/quote not found on page 2.*on the record/);
  });

  it("says the server's reason without the status line, and what to do when rate limited", () => {
    expect(similarFailure(new Error('POST /cases/c/steps: 409 {"error":"input_run_id is not a completed decompose run"}'))).toBe(
      "input_run_id is not a completed decompose run",
    );
    expect(similarFailure(new Error('POST /cases/c/steps: 429 {"error":"step limit reached for this case"}'))).toMatch(/^too many runs just now \(step limit reached for this case\)\. Try again/);
    expect(similarFailure(new Error("POST /cases/c/steps: 500 upstream"))).toBe("upstream");
    expect(similarFailure(new Error("this demo link is missing its access token"))).toBe("this demo link is missing its access token");
  });
});
