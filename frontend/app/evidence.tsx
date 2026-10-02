"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { PDFJS_VERSION } from "@qryvox/shared";
import type { BoardCitation } from "../lib/board";
import { errorMessage } from "../lib/errors";
import {
  evidenceView,
  fetchVerifiedDocument,
  type EvidenceDocument,
  type EvidenceEvent,
  type EvidenceMode,
  findQuote,
  paneState,
  type QuoteMatch,
} from "../lib/evidence";
import { browserPdfAssets, openPdf, type OpenDocument, type RenderedPage } from "../lib/pdf";

// The evidence pane: the source document, beside the finding that cites it, on the page the citation
// names, with the passage marked in the text layer.
//
// Two paths, both designed (ADR-0001, spec decision 33). The primary one marks the passage in the
// pdf.js text layer over the page image. The fallback is a highlighted verbatim quote panel beside a page
// jump, and it is what the pane shows whenever the text layer cannot be marked — a page whose runs do
// not hold the quote, a document that would not fetch, bytes whose hash is not the one the log recorded,
// a page that would not draw. The pane says in words which one is on screen, because an analyst has to be
// able to tell a highlight from a fallback without reading its colours.
//
// Props are the document and the citation and nothing else: no store, no context, and no fetch of
// anything but that document's own bytes. The bytes are re-fetched by hash on every mount and every
// citation change — every render, reload and replay — and nothing about the document is read out of the
// event log, because the slim document.ingested event carries no page text to read (ADR-0002).

const MUTED = "#5b6270";
const LINE = "#d5d9e0";
const ACCENT = "#1f4f8f";
// One colour per outcome, and the word beside it: a fallback must not be mistaken for a highlight.
const MODE_COLOUR: Record<EvidenceMode, string> = {
  reading: MUTED,
  highlighted: "#1c6b4a",
  "quote-panel": "#8a6d3b",
  "document-missing": "#a02c2c",
  "document-unverified": "#a02c2c",
  "page-unreadable": "#8a6d3b",
};

// pdf.js writes the text layer's divs itself, so they cannot be styled by React: the rules a text layer
// needs are its own viewer's, and this is the minimum of them that stands alone. Everything else in this
// pane is inline styles, as the rest of the product is.
const TEXT_LAYER_CSS = `
.qryvox-evidence .textLayer {
  color-scheme: only light;
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.qryvox-evidence .textLayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}
.qryvox-evidence .textLayer > :not(.markedContent),
.qryvox-evidence .textLayer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.qryvox-evidence .textLayer .markedContent { display: contents; }
.qryvox-evidence .textLayer br { width: 0; height: 0; }
`;

export type EvidencePaneProps = {
  // The document the citation names, as the case log recorded it. Aliased to `source` below so the
  // browser's own document is never shadowed in a component that hands DOM to pdf.js.
  document: EvidenceDocument;
  citation: BoardCitation;
};

