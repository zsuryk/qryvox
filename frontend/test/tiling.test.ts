import { type CardId, findingCardId, SlimEvent, type WorldPos } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import { canvasLayout } from "../lib/canvas-layout";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { CARD_H, CARD_W, cardRect, FLOW_COLUMNS, GAP, overlaps, slotRect, snapToGrid, tile } from "../lib/tiling";
import type { Rect } from "../lib/viewport";

// Auto-tiling (#53): a pure layout in world coordinates. The invariant is that no two cards overlap, the
// flow keeps its gap from anything pinned, and a pinned card never moves for the flow.

const ids = (n: number, prefix = "f"): CardId[] => Array.from({ length: n }, (_, i) => findingCardId(`${prefix}${i}`));

function expectNoOverlap(rects: Rect[]) {
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) expect(overlaps(a, b), `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`).toBe(false);
  }
}

// A deterministic stand-in for "anywhere an analyst might pin": a small LCG, so failures replay.
function scatter(count: number, seed: number): WorldPos[] {
  let s = seed;
  const next = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const spots: WorldPos[] = [];
  while (spots.length < count) {
    const at = snapToGrid({ x: next() * 1600 - 200, y: next() * 1400 - 200 });
    // Pins do not overlap each other: the canvas refuses that drop, so the log never holds one.
    if (!spots.some((s) => overlaps(cardRect(s), cardRect(at)))) spots.push(at);
  }
  return spots;
}

describe("the flow", () => {
  it("runs left to right in rows of fixed columns, one card size, one gap", () => {
    const rects = [...tile(ids(6), new Map()).values()];
    expect(rects[0]).toEqual({ x: 0, y: 0, w: CARD_W, h: CARD_H });
    expect(rects[1]).toEqual({ x: CARD_W + GAP, y: 0, w: CARD_W, h: CARD_H });
    expect(rects[FLOW_COLUMNS]).toEqual({ x: 0, y: CARD_H + GAP, w: CARD_W, h: CARD_H });
    expect(new Set(rects.map((r) => r.h))).toEqual(new Set([CARD_H]));
    expectNoOverlap(rects);
  });

  it("appends a new arrival without moving any card already laid out", () => {
    const before = tile(ids(7), new Map());
    const after = tile([...ids(7), findingCardId("new")], new Map());
    for (const [id, rect] of before) expect(after.get(id)).toEqual(rect);
    expect(after.get(findingCardId("new"))).toEqual(slotRect(7));
  });
});

describe("pins", () => {
  it("hold their cards exactly where they were put, and the flow goes around them", () => {
    const order = ids(10);
    const pins = new Map<CardId, WorldPos>([
      [order[3]!, { x: 0, y: 0 }],
      [order[7]!, { x: 400, y: 260 }],
    ]);
    const rects = tile(order, pins);
    expect(rects.get(order[3]!)).toEqual(cardRect({ x: 0, y: 0 }));
    expect(rects.get(order[7]!)).toEqual(cardRect({ x: 400, y: 260 }));
    expectNoOverlap([...rects.values()]);
    // The flow keeps a full gap from a pin, not just clear of it.
    for (const [id, rect] of rects) {
      if (pins.has(id)) continue;
      for (const pin of pins.values()) expect(overlaps(rect, cardRect(pin), GAP)).toBe(false);
    }
  });

  it("survive every reflow: cards arriving, leaving, and the flow narrowing", () => {
    const order = ids(14);
    const pins = new Map<CardId, WorldPos>(scatter(4, 7).map((at, i) => [order[i * 3]!, at]));
    const layouts = [
      tile(order, pins),
      tile([...order, ...ids(5, "similar")], pins),
      tile(order.filter((_, i) => i % 2 === 0 || pins.has(order[i]!)), pins),
      tile(order, pins, { columns: 2 }),
    ];
    for (const rects of layouts) {
      for (const [id, at] of pins) expect(rects.get(id)).toEqual(cardRect(at));
      expectNoOverlap([...rects.values()]);
    }
  });

  it("keep the flow clear of obstacles too", () => {
    const plan = { x: 0, y: 0, w: 400, h: 600 };
    const rects = [...tile(ids(8), new Map(), { obstacles: [plan] }).values()];
    for (const rect of rects) expect(overlaps(rect, plan, GAP)).toBe(false);
    expectNoOverlap(rects);
  });

  it("snap a drop to the flow's grid", () => {
    expect(snapToGrid({ x: 13, y: -11 })).toEqual({ x: GAP, y: 0 });
    expect(snapToGrid({ x: 335, y: 250 })).toEqual({ x: 14 * GAP, y: 10 * GAP });
  });
});

describe("on the fixtures", () => {
  it("never overlaps on the recorded case, with its scripted ops, or with pins anywhere", () => {
    const views = [canvasView(SlimEvent.array().parse(recorded)), canvasView(fixtureEvents())];
    for (const seed of [3, 11, 29]) {
      const view = views[1]!;
      const pins = new Map(view.cards.slice(0, 5).map((c, i) => [c.cardId, scatter(5, seed)[i]!]));
      const rects = tile(
        view.cards.map((c) => c.cardId),
        pins,
      );
      expectNoOverlap([...rects.values()]);
      for (const [id, at] of pins) expect(rects.get(id)).toEqual(cardRect(at));
    }
    for (const view of views) {
      const layout = canvasLayout(view);
      expectNoOverlap(layout.flow.map((p) => p.rect));
    }
  });

  it("lays out the fixture's open cards: the pinned one at its pin, the docked and discarded ones off the flow", () => {
    const view = canvasView(fixtureEvents());
    const { flow, docked: inPlan, plan, bounds } = canvasLayout(view);
    const [docked, pinned, discarded] = view.cards.filter((c) => c.kind === "finding").map((c) => c.cardId);

    expect(flow.find((p) => p.card.cardId === pinned)).toMatchObject({ pinned: true, rect: cardRect({ x: 0, y: 0 }) });
    expect(flow.some((p) => p.card.cardId === docked || p.card.cardId === discarded)).toBe(false);
    expect(flow).toHaveLength(view.cards.length - 2);
    // The docked card is in the plan region, to the left of the flow, which keeps clear of it.
    expect(inPlan.map((p) => p.card.cardId)).toEqual([docked]);
    expect(plan.bounds.x + plan.bounds.w).toBeLessThan(0);
    expect(bounds).toMatchObject({ x: plan.bounds.x, y: 0 });
  });
});
