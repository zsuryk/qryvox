"use client";

import { useState } from "react";
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

const MUTED = "#5b6270";
const LINE = "#d5d9e0";
const ACCENT = "#1f4f8f";
// One colour per outcome, and the word beside it: a high finding must not rely on colour alone.
const SEVERITY_COLOUR: Record<Severity, string> = { high: "#a02c2c", medium: "#8a6d3b", low: MUTED };

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
      <p style={{ color: "#a02c2c" }}>
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
    <section aria-labelledby="board-heading">
      <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 12 }}>
        <h2 id="board-heading" style={{ margin: 0 }}>
          Claim board
        </h2>
        <p style={{ color: MUTED, margin: 0 }}>
          Showing <strong>{view.visible}</strong> of <strong>{view.active}</strong> active findings
          {filtered ? ` · ${names(categories)}` : ""}
        </p>
      </div>

      <div role="group" aria-label="Filter findings by category" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0 20px" }}>
        {CATEGORIES.map((category) => {
          const on = categories.includes(category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(category)}
              style={{
                background: on ? ACCENT : "#ffffff",
                border: `1px solid ${on ? ACCENT : LINE}`,
                borderRadius: 999,
                color: on ? "#ffffff" : MUTED,
                cursor: "pointer",
                font: "inherit",
                fontSize: "0.85rem",
                padding: "4px 12px",
              }}
            >
              {categoryLabel(category)}
              <span style={{ opacity: 0.75 }}> {view.counts[category]}</span>
            </button>
          );
        })}
      </div>

      {/* The split: findings on the left, the document they cite on the right, wrapping to one column on
          a narrow screen rather than squeezing a page of PDF into nothing. */}
      <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: 20 }}>
        <div style={{ flex: "1 1 420px", minWidth: 0 }}>
          {view.cards.length === 0 ? (
            <div>
              <p style={{ fontWeight: 600, margin: 0 }}>{view.notice?.headline}</p>
              <p style={{ color: MUTED, margin: "4px 0 0" }}>{view.notice?.detail}</p>
            </div>
          ) : (
            <ul style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", listStyle: "none", margin: 0, padding: 0 }}>
              {view.cards.map((card) => (
                <Finding key={card.findingId} card={card} selection={selection} onSelect={select} />
              ))}
            </ul>
          )}

          {view.scope && (
            <details style={{ marginTop: 20 }}>
              <summary style={{ color: MUTED, cursor: "pointer", fontSize: "0.8rem" }}>Run scope</summary>
              <p style={{ color: MUTED, fontSize: "0.8rem", margin: "6px 0 0" }}>
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

        <EvidenceColumn
          selection={selection}
          // The pane is given the document the log recorded, not the one the citation names: the hash it
          // checks the bytes against belongs to the document, and a citation carries no hash at all.
          source={selection ? evidenceDocument(events, selection.citation.documentId) : null}
        />
      </div>
    </section>
  );
}

export default Board;

