import { isDiscarded, planGroups } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { cardModel, cardSize } from "../lib/canvas-cards";
import { canvasLayout } from "../lib/canvas-layout";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { appendOp } from "../lib/canvas-store";
import { planLayout } from "../lib/plan-region";
import { tile } from "../lib/tiling";

// The canvas toolbar's Reflow (#82): whatever the analyst did with their hands, pressing it puts every
// unpinned card back into the tiling, in arrival order, and leaves every pin where it was. What it
// promises is the tiling result itself: exactly what lib/tiling.ts would lay out from the folded log.

const at = (n: number) => ({ eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "3")}`, at: "2026-10-04T09:00:00.000Z" });

// Random manual moves: a seeded walk of pins, unpins and discards, so any failure replays.
function scrambled(seed: number) {
  const view = canvasView(fixtureEvents());
  let events = fixtureEvents();
  let s = seed;
  const next = () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  const touched = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const card = view.cards[Math.floor(next() * view.cards.length)]!;
    if (touched.has(card.cardId)) continue;
    touched.add(card.cardId);
    const roll = next();
    if (roll < 0.5) events = appendOp(events, { type: "card.pinned", payload: { card_id: card.cardId, world_pos: { x: Math.floor(next() * 8) * 324, y: Math.floor(next() * 6) * 244 } } }, at(i + 10));
    else if (roll < 0.7) events = appendOp(events, { type: "card.unpinned", payload: { card_id: card.cardId } }, at(i + 10));
    else events = appendOp(events, { type: "card.discarded", payload: { card_id: card.cardId } }, at(i + 10));
  }
  return canvasView(events);
}

describe("reflow (#82)", () => {
  it("reproduces the tiling result after random manual moves, keeping pins", () => {
    for (const seed of [5, 19, 42, 77]) {
      const view = scrambled(seed);
      const layout = canvasLayout(view);
      const byId = new Map(view.cards.map((c) => [c.cardId, c]));
      const onFlow = view.cards.filter((c) => !view.state.board.docked.some((d) => d.cardId === c.cardId) && !isDiscarded(view.state, c.cardId));
      const pins = new Map(view.state.board.pinned.map((p) => [p.cardId, p.worldPos]));
      const sizes = new Map(onFlow.map((c) => [c.cardId, cardSize(cardModel(c, view.state, view.rationales))]));
      const groups = planGroups(view.state).map((g) => ({ ...g, cards: g.cards.filter((d) => byId.has(d.cardId)) })).filter((g) => g.cards.length > 0);
      const expected = tile(onFlow.map((c) => c.cardId), pins, { obstacles: [planLayout(groups).bounds], sizes });
      for (const placed of layout.flow) {
        expect(placed.rect).toEqual(expected.get(placed.card.cardId));
        if (placed.pinned) {
          const pin = pins.get(placed.card.cardId)!;
          expect(placed.rect).toMatchObject({ x: pin.x, y: pin.y });
        }
      }
      for (const [i, a] of layout.flow.entries()) {
        for (const b of layout.flow.slice(i + 1)) {
          expect(a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.y < b.rect.y + b.rect.h && b.rect.y < a.rect.y + a.rect.h).toBe(false);
        }
      }
    }
  });
});
