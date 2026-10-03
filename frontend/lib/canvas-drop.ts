import type { CardId, FindingCategory, PlanSlot, WorldPos } from "@qryvox/shared";
import { categoryLabel } from "./board";
import type { CardOp } from "./canvas-store";
import { cardRect, overlaps, snapToGrid } from "./tiling";
import type { Rect } from "./viewport";

// What dropping a dragged card does (#55, #56), decided apart from the pointer so it can be tested: the
// gesture says where the card was let go, and this says which card operations that is, or why the card
// goes back to where it came from. A drop that is not an operation returns the card and loses nothing.

export type DropTarget =
  // Over the discard bin.
  | { kind: "bin" }
  // Over one slot of the plan region.
  | { kind: "slot"; slot: PlanSlot }
  // Over the plan region, but no slot in it.
  | { kind: "plan" }
  // Over the plan as a whole, where it is not in the world: a narrow screen's Plan button (#61). The card
  // goes in its own slot, the one its Dock button uses, or null when it has none.
  | { kind: "dock"; slot: PlanSlot | null }
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
  // The slot the card is docked in, or null when it is not in the plan.
  docked: PlanSlot | null;
  // The categories it may be docked under (canvas-cards.ts dockableCategories); none for a passage no
  // finding cites.
  categories: readonly FindingCategory[];
};

export type DropOutcome = { ops: CardOp[]; said: string } | { returned: string };

const BACK = "Back in its place";

export function resolveDrop(cardId: CardId, target: DropTarget, context: DropContext): DropOutcome {
  switch (target.kind) {
    case "bin":
      return context.discarded
        ? { returned: "It is already in the discard bin." }
        : { ops: [{ type: "card.discarded", payload: { card_id: cardId } }], said: "Discarded from the canvas. The finding is not dismissed; restore the card from the bin." };
    case "outside":
      return { returned: `${BACK}: it was let go off the canvas.` };
    case "plan":
      return { returned: `${BACK}: drop it on one of the plan's slots.` };
    case "dock":
      return target.slot === null
        ? { returned: `${BACK}: no finding cites this passage, so it has no place in the plan.` }
        : resolveDrop(cardId, { kind: "slot", slot: target.slot }, context);
    case "slot": {
      const { slot } = target;
      if (context.categories.length === 0) return { returned: `${BACK}: no finding cites this passage, so it has no place in the plan.` };
      if (!context.categories.includes(slot.category)) {
        return { returned: `${BACK}: it belongs under ${context.categories.map(categoryLabel).join(" or ")}, not ${categoryLabel(slot.category)}.` };
      }
      // Dropped again on its own slot, it goes to the end of the group: a rearrangement, and recorded.
      const moved = context.docked !== null;
      return {
        ops: [{ type: "card.docked", payload: { card_id: cardId, plan_slot: slot } }],
        said: moved ? "Moved in the plan." : "Docked to the plan: it is in the reportable set.",
      };
    }
    case "canvas": {
      const at = snapToGrid(target.at);
      const rect = cardRect(at);
      if (context.pinned.some((p) => p.cardId !== cardId && overlaps(p.rect, rect))) {
        return { returned: `${BACK}: another pinned card is there.` };
      }
      if (context.obstacles.some((o) => overlaps(o, rect))) {
        return { returned: `${BACK}: that is not open canvas.` };
      }
      const pin: CardOp = { type: "card.pinned", payload: { card_id: cardId, world_pos: at } };
      // Out of the plan and onto the canvas: undocked, and held where it was put.
      return context.docked
        ? { ops: [{ type: "card.undocked", payload: { card_id: cardId } }, pin], said: "Taken out of the plan and pinned there." }
        : { ops: [pin], said: "Pinned there. The other cards flow around it." };
    }
  }
}
