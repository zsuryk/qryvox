import { findingCardId, pinOf, isDiscarded } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { resolveDrop } from "../lib/canvas-drop";
import { canvasLayout } from "../lib/canvas-layout";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { appendOp } from "../lib/canvas-store";
import { cardRect, CARD_W } from "../lib/tiling";

// What a drop does (#56): the bin discards, open canvas pins, anything else returns the card. And what it
// did survives a reload, because a reload is the same fold over the same log.

const card = findingCardId("dragged");
const other = { cardId: findingCardId("pinned"), rect: cardRect({ x: 0, y: 0 }) };
const context = { pinned: [other], obstacles: [{ x: -400, y: 0, w: 360, h: 600 }], discarded: false, docked: null, categories: ["fees" as const] };

describe("a drop", () => {
  it("on the bin discards the card", () => {
    expect(resolveDrop(card, { kind: "bin" }, context)).toMatchObject({ ops: [{ type: "card.discarded", payload: { card_id: card } }] });
    expect(resolveDrop(card, { kind: "bin" }, { ...context, discarded: true })).toHaveProperty("returned");
  });

  it("on open canvas pins it there, snapped to the grid", () => {
    expect(resolveDrop(card, { kind: "canvas", at: { x: 1003, y: 470 } }, context)).toMatchObject({
      ops: [{ type: "card.pinned", payload: { card_id: card, world_pos: { x: 1008, y: 480 } } }],
    });
  });

  it("on the plan as a whole (a narrow screen's Plan button, #61) docks it in its own slot, if it has one", () => {
    const slot = { category: "fees" as const, authority: "ppm" as const };
    expect(resolveDrop(card, { kind: "dock", slot }, context)).toMatchObject({ ops: [{ type: "card.docked", payload: { card_id: card, plan_slot: slot } }] });
    expect(resolveDrop(card, { kind: "dock", slot: null }, { ...context, categories: [] })).toMatchObject({ returned: expect.stringMatching(/no finding cites/) });
  });

  it("returns the card when it would land on another pin, on an obstacle, or off the canvas", () => {
    expect(resolveDrop(card, { kind: "canvas", at: { x: 100, y: 50 } }, context)).toHaveProperty("returned");
    expect(resolveDrop(card, { kind: "canvas", at: { x: -300, y: 100 } }, context)).toHaveProperty("returned");
    expect(resolveDrop(card, { kind: "outside" }, context)).toHaveProperty("returned");
    // A card may be dropped over where it already is pinned: moving it a little is moving it.
    expect(resolveDrop(other.cardId, { kind: "canvas", at: { x: 24, y: 0 } }, context)).toHaveProperty("ops");
  });
});

describe("what a drop did", () => {
  it("survives reflow and a reload from the log: the pin stays, the discarded card stays in the bin, and restores", () => {
    const events = fixtureEvents();
    const cards = canvasView(events).cards;
    const [pinned, discarded] = [cards[5]!.cardId, cards[6]!.cardId];
    const at = (n: number) => ({ eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "7")}`, at: "2026-10-03T12:00:00.000Z" });
    let log = appendOp(events, { type: "card.pinned", payload: { card_id: pinned, world_pos: { x: 1344, y: 0 } } }, at(1));
    log = appendOp(log, { type: "card.discarded", payload: { card_id: discarded } }, at(2));

    // A reload is the same fold of the same events, serialised and read back.
    const reloaded = canvasView(JSON.parse(JSON.stringify(log)));
    expect(pinOf(reloaded.state, pinned)).toEqual({ x: 1344, y: 0 });
    expect(canvasLayout(reloaded).flow.find((p) => p.card.cardId === pinned)?.rect).toMatchObject({ x: 1344, y: 0, w: CARD_W });
    expect(isDiscarded(reloaded.state, discarded)).toBe(true);
    expect(canvasLayout(reloaded).flow.some((p) => p.card.cardId === discarded)).toBe(false);

    const restored = canvasView(appendOp(log, { type: "card.restored", payload: { card_id: discarded } }, at(3)));
    expect(canvasLayout(restored).flow.some((p) => p.card.cardId === discarded)).toBe(true);
    // Restoring reflows the flow; the pin does not move.
    expect(canvasLayout(restored).flow.find((p) => p.card.cardId === pinned)?.rect).toMatchObject({ x: 1344, y: 0, w: CARD_W });

    const released = canvasView(appendOp(log, { type: "card.unpinned", payload: { card_id: pinned } }, at(4)));
    expect(canvasLayout(released).flow.find((p) => p.card.cardId === pinned)?.pinned).toBe(false);
  });
});
