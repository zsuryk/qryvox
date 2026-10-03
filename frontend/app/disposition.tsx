"use client";

import { useEffect, useState } from "react";
import { ANALYST_ACTOR, type Disposition, type FindingCategory, type SlimEvent } from "@qryvox/shared";
import { changeDisposition } from "../lib/api";
import { CATEGORIES } from "../lib/board";
import {
  DISPOSITION_LABEL,
  dispositionConsole,
  keyAction,
  KEY_BINDINGS,
  type ConsoleRow,
  type ConsoleState,
  type ConsoleView,
} from "../lib/disposition";
import { errorMessage } from "../lib/errors";

// The disposition console: the human decision, and the only one there is. Every finding on the case can be
// approved or dismissed here, by button or by keyboard, and each decision is an event appended to the
// log under the fixed stage-1 analyst identity (spec decision 34, spec decision 9).
//
// The console holds no disposition state of its own. It knows two things: which finding the analyst is
// standing on, and which request is in flight. Everything it shows about a decision is folded from the
// events it was handed, so what appears after a click is what the log says — never a flag flipped locally
// and hoped for. Nothing here decides anything either: not a timeout, not a filter change, not a re-run,
// not a step.

// One tone per decision, and the word beside it: a dismissed finding must not read as dismissed by hue
// alone, and a green tick that is not approved is a lie in a regulated review.
const DECISION_TONE: Record<Disposition, string> = { approved: "badge--positive", dismissed: "badge--caution" };
const DECISION_BUTTON: Record<Disposition, string> = { approved: "btn--positive", dismissed: "btn--caution" };

export type DispositionConsoleProps = {
  caseId: string;
  // The case's log, as the browser holds it. The console folds it; it never asks the server for a
  // disposition of its own, because there is no such endpoint and there should not be one.
  events: readonly SlimEvent[];
  // Called after every append, so what the console shows next is the log's own account of the decision.
  refetch: () => void | Promise<void>;
  // The categories the console is showing, when it is mounted beside a filtered board. Narrowing what is
  // shown is not a decision and decides nothing: the findings held back keep whatever they had.
  selected?: readonly FindingCategory[];
};

export default function DispositionConsole({ caseId, events, refetch, selected = CATEGORIES }: DispositionConsoleProps) {
  const [focus, setFocus] = useState<ConsoleState>({ focusedFindingId: null });
  // The in-flight append, with the event id the browser named for it (ADR-0002). Held because a second
  // press on the same finding while the first is still in the air reuses this id and appends nothing,
  // rather than logging the analyst's one decision twice.
  const [pending, setPending] = useState<{ findingId: string; eventId: string } | null>(null);
  // The last decision, for the announcement. It is a message and nothing more: a decision is not recorded
  // here, only described, because the log is what records it.
  const [said, setSaid] = useState<{ text: string; recorded: boolean } | null>(null);

  // One decision, in the console's own terms: an append, then a re-read. The message the analyst hears is
  // the decision as the log now records it, which is why it is set after the refetch rather than before.
  async function decide(row: ConsoleRow, disposition: Disposition) {
    const eventId = pending?.findingId === row.card.findingId ? pending.eventId : crypto.randomUUID();
    setPending({ findingId: row.card.findingId, eventId });
    setSaid(null);
    try {
      await changeDisposition(caseId, { event_id: eventId, finding_id: row.card.findingId, disposition });
      setPending(null);
      await refetch();
      setSaid({ text: `${DISPOSITION_LABEL[disposition]} — ${row.card.claim}`, recorded: true });
    } catch (cause) {
      // Said as a failure rather than left silent: a decision that did not reach the log is not a decision.
      // The event id is deliberately kept, so pressing again reuses it — the endpoint is idempotent by
      // event_id (ADR-0002), so a decision whose response was lost in transit is recovered by retrying
      // rather than logged twice. Clearing it here would make every retry a second event.
      //
      // The log is re-read on the way out because a refusal usually means the log has moved on: the
      // backend answers 409 when a later findings run superseded the finding, and the analyst is owed the
      // board as it now stands rather than the one that asked them to decide on a finding already gone.
      setSaid({ text: `Not recorded: ${errorMessage(cause)}`, recorded: false });
      try {
        await refetch();
      } catch {
        // A log that will not re-read costs the console its refresh, not the analyst their reason.
      }
    }
  }

  // The keyboard, through the reducer in lib/disposition.ts. It is bound on the document rather than on a
  // control, so the console is drivable without tabbing through it — and the mouse flow is untouched by
  // it, because the reducer refuses every key it does not own.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A keystroke aimed at a text field is that field's, even if it happens to spell a decision.
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
        return;
      }
      const action = keyAction(
        focus,
        { key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey },
        events,
        selected,
      );
      switch (action.kind) {
        case "focus":
          setFocus({ focusedFindingId: action.findingId });
          break;
        case "decide": {
          const row = dispositionConsole(events, focus.focusedFindingId, selected).rows.find(
            (candidate) => candidate.card.findingId === action.findingId,
          );
          if (row) void decide(row, action.disposition);
          break;
        }
        case "ignore":
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // No dependency array on purpose: the listener is rebound every render and so decides against the log
    // as it stands now, never against a rendering of it the log has since moved past.
  });

  // A gap in the log is a hard error, not a half-built console (ADR-0002), so it is said rather than
  // rendered as a panel with nothing on it.
  let view: ConsoleView;
  try {
    view = dispositionConsole(events, focus.focusedFindingId, selected);
  } catch (cause) {
    return (
      <p className="notice notice--negative t-callout">
        This console cannot be built from the case&apos;s log: {errorMessage(cause)}
      </p>
    );
  }

  return (
    <section aria-labelledby="disposition-heading" className="section">
      <div className="section-head">
        <h2 id="disposition-heading" className="t-title">
          Disposition
        </h2>
        <span className="t-footnote muted">
          {view.approved} approved · {view.dismissed} dismissed · {view.undecided} undecided
        </span>
      </div>

      <div className="stack" style={{ "--stack-gap": "0.5rem", marginBottom: "1rem" } as React.CSSProperties}>
        <p className="t-footnote muted measure">
          Every finding is decided here by {ANALYST_ACTOR}, and nothing decides it for them. Undecided is not dismissed:
          it is what a finding is until an analyst says otherwise.
        </p>
        {/* The shortcuts are on the screen, not in a README: a console nobody can find the keys for is a
            console with a mouse. Rendered from the same table the reducer reads, so they cannot drift. */}
        <p className="t-footnote muted row" style={{ "--row-gap": "0.25rem 1rem" } as React.CSSProperties}>
          <span className="t-eyebrow">Keyboard</span>
          {KEY_BINDINGS.map((binding) => (
            <span key={binding.intent}>
              {binding.keys.map((key) => (
                <kbd key={key}>{key === "ArrowDown" ? "↓" : key === "ArrowUp" ? "↑" : key.toUpperCase()}</kbd>
              ))}{" "}
              {binding.label}
            </span>
          ))}
        </p>
      </div>

      {view.rows.length === 0 ? (
        <div className="card card--quiet stack" style={{ "--stack-gap": "0.25rem" } as React.CSSProperties}>
          <p className="t-headline">{view.notice?.headline}</p>
          <p className="t-callout muted">{view.notice?.detail}</p>
        </div>
      ) : (
        <ul className="list-plain stack" style={{ "--stack-gap": "0.625rem" } as React.CSSProperties}>
          {view.rows.map((row, index) => (
            <Decision
              key={row.card.findingId}
              row={row}
              focused={view.focused?.index === index}
              onFocus={() => setFocus({ focusedFindingId: row.card.findingId })}
              onDecide={(disposition) => void decide(row, disposition)}
              busy={pending?.findingId === row.card.findingId}
            />
          ))}
        </ul>
      )}

      {/* The decision as it is made, for anyone who cannot see the row it happened on. */}
      <p aria-live="polite" role="status" className={`t-footnote ${said?.recorded === false ? "text-negative" : "muted"}`} style={{ marginTop: "1rem" }}>
        {said?.text}
      </p>
    </section>
  );
}

