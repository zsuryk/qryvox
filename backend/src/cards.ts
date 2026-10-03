import { ANALYST_ACTOR, cardCategories, type CardOperationRequest, caseCards, fold } from "@qryvox/shared";
import type { Db } from "./db/client.js";
import type { EventRow } from "./db/schema.js";
import { appendOnceWith, caseLog } from "./log.js";

// The canvas's card operations on a live case (#65). Each is the analyst's decision, appended as they are,
// like a disposition: no model is called, and nothing here touches a finding. The checks run inside the
// write transaction against the case as it stands then, so a card a findings run has just superseded off
// the canvas cannot be docked in the same instant.

// An operation the case cannot take: a card it does not have, or a dock into another category. 409,
// nothing appended.
export class CardConflict extends Error {
  override name = "CardConflict";
}

export function recordCardOperation(db: Db, caseId: string, request: CardOperationRequest): Promise<EventRow> {
  const { event_id, type, payload } = request;
  return appendOnceWith(db, caseId, { eventId: event_id, type, v: 1, actor: ANALYST_ACTOR }, async (tx) => {
    const log = await caseLog(tx, caseId);
    const state = fold(log);
    // The cards the browser lays out, by the same rule (canvas.ts): a finding card for each finding on the
    // board, an excerpt card for each passage one cites or a completed find-similar run returned.
    const cards = caseCards(log, state);
    const card = cards.find((c) => c.cardId === payload.card_id);
    if (!card) {
      throw new CardConflict(
        `card ${payload.card_id} is not on this case's canvas: no finding on the board is it or cites it, it is not a statement of the latest extract run, and no find-similar press or completed run returned it`,
      );
    }
    if (type === "card.docked") {
      const categories = cardCategories(card, state, cards);
      if (!categories.includes(payload.plan_slot.category)) {
        throw new CardConflict(
          categories.length === 0
            ? `card ${payload.card_id} has no category to dock under: no finding cites it`
            : `card ${payload.card_id} docks under ${categories.join(" or ")}, not ${payload.plan_slot.category}`,
        );
      }
    }
    return { payload, companions: [] };
  });
}
