"use client";

import { memo } from "react";
import type { CardId, Disposition, Severity } from "@qryvox/shared";
import type { CardCitation, CardModel } from "../lib/canvas-cards";

// The canvas's one card (#54). Two kinds, one anatomy and one height, so the flow can be arithmetic:
//   finding — severity, category and authority badges, the finding in a sentence, the one line on why it
//             counts (the claim board's own rationale), and the passage it is cited on;
//   excerpt — the document and its kind, the page, the passage verbatim, and the findings that cite it.
// A finding card also carries the analyst's decision on its finding (#59): Approve and Dismiss, the same
// decision and the same keys (A, D) as the Review console, recorded on the case. That is a judgement on the
// finding; Discard, in the action row, is only housekeeping on the canvas and decides nothing.
// The same action row closes both. Every operation a hand can do by dragging a card is a button here too,
// so the canvas works from the keyboard and with a screen reader, and a disabled one says why.

const SEVERITY_TONE: Record<Severity, string> = { high: "badge--negative", medium: "badge--caution", low: "" };

export type CardActions = {
  dock: (cardId: CardId) => void;
  undock: (cardId: CardId) => void;
  pin: (cardId: CardId) => void;
  unpin: (cardId: CardId) => void;
  discard: (cardId: CardId) => void;
  restore: (cardId: CardId) => void;
  // Similar: the card's nearest neighbours among the statements already extracted, at once (#60).
  similar: (cardId: CardId) => void;
  // Look further: once Similar has been pressed, the model's seeded run (#57).
  further: (cardId: CardId) => void;
  // The analyst's decision on a finding card's finding (#59).
  decide: (cardId: CardId, disposition: Disposition) => void;
  openCitation: (citation: CardCitation, label: string) => void;
  reveal: (cardId: CardId) => void;
};

// Flat flags rather than one object, so a card whose state has not changed is never re-rendered.
export type CardProps = {
  model: CardModel;
  docked: boolean;
  pinned: boolean;
  discarded: boolean;
  // Why this card cannot be docked by its button, or null when it can.
  undockable: string | null;
  // A Look further run from this card is under way.
  searching: boolean;
  // Similar has been pressed on this card, so its button now looks further.
  asked: boolean;
  // One of the neighbours the latest press of Similar found, lit for a moment.
  lit: boolean;
  // Why Look further cannot run from this card, or null when it can.
  similarOff: string | null;
  // A decision on this card's finding is on its way to the log.
  deciding: boolean;
  actions: CardActions;
};

export const Card = memo(function Card({ model, docked, pinned, discarded, undockable, searching, asked, lit, similarOff, deciding, actions }: CardProps) {
  const state = { docked, pinned, discarded };
  const what =
    model.kind === "finding"
      ? `Finding, ${model.disposition ? DECIDED[model.disposition].toLowerCase() : "undecided"}: ${model.title}`
      : `Excerpt from ${model.documentName}, page ${model.page}`;
  const label = `${what}${docked ? " (in the plan)" : pinned ? " (pinned)" : ""}`;
  const dismissed = model.kind === "finding" && model.disposition === "dismissed";
  return (
    // A finding card is focusable as a whole, so the keyboard can stand on it and decide it as on Review.
    <article
      className={`card canvas-card${model.kind === "finding" && model.written ? " canvas-card--written" : ""}${state.pinned ? " canvas-card--pinned" : ""}${dismissed ? " canvas-card--dismissed" : ""}${lit ? " canvas-card--lit" : ""}`}
      aria-label={label}
      tabIndex={model.kind === "finding" ? 0 : undefined}
      data-finding-card={model.kind === "finding" ? model.cardId : undefined}
    >
      {model.kind === "finding" ? <FindingBody model={model} deciding={deciding} actions={actions} /> : <ExcerptBody model={model} actions={actions} />}
      <ActionRow cardId={model.cardId} state={state} undockable={undockable} searching={searching} asked={asked} similarOff={similarOff} actions={actions} />
    </article>
  );
});

const DECIDED: Record<Disposition, string> = { approved: "Approved", dismissed: "Dismissed" };
const DECIDE: Record<Disposition, { label: string; tone: string; title: string }> = {
  approved: { label: "Approve", tone: "btn--positive", title: "Approve the finding: your decision, recorded on the case as on Review (A)" },
  dismissed: {
    label: "Dismiss",
    tone: "btn--caution",
    title: "Dismiss the finding: your decision, recorded on the case as on Review (D). Not Discard, which only tidies the canvas",
  },
};

