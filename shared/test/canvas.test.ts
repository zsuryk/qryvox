import { describe, expect, it } from "vitest";
import {
  activeFindings,
  CardEvent,
  CardOperationRequest,
  cardCategories,
  caseCards,
  excerptCardId,
  findingCardId,
  FIND_SIMILAR_STEP,
  fold,
  latestStatements,
  nearestStatements,
  seededPassages,
  similarNeighbours,
  SlimEvent,
  type CaseCard,
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

// A card event after the log, as the backend appends one.
function withCardEvent(log: readonly SlimEvent[], type: string, payload: object): SlimEvent[] {
  const seq = log.at(-1)!.seq + 1;
  return [
    ...log,
    SlimEvent.parse({
      seq,
      event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      case_id: log[0]!.case_id,
      actor: "demo-analyst",
      at: log.at(-1)!.at,
      step_run_id: null,
      type,
      v: 1,
      payload,
    }),
  ];
}

// A later unseeded extract run: the case's statements are now these. The recorded run's eleven are all
// cited by a finding, so a run with passages no finding cites is what gives a press something new.
const waiver = { document_id: "factsheet", page: 1, quote: "The management fee is waived for the first year" };
function withExtract(log: readonly SlimEvent[], statements: object[], runId = "0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a"): SlimEvent[] {
  const run = { step: "extract", model: "fake", prompt_version: "extract@1", input_run_id: null };
  const last = log.at(-1)!;
  return [
    ...log,
    ...(["step.started", "step.completed"] as const).map((type, i) =>
      SlimEvent.parse({
        ...last,
        seq: last.seq + 1 + i,
        event_id: `00000000-0000-4000-9000-${String(last.seq + 1 + i).padStart(12, "0")}`,
        step_run_id: runId,
        type,
        payload: type === "step.started" ? run : { ...run, output: { statements } },
      }),
    ),
  ];
}
const extracted = withExtract(events, [...latestStatements(events), waiver, minimum]);

// The cards the canvas draws before anything names a latent one: all but the extract run's other statements.
const drawn = (cards: CaseCard[]) => cards.filter((c) => !(c.kind === "excerpt" && c.latent));

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

  it("re-runs extract for a card of either kind, and still takes a request recorded with contradictions", () => {
    const similar = (card_id: string, step_kind: string) =>
      CardOperationRequest.safeParse({ event_id: id, type: "card.similar_requested", payload: { card_id, step_kind } }).success;
    const excerpt = excerptCardId(feeSeed);
    expect(similar("finding:f-1", FIND_SIMILAR_STEP)).toBe(true);
    expect(similar(excerpt, FIND_SIMILAR_STEP)).toBe(true);
    // A finding card re-ran contradictions before #66, and contradictions can still be seeded through the
    // API, so a request naming it is still a card operation rather than a refusal.
    expect(similar("finding:f-1", "contradictions")).toBe(true);
    expect(similar(excerpt, "contradictions")).toBe(true);
    expect(similar("finding:f-1", "findings")).toBe(false);
    expect(similar(excerpt, "findings")).toBe(false);
  });

  it("answers with a card event, and only a card event", () => {
    const at = { seq: 28, event_id: id, case_id: "c", actor: "demo-analyst", at: "2026-10-03T12:00:00.000Z", step_run_id: null, v: 1 };
    expect(CardEvent.safeParse({ ...at, type: "card.restored", payload: { card_id: "finding:f-1" } }).success).toBe(true);
    expect(CardEvent.safeParse({ ...at, type: "case.opened", payload: {} }).success).toBe(false);
  });
});

describe("the cards a case has", () => {
  it("is each active finding then its passages, then a seeded run's new passages as candidates", () => {
    const base = drawn(caseCards(events));
    const cards = drawn(caseCards(withSeededExtract(events, feeSeed, [feeSeed, minimum])));

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
    const candidate = cards.find((c) => c.cardId === excerptCardId(minimum))!;
    expect(candidate).toMatchObject({ candidateOf: RUN });
    expect(cardCategories(candidate, state, cards)).toEqual([]);
  });

  it("is nowhere for a latent statement, and under the pressed card's category for its instant neighbour", () => {
    const state = fold(extracted);
    const cards = caseCards(extracted, state);
    const latent = cards.find((c) => c.cardId === excerptCardId(waiver))!;
    expect(latent).toMatchObject({ latent: true });
    expect(cardCategories(latent, state, cards)).toEqual([]);

    const pressed = withCardEvent(extracted, "card.similar_requested", { card_id: excerptCardId(feeSeed), step_kind: FIND_SIMILAR_STEP });
    const after = caseCards(pressed);
    const neighbour = after.find((c) => c.cardId === excerptCardId(waiver))!;
    expect(neighbour).toMatchObject({ neighbourOf: { cardId: excerptCardId(feeSeed) } });
    expect(cardCategories(neighbour, fold(pressed), after)).toEqual([fees!.category]);
  });
});

