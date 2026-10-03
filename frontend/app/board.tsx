"use client";

import { useState, type ReactNode } from "react";
import type { FindingCategory, Severity, SlimEvent } from "@qryvox/shared";
import { boardView, categoryLabel, CATEGORIES, names, type BoardCard, type BoardCitation, type BoardView } from "../lib/board";
import { errorMessage } from "../lib/errors";
import { type EvidenceDocument, evidenceDocument } from "../lib/evidence";
import { EvidencePane } from "./evidence";

// The claim board. Simple by default: every finding on a pinned card, narrowed by category, with the run
// scope and each card's provenance one disclosure layer down (spec decision 31). Nothing here asks the
// analyst to type, and nothing is stored — the cards are a fold of the events this component was handed.
//
// Every card's citation is a control rather than a caption: opening it puts the document it names in the
// pane beside the board, on the page it cites. The quote stays in the card's own body, verbatim, whatever
// the pane goes on to show — the evidence is readable from the card alone, which is the whole reason the
// fallback is a quote panel rather than a blank column (spec decision 33).

// One tone per severity, and the word beside it: a high finding must not rely on colour alone.
const SEVERITY_TONE: Record<Severity, string> = { high: "badge--negative", medium: "badge--caution", low: "" };

// Which passage the pane is showing. A card can carry two — the citation and, where there is one, the
// counterpart it runs into — so the passage is named rather than the slot it sits in.
export type EvidenceSelection = {
  findingId: string;
  citation: BoardCitation;
};

export type BoardProps = {
  events: readonly SlimEvent[];
  // Which citation the pane is showing. Left out, the board keeps the selection itself from the chips, so
  // `events` alone is a working board with a working pane — which is how /board mounts it. Given, the
  // caller owns it, and another surface (the disposition console, the replay scrubber) can put a
  // citation in the pane without a click here.
  selected?: EvidenceSelection | null;
  // Told about every citation opened, including the one that closes the pane again.
  onSelect?: (selection: EvidenceSelection | null) => void;
};

export function Board({ events, selected, onSelect }: BoardProps) {
  const [categories, setCategories] = useState<readonly FindingCategory[]>([...CATEGORIES]);
  const [ownSelection, setOwnSelection] = useState<EvidenceSelection | null>(null);
  // Uncontrolled unless the caller says otherwise, which is the whole of the difference between the two
  // ways this is mounted.
  const selection = selected === undefined ? ownSelection : selected;

  // A gap in the log is a hard error, not a half-built board (ADR-0002), so it is said rather than
  // rendered as an empty page.
  let view: BoardView;
  try {
    view = boardView(events, categories);
  } catch (cause) {
    return (
      <p className="notice notice--negative t-callout">
        This board cannot be built from the case&apos;s log: {errorMessage(cause)}
      </p>
    );
  }

  const toggle = (category: FindingCategory) =>
    setCategories((current) =>
      current.includes(category) ? current.filter((other) => other !== category) : [...current, category],
    );

  // Opening the passage already open closes it, so the pane is a disclosure rather than something the
  // analyst has to find a way out of.
  const choose = (next: EvidenceSelection | null) => {
    if (selected === undefined) setOwnSelection(next);
    onSelect?.(next);
  };

  const select = (card: BoardCard, citation: BoardCitation) =>
    choose(showing(selection, card, citation) ? null : { findingId: card.findingId, citation });

  const filtered = view.visible !== view.active;

  return (
    <section aria-labelledby="board-heading" className="section">
      <div className="section-head">
        <h2 id="board-heading" className="t-title">
          Claim board
        </h2>
        <span className="t-footnote muted">
          Showing {view.visible} of {view.active} active findings
          {filtered ? ` · ${names(categories)}` : ""}
        </span>
      </div>

      <div role="group" aria-label="Filter findings by category" className="row" style={{ marginBottom: "1.25rem" }}>
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className="chip"
            aria-pressed={categories.includes(category)}
            onClick={() => toggle(category)}
          >
            {categoryLabel(category)}
            <span className="count">{view.counts[category]}</span>
          </button>
        ))}
      </div>

      {/* The split: findings on the left, the document they cite on the right, wrapping to one column on
          a narrow screen rather than squeezing a page of PDF into nothing. The second column appears when
          a citation is opened and not before: the default view is the board with its filters, not a
          placeholder asking to be filled (spec decision 31). */}
      <div className="split">
        <div className="split-main">
          {view.cards.length === 0 ? (
            <div className="card card--quiet stack" style={{ "--stack-gap": "0.25rem" } as React.CSSProperties}>
              <p className="t-headline">{view.notice?.headline}</p>
              <p className="t-callout muted">{view.notice?.detail}</p>
            </div>
          ) : (
            <ul className="grid-cards">
              {view.cards.map((card) => (
                <Finding key={card.findingId} card={card} selection={selection} onSelect={select} />
              ))}
            </ul>
          )}

          {view.scope && (
            <details style={{ marginTop: "1.25rem" }}>
              <summary>Run scope</summary>
              <p className="t-footnote muted" style={{ marginTop: "0.5rem" }}>
                {[
                  view.scope.step,
                  view.scope.promptVersion,
                  view.scope.model,
                  `run ${view.scope.runIds.join(", ")}`,
                  `events ${view.scope.firstSeq}–${view.scope.lastSeq}`,
                  `${view.scope.superseded} superseded finding${view.scope.superseded === 1 ? "" : "s"} off the board, still in the log.`,
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </p>
            </details>
          )}
        </div>

        {selection !== null && (
          <EvidenceColumn
            key={`${selection.findingId}:${selection.citation.documentId}:${selection.citation.page}`}
            selection={selection}
            // The pane is given the document the log recorded, not the one the citation names: the hash it
            // checks the bytes against belongs to the document, and a citation carries no hash at all.
            source={evidenceDocument(events, selection.citation.documentId)}
          />
        )}
      </div>
    </section>
  );
}

