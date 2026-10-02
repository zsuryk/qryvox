"use client";

import { useState } from "react";
import type { FindingCategory, Severity, SlimEvent } from "@qryvox/shared";
import { boardView, categoryLabel, CATEGORIES, names, type BoardCard, type BoardView } from "../lib/board";
import { errorMessage } from "../lib/errors";

// The claim board. Simple by default: every finding on a pinned card, narrowed by category, with the run
// scope and each card's provenance one disclosure layer down (spec decision 31). Nothing here asks the
// analyst to type, and nothing is stored — the cards are a fold of the events this component was handed.

const MUTED = "#5b6270";
const LINE = "#d5d9e0";
const ACCENT = "#1f4f8f";
// One colour per outcome, and the word beside it: a high finding must not rely on colour alone.
const SEVERITY_COLOUR: Record<Severity, string> = { high: "#a02c2c", medium: "#8a6d3b", low: MUTED };

export default function Board({ events }: { events: readonly SlimEvent[] }) {
  const [selected, setSelected] = useState<readonly FindingCategory[]>([...CATEGORIES]);

  // A gap in the log is a hard error, not a half-built board (ADR-0002), so it is said rather than
  // rendered as an empty page.
  let view: BoardView;
  try {
    view = boardView(events, selected);
  } catch (cause) {
    return (
      <p style={{ color: "#a02c2c" }}>
        This board cannot be built from the case&apos;s log: {errorMessage(cause)}
      </p>
    );
  }

  const toggle = (category: FindingCategory) =>
    setSelected((current) =>
      current.includes(category) ? current.filter((other) => other !== category) : [...current, category],
    );

  const filtered = view.visible !== view.active;

  return (
    <section aria-labelledby="board-heading">
      <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 12 }}>
        <h2 id="board-heading" style={{ margin: 0 }}>
          Claim board
        </h2>
        <p style={{ color: MUTED, margin: 0 }}>
          Showing <strong>{view.visible}</strong> of <strong>{view.active}</strong> active findings
          {filtered ? ` · ${names(selected)}` : ""}
        </p>
      </div>

      <div role="group" aria-label="Filter findings by category" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0 20px" }}>
        {CATEGORIES.map((category) => {
          const on = selected.includes(category);
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

      {view.cards.length === 0 ? (
        <div>
          <p style={{ fontWeight: 600, margin: 0 }}>{view.notice?.headline}</p>
          <p style={{ color: MUTED, margin: "4px 0 0" }}>{view.notice?.detail}</p>
        </div>
      ) : (
        <ul style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", listStyle: "none", margin: 0, padding: 0 }}>
          {view.cards.map((card) => (
            <Finding key={card.findingId} card={card} />
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
    </section>
  );
}

// One pinned card: what it is, what is claimed, why that is a finding, and the passage it comes from.
function Finding({ card }: { card: BoardCard }) {
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

      {card.citation && (
        <figure style={{ borderLeft: `2px solid ${LINE}`, margin: "10px 0 0", paddingLeft: 10 }}>
          <blockquote style={{ margin: 0, overflowWrap: "anywhere" }}>{card.citation.quote}</blockquote>
          <figcaption style={{ color: MUTED, fontSize: "0.75rem", marginTop: 4 }}>
            {card.citation.documentName} · page {card.citation.page}
          </figcaption>
        </figure>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ color: MUTED, cursor: "pointer", fontSize: "0.8rem" }}>Evidence and provenance</summary>
        {card.counterpart ? (
          <figure style={{ borderLeft: `2px solid ${LINE}`, margin: "8px 0 0", paddingLeft: 10 }}>
            <blockquote style={{ margin: 0, overflowWrap: "anywhere" }}>{card.counterpart.quote}</blockquote>
            <figcaption style={{ color: MUTED, fontSize: "0.75rem", marginTop: 4 }}>
              {card.counterpart.documentName} · page {card.counterpart.page}
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
