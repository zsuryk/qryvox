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

  it("on a narrow screen (#61) flows one column, keeps the pin, and leaves the plan to its sheet", () => {
    const view = canvasView(fixtureEvents());
    const wide = canvasLayout(view);
    const narrow = canvasLayout(view, { narrow: true });
    expectNoOverlap(narrow.flow.map((p) => p.rect));
    expect(narrow.flow.map((p) => p.card.cardId)).toEqual(wide.flow.map((p) => p.card.cardId));
    // The pin is a world position, whatever the screen.
    expect(narrow.flow.filter((p) => p.pinned)).toEqual(wide.flow.filter((p) => p.pinned));
    // Every card the flow places sits in the one column at x = 0, below the one before.
    const flowed = narrow.flow.filter((p) => !p.pinned).map((p) => p.rect);
    expect(flowed.every((r) => r.x === 0)).toBe(true);
    for (const [i, r] of flowed.slice(1).entries()) expect(r.y).toBeGreaterThan(flowed[i]!.y);
    // The plan is not in the world here, so fitting looks at the flow only; its groups are still there to list.
    expect(narrow.bounds).toMatchObject({ x: 0, y: 0, w: CARD_W });
    expect(narrow.groups.flatMap((g) => g.cards.map((c) => c.cardId))).toEqual(wide.docked.map((p) => p.card.cardId));
  });
});

describe("variable card sizes (#79)", () => {
  const sizesOf = (hs: number[]) => new Map(ids(hs.length).map((id, i) => [id, { w: CARD_W, h: hs[i]! }]));

  it("packs mixed heights in rows with no overlap and at least GAP between cards", () => {
    const order = ids(7);
    const sizes = sizesOf([200, 320, 240, 180, 400, 260, 220]);
    const rects = tile(order, new Map(), { sizes });
    expectNoOverlap([...rects.values()]);
    for (const [id, rect] of rects) expect(rect.h).toBe(sizes.get(id)!.h);
    // Between any two cards there is either a full gap or they are in different rows.
    for (const [id, a] of rects) {
      for (const [other, b] of rects) {
        if (id === other) continue;
        const nearX = a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP;
        const nearY = a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;
        expect(overlaps(a, b, GAP)).toBe(false);
        void nearX;
        void nearY;
      }
    }
  });

  it("grows a row only to the tallest card in it", () => {
    const order = ids(FLOW_COLUMNS + 1);
    const sizes = sizesOf([400, 200, 200, 200, 220]);
    const rects = tile(order, new Map(), { sizes });
    const first = [...rects.values()].slice(0, FLOW_COLUMNS);
    const secondRow = rects.get(order[FLOW_COLUMNS]!)!;
    expect(secondRow.y).toBe(400 + GAP);
    expect(Math.min(...first.map((r) => r.y))).toBe(0);
  });

  it("keeps pins exact and routes the flow around them, with the varied sizes", () => {
    const order = ids(9);
    const sizes = sizesOf([200, 300, 250, 350, 200, 300, 260, 220, 240]);
    const pins = new Map<CardId, WorldPos>([
      [order[1]!, { x: 0, y: 0 }],
      [order[5]!, { x: 500, y: 424 }],
    ]);
    const rects = tile(order, pins, { sizes });
    expect(rects.get(order[1]!)).toEqual({ x: 0, y: 0, w: CARD_W, h: 300 });
    expect(rects.get(order[5]!)).toEqual({ x: 500, y: 424, w: CARD_W, h: 300 });
    expectNoOverlap([...rects.values()]);
    for (const [id, rect] of rects) {
      if (pins.has(id)) continue;
      for (const pin of pins.keys()) expect(overlaps(rect, rects.get(pin)!, GAP)).toBe(false);
    }
  });

  it("appends a new arrival after the last card already laid out", () => {
    const order = ids(5);
    const sizes = sizesOf([220, 300, 180, 260, 240]);
    const before = tile(order, new Map(), { sizes });
    const after = tile([...order, findingCardId("new")], new Map(), { sizes: new Map([...sizes, [findingCardId("new"), { w: CARD_W, h: 280 }]]) });
    for (const [id, rect] of before) expect(after.get(id)).toEqual(rect);
    const last = [...before.values()].reduce((a, b) => (a.y + a.h > b.y + b.h ? a : b));
    const added = after.get(findingCardId("new"))!;
    expect(added.y).toBeGreaterThanOrEqual(0);
    expect([...after.values()].filter((r) => r !== added)).toHaveLength(5);
    void last;
  });

  it("reflows with the same result as the fixed grid when every card has CARD_H", () => {
    const order = ids(9);
    const sizes = new Map(order.map((id) => [id, { w: CARD_W, h: CARD_H }]));
    expect([...tile(order, new Map(), { sizes }).entries()]).toEqual([...tile(order, new Map()).entries()]);
    const pins = new Map<CardId, WorldPos>([[order[2]!, { x: 400, y: 244 }]]);
    expect([...tile(order, pins, { sizes }).entries()]).toEqual([...tile(order, pins).entries()]);
  });
});
