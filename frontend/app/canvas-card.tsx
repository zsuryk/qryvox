"use client";

import { memo } from "react";
import type { CardId, Severity } from "@qryvox/shared";
import type { CardCitation, CardModel } from "../lib/canvas-cards";

// The canvas's one card (#54). Two kinds, one anatomy and one height, so the flow can be arithmetic:
//   finding — severity, category and authority badges, the finding in a sentence, the one line on why it
//             counts (the claim board's own rationale), and the passage it is cited on;
//   excerpt — the document and its kind, the page, the passage verbatim, and the findings that cite it.
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
  similar: (cardId: CardId) => void;
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
  // A find-similar run from this card is under way.
  searching: boolean;
  // Why find similar cannot run from this card, or null when it can.
  similarOff: string | null;
  actions: CardActions;
};

export const Card = memo(function Card({ model, docked, pinned, discarded, undockable, searching, similarOff, actions }: CardProps) {
  const state = { docked, pinned, discarded };
  const what = model.kind === "finding" ? `Finding: ${model.title}` : `Excerpt from ${model.documentName}, page ${model.page}`;
  const label = `${what}${docked ? " (in the plan)" : pinned ? " (pinned)" : ""}`;
  return (
    <article className={`card canvas-card${state.pinned ? " canvas-card--pinned" : ""}`} aria-label={label}>
      {model.kind === "finding" ? <FindingBody model={model} actions={actions} /> : <ExcerptBody model={model} actions={actions} />}
      <ActionRow cardId={model.cardId} state={state} undockable={undockable} searching={searching} similarOff={similarOff} actions={actions} />
    </article>
  );
});

function FindingBody({ model, actions }: { model: Extract<CardModel, { kind: "finding" }>; actions: CardActions }) {
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
        {model.disposition && (
          <span className={`badge ${model.disposition === "approved" ? "badge--positive" : ""}`}>
            {model.disposition === "approved" ? "Approved" : "Dismissed"}
          </span>
        )}
      </div>
      <h3 className="t-callout strong canvas-card__title">{model.title}</h3>
      <p className="t-caption muted canvas-card__line" title={model.rationale}>
        {model.rationale}
      </p>
      <div className="canvas-card__chips">
        <button type="button" className="chip chip--link canvas-card__chip" title="Open the page this is cited on" onClick={() => actions.openCitation(model.citation, chip)}>
          {chip}
        </button>
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
          <span className="badge badge--tint" title={model.similarTo}>
            Similar
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
  similarOff,
  actions,
}: {
  cardId: CardId;
  state: { docked: boolean; pinned: boolean; discarded: boolean };
  undockable: string | null;
  searching: boolean;
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
        <button type="button" className="btn btn--small" title="Reject it to the discard bin; nothing is deleted" onClick={() => actions.discard(cardId)}>
          Discard
        </button>
      )}
      <button
        type="button"
        className="btn btn--small"
        disabled={searching || similarOff !== null}
        aria-busy={searching}
        title={similarOff ?? (searching ? "Looking for more like this" : "Find more passages like this one; they arrive as cards marked Similar")}
        onClick={() => actions.similar(cardId)}
      >
        {searching ? "Finding…" : "Similar"}
      </button>
    </div>
  );
}
