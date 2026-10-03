import { dispositionOf, fold, type CaseState, type Disposition, type FindingCategory, type SlimEvent } from "@qryvox/shared";
import { boardView, type BoardCard, type BoardNotice, CATEGORIES } from "./board";

// The disposition console, DOM-free: the model the console shows and the keyboard that drives it.
//
// Everything on screen is a fold of the event log this module is handed. There is no store behind it, no
// cache and no optimistic "approved" flag: a decision is an event the analyst asked for, the log records
// it, and what the console shows afterwards is the fold of what came back over the wire (spec decision 34,
// ADR-0002). Which is why the console keeps only where the analyst is standing — and where they are
// standing is not a disposition.
//
// The keyboard lives here too, as a reducer from (state, key, events) to the action the console should
// take. That is what makes "approve, dismiss, next finding and previous finding are all reachable by
// keyboard" a claim a test can check, rather than something a reviewer has to be shown with a mouse.

export const DISPOSITION_LABEL: Record<Disposition, string> = { approved: "Approved", dismissed: "Dismissed" };

export type ConsoleRow = {
  // The finding as the board words it, so the console says the same thing about a finding the board says
  // it about: one vocabulary across the two surfaces (spec decision 31).
  card: BoardCard;
  // null until the analyst decides. Undecided is a state of its own, and it is not dismissed: it is what
  // every finding is until a human says otherwise, and nothing else ever puts it there.
  decision: Disposition | null;
  // Who decided, and when, read off the event the decision came from: the actor the log recorded, the
  // wall clock the scrubber reads and the seq the log orders by.
  decidedBy: string | null;
  decidedAt: string | null;
  decidedAtSeq: number | null;
};

export type ConsoleView = {
  // Every active finding, decided or not. A dismissed finding stays on the console and stays marked
  // dismissed: the reasoning is part of the record, so it is shown rather than hidden (spec decision 10).
  rows: readonly ConsoleRow[];
  // The row the analyst is on, resolved from the held finding id; null only when there is nothing at all
  // to decide, because a console with no focused row would have a keyboard deciding a row nobody can see.
  focused: { index: number; row: ConsoleRow } | null;
  approved: number;
  dismissed: number;
  undecided: number;
  // The board already says which of its three emptinesses this is, and a console with nothing to decide
  // says the same thing rather than a fourth one.
  notice: BoardNotice | null;
};

export function dispositionConsole(
  events: readonly SlimEvent[],
  focusedFindingId: string | null = null,
  selected: readonly FindingCategory[] = CATEGORIES,
): ConsoleView {
  const state = fold(events);
  // The board owns what a finding is and how it reads, and it already has three distinct ways to say
  // that there is nothing here. The console borrows the same rows rather than growing its own idea of a
  // finding, which is what keeps a decision made here and a finding read there about the same thing.
  const board = boardView(events, selected);
  const rows = board.cards.map((card) => row(card, state, events));
  const index = rows.findIndex((candidate) => candidate.card.findingId === focusedFindingId);

  return {
    rows,
    // A focus the log no longer holds — a superseded finding, or one a filter turned off — falls back to
    // the first row rather than going blank, so the keyboard and the eye stay on the same finding.
    focused: rows.length === 0 ? null : { index: Math.max(0, index), row: rows[Math.max(0, index)]! },
    approved: rows.filter((candidate) => candidate.decision === "approved").length,
    dismissed: rows.filter((candidate) => candidate.decision === "dismissed").length,
    undecided: rows.filter((candidate) => candidate.decision === null).length,
    notice: board.notice,
  };
}

function row(card: BoardCard, state: CaseState, events: readonly SlimEvent[]): ConsoleRow {
  const decision = dispositionOf(state, card.findingId);
  // The fold carries who decided and the seq it was decided at, but not the wall clock the scrubber reads,
  // so the event it names is asked for once: the seq the fold recorded is the event to look up.
  const event = decision === null ? undefined : events.find((candidate) => candidate.seq === decision.changedAtSeq);
  return {
    card,
    decision: decision?.disposition ?? null,
    decidedBy: decision?.actor ?? null,
    decidedAt: event?.at ?? null,
    decidedAtSeq: decision?.changedAtSeq ?? null,
  };
}