export function EvidencePane({ document: source, citation }: EvidencePaneProps) {
  const { documentId, filename, sha256, pageCount } = source;
  const { page: citedPage, quote } = citation;
  // What the pane is working on, as one value: a citation is a document plus a page, so a change of
  // either is another document to fetch and another page to open — while a page jump is neither, and
  // moves the page inside the document already open.
  const key = `${documentId}:${sha256}:${citedPage}`;

  const [history, record] = useReducer(evidence, { key, events: [] as readonly EvidenceEvent[] });
  // The document and the worker behind every page the pane opened, held against the key they were opened
  // for: a citation the analyst has moved on from leaves a document that is already on its way out, and
  // treating it as gone is what stops the pane drawing from a document it no longer means to show.
  const [openedFor, setOpenedFor] = useState<{ key: string; document: OpenDocument } | null>(null);
  // Where pdf.js draws, and what it drew last. Refs, not state: they are pdf.js's to hand back and
  // nothing here renders them.
  const host = useRef<HTMLDivElement | null>(null);
  const drawn = useRef<RenderedPage | null>(null);

  const opened = openedFor?.key === key ? openedFor.document : null;
  const state = paneState(history.key === key ? history.events : []);
  const view = evidenceView(state, citation, source);

  // Opening a citation opens its document: fetch the bytes, check them against the hash the log
  // recorded, and only then let pdf.js have them. Nothing here is memoised and nothing is kept — a pane
  // that has shown a document before fetches it again, which is what "re-fetched by hash on every
  // render, reload and replay" is in code rather than in prose (ADR-0001).
  //
  // The effect depends on the citation's own values rather than on the objects they arrive in, so a
  // caller handing over a fresh document and citation every render fetches once per render and not once
  // per object — key and the values it is built from are named together so that stays true if the key
  // ever stops being what it looks like.
  useEffect(() => {
    const next: EvidenceDocument = { documentId, filename, sha256, pageCount };
    const forKey = key;
    let live = true;
    void (async () => {
      // The log's own page count is enough to know a citation points past the end of the document, and
      // there is nothing to draw for a page that is not there.
      if (citedPage > pageCount || citedPage < 1) {
        record({ key: forKey, event: {
          type: "page.unavailable",
          detail: `Page ${citedPage} is not one of the ${pageCount} pages this document has.`,
        } });
        return;
      }
      const fetched = await fetchVerifiedDocument(next);
      // A citation the analyst has moved on from: its report is not this pane's, and recording it would
      // put one document's page against another document's quote.
      if (!live) return;
      record({ key: forKey, event: fetched.event });
      if (fetched.verdict === "rejected") return;
      let open: OpenDocument;
      try {
        open = await openPdf(fetched.bytes, browserPdfAssets);
      } catch (cause) {
        if (!live) return;
        // The bytes hashed to the cited document and pdf.js still would not open them. The pane degrades
        // to the quote panel and says which it was, rather than sitting on an empty column.
        record({ key: forKey, event: { type: "page.unavailable", detail: errorMessage(cause) } });
        return;
      }
      if (!live) {
        await open.destroy();
        return;
      }
      setOpenedFor({ key: forKey, document: open });
    })();
    return () => {
      live = false;
    };
  }, [key, documentId, filename, sha256, pageCount, citedPage]);

  // Drawing a page, and moving between the pages of a document already open beside the finding. This is
  // the part no test reaches: a TextLayer needs a real DOM container, so what it paints is verified in
  // the browser, and what it decides is decided on the runs instead (testing decision 9).
  useEffect(() => {
    const open = opened;
    const container = host.current;
    if (!open || !container) return;
    const wanted = view.page;
    let live = true;
    void open
      .drawPage({ page: wanted, container })
      .then((drawnPage) => {
        if (!live) {
          void drawnPage.destroy();
          return;
        }
        drawn.current = drawnPage;
        // Marked here, on the divs pdf.js has just written, rather than by React, which does not know
        // they exist. It is the same match evidenceView decides on, from the same runs, so the mark on
        // the page and the word beside it can never disagree about which path is in use.
        markPassage(drawnPage.textDivs, findQuote(drawnPage.runs, quote));
        record({ key, event: { type: "page.read", page: drawnPage.page, runs: drawnPage.runs } });
      })
      .catch((cause: unknown) => {
        if (live) record({ key, event: { type: "page.unavailable", detail: errorMessage(cause) } });
      });
    return () => {
      live = false;
      // The page is taken down on the way out of every draw, so a pane that has cycled through a
      // document's pages holds one page's DOM rather than all of them.
      const previous = drawn.current;
      drawn.current = null;
      if (previous) void previous.destroy();
    };
  }, [opened, key, view.page, quote]);

  // The document and the worker behind every page the pane opened, released when it closes or moves on.
  useEffect(() => {
    const open = opened;
    return () => {
      if (open) void open.destroy();
    };
  }, [opened]);

  return (
    <aside
      aria-label={`Evidence from ${source.filename}`}
      className="qryvox-evidence"
      style={{
        background: "#ffffff",
        border: `1px solid ${LINE}`,
        borderRadius: 6,
        flex: "0 1 380px",
        padding: "12px 14px",
        position: "sticky",
        top: 16,
      }}
    >
      <style>{TEXT_LAYER_CSS}</style>

      <p style={{ margin: 0 }}>
        <span
          style={{
            background: "#f6f7f9",
            borderRadius: 999,
            color: MODE_COLOUR[view.mode],
            fontSize: "0.75rem",
            fontWeight: 600,
            padding: "2px 8px",
          }}
        >
          {view.modeLabel}
        </span>
      </p>

      <h3 style={{ fontSize: "0.95rem", margin: "8px 0 0", overflowWrap: "anywhere" }}>{source.filename}</h3>
      <p style={{ color: MUTED, fontSize: "0.8rem", margin: "2px 0 0" }}>
        Page {view.page} of {view.pageCount} · document {source.documentId} · pdf.js {PDFJS_VERSION}
        {view.sha256 ? ` · sha-256 ${view.sha256.slice(0, 12)}… verified` : ""}
      </p>
      {/* Stated rather than signalled: which of the two paths is on screen, and why this one. */}
      <p aria-live="polite" style={{ color: MUTED, fontSize: "0.8rem", margin: "6px 0 0" }}>
        {view.detail}
      </p>

      {/* The page, whenever it could be drawn. Before that it is an empty box, and the line above says
          why the pane is still reading. */}
      <div
        ref={host}
        style={{
          background: "#f6f7f9",
          border: `1px solid ${LINE}`,
          borderRadius: 4,
          marginTop: 10,
          maxHeight: "58vh",
          overflow: "auto",
        }}
      />

      {/* The quote, verbatim, on every path. This is the fallback's home and the floor under it: the
          finding's own quote is what makes the evidence readable whether or not a highlight painted. */}
      <figure style={{ borderLeft: `3px solid ${ACCENT}`, margin: "10px 0 0", paddingLeft: 10 }}>
        <blockquote style={{ margin: 0, overflowWrap: "anywhere" }}>
          <mark style={{ background: "#fde68a", color: "inherit", padding: "0 2px" }}>{view.quote}</mark>
        </blockquote>
        <figcaption style={{ color: MUTED, fontSize: "0.75rem", marginTop: 4 }}>
          Cited passage · {citation.documentName} · page {view.citedPage}
        </figcaption>
      </figure>

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {view.showsPage ? (
          <>
            <Jump
              label="‹ Previous page"
              disabled={view.page <= 1}
              onSelect={() => record({ key, event: { type: "page.jumped", page: view.page - 1 } })}
            />
            <span style={{ color: MUTED, fontSize: "0.8rem" }}>
              Page {view.page} of {view.pageCount}
            </span>
            <Jump
              label="Next page ›"
              disabled={view.page >= view.pageCount}
              onSelect={() => record({ key, event: { type: "page.jumped", page: view.page + 1 } })}
            />
            {!view.onCitedPage && (
              <Jump
                label={`Back to page ${view.citedPage}`}
                onSelect={() => record({ key, event: { type: "page.jumped", page: view.citedPage } })}
              />
            )}
          </>
        ) : (
          <p style={{ color: MUTED, fontSize: "0.8rem", margin: 0 }}>
            No page on screen yet, so there is nothing to jump between.
          </p>
        )}
      </div>
    </aside>
  );
}

