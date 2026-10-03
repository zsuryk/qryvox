import { type CardId, isDiscarded, type WorldPos } from "@qryvox/shared";
import type { CanvasCard, CanvasView } from "./canvas-source";
import { tile } from "./tiling";
import { boundsOf, type Rect } from "./viewport";

// Where everything on the canvas is, in world coordinates, as a pure function of the folded view: the one
// place the canvas decides layout, so the component only draws what this returns.

export type PlacedCard = { card: CanvasCard; rect: Rect; pinned: boolean };

export type CanvasLayout = {
  // The cards on the open canvas, in flow order: not docked to the plan, not in the discard bin.
  flow: PlacedCard[];
  // Everything there is to see, for fit-to-content; null on an empty canvas.
  bounds: Rect | null;
};

export function canvasLayout(view: CanvasView): CanvasLayout {
  const { state } = view;
  const docked = new Set(state.board.docked.map((d) => d.cardId));
  const onFlow = view.cards.filter((c) => !docked.has(c.cardId) && !isDiscarded(state, c.cardId));
  const pins = new Map<CardId, WorldPos>(state.board.pinned.map((p) => [p.cardId, p.worldPos]));
  const rects = tile(
    onFlow.map((c) => c.cardId),
    pins,
  );
  const flow = onFlow.map((card) => ({ card, rect: rects.get(card.cardId)!, pinned: pins.has(card.cardId) }));
  return { flow, bounds: boundsOf(flow.map((p) => p.rect)) };
}
