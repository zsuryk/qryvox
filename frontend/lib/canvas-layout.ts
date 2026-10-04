import { type CardId, isDiscarded, type PlanGroup, planGroups, type WorldPos } from "@qryvox/shared";
import type { CanvasCard, CanvasView } from "./canvas-source";
import { cardModel, cardSize, type ExpandedMap } from "./canvas-cards";
import { type PlanLayout, planLayout } from "./plan-region";
import { tile, type CardSize } from "./tiling";
import { boundsOf, type Rect } from "./viewport";

// Where everything on the canvas is, in world coordinates, as a pure function of the folded view: the one
// place the canvas decides layout, so the component only draws what this returns.

export type PlacedCard = { card: CanvasCard; rect: Rect; pinned: boolean };

export type CanvasLayout = {
  // The cards on the open canvas, in flow order: not docked to the plan, not in the discard bin.
  flow: PlacedCard[];
  // The cards docked to the plan, in the plan region's order.
  docked: PlacedCard[];
  plan: PlanLayout;
  // The plan's groups that have cards, in the plan's order: what a narrow screen lists in its plan sheet.
  groups: PlanGroup[];
  // Everything there is to see, for fit-to-content.
  bounds: Rect | null;
};

// A narrow screen (a phone, #61) has no room for the plan beside the flow: the plan region leaves the world
// for a sheet, so it is not in the bounds there, and the flow is one column, read top to bottom the way a
// phone is. Only the flow's shape changes: pins are world positions and stay exactly where they were put.
export type LayoutOptions = { narrow?: boolean; expanded?: ExpandedMap };

export function canvasLayout(view: CanvasView, { narrow = false, expanded }: LayoutOptions = {}): CanvasLayout {
  const { state } = view;
  const byId = new Map(view.cards.map((c) => [c.cardId, c]));
  // A docked card whose finding a later run superseded has nothing left to show, so the plan leaves it out;
  // the dock stays in the log.
  const groups = planGroups(state)
    .map((g) => ({ ...g, cards: g.cards.filter((d) => byId.has(d.cardId)) }))
    .filter((g) => g.cards.length > 0);
  const plan = planLayout(groups);
  const docked = [...plan.cards].map(([cardId, rect]) => ({ card: byId.get(cardId)!, rect, pinned: false }));
  const onFlow = view.cards.filter((c) => !plan.cards.has(c.cardId) && !isDiscarded(state, c.cardId));
  const pins = new Map<CardId, WorldPos>(state.board.pinned.map((p) => [p.cardId, p.worldPos]));
  // Each card's height is its content's (#80), and the flow packs the cards at those heights (#79).
  const sizes = new Map<CardId, CardSize>(
    view.cards.map((card) => [card.cardId, cardSize(cardModel(card, state, view.rationales),expanded?.get(card.cardId))]),
  );
  const rects = tile(
    onFlow.map((c) => c.cardId),
    pins,
    { obstacles: [plan.bounds], columns: narrow ? 1 : undefined, sizes },
  );
  const flow = onFlow.map((card) => ({ card, rect: rects.get(card.cardId)!, pinned: pins.has(card.cardId) }));
  const shown = flow.map((p) => p.rect);
  return { flow, docked, plan, groups, bounds: boundsOf(narrow ? shown : [plan.bounds, ...shown]) };
}
