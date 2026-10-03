import { randomUUID } from "node:crypto";
import {
  activeFindings,
  CardOperationResponse,
  ErrorResponse,
  excerptCardId,
  findingCardId,
  isDiscarded,
  pinOf,
  planGroups,
} from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { board, caseWithPack, factsheet, pipelineLlm, runPipeline, step } from "./fake-pipeline";
import { EXTRACT_SYSTEM_PROMPT } from "../src/steps/extract";
import { FakeLlm, setup, type TestApp } from "./helpers";

// The canvas's card operations on a live case (#65): POST /cases/:caseId/cards, then the fold.

// The scripted pipeline, except that a seeded extract (a find-similar run) returns a passage no finding
// cites, so it has a candidate card to offer.
function similarLlm() {
  const pipeline = pipelineLlm();
  return new FakeLlm(async (messages) => {
    const system = messages[0]!.content;
    if (system !== EXTRACT_SYSTEM_PROMPT && system.startsWith(EXTRACT_SYSTEM_PROMPT)) return JSON.stringify({ statements: [further] });
    return (await pipeline.complete(messages)).content;
  });
}

async function caseWithFinding() {
  const t = await setup({ llm: similarLlm() });
  const caseId = await caseWithPack(t);
  const runs = await runPipeline(t, caseId);
  const [finding] = activeFindings((await board(t, caseId)).state);
  return { t, caseId, runs, finding: finding! };
}

// A passage on the factsheet that no finding cites, which a find-similar run can return.
const further = { document_id: "factsheet", page: 2, quote: factsheet.pages[1]! };

function cardOp(t: TestApp, caseId: string, type: string, payload: object, eventId: string = randomUUID()) {
  return t.request("POST", `/cases/${caseId}/cards`, { event_id: eventId, type, payload });
}

async function cardEvents(t: TestApp, caseId: string) {
  return (await board(t, caseId)).events.filter((e) => e.type.startsWith("card."));
}

describe("a card operation", () => {
  it("appends each card event as the analyst, answers with it, and folds into the canvas state", async () => {
    const { t, caseId, finding } = await caseWithFinding();
    const card = findingCardId(finding.finding_id);
    const slot = { category: "fees", authority: "factsheet" };

    const ops: [string, object][] = [
      ["card.pinned", { card_id: card, world_pos: { x: 24, y: 48 } }],
      ["card.unpinned", { card_id: card }],
      ["card.docked", { card_id: card, plan_slot: slot }],
      ["card.undocked", { card_id: card }],
      ["card.discarded", { card_id: card }],
      ["card.restored", { card_id: card }],
      ["card.similar_requested", { card_id: card, step_kind: "contradictions" }],
      // Extract is what the canvas re-runs for a finding card (#66); contradictions is what it re-ran
      // before, and what the API can still be seeded with.
      ["card.similar_requested", { card_id: card, step_kind: "extract" }],
    ];
    for (const [type, payload] of ops) {
      const res = await cardOp(t, caseId, type, payload);
      expect(res.status, await res.clone().text()).toBe(201);
      const event = CardOperationResponse.parse(await res.json());
      expect(event).toMatchObject({ type, payload, actor: "demo-analyst", step_run_id: null, case_id: caseId });
      const { events } = await board(t, caseId);
      expect(events.at(-1)).toEqual(event);
    }

    const { state } = await board(t, caseId);
    expect(state.board).toMatchObject({ docked: [], pinned: [], discarded: [] });
    expect(state.board.similarRequests).toEqual([
      expect.objectContaining({ cardId: card, stepKind: "contradictions", actor: "demo-analyst" }),
      expect.objectContaining({ cardId: card, stepKind: "extract", actor: "demo-analyst" }),
    ]);
    // Nothing touched the finding.
    expect(activeFindings(state)).toEqual([finding]);
    expect(state.dispositions).toEqual([]);
  });

  it("leaves each operation's effect in the fold: docked, pinned and discarded cards as the analyst left them", async () => {
    const { t, caseId, finding } = await caseWithFinding();
    const card = findingCardId(finding.finding_id);
    const excerpt = excerptCardId(finding.counterpart!);

    await cardOp(t, caseId, "card.docked", { card_id: card, plan_slot: { category: "fees", authority: "factsheet" } });
    await cardOp(t, caseId, "card.pinned", { card_id: excerpt, world_pos: { x: 0, y: 0 } });
    await cardOp(t, caseId, "card.discarded", { card_id: excerptCardId(finding.citation) });

    const { state } = await board(t, caseId);
    expect(planGroups(state)).toEqual([expect.objectContaining({ category: "fees", authority: "factsheet", cards: [expect.objectContaining({ cardId: card })] })]);
    expect(pinOf(state, excerpt)).toEqual({ x: 0, y: 0 });
    expect(isDiscarded(state, excerptCardId(finding.citation))).toBe(true);
  });

  it("a retried event_id appends once and answers with the event already written", async () => {
    const { t, caseId, finding } = await caseWithFinding();
    const eventId = randomUUID();
    const payload = { card_id: findingCardId(finding.finding_id) };

    const first = await cardOp(t, caseId, "card.discarded", payload, eventId);
    const second = await cardOp(t, caseId, "card.discarded", payload, eventId);

    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(await cardEvents(t, caseId)).toHaveLength(1);
  });

  it("an event_id already used by another kind of event is 409", async () => {
    const { t, caseId, finding } = await caseWithFinding();
    const eventId = randomUUID();
    await cardOp(t, caseId, "card.discarded", { card_id: findingCardId(finding.finding_id) }, eventId);

    const res = await cardOp(t, caseId, "card.restored", { card_id: findingCardId(finding.finding_id) }, eventId);

    expect(res.status).toBe(409);
    expect(await cardEvents(t, caseId)).toHaveLength(1);
  });
});

