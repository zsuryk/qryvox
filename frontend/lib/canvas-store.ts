import { ANALYST_ACTOR, type CardEvent, SlimEvent } from "@qryvox/shared";

// The canvas's store (#48): the case's event log, and nothing else. What the canvas shows is folded from it
// (canvasView), and what the analyst does to a card is a new event on the end of it, which the next fold
// reads like any other. There is no second copy of the canvas state to keep in step with the log.
//
// Where the event goes depends on the source. On the fixture it is appended here, in the browser, to the
// log this tab holds: the recorded case is nobody's to write to, and a reload starts it over. On a live
// case it goes to the backend (POST /cases/:id/cards, #65) the way a disposition does, and is shown at
// once, before the answer: the log is then what the server confirmed plus the operations still on their
// way, each drawn as the event it will be. The answer replaces the operation with the event the server
// wrote; a refusal drops it, and the canvas is the confirmed log again, with the reason said. Nothing that
// was not recorded is ever left looking recorded.

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

// An operation sent and not yet answered, with the event id the server will record it under.
export type PendingOp = { op: CardOp; envelope: Envelope };

// The store's state: the log as the server (or, on the fixture, this tab) has it, and the operations on
// their way. Only `confirmed` is ever the case's record.
export type CanvasLog = { confirmed: readonly SlimEvent[]; pending: readonly PendingOp[] };

export function canvasLog(events: readonly SlimEvent[]): CanvasLog {
  return { confirmed: events, pending: [] };
}

// What the canvas folds: the confirmed log, then each pending operation at the seqs after it, in the order
// they were made, which is the order they are sent in.
export function shownLog(log: CanvasLog): readonly SlimEvent[] {
  return log.pending.reduce<readonly SlimEvent[]>((events, p) => appendOp(events, p.op, p.envelope), log.confirmed);
}

export function sent(log: CanvasLog, pending: PendingOp): CanvasLog {
  return { ...log, pending: [...log.pending, pending] };
}

// The server recorded the operation: it leaves the pending list, and the event it wrote joins the log if
// it is the next one. If it is not (another tab appended in between), the log has moved on and is read
// again: "stale" says so, and the operation stays shown until that read replaces the confirmed log.
export function settled(log: CanvasLog, event: CardEvent): CanvasLog | "stale" {
  const last = log.confirmed.at(-1);
  if (log.confirmed.some((e) => e.event_id === event.event_id)) {
    return { ...log, pending: log.pending.filter((p) => p.envelope.eventId !== event.event_id) };
  }
  if (!last || event.seq !== last.seq + 1) return "stale";
  return {
    confirmed: [...log.confirmed, SlimEvent.parse(event)],
    pending: log.pending.filter((p) => p.envelope.eventId !== event.event_id),
  };
}

// The server refused the operation, or it never arrived: it is dropped, and what is shown is what was
// confirmed, with the operations after it, as if it had never been made.
export function rolledBack(log: CanvasLog, eventId: string): CanvasLog {
  return { ...log, pending: log.pending.filter((p) => p.envelope.eventId !== eventId) };
}

// The log read again from the server: it replaces the confirmed log, and an operation it already holds is
// no longer pending.
export function reread(log: CanvasLog, events: readonly SlimEvent[]): CanvasLog {
  const ids = new Set(events.map((e) => e.event_id));
  return { confirmed: events, pending: log.pending.filter((p) => !ids.has(p.envelope.eventId)) };
}
