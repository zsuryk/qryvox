import { describe, expect, it } from "vitest";
import {
  activeFindings,
  CardEvent,
  CardOperationRequest,
  cardCategories,
  caseCards,
  excerptCardId,
  findingCardId,
  fold,
  seededPassages,
  similarStep,
  SlimEvent,
} from "../src";
import recorded from "../fixtures/case-recorded.json";

// The cards a case has (#65): the rule the browser lays out and the server checks an operation against.
const events = SlimEvent.array().parse(recorded);
const [fees] = activeFindings(fold(events));
const feeSeed = fees!.citation;
const minimum = { document_id: "factsheet", page: 1, quote: "Minimum initial investment: USD 1,000" };
const RUN = "5e2a9c47-1d3b-4f60-8a7e-0c9b6d2f4e18";

// A completed seeded extract run after the recorded log, as the backend records one.
function withSeededExtract(log: readonly SlimEvent[], seed: object, statements: object[], runId = RUN): SlimEvent[] {
  const run = { step: "extract", model: "fake", prompt_version: "extract@1", input_run_id: null, seed };
  return [...log, ...(["step.started", "step.completed"] as const).map((type, i) =>
    SlimEvent.parse({
      seq: log.length + 1 + i,
      event_id: `00000000-0000-4000-8000-${String(log.length + 1 + i).padStart(12, "0")}`,
      case_id: log[0]!.case_id,
      actor: "demo-analyst",
      at: log.at(-1)!.at,
      step_run_id: runId,
      type,
      v: 1,
      payload: type === "step.started" ? run : { ...run, output: { statements } },
    }),
  )];
}

describe("the card operation request", () => {
  const id = "0b8e6a8c-2f7d-4c1e-9a3b-5d6f7e8a9b0c";

  it("takes each card event's type and payload with the browser's event_id", () => {
    const docked = { event_id: id, type: "card.docked", payload: { card_id: "finding:f-1", plan_slot: { category: "fees", authority: "ppm" } } };
    expect(CardOperationRequest.parse(docked)).toEqual(docked);
    for (const type of ["card.undocked", "card.unpinned", "card.discarded", "card.restored"]) {
      expect(CardOperationRequest.safeParse({ event_id: id, type, payload: { card_id: "finding:f-1" } }).success).toBe(true);
    }
    expect(CardOperationRequest.safeParse({ event_id: id, type: "card.pinned", payload: { card_id: "finding:f-1", world_pos: { x: 24, y: -48 } } }).success).toBe(true);
  });

  it("refuses anything but a card event, a malformed card id, and a missing event_id", () => {
    expect(CardOperationRequest.safeParse({ event_id: id, type: "disposition.changed", payload: { finding_id: "f-1", disposition: "approved" } }).success).toBe(false);
    expect(CardOperationRequest.safeParse({ event_id: id, type: "card.discarded", payload: { card_id: "f-1" } }).success).toBe(false);
    expect(CardOperationRequest.safeParse({ type: "card.discarded", payload: { card_id: "finding:f-1" } }).success).toBe(false);
  });

  it("re-runs contradictions for a finding card and extract for an excerpt card, and nothing else", () => {
    const similar = (card_id: string, step_kind: string) =>
      CardOperationRequest.safeParse({ event_id: id, type: "card.similar_requested", payload: { card_id, step_kind } }).success;
    const excerpt = excerptCardId(feeSeed);
    expect(similarStep("finding:f-1")).toBe("contradictions");
    expect(similarStep(excerpt)).toBe("extract");
    expect(similar("finding:f-1", "contradictions")).toBe(true);
    expect(similar(excerpt, "extract")).toBe(true);
    expect(similar("finding:f-1", "extract")).toBe(false);
    expect(similar(excerpt, "contradictions")).toBe(false);
    expect(similar("finding:f-1", "findings")).toBe(false);
  });

  it("answers with a card event, and only a card event", () => {
    const at = { seq: 28, event_id: id, case_id: "c", actor: "demo-analyst", at: "2026-10-03T12:00:00.000Z", step_run_id: null, v: 1 };
    expect(CardEvent.safeParse({ ...at, type: "card.restored", payload: { card_id: "finding:f-1" } }).success).toBe(true);
    expect(CardEvent.safeParse({ ...at, type: "case.opened", payload: {} }).success).toBe(false);
  });
});

describe("the cards a case has", () => {
  it("is each active finding then its passages, then a seeded run's new passages as candidates", () => {
    const base = caseCards(events);
    const cards = caseCards(withSeededExtract(events, feeSeed, [feeSeed, minimum]));

    expect(base[0]).toMatchObject({ cardId: findingCardId(fees!.finding_id), kind: "finding" });
    expect(base[1]).toEqual({ cardId: excerptCardId(feeSeed), kind: "excerpt", citation: feeSeed });
    expect(cards.slice(0, base.length)).toEqual(base);
    expect(cards.slice(base.length)).toEqual([{ cardId: excerptCardId(minimum), kind: "excerpt", citation: minimum, candidateOf: RUN }]);
  });

  it("reads a seeded run's passages only once it completed", () => {
    const log = withSeededExtract(events, feeSeed, [minimum]);
    expect(seededPassages(log, RUN)).toEqual([minimum]);
    expect(seededPassages(log.slice(0, -1), RUN)).toEqual([]);
  });
});

describe("where a card may dock", () => {
  it("is a finding card's category, and an excerpt card's citing findings' categories", () => {
    const state = fold(events);
    const cards = caseCards(events, state);
    expect(cardCategories(cards[0]!, state, cards)).toEqual([fees!.category]);
    expect(cardCategories(cards[1]!, state, cards)).toEqual([fees!.category]);
  });

  it("is, for a candidate no finding cites, the categories of the card it was found from, through every drift", () => {
    const further = { document_id: "factsheet", page: 2, quote: "Dealing: daily" };
    const drifted = withSeededExtract(withSeededExtract(events, feeSeed, [minimum]), minimum, [further], "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f");
    const state = fold(drifted);
    const cards = caseCards(drifted, state);
    const card = (citation: object) => cards.find((c) => c.kind === "excerpt" && JSON.stringify(c.citation) === JSON.stringify(citation))!;

    expect(cardCategories(card(minimum), state, cards)).toEqual([fees!.category]);
    expect(cardCategories(card(further), state, cards)).toEqual([fees!.category]);
  });

  it("is nowhere for a candidate seeded from a passage the case has no card for", () => {
    const stray = { document_id: "deck", page: 1, quote: "nothing cites this" };
    const log = withSeededExtract(events, stray, [minimum]);
    const state = fold(log);
    const cards = caseCards(log, state);
    expect(cardCategories(cards.at(-1)!, state, cards)).toEqual([]);
  });
});
