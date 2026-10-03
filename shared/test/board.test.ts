import { describe, expect, it } from "vitest";
import {
  activeFindings,
  CardId,
  dispositionOf,
  EVENT_TYPES,
  excerptCardId,
  findingCardId,
  findingIdOfCard,
  fold,
  isDiscarded,
  pinOf,
  planGroups,
  SlimEvent,
} from "../src";
import recorded from "../fixtures/case-recorded.json";

// The recorded pipeline run (see fold.test.ts) with card operations appended by hand: like dispositions,
// they are what a person does, so no recording has any. Everything asserted is read off the folded log.
const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;
const recordedBoard = activeFindings(fold(events));
const [fees, , third] = recordedBoard.map((f) => findingCardId(f.finding_id));

type CardOp =
  | { type: "card.docked"; payload: { card_id: string; plan_slot: { category: string; authority: string } } }
  | { type: "card.undocked" | "card.discarded" | "card.restored" | "card.unpinned"; payload: { card_id: string } }
  | { type: "card.pinned"; payload: { card_id: string; world_pos: { x: number; y: number } } }
  | { type: "card.similar_requested"; payload: { card_id: string; step_kind: string } };

// The recorded 1..27 followed by these operations at seq 28, 29, …
function withOps(...ops: CardOp[]): SlimEvent[] {
  return [
    ...events,
    ...ops.map((op, i) => {
      const seq = events.length + 1 + i;
      return SlimEvent.parse({
        seq,
        event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        case_id: caseId,
        actor: "demo-analyst",
        at: "2026-10-03T12:00:00.000Z",
        step_run_id: null,
        v: 1,
        ...op,
      });
    }),
  ];
}

const dock = (card_id: string, category: string, authority: string): CardOp => ({
  type: "card.docked",
  payload: { card_id, plan_slot: { category, authority } },
});
const op = (type: "card.undocked" | "card.discarded" | "card.restored" | "card.unpinned", card_id: string): CardOp => ({ type, payload: { card_id } });
const pin = (card_id: string, x: number, y: number): CardOp => ({ type: "card.pinned", payload: { card_id, world_pos: { x, y } } });

describe("card ids", () => {
  it("names a finding card after its finding and an excerpt card after its passage", () => {
    expect(findingCardId("f-1")).toBe("finding:f-1");
    expect(findingIdOfCard("finding:f-1")).toBe("f-1");

    const citation = { document_id: "ppm", page: 2, quote: "Annual management fee: 1.25%" };
    const id = excerptCardId(citation);
    expect(id).toMatch(/^excerpt:ppm:2:[0-9a-f]{8}$/);
    expect(CardId.parse(id)).toBe(id);
    expect(findingIdOfCard(id)).toBeNull();
    // Stable across whitespace the text layer may vary, distinct across passages.
    expect(excerptCardId({ ...citation, quote: " Annual  management\nfee: 1.25% " })).toBe(id);
    expect(excerptCardId({ ...citation, quote: "Annual management fee: 0.85%" })).not.toBe(id);
  });

  it("refuses an id that is neither kind", () => {
    expect(CardId.safeParse("f-1").success).toBe(false);
    expect(CardId.safeParse("excerpt:ppm:0:deadbeef").success).toBe(false);
  });
});

