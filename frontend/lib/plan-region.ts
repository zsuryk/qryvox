import { AUTHORITY_ORDER, type CardId, FindingCategory, type PlanGroup, type PlanSlot, type WorldPos } from "@qryvox/shared";
import { CARD_H, CARD_W } from "./tiling";
import type { Rect } from "./viewport";

// The plan region (#55): the reportable set, as a column of the canvas to the left of the flow, in world
// coordinates like everything else on it. One section per category, in the contract's order; in each, one
// slot per authority, PPM first and the deck last (AUTHORITY_ORDER, CONTEXT.md), drawn as a row of
// targets a card is dropped on. A slot with cards opens below the row into a group: its label, then its
// cards stacked in the order they were docked. The whole of it is a function of planGroups(), so it
// reflows with whatever the log says is docked, and nothing about it is stored.

export const PLAN_PAD = 16;
export const PLAN_W = CARD_W + 2 * PLAN_PAD;
// The space between the plan and the flow at world x = 0.
export const PLAN_GAP = 48;
const HEAD = 56;
const CATEGORY_HEAD = 28;
const TARGETS = 32;
const GROUP_HEAD = 26;
const STACK_GAP = 12;
const SECTION_GAP = 20;

export type PlanSlotLayout = {
  slot: PlanSlot;
  // The slot's target in its category's row.
  target: Rect;
  // Where its docked cards are stacked, with their label; null while it has none.
  group: Rect | null;
  count: number;
};

export type PlanLayout = {
  bounds: Rect;
  categories: { category: FindingCategory; heading: Rect }[];
  slots: PlanSlotLayout[];
  // Every docked card's rectangle.
  cards: Map<CardId, Rect>;
};

export function planLayout(groups: readonly PlanGroup[], origin: WorldPos = { x: -(PLAN_W + PLAN_GAP), y: 0 }): PlanLayout {
  const inner = origin.x + PLAN_PAD;
  const targetW = (CARD_W - (AUTHORITY_ORDER.length - 1) * 6) / AUTHORITY_ORDER.length;
  const categories: PlanLayout["categories"] = [];
  const slots: PlanSlotLayout[] = [];
  const cards = new Map<CardId, Rect>();
  let y = origin.y + HEAD;

  for (const category of FindingCategory.options) {
    categories.push({ category, heading: { x: inner, y, w: CARD_W, h: CATEGORY_HEAD } });
    y += CATEGORY_HEAD;
    const row = y;
    y += TARGETS + STACK_GAP;
    for (const [i, authority] of AUTHORITY_ORDER.entries()) {
      const group = groups.find((g) => g.category === category && g.authority === authority);
      const target = { x: inner + i * (targetW + 6), y: row, w: targetW, h: TARGETS };
      if (!group) {
        slots.push({ slot: { category, authority }, target, group: null, count: 0 });
        continue;
      }
      const top = y;
      y += GROUP_HEAD;
      for (const card of group.cards) {
        cards.set(card.cardId, { x: inner, y, w: CARD_W, h: CARD_H });
        y += CARD_H + STACK_GAP;
      }
      slots.push({ slot: { category, authority }, target, group: { x: inner, y: top, w: CARD_W, h: y - top - STACK_GAP }, count: group.cards.length });
    }
    y += SECTION_GAP;
  }
  return { bounds: { x: origin.x, y: origin.y, w: PLAN_W, h: y - origin.y }, categories, slots, cards };
}

const within = (r: Rect, p: WorldPos) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// What is under a world point: a slot (its target, or its group of cards), the plan region but no slot,
// or nothing of the plan's at all.
export function planHit(plan: PlanLayout, at: WorldPos): { kind: "slot"; slot: PlanSlot } | { kind: "plan" } | null {
  const hit = plan.slots.find((s) => within(s.target, at) || (s.group !== null && within(s.group, at)));
  if (hit) return { kind: "slot", slot: hit.slot };
  return within(plan.bounds, at) ? { kind: "plan" } : null;
}