export default Board;

// The evidence column's own box. One place, because the pane and the one thing that can stand in for it
// are the same column and were drifting apart as two copies of the same style.
function Aside({ children }: { children: ReactNode }) {
  return (
    <aside aria-label="Evidence" className="split-side card materialize stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
      {children}
    </aside>
  );
}

// The second column: the pane, or what it says when the log names no document for the citation. Both are
// states the pane cannot draw for itself — the pane is handed a document, and there is none to hand it.
function EvidenceColumn({
  selection,
  source,
}: {
  selection: EvidenceSelection;
  source: EvidenceDocument | null;
}) {
  // The log names every document a citation can cite, so this is a log gap rather than a state the pane
  // draws — and the board already treats a log gap as an error of its own. Nothing is rendered from a
  // document that cannot be named, and certainly not from one that cannot be hashed.
  if (source === null) {
    return (
      <Aside>
        <p className="t-headline">This case&apos;s log names no such document</p>
        <p className="t-footnote muted">
          No document was ingested with the id <code>{selection.citation.documentId}</code>, so there is
          nothing to open or to check the bytes against. The passage is quoted in full on its card.
        </p>
      </Aside>
    );
  }

  return <EvidencePane document={source} citation={selection.citation} />;
}

// Whether the pane is showing this exact passage, compared on the passage and not on the slot it sits in
// because a card can carry two and each is separately openable.
function showing(selection: EvidenceSelection | null, card: BoardCard, citation: BoardCitation): boolean {
  return (
    selection !== null &&
    selection.findingId === card.findingId &&
    selection.citation.quote === citation.quote &&
    selection.citation.page === citation.page &&
    selection.citation.documentId === citation.documentId
  );
}

// One pinned card: what it is, what is claimed, why that is a finding, and the passage it comes from.
function Finding({
  card,
  selection,
  onSelect,
}: {
  card: BoardCard;
  selection: EvidenceSelection | null;
  onSelect: (card: BoardCard, citation: BoardCitation) => void;
}) {
  return (
    <li className="card stack finding" style={{ "--stack-gap": "0.625rem" } as React.CSSProperties}>
      <div className="row" style={{ "--row-gap": "0.375rem" } as React.CSSProperties}>
        <span className={`badge badge--strong ${SEVERITY_TONE[card.severity]}`}>
          <span className="dot" />
          {card.severityLabel}
        </span>
        <span className="badge">{card.categoryLabel}</span>
        <span className="badge">{card.kindLabel}</span>
        {card.rule && (
          <span className="badge badge--tint" title={card.rule.text}>
            Rule {card.rule.id} · {card.rule.title}
          </span>
        )}
      </div>

      <p className="t-headline">{card.claim}</p>
      <p className="t-footnote muted">{card.rationale}</p>

      {/* The quote, in the card, whatever the pane goes on to do. It is the finding's own evidence:
          readable whether or not a text layer was ever marked. */}
      {card.citation && (
        <figure className="quote quote--cited">
          <blockquote className="t-callout">{card.citation.quote}</blockquote>
          <figcaption>
            <CitationChip
              citation={card.citation}
              open={showing(selection, card, card.citation)}
              onSelect={() => onSelect(card, card.citation!)}
            />
          </figcaption>
        </figure>
      )}

      <details>
        <summary>Evidence and provenance</summary>
        {card.counterpart ? (
          <figure className="quote">
            <blockquote className="t-callout">{card.counterpart.quote}</blockquote>
            <figcaption>
              <CitationChip
                citation={card.counterpart}
                open={showing(selection, card, card.counterpart)}
                onSelect={() => onSelect(card, card.counterpart!)}
              />
            </figcaption>
          </figure>
        ) : (
          <p className="t-footnote muted" style={{ marginTop: "0.5rem" }}>
            No other document in the pack speaks to this.
          </p>
        )}
        <p className="t-caption faint wrap-anywhere" style={{ marginTop: "0.625rem" }}>
          {card.kindLabel} · {card.severityLabel} severity · finding {card.findingId} · run {card.runId} · event {card.seq}
        </p>
      </details>
    </li>
  );
}

// A citation as a control. A real button, so it answers to Enter and Space like every other control in
// the product and needs nothing typed to drive it; aria-expanded says which passage the pane is holding,
// with the word beside it too, because the pane's state is not on this card.
function CitationChip({
  citation,
  open,
  onSelect,
}: {
  citation: BoardCitation;
  open: boolean;
  onSelect: () => void;
}) {
  return (
    <span className="row">
      <button type="button" className="chip chip--link" aria-expanded={open} onClick={onSelect}>
        {citation.documentName} · page {citation.page}
      </button>
      {open && <span className="t-caption muted">open in the pane</span>}
    </span>
  );
}
