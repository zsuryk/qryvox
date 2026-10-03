import { AUTHORITY_ORDER, findingCardId, FindingCategory, type PlanGroup } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { resolveDrop } from "../lib/canvas-drop";
import { canvasLayout } from "../lib/canvas-layout";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { appendOp } from "../lib/canvas-store";
import { planHit, planLayout } from "../lib/plan-region";
import { overlaps } from "../lib/tiling";

// The plan region (#55): a world-space column of category × authority slots, laid out from planGroups().

const docked = (category: FindingCategory, authority: (typeof AUTHORITY_ORDER)[number], ...ids: string[]): PlanGroup => ({
  category,
  authority,
  cards: ids.map((id, i) => ({ cardId: findingCardId(id), slot: { category, authority }, actor: "demo-analyst", dockedAtSeq: 30 + i })),
});

describe("the plan's layout", () => {
  it("has a slot for every category × authority, the authorities PPM first, in every category", () => {
    const plan = planLayout([]);
    expect(plan.slots).toHaveLength(FindingCategory.options.length * AUTHORITY_ORDER.length);
    for (const category of FindingCategory.options) {
      const row = plan.slots.filter((s) => s.slot.category === category);
      expect(row.map((s) => s.slot.authority)).toEqual(["ppm", "fee_table", "factsheet", "deck"]);
      // Left to right in that order.
      expect(row.map((s) => s.target.x)).toEqual([...row.map((s) => s.target.x)].sort((a, b) => a - b));
    }
    expect(plan.categories.map((c) => c.category)).toEqual(FindingCategory.options);
  });

  it("opens a group under a slot with cards, stacked in docking order, never overlapping", () => {
    const plan = planLayout([docked("fees", "ppm", "a"), docked("fees", "deck", "b", "c"), docked("risk", "fee_table", "d")]);
    const rects = [...plan.cards.values()];
    expect([...plan.cards.keys()]).toEqual(["a", "b", "c", "d"].map(findingCardId));
    for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    expect(plan.cards.get(findingCardId("b"))!.y).toBeLessThan(plan.cards.get(findingCardId("c"))!.y);
    expect(plan.slots.find((s) => s.slot.category === "fees" && s.slot.authority === "deck")).toMatchObject({ count: 2 });
    // Everything fits inside the region, which grows with what is docked.
    for (const r of rects) expect(r.y + r.h).toBeLessThanOrEqual(plan.bounds.y + plan.bounds.h);
    expect(plan.bounds.h).toBeGreaterThan(planLayout([]).bounds.h);
  });

  it("says what is under a point: a slot's target or its group, the region, or nothing", () => {
    const plan = planLayout([docked("terms", "factsheet", "a")]);
    const slot = plan.slots.find((s) => s.slot.category === "terms" && s.slot.authority === "factsheet")!;
    const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    expect(planHit(plan, centre(slot.target))).toEqual({ kind: "slot", slot: { category: "terms", authority: "factsheet" } });
    expect(planHit(plan, centre(slot.group!))).toEqual({ kind: "slot", slot: { category: "terms", authority: "factsheet" } });
    expect(planHit(plan, centre(plan.categories[0]!.heading))).toEqual({ kind: "plan" });
    expect(planHit(plan, { x: 10, y: 10 })).toBeNull();
  });
});

describe("docking by drop", () => {
  const card = findingCardId("x");
  const base = { pinned: [], obstacles: [], discarded: false, docked: null, categories: ["fees" as const] };

  it("snaps into a slot of the card's category, any authority", () => {
    expect(resolveDrop(card, { kind: "slot", slot: { category: "fees", authority: "ppm" } }, base)).toMatchObject({
      ops: [{ type: "card.docked", payload: { card_id: card, plan_slot: { category: "fees", authority: "ppm" } } }],
    });
  });

  it("returns the card from a slot of another category, from the region between slots, or with no category", () => {
    expect(resolveDrop(card, { kind: "slot", slot: { category: "risk", authority: "ppm" } }, base)).toEqual({
      returned: "Back in its place: it belongs under Fees, not Risk.",
    });
    expect(resolveDrop(card, { kind: "plan" }, base)).toHaveProperty("returned");
    expect(resolveDrop(card, { kind: "slot", slot: { category: "fees", authority: "ppm" } }, { ...base, categories: [] })).toHaveProperty("returned");
  });

  it("takes a docked card out of the plan when it is dropped on open canvas, and moves it when dropped on another slot", () => {
    const inPlan = { ...base, docked: { category: "fees", authority: "ppm" } as const };
    expect(resolveDrop(card, { kind: "canvas", at: { x: 2016, y: 0 } }, inPlan)).toMatchObject({
      ops: [{ type: "card.undocked" }, { type: "card.pinned", payload: { world_pos: { x: 2016, y: 0 } } }],
    });
    expect(resolveDrop(card, { kind: "slot", slot: { category: "fees", authority: "deck" } }, inPlan)).toMatchObject({
      ops: [{ type: "card.docked", payload: { plan_slot: { authority: "deck" } } }],
      said: "Moved in the plan.",
    });
  });

  it("round-trips through events: docked, moved, undocked, each a fold of the log", () => {
    const events = fixtureEvents();
    const card = canvasView(events).cards.find((c) => c.kind === "finding" && c.finding.category === "strategy")!.cardId;
    const env = (n: number) => ({ eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "5")}`, at: "2026-10-03T12:00:00.000Z" });
    const dockedLog = appendOp(events, { type: "card.docked", payload: { card_id: card, plan_slot: { category: "strategy", authority: "factsheet" } } }, env(1));
    const movedLog = appendOp(dockedLog, { type: "card.docked", payload: { card_id: card, plan_slot: { category: "strategy", authority: "ppm" } } }, env(2));
    const undockedLog = appendOp(movedLog, { type: "card.undocked", payload: { card_id: card } }, env(3));

    const slotOf = (log: typeof events) => {
      const layout = canvasLayout(canvasView(log));
      const rect = layout.docked.find((p) => p.card.cardId === card)?.rect;
      return rect ? layout.plan.slots.find((s) => s.group && rect.y >= s.group.y && rect.y < s.group.y + s.group.h)?.slot : null;
    };
    expect(slotOf(dockedLog)).toEqual({ category: "strategy", authority: "factsheet" });
    expect(slotOf(movedLog)).toEqual({ category: "strategy", authority: "ppm" });
    expect(slotOf(undockedLog)).toBeNull();
    expect(canvasLayout(canvasView(undockedLog)).flow.some((p) => p.card.cardId === card)).toBe(true);
  });
});