describe("a card the case does not have", () => {
  it("is 409 for a finding card of a finding never on the board, and appends nothing", async () => {
    const { t, caseId } = await caseWithFinding();

    const res = await cardOp(t, caseId, "card.discarded", { card_id: findingCardId(randomUUID()) });

    expect(res.status).toBe(409);
    expect(ErrorResponse.parse(await res.json()).error).toMatch(/not on this case's canvas/);
    expect(await cardEvents(t, caseId)).toEqual([]);
  });

  it("is 409 for an excerpt card no finding cites and no find-similar run returned", async () => {
    const { t, caseId } = await caseWithFinding();

    const res = await cardOp(t, caseId, "card.pinned", { card_id: excerptCardId(further), world_pos: { x: 0, y: 0 } });

    expect(res.status).toBe(409);
    expect(await cardEvents(t, caseId)).toEqual([]);
  });

  it("is 409 for a finding a later findings run superseded off the board, though a retry still lands", async () => {
    const { t, caseId, runs, finding } = await caseWithFinding();
    const card = findingCardId(finding.finding_id);
    const eventId = randomUUID();
    await cardOp(t, caseId, "card.pinned", { card_id: card, world_pos: { x: 0, y: 0 } }, eventId);
    await step(t, caseId, "findings", runs.contradictions.step_run_id);

    const late = await cardOp(t, caseId, "card.discarded", { card_id: card });
    const retry = await cardOp(t, caseId, "card.pinned", { card_id: card, world_pos: { x: 0, y: 0 } }, eventId);

    expect(late.status).toBe(409);
    expect(retry.status).toBe(201);
    expect(await cardEvents(t, caseId)).toHaveLength(1);
  });

  it("is on the canvas once a completed find-similar run returned it, and docks under the category it was found from", async () => {
    const { t, caseId, finding } = await caseWithFinding();
    const seeded = await t.request("POST", `/cases/${caseId}/steps`, {
      step_run_id: randomUUID(),
      step: "extract",
      input_run_id: null,
      seed: finding.citation,
    });
    expect(seeded.status, await seeded.clone().text()).toBe(200);
    const candidate = excerptCardId(further);

    expect((await cardOp(t, caseId, "card.pinned", { card_id: candidate, world_pos: { x: 0, y: 0 } })).status).toBe(201);
    expect((await cardOp(t, caseId, "card.docked", { card_id: candidate, plan_slot: { category: "fees", authority: "factsheet" } })).status).toBe(201);
    expect((await cardOp(t, caseId, "card.docked", { card_id: candidate, plan_slot: { category: "risk", authority: "factsheet" } })).status).toBe(409);
  });
});

describe("a dock into the wrong place", () => {
  it("is 409 into a slot of another category, and appends nothing", async () => {
    const { t, caseId, finding } = await caseWithFinding();

    const res = await cardOp(t, caseId, "card.docked", {
      card_id: findingCardId(finding.finding_id),
      plan_slot: { category: "risk", authority: "factsheet" },
    });

    expect(res.status).toBe(409);
    expect(ErrorResponse.parse(await res.json()).error).toMatch(/docks under fees, not risk/);
    expect(await cardEvents(t, caseId)).toEqual([]);
  });
});

describe("a request that is not a card operation", () => {
  it("is 400 for another event type, a malformed card id, or find similar naming a step that takes no seed", async () => {
    const { t, caseId, finding } = await caseWithFinding();
    const card = findingCardId(finding.finding_id);

    expect((await cardOp(t, caseId, "disposition.changed", { finding_id: finding.finding_id, disposition: "approved" })).status).toBe(400);
    expect((await cardOp(t, caseId, "card.discarded", { card_id: finding.finding_id })).status).toBe(400);
    expect((await cardOp(t, caseId, "card.similar_requested", { card_id: card, step_kind: "findings" })).status).toBe(400);
    expect(await cardEvents(t, caseId)).toEqual([]);
  });

  it("is 404 for an unknown case", async () => {
    const t = await setup();
    expect((await cardOp(t, randomUUID(), "card.discarded", { card_id: "finding:f-1" })).status).toBe(404);
  });
});
