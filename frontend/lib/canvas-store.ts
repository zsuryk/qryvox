import { ANALYST_ACTOR, SlimEvent } from "@qryvox/shared";
import type { CanvasMode } from "./canvas-source";

// The canvas's store (#48): the case's event log, and nothing else. What the canvas shows is folded from it
// (canvasView), and what the analyst does to a card is a new event on the end of it, which the next fold
// reads like any other. There is no second copy of the canvas state to keep in step with the log.
//
// Where the event goes depends on the source. On the fixture it is appended here, in the browser, to the
// log this tab holds: the recorded case is nobody's to write to, and a reload starts it over. On a live
// case it would go to the backend like a disposition does, but the backend has no endpoint that appends
// card events yet, so on a live case the operations are offered and disabled, with that said beside them,
// rather than kept in the browser where they would look recorded and not be.

type CardEvent = Extract<SlimEvent, { type: `card.${string}` }>;

// One card operation: a card event without its envelope, which the store supplies.
export type CardOp = { [T in CardEvent["type"]]: Pick<Extract<CardEvent, { type: T }>, "type" | "payload"> }[CardEvent["type"]];

export type Envelope = { eventId: string; at: string; actor?: string };

// The log with `op` appended at the next seq, checked against the event contract like any event the
// backend returns, so a card operation the contract refuses never reaches the fold.
export function appendOp(events: readonly SlimEvent[], op: CardOp, envelope: Envelope): SlimEvent[] {
  const last = events.at(-1);
  if (!last) throw new Error("a card operation needs a case: the log is empty");
  const event = SlimEvent.parse({
    seq: last.seq + 1,
    event_id: envelope.eventId,
    case_id: last.case_id,
    actor: envelope.actor ?? ANALYST_ACTOR,
    at: envelope.at,
    step_run_id: null,
    v: 1,
    ...op,
  });
  return [...events, event];
}

// Whether card operations can be recorded from here, and if not, why not, in the analyst's words.
export function operations(mode: CanvasMode): { enabled: true } | { enabled: false; reason: string } {
  return mode.kind === "fixture"
    ? { enabled: true }
    : {
        enabled: false,
        reason: "Card operations are read-only on a live case for now: the backend cannot record card events yet.",
      };
}
