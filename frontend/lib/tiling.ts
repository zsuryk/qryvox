import type { CardId, WorldPos } from "@qryvox/shared";
import type { Rect } from "./viewport";

// Auto-tiling (#53): where each card on the canvas goes, in world coordinates, with nothing overlapping.
// Cards flow left to right in rows of a fixed number of columns from the flow's origin, every card the
// same size with the same gap, so a card's slot is a matter of arithmetic and never of what the screen
// shows. A pinned card stays exactly where the analyst put it, and the flow goes around it: a slot that
// would touch a pinned card, or anything else in the way, is skipped, and the card takes the next free
// one. Reflowing after a card arrives or leaves therefore moves only unpinned cards, and a new arrival
// goes on the end, after every card already laid out.
//
// Pure and in world units only: the viewport (lib/viewport.ts) is what turns any of this into pixels.

// Every card is this size, whatever it shows: the fixed height is what lets the flow be arithmetic.
export const CARD_W = 300;
export const CARD_H = 220;
export const GAP = 24;

export const FLOW_COLUMNS = 4;
export const FLOW_ORIGIN: WorldPos = { x: 0, y: 0 };

export type TileOptions = {
  columns?: number;
  origin?: WorldPos;
  // Anything else the flow must keep clear of, such as the plan region.
  obstacles?: readonly Rect[];
};

export function cardRect(at: WorldPos): Rect {
  return { x: at.x, y: at.y, w: CARD_W, h: CARD_H };
}

// Whether two rectangles come closer than `clearance` to each other. Touching at exactly the clearance is
// apart: two cards a gap apart are neighbours, not an overlap.
export function overlaps(a: Rect, b: Rect, clearance = 0): boolean {
  return a.x < b.x + b.w + clearance && b.x < a.x + a.w + clearance && a.y < b.y + b.h + clearance && b.y < a.y + a.h + clearance;
}

// The rectangle of flow slot `k`: row-major from the origin.
export function slotRect(k: number, { columns = FLOW_COLUMNS, origin = FLOW_ORIGIN }: TileOptions = {}): Rect {
  return cardRect({ x: origin.x + (k % columns) * (CARD_W + GAP), y: origin.y + Math.floor(k / columns) * (CARD_H + GAP) });
}

// Lay out `order` — every card on the canvas, in the order they arrived — around the pinned ones. The
// result has a rectangle for every card in `order`, pinned cards at their pins.
export function tile(order: readonly CardId[], pins: ReadonlyMap<CardId, WorldPos>, options: TileOptions = {}): Map<CardId, Rect> {
  const placed = new Map<CardId, Rect>();
  const occupied: Rect[] = [...(options.obstacles ?? [])];
  for (const id of order) {
    const pin = pins.get(id);
    if (pin) {
      placed.set(id, cardRect(pin));
      occupied.push(cardRect(pin));
    }
  }
  let k = 0;
  for (const id of order) {
    if (placed.has(id)) continue;
    let rect = slotRect(k, options);
    while (occupied.some((o) => overlaps(o, rect, GAP))) rect = slotRect(++k, options);
    placed.set(id, rect);
    k += 1;
  }
  return placed;
}

// The pinned position nearest a drop: on the world grid the flow is built on, so pinned cards line up with
// the flow and with each other rather than landing a few units off.
export function snapToGrid(at: WorldPos, pitch = GAP): WorldPos {
  // + 0 turns a -0 (a drop just left of or above the origin) into the 0 it means.
  return { x: Math.round(at.x / pitch) * pitch + 0, y: Math.round(at.y / pitch) * pitch + 0 };
}