// What the analyst is on. A finding id rather than a row index, because the rows are folded from the log
// and a re-run or a filter change moves them underneath anything held by position.
export type ConsoleState = { focusedFindingId: string | null };

// One keystroke, as the browser reports it. The modifiers are part of this seam rather than the
// component's problem, because Ctrl+A is select-all rather than approve: a shortcut that fires under a
// modifier would decide a finding the analyst never pressed a bare key for.
export type KeyPress = { key: string; ctrl?: boolean; meta?: boolean; alt?: boolean };

export type KeyIntent = "approve" | "dismiss" | "next" | "previous";

export type KeyBinding = {
  intent: KeyIntent;
  // Every key that does it. The arrows are bound beside the letters so the console is reachable by the
  // keys people already use to move between things; the modifier keys are deliberately not bound.
  keys: readonly string[];
  // What the console calls it, in its own words: rendered under the heading from this table, so a
  // shortcut cannot exist without being advertised and cannot be advertised without working.
  label: string;
};

export const KEY_BINDINGS: readonly KeyBinding[] = [
  { intent: "approve", keys: ["a"], label: "approve the finding in focus" },
  { intent: "dismiss", keys: ["d"], label: "dismiss the finding in focus" },
  { intent: "next", keys: ["j", "ArrowDown"], label: "next finding" },
  { intent: "previous", keys: ["k", "ArrowUp"], label: "previous finding" },
];

// What one keystroke asks the console to do. `decide` is a request for an event, not an event: the console
// makes the append, the log records it and the console re-reads the log. Nothing in this module decides
// anything, and no key that is not in the table above produces an action at all.
export type ConsoleAction =
  | { kind: "decide"; findingId: string; disposition: Disposition }
  | { kind: "focus"; findingId: string }
  | { kind: "ignore" };

export function keyAction(
  state: ConsoleState,
  press: KeyPress,
  events: readonly SlimEvent[],
  selected: readonly FindingCategory[] = CATEGORIES,
): ConsoleAction {
  const binding = bindingFor(press);
  if (!binding) return { kind: "ignore" };

  const view = dispositionConsole(events, state.focusedFindingId, selected);
  const focused = view.focused;

  switch (binding.intent) {
    case "approve":
    case "dismiss": {
      // The focused finding, and only if there is one: with nothing to decide on the case, a keystroke
      // decides nothing at all rather than deciding some finding the analyst cannot see.
      if (!focused) return { kind: "ignore" };
      return {
        kind: "decide",
        findingId: focused.row.card.findingId,
        disposition: binding.intent === "approve" ? "approved" : "dismissed",
      };
    }
    case "next":
    case "previous": {
      if (!focused) return { kind: "ignore" };
      const { rows } = view;
      // The console wraps. A review is a loop, and an analyst working down it should not have to reach
      // past the last row to come back to the first — and moving focus decides nothing either way.
      const offset = binding.intent === "next" ? 1 : -1;
      const moved = rows[((((focused.index + offset) % rows.length) + rows.length) % rows.length)]!;
      return { kind: "focus", findingId: moved.card.findingId };
    }
  }
}

// What a keystroke means, with no console behind it: the canvas (#59) binds the same keys to the finding
// card in focus, from this same table, so the two surfaces cannot drift apart.
export function keyIntent(press: KeyPress): KeyIntent | null {
  return bindingFor(press)?.intent ?? null;
}

function bindingFor(press: KeyPress): KeyBinding | undefined {
  // A modified keystroke is somebody else's shortcut, whatever letter it spells: approving under Ctrl
  // would be a decision the analyst never asked for, which is the one thing this console must not do.
  if (press.ctrl || press.meta || press.alt) return undefined;
  // Case is not normalised away: Shift+A is not approve, because the console owns the keys it advertises
  // and a different key is a different key.
  return KEY_BINDINGS.find((binding) => binding.keys.includes(press.key));
}