export default EvidencePane;

// The pane's own list of what was done to the citation on screen — the same discipline as the audit log,
// one list in and one state out. A different document, hash or cited page is a different citation, and
// the list says so rather than being quietly cleared: the fold is what resets the pane, in one place,
// rather than the reducer deciding on its own what a new citation means.
function evidence(
  history: { key: string; events: readonly EvidenceEvent[] },
  action: { key: string; event: EvidenceEvent },
): { key: string; events: readonly EvidenceEvent[] } {
  if (action.key !== history.key) return { key: action.key, events: [{ type: "citation.opened" }, action.event] };
  return action.event.type === "citation.opened"
    ? { key: history.key, events: [action.event] }
    : { key: history.key, events: [...history.events, action.event] };
}

// A page jump is a control like any other: a real button, so it answers to Enter and Space and needs no
// free text to drive.
function Jump({ label, disabled, onSelect }: { label: string; disabled?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      style={{
        background: disabled ? "#f6f7f9" : "#ffffff",
        border: `1px solid ${disabled ? LINE : ACCENT}`,
        borderRadius: 6,
        color: disabled ? MUTED : ACCENT,
        cursor: disabled ? "not-allowed" : "pointer",
        font: "inherit",
        fontSize: "0.8rem",
        padding: "4px 10px",
      }}
    >
      {label}
    </button>
  );
}

// The primary path, painted: pdf.js writes one absolutely positioned div per text run and hides its text
// behind the canvas, so a passage is marked by filling the runs it covers — which is what the pdf.js find
// controller does, without the geometry. The outline is beside the colour so the mark is not colour
// alone, and the attribute is what makes the marked runs findable in the inspector.
function markPassage(divs: readonly HTMLElement[], match: QuoteMatch | null): void {
  if (match === null) return;
  for (let at = match.from; at <= match.to; at += 1) {
    const div = divs[at];
    if (!div) continue;
    div.dataset.citedPassage = "true";
    div.style.background = "#fde68a";
    div.style.outline = "2px solid #b45309";
    div.style.outlineOffset = "0";
  }
}