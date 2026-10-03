import { type CardId, isDiscarded, planGroups, type WorldPos } from "@qryvox/shared";
import type { CanvasCard, CanvasView } from "./canvas-source";
import { type PlanLayout, planLayout } from "./plan-region";
import { tile } from "./tiling";
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
  // Everything there is to see, for fit-to-content.
  bounds: Rect | null;
};

export function canvasLayout(view: CanvasView): CanvasLayout {
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
  const rects = tile(
    onFlow.map((c) => c.cardId),
    pins,
    { obstacles: [plan.bounds] },
  );
  const flow = onFlow.map((card) => ({ card, rect: rects.get(card.cardId)!, pinned: pins.has(card.cardId) }));
  return { flow, docked, plan, bounds: boundsOf([plan.bounds, ...flow.map((p) => p.rect)]) };
}