// One finding and the decision on it. The row stays on the console whatever the decision was: a dismissed
// finding is marked dismissed and kept, because the reasoning is part of the record rather than something
// to tidy away once it has been dealt with.
function Decision({
  row,
  focused,
  busy,
  onFocus,
  onDecide,
}: {
  row: ConsoleRow;
  focused: boolean;
  busy: boolean;
  onFocus: () => void;
  onDecide: (disposition: Disposition) => void;
}) {
  const { card, decision, decidedBy, decidedAt, decidedAtSeq } = row;

  return (
    <li
      aria-current={focused ? true : undefined}
      onClick={onFocus}
      // The focused row is marked by a ring as well as by the announcement, so where the keyboard is
      // standing is visible without a pointer.
      className={`card decision${focused ? " card--focused" : ""}`}
    >
      <div className="decision__body stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
        <div className="row" style={{ "--row-gap": "0.375rem" } as React.CSSProperties}>
          {/* The decision, in words: the word is what carries it, not the hue. */}
          <span className={`badge badge--strong ${decision === null ? "" : DECISION_TONE[decision]}`}>
            <span className="dot" />
            {decision === null ? "Undecided" : DISPOSITION_LABEL[decision]}
          </span>
          <span className="badge">{card.categoryLabel}</span>
          <span className="badge">{card.kindLabel}</span>
        </div>

        <p className="t-callout strong">{card.claim}</p>

        {/* Who decided and when, from the event itself: the actor the log recorded, and the seq it is
            ordered by, which is the same coordinate the replay scrubber reads. */}
        {decision !== null && (
          <p className="t-caption muted">
            {DISPOSITION_LABEL[decision]} by {decidedBy} · {decidedAt} · event {decidedAtSeq}
          </p>
        )}
      </div>

      <div role="group" aria-label={`Decide on: ${card.claim}`} className="row decision__actions">
        {(["approved", "dismissed"] as const).map((disposition) => (
          <button
            key={disposition}
            type="button"
            className={`btn btn--small ${DECISION_BUTTON[disposition]}`}
            // Not a toggle: the pressed state is the decision the log currently holds, and pressing again
            // is a further decision rather than an undo. Nothing clears a decision but another decision.
            aria-pressed={decision === disposition}
            disabled={busy}
            aria-busy={busy}
            onClick={(event) => {
              // The row owns the click; the button owns the decision.
              event.stopPropagation();
              onDecide(disposition);
            }}
          >
            {DISPOSITION_LABEL[disposition]}
          </button>
        ))}
      </div>
    </li>
  );
}
