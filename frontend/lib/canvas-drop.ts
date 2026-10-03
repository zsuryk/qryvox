import type { CardId, WorldPos } from "@qryvox/shared";
import type { CardOp } from "./canvas-store";
import { cardRect, overlaps, snapToGrid } from "./tiling";
import type { Rect } from "./viewport";

// What dropping a dragged card does (#55, #56), decided apart from the pointer so it can be tested: the
// gesture says where the card was let go, and this says which card operation that is, or why the card
// goes back to where it came from. A drop that is not an operation returns the card and loses nothing.

export type DropTarget =
  // Over the discard bin.
  | { kind: "bin" }
  // On the open canvas, the card's top-left corner at this world position.
  | { kind: "canvas"; at: WorldPos }
  // Anywhere else: off the canvas, or over its controls.
  | { kind: "outside" };

export type DropContext = {
  // Where every other pinned card is: a pin may not land on one.
  pinned: readonly { cardId: CardId; rect: Rect }[];
  // What a pin may not land on at all, such as the plan region.
  obstacles: readonly Rect[];
  discarded: boolean;
};

export type DropOutcome = { ops: CardOp[]; said: string } | { returned: string };

export function resolveDrop(cardId: CardId, target: DropTarget, context: DropContext): DropOutcome {
  switch (target.kind) {
    case "bin":
      return context.discarded
        ? { returned: "It is already in the discard bin." }
        : { ops: [{ type: "card.discarded", payload: { card_id: cardId } }], said: "Discarded. It is in the bin, and can be restored." };
    case "outside":
      return { returned: "Back in its place: it was let go off the canvas." };
    case "canvas": {
      const at = snapToGrid(target.at);
      const rect = cardRect(at);
      if (context.pinned.some((p) => p.cardId !== cardId && overlaps(p.rect, rect))) {
        return { returned: "Back in its place: another pinned card is there." };
      }
      if (context.obstacles.some((o) => overlaps(o, rect))) {
        return { returned: "Back in its place: that is not open canvas." };
      }
      return { ops: [{ type: "card.pinned", payload: { card_id: cardId, world_pos: at } }], said: "Pinned there. The other cards flow around it." };
    }
  }
}
