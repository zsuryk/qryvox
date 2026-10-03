import { SlimEvent, StepFailure } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import { StepFailureError } from "../lib/api";
import { cardModel } from "../lib/canvas-cards";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { asked, candidatesOf, hasRecording, instantSaid, instantSimilar, planSimilar, playback, similarFailure, similarRequest } from "../lib/canvas-similar";
import { appendOp } from "../lib/canvas-store";
import { statusLines } from "../lib/canvas-status";
import recordings from "../lib/similar-recorded.json";

// Find similar (#57): what a press on Similar runs, the fixture's recorded runs, and the words a failure
// comes to. Nothing here touches the network.
const view = canvasView(fixtureEvents());
const findingCard = view.cards.find((c) => c.kind === "finding")!;
const excerptCard = view.cards.find((c) => c.kind === "excerpt")!;
const decompose = view.state.stepRuns.filter((r) => r.step === "decompose" && r.status === "completed").at(-1)!;

describe("what Similar runs", () => {
  it("re-runs extract for a finding card, seeded with its citation, over the documents (#66)", () => {
    expect(planSimilar(view, findingCard.cardId)).toEqual({
      plan: { step: "extract", seed: findingCard.kind === "finding" && findingCard.finding.citation, inputRunId: null },
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

  it("plans a finding card the same without a completed decompose run, and says why not for a card no longer there", () => {
    // The recorded case with its decompose run's completion taken out: extract reads the documents, so a
    // finding card still has a run to make, where re-running contradictions needed claims to look through.
    const events = SlimEvent.array().parse(recorded);
    const noDecompose = canvasView(events.filter((e) => !(e.step_run_id === decompose.stepRunId && e.type === "step.completed")).map((e, i) => ({ ...e, seq: i + 1 })));
    expect(planSimilar(noDecompose, findingCard.cardId)).toEqual({ plan: { step: "extract", seed: findingCard.kind === "finding" && findingCard.finding.citation, inputRunId: null } });
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
    expect(after.state.seededRuns).toEqual([expect.objectContaining({ step: "extract", status: "completed", seed: planned.plan.seed })]);
    // The board is untouched: the same findings, and the pipeline's runs as they were.
    expect(after.state.findings).toEqual(view.state.findings);
    expect(after.state.stepRuns).toEqual(view.state.stepRuns);
    // Every candidate is a card the canvas did not have, and a press on a finding card brings at least one:
    // the recorded run it now replays returned a passage no card had, where the contradictions run it
    // replaced returned the passage the finding was cited on (#57, #66).
    const added = candidatesOf(after, "5e2a9c47-1d3b-4f60-8a7e-0c9b6d2f4e18");
    expect(added.length).toBeGreaterThan(0);
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

  it("marks a candidate from a finding card with that finding's claim, as one from an excerpt card is (#66)", () => {
    const planned = planSimilar(view, findingCard.cardId);
    if (!("plan" in planned)) throw new Error("expected a plan");
    const after = canvasView([...fixtureEvents(), ...playback(fixtureEvents(), planned.plan, "run-x", "2026-10-03T12:00:00.000Z")!]);
    const claim = planned.plan.seed;
    // The document named as the finding's own card names it, which is how the line reads it.
    const named = cardModel(findingCard, view.state).citation.documentName;
    const candidates = candidatesOf(after, "run-x");
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const model = cardModel(after.cards.find((c) => c.cardId === candidate)!, after.state);
      expect(model).toMatchObject({ candidate: true, similarTo: `Similar to “${claim.quote}”, ${named} page ${claim.page}` });
    }
  });

  it("plays nothing back for a plan with no recording", () => {
    const plan = { step: "extract" as const, seed: { document_id: "ppm", page: 9, quote: "not recorded" }, inputRunId: null };
    expect(playback(fixtureEvents(), plan, "run", "2026-10-03T12:00:00.000Z")).toBeNull();
  });
});

describe("Similar, at once (#60)", () => {
  const press = (events: readonly SlimEvent[], cardId: string) =>
    appendOp(events, { type: "card.similar_requested", payload: { card_id: cardId, step_kind: "extract" } }, { eventId: "0b8e6a8c-2f7d-4c1e-9a3b-5d6f7e8a9b0c", at: "2026-10-03T12:00:00.000Z" });

  it("on the recorded case finds neighbours with no model, every one already a card, which it lights rather than draws twice", () => {
    const events = fixtureEvents();
    const found = instantSimilar(view, events, findingCard.cardId);
    if ("refused" in found) throw new Error("expected neighbours");
    expect(found.neighbours.length).toBeGreaterThan(0);
    expect(found.fresh).toEqual([]);
    expect(instantSaid(found)).toMatch(/already on the canvas, highlighted\. Look further asks the model/);

    const after = canvasView(press(events, findingCard.cardId));
    expect(after.cards.map((c) => c.cardId)).toEqual(view.cards.map((c) => c.cardId));
    expect(asked(view, findingCard.cardId)).toBe(false);
    expect(asked(after, findingCard.cardId)).toBe(true);
  });

  it("draws a neighbour no card had, marked instant with the passage it was found from, and says the press in the status panel", () => {
    // A later extract run holding a passage no finding cites: latent, and not drawn, until a press brings it.
    const waiver = { document_id: findingCard.kind === "finding" ? findingCard.finding.citation.document_id : "", page: 1, quote: "The management fee is waived for the first year" };
    const base = fixtureEvents();
    const run = { step: "extract", model: "fake", prompt_version: "extract@1", input_run_id: null };
    const statements = [waiver, ...(findingCard.kind === "finding" ? [findingCard.finding.citation] : [])];
    const last = base.at(-1)!;
    const extracted = [
      ...base,
      ...(["step.started", "step.completed"] as const).map((type, i) =>
        SlimEvent.parse({ ...last, seq: last.seq + 1 + i, event_id: `00000000-0000-4000-9000-00000000000${i}`, step_run_id: "later-extract", type, payload: type === "step.started" ? run : { ...run, output: { statements } } }),
      ),
    ];
    const before = canvasView(extracted);
    expect(before.cards.map((c) => c.cardId)).toEqual(view.cards.map((c) => c.cardId));
    const found = instantSimilar(before, extracted, findingCard.cardId);
    if ("refused" in found) throw new Error("expected neighbours");
    expect(found.fresh).toHaveLength(1);

    const pressed = press(extracted, findingCard.cardId);
    const after = canvasView(pressed);
    const neighbour = after.cards.find((c) => c.cardId === found.fresh[0])!;
    expect(cardModel(neighbour, after.state)).toMatchObject({ kind: "excerpt", candidate: true, instant: true, similarTo: expect.stringMatching(/^Similar to “/) });
    expect(statusLines(pressed).at(-1)).toMatchObject({ kind: "card", text: "Similar · instant: 1 like it among the extracted statements, 1 new to the canvas" });
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