describe("the statements a case has as cards (#60)", () => {
  it("is every statement of the latest unseeded extract run, latent unless something brought it", () => {
    // On the recorded case every statement is cited by a finding, so none is latent.
    expect(caseCards(events).some((c) => c.kind === "excerpt" && c.latent)).toBe(false);
    const cards = caseCards(extracted);
    const latent = cards.filter((c) => c.kind === "excerpt" && c.latent);
    const ids = new Set(cards.map((c) => c.cardId));
    expect(latestStatements(extracted).every((s) => ids.has(excerptCardId(s)))).toBe(true);
    // A statement a finding cites already has its card, and is not latent.
    expect(latent.map((c) => c.cardId)).toEqual([excerptCardId(waiver), excerptCardId(minimum)]);
    // Last, after every card that is drawn.
    expect(cards.slice(cards.length - latent.length)).toEqual(latent);
  });

  it("does not count a seeded run's statements as the case's", () => {
    const stray = { document_id: "deck", page: 1, quote: "Only a seeded run returned this" };
    const cards = caseCards(withSeededExtract(events, feeSeed, [stray]));
    expect(cards.find((c) => c.cardId === excerptCardId(stray))).toMatchObject({ candidateOf: RUN });
    expect(cards.find((c) => c.cardId === excerptCardId(stray))).not.toHaveProperty("latent");
  });
});

describe("a press of find similar (#60)", () => {
  const finding = findingCardId(fees!.finding_id);
  const pressed = withCardEvent(extracted, "card.similar_requested", { card_id: finding, step_kind: FIND_SIMILAR_STEP });

  it("brings the seed's nearest statements at once, as neighbours of the card pressed, with no run", () => {
    const before = drawn(caseCards(extracted));
    const after = drawn(caseCards(pressed));
    const atSeq = pressed.at(-1)!.seq;
    const expected = nearestStatements(extracted, feeSeed, 5).map((n) => n.citation);
    expect(expected).toContainEqual(waiver);
    expect(similarNeighbours(pressed, feeSeed, atSeq)).toEqual(expected);

    const added = after.slice(before.length);
    const had = new Set(before.map((c) => c.cardId));
    // Every neighbour is on the canvas once: those that already had a card keep it.
    expect(added.map((c) => c.cardId)).toEqual(expected.map(excerptCardId).filter((id) => !had.has(id)));
    expect(added.length).toBeGreaterThan(0);
    for (const card of added) expect(card).toMatchObject({ kind: "excerpt", neighbourOf: { cardId: finding, seed: feeSeed, atSeq } });
  });

  it("finds an excerpt card's passage from its card id, and keeps what a press found when a later extract run replaces the corpus", () => {
    const fromExcerpt = withCardEvent(extracted, "card.similar_requested", { card_id: excerptCardId(feeSeed), step_kind: FIND_SIMILAR_STEP });
    const neighbours = drawn(caseCards(fromExcerpt)).filter((c) => c.kind === "excerpt" && c.neighbourOf);
    expect(neighbours.length).toBeGreaterThan(0);

    const pinned = withCardEvent(fromExcerpt, "card.pinned", { card_id: neighbours[0]!.cardId, world_pos: { x: 0, y: 0 } });
    const later = withExtract(pinned, [minimum], "1e2d3c4b-5a69-4788-9a0b-c1d2e3f4a5b6");
    const kept = caseCards(later).filter((c) => c.kind === "excerpt" && c.neighbourOf);
    expect(kept.map((c) => c.cardId)).toEqual(neighbours.map((c) => c.cardId));
  });

  it("brings neighbours for a press recorded before #60, which named contradictions", () => {
    const old = withCardEvent(extracted, "card.similar_requested", { card_id: finding, step_kind: "contradictions" });
    expect(drawn(caseCards(old)).map((c) => c.cardId)).toEqual(drawn(caseCards(pressed)).map((c) => c.cardId));
  });
});