// The second column: the pane, or what it says before a citation is opened. The split is there from the
// start, so an analyst can see what a citation leads to before opening one.
function EvidenceColumn({
  selection,
  source,
}: {
  selection: EvidenceSelection | null;
  source: EvidenceDocument | null;
}) {
  if (selection === null) {
    return (
      <aside
        aria-label="Evidence"
        style={{ background: "#ffffff", border: `1px solid ${LINE}`, borderRadius: 6, flex: "0 1 380px", padding: "12px 14px" }}
      >
        <p style={{ fontWeight: 600, margin: 0 }}>No citation open</p>
        <p style={{ color: MUTED, fontSize: "0.85rem", margin: "4px 0 0" }}>
          Open a citation on any card and the document it names opens here, on the page it cites, with the
          passage marked.
        </p>
      </aside>
    );
  }

  // The log names every document a citation can cite, so this is a log gap rather than a state the pane
  // draws — and the board already treats a log gap as an error of its own. Nothing is rendered from a
  // document that cannot be named, and certainly not from one that cannot be hashed.
  if (source === null) {
    return (
      <aside
        aria-label="Evidence"
        style={{ background: "#ffffff", border: `1px solid ${LINE}`, borderRadius: 6, flex: "0 1 380px", padding: "12px 14px" }}
      >
        <p style={{ fontWeight: 600, margin: 0 }}>This case&apos;s log names no such document</p>
        <p style={{ color: MUTED, fontSize: "0.85rem", margin: "4px 0 0" }}>
          No document was ingested with the id <code>{selection.citation.documentId}</code>, so there is
          nothing to open or to check the bytes against. The passage is quoted in full on its card.
        </p>
      </aside>
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
    <li
      style={{
        background: "#ffffff",
        border: `1px solid ${LINE}`,
        borderLeft: `4px solid ${SEVERITY_COLOUR[card.severity]}`,
        borderRadius: 6,
        padding: "12px 14px",
      }}
    >
      <p style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: 0 }}>
        {[
          { label: card.categoryLabel, colour: MUTED },
          { label: card.kindLabel, colour: MUTED },
          { label: `${card.severityLabel} severity`, colour: SEVERITY_COLOUR[card.severity] },
        ].map((badge) => (
          <span
            key={badge.label}
            style={{ background: "#f6f7f9", borderRadius: 999, color: badge.colour, fontSize: "0.75rem", padding: "2px 8px" }}
          >
            {badge.label}
          </span>
        ))}
      </p>

      <p style={{ fontWeight: 600, margin: "10px 0 0" }}>{card.claim}</p>
      <p style={{ color: MUTED, fontSize: "0.85rem", margin: "4px 0 0" }}>{card.rationale}</p>

      {/* The quote, in the card, whatever the pane goes on to do. It is the finding's own evidence:
          readable whether or not a text layer was ever marked. */}
      {card.citation && (
        <figure style={{ borderLeft: `2px solid ${LINE}`, margin: "10px 0 0", paddingLeft: 10 }}>
          <blockquote style={{ margin: 0, overflowWrap: "anywhere" }}>{card.citation.quote}</blockquote>
          <figcaption style={{ marginTop: 4 }}>
            <CitationChip
              citation={card.citation}
              open={showing(selection, card, card.citation)}
              onSelect={() => onSelect(card, card.citation!)}
            />
          </figcaption>
        </figure>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ color: MUTED, cursor: "pointer", fontSize: "0.8rem" }}>Evidence and provenance</summary>
        {card.counterpart ? (
          <figure style={{ borderLeft: `2px solid ${LINE}`, margin: "8px 0 0", paddingLeft: 10 }}>
            <blockquote style={{ margin: 0, overflowWrap: "anywhere" }}>{card.counterpart.quote}</blockquote>
            <figcaption style={{ marginTop: 4 }}>
              <CitationChip
                citation={card.counterpart}
                open={showing(selection, card, card.counterpart)}
                onSelect={() => onSelect(card, card.counterpart!)}
              />
            </figcaption>
          </figure>
        ) : (
          <p style={{ color: MUTED, fontSize: "0.8rem", margin: "8px 0 0" }}>
            No other document in the pack speaks to this.
          </p>
        )}
        <p style={{ color: MUTED, fontSize: "0.75rem", margin: "10px 0 0", overflowWrap: "anywhere" }}>
          {card.kindLabel} · {card.severityLabel} severity · finding {card.findingId} · run {card.runId} · event{" "}
          {card.seq}
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
    <span style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onSelect}
        style={{
          background: open ? ACCENT : "#ffffff",
          border: `1px solid ${open ? ACCENT : LINE}`,
          borderRadius: 999,
          color: open ? "#ffffff" : ACCENT,
          cursor: "pointer",
          font: "inherit",
          fontSize: "0.75rem",
          padding: "2px 10px",
        }}
      >
        {citation.documentName} · page {citation.page}
      </button>
      {open && <span style={{ color: MUTED, fontSize: "0.75rem" }}>open in the pane</span>}
    </span>
  );
}