function FindingBody({ model, deciding, actions }: { model: Extract<CardModel, { kind: "finding" }>; deciding: boolean; actions: CardActions }) {
  const chip = `${model.citation.documentName} · page ${model.citation.citation.page}`;
  return (
    <>
      <div className="row canvas-card__badges">
        <span className={`badge badge--strong ${SEVERITY_TONE[model.severity]}`}>
          <span className="dot" />
          {model.severityLabel}
        </span>
        <span className="badge">{model.category}</span>
        {model.authority && <span className="badge">{model.authority}</span>}
      </div>
      <h3 className="t-callout strong canvas-card__title">{model.title}</h3>
      {model.written ? (
        // The model's sentence (#62), marked as such, quietly: the derived line needs no label.
        <p className="t-caption muted canvas-card__line canvas-card__line--written" title={`Why it matters, written by the model: ${model.rationale}`}>
          <span className="canvas-card__why">Why it matters</span> {model.rationale}
        </p>
      ) : (
        <p className="t-caption muted canvas-card__line" title={model.rationale}>
          {model.rationale}
        </p>
      )}
      <div className="canvas-card__chips">
        <button type="button" className="chip chip--link canvas-card__chip" title="Open the page this is cited on" onClick={() => actions.openCitation(model.citation, chip)}>
          {chip}
        </button>
        {/* The decision, in words as well as by the pressed button: undecided is a state of its own. */}
        <div className="canvas-card__decide" role="group" aria-label="Decision on this finding">
          {(["approved", "dismissed"] as const).map((disposition) => {
            const on = model.disposition === disposition;
            return (
              <button
                key={disposition}
                type="button"
                className={`btn btn--small ${DECIDE[disposition].tone}`}
                // Not a toggle: pressing again is a further decision, as on the Review console.
                aria-pressed={on}
                disabled={deciding}
                aria-busy={deciding}
                title={DECIDE[disposition].title}
                onClick={() => actions.decide(model.cardId, disposition)}
              >
                {on ? DECIDED[disposition] : DECIDE[disposition].label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ExcerptBody({ model, actions }: { model: Extract<CardModel, { kind: "excerpt" }>; actions: CardActions }) {
  const page = `${model.documentName} · page ${model.page}`;
  return (
    <>
      <div className="row canvas-card__badges">
        {model.similarTo && (
          <span className="badge badge--tint" title={model.instant ? `${model.similarTo}. Found at once among the statements already extracted, with no model` : model.similarTo}>
            {model.instant ? "Similar · instant" : "Similar"}
          </span>
        )}
        {model.documentKind && <span className="badge badge--strong badge--tint">{model.documentKind}</span>}
        <button type="button" className="chip chip--link canvas-card__chip" title="Open this page" onClick={() => actions.openCitation(model.citation, page)}>
          {page}
        </button>
      </div>
      <blockquote className="t-callout canvas-card__quote">{model.quote}</blockquote>
      <div className="canvas-card__chips" role="group" aria-label="Findings citing this passage">
        {model.linked.length === 0 ? (
          <span className="t-caption faint canvas-card__line" title={model.similarTo ?? undefined}>
            {model.similarTo ?? "No finding cites it"}
          </span>
        ) : (
          model.linked.map((link) => (
            <button key={link.cardId} type="button" className="chip canvas-card__chip" title="Show this finding's card" onClick={() => actions.reveal(link.cardId)}>
              {link.label}
            </button>
          ))
        )}
      </div>
    </>
  );
}

function ActionRow({
  cardId,
  state,
  undockable,
  searching,
  asked,
  similarOff,
  actions,
}: {
  cardId: CardId;
  state: { docked: boolean; pinned: boolean; discarded: boolean };
  undockable: string | null;
  searching: boolean;
  asked: boolean;
  similarOff: string | null;
  actions: CardActions;
}) {
  return (
    <div className="canvas-card__actions" role="group" aria-label="Card actions">
      {state.docked ? (
        <button type="button" className="btn btn--small" title="Take it out of the plan" onClick={() => actions.undock(cardId)}>
          Undock
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--small"
          disabled={undockable !== null}
          title={undockable ?? "Add it to the plan's reportable set"}
          onClick={() => actions.dock(cardId)}
        >
          Dock
        </button>
      )}
      <button
        type="button"
        className="btn btn--small"
        disabled={state.docked || state.discarded}
        title={state.pinned ? "Let it go back into the flow" : "Hold it where it is; the flow goes around it"}
        onClick={() => (state.pinned ? actions.unpin(cardId) : actions.pin(cardId))}
      >
        {state.pinned ? "Unpin" : "Pin"}
      </button>
      {state.discarded ? (
        <button type="button" className="btn btn--small" title="Bring it back" onClick={() => actions.restore(cardId)}>
          Restore
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--small"
          title="Take the card off the canvas into the bin. Housekeeping only: the finding is not dismissed, and nothing is deleted"
          onClick={() => actions.discard(cardId)}
        >
          Discard
        </button>
      )}
      {asked ? (
        <button
          type="button"
          className="btn btn--small"
          disabled={searching || similarOff !== null}
          aria-busy={searching}
          title={similarOff ?? (searching ? "The model is looking for more like this" : "Ask the model for passages the extracted statements missed; they arrive as cards marked Similar")}
          onClick={() => actions.further(cardId)}
        >
          {searching ? "Looking…" : "Look further"}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--small"
          title="Show the passages most like this one among the statements already extracted, at once and with no model"
          onClick={() => actions.similar(cardId)}
        >
          Similar
        </button>
      )}
    </div>
  );
}