describe("fold: card operations", () => {
  it("adds the card events to the vocabulary, and a recorded case has no board state", () => {
    expect(EVENT_TYPES).toEqual(
      expect.arrayContaining(["card.docked", "card.undocked", "card.pinned", "card.discarded", "card.restored", "card.similar_requested"]),
    );
    expect(fold(events).board).toEqual({ docked: [], pinned: [], discarded: [], similarRequests: [] });
  });

  it("groups the plan region by category, then authority from the PPM down", () => {
    const excerpt = excerptCardId({ document_id: "deck", page: 1, quote: "Target yield 8%" });
    const state = fold(
      withOps(dock(excerpt, "fees", "deck"), dock(third!, "risk", "ppm"), dock(fees!, "fees", "fee_table"), dock("finding:x", "fees", "ppm")),
    );

    expect(planGroups(state).map((g) => [g.category, g.authority, g.cards.map((c) => c.cardId)])).toEqual([
      ["fees", "ppm", ["finding:x"]],
      ["fees", "fee_table", [fees]],
      ["fees", "deck", [excerpt]],
      ["risk", "ppm", [third]],
    ]);
    expect(state.board.docked[0]).toEqual({
      cardId: excerpt,
      slot: { category: "fees", authority: "deck" },
      actor: "demo-analyst",
      dockedAtSeq: 28,
    });
  });

  it("docking again moves the card rather than listing it twice; undocking takes it out", () => {
    const moved = fold(withOps(dock(fees!, "fees", "deck"), dock(fees!, "fees", "ppm")));
    expect(moved.board.docked).toEqual([expect.objectContaining({ cardId: fees, slot: { category: "fees", authority: "ppm" }, dockedAtSeq: 29 })]);

    expect(fold(withOps(dock(fees!, "fees", "ppm"), op("card.undocked", fees!))).board.docked).toEqual([]);
  });

  it("keeps the latest pin per card", () => {
    const state = fold(withOps(pin(fees!, 0, 0), pin(third!, 10, -4.5), pin(fees!, 320, 128)));

    expect(pinOf(state, fees!)).toEqual({ x: 320, y: 128 });
    expect(pinOf(state, third!)).toEqual({ x: 10, y: -4.5 });
    expect(state.board.pinned.map((p) => [p.cardId, p.pinnedAtSeq])).toEqual([
      [fees, 30],
      [third, 29],
    ]);
  });

  it("unpins a card back into the flow, and the latest of pin and unpin wins", () => {
    const released = fold(withOps(pin(fees!, 0, 0), pin(third!, 24, 24), op("card.unpinned", fees!)));
    expect(pinOf(released, fees!)).toBeNull();
    expect(pinOf(released, third!)).toEqual({ x: 24, y: 24 });

    const repinned = fold(withOps(pin(fees!, 0, 0), op("card.unpinned", fees!), pin(fees!, 48, 0)));
    expect(pinOf(repinned, fees!)).toEqual({ x: 48, y: 0 });
    // Unpinning a card that was never pinned changes nothing but the seq.
    expect(fold(withOps(op("card.unpinned", fees!))).board).toEqual(fold(events).board);
    expect(EVENT_TYPES).toContain("card.unpinned");
  });

  it("discard rejects the card and never touches the finding it shows", () => {
    const before = fold(events);
    const state = fold(withOps(dock(fees!, "fees", "fee_table"), op("card.discarded", fees!)));

    expect(isDiscarded(state, fees!)).toBe(true);
    // A discarded card leaves the plan region…
    expect(state.board.docked).toEqual([]);
    // …and the finding is exactly as it was: on the board, not superseded, not dismissed.
    expect(state.findings).toEqual(before.findings);
    expect(activeFindings(state)).toEqual(recordedBoard);
    expect(dispositionOf(state, findingIdOfCard(fees!)!)).toBeNull();
  });

  it("restores a discarded card, by card.restored or by docking it again", () => {
    const restored = fold(withOps(op("card.discarded", fees!), op("card.restored", fees!)));
    expect(isDiscarded(restored, fees!)).toBe(false);
    expect(restored.board.docked).toEqual([]);

    const redocked = fold(withOps(op("card.discarded", fees!), dock(fees!, "fees", "ppm")));
    expect(isDiscarded(redocked, fees!)).toBe(false);
    expect(planGroups(redocked)).toEqual([expect.objectContaining({ category: "fees", authority: "ppm" })]);
  });

  it("keeps a pin while the card is in the bin, for when it comes back", () => {
    const state = fold(withOps(pin(fees!, 5, 5), op("card.discarded", fees!), op("card.restored", fees!)));

    expect(pinOf(state, fees!)).toEqual({ x: 5, y: 5 });
  });

  it("records every find-similar request in order, as a history", () => {
    const similar = (card_id: string, step_kind: string): CardOp => ({ type: "card.similar_requested", payload: { card_id, step_kind } });
    const state = fold(withOps(similar(fees!, "findings"), similar(third!, "contradictions"), similar(fees!, "findings")));

    expect(state.board.similarRequests).toEqual([
      { cardId: fees, stepKind: "findings", actor: "demo-analyst", atSeq: 28 },
      { cardId: third, stepKind: "contradictions", actor: "demo-analyst", atSeq: 29 },
      { cardId: fees, stepKind: "findings", actor: "demo-analyst", atSeq: 30 },
    ]);
  });

  it("is pure, replayable to any seq, and folds the same whatever order events arrive in", () => {
    const log = withOps(dock(fees!, "fees", "ppm"), pin(third!, 1, 2), op("card.discarded", fees!), op("card.restored", fees!));

    expect(fold(log)).toEqual(fold(log));
    expect(fold([...log].reverse())).toEqual(fold(log));
    // Replay to seq 29: docked and pinned, the discard not yet made.
    const at29 = fold(log.filter((e) => e.seq <= 29));
    expect(planGroups(at29).map((g) => g.cards.map((c) => c.cardId))).toEqual([[fees]]);
    expect(isDiscarded(at29, fees!)).toBe(false);
    expect(isDiscarded(fold(log.filter((e) => e.seq <= 30)), fees!)).toBe(true);
    // Folding leaves the input untouched.
    expect(log).toEqual(withOps(dock(fees!, "fees", "ppm"), pin(third!, 1, 2), op("card.discarded", fees!), op("card.restored", fees!)));
  });

  it("refuses a slot outside the categories and document kinds, and a position that is not a number", () => {
    expect(() => withOps(dock(fees!, "fees", "prospectus"))).toThrow();
    expect(() => withOps(dock(fees!, "liquidity", "ppm"))).toThrow();
    expect(() => withOps(pin(fees!, Number.POSITIVE_INFINITY, 0))).toThrow();
  });
});
