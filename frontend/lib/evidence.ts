import { fold, type Sha256, type SlimEvent } from "@qryvox/shared";
import type { BoardCitation } from "./board";
import { errorMessage } from "./errors";
import { sha256Hex, type DocumentBytes } from "./intake";
import { fetchPackFile } from "./pack";

// The evidence pane's half that no DOM touches, so a test can drive the whole decision the pane makes:
// which of the two paths is in use, and why. The other half — the canvas, the text layer and the divs a
// passage is marked on — is in app/evidence.tsx, and nothing in here may grow a reason to import React.
//
// The pane is specified in two paths (ADR-0001, spec decision 33): the passage marked in the pdf.js text
// layer on the cited page, and, where that is not available, a highlighted verbatim quote panel beside a
// page jump. The fallback is a designed output rather than an apology, so every way the primary path can
// fail is a named state with a stated reason here, and the pane says which of the two it is showing.

// The document a citation names, as document.ingested recorded it. Nothing else: the slim event
// deliberately omits the extracted page text, and that omission is load-bearing — the pane re-reads the
// document by hash rather than trusting text the log was told not to carry (ADR-0002).
export type EvidenceDocument = {
  documentId: string;
  // The static asset to fetch the bytes from; /pack/<filename>.
  filename: string;
  // The hash document.ingested recorded. The bytes are checked against this before anything is drawn.
  sha256: Sha256;
  pageCount: number;
};

// The document a citation names, read from the case log rather than from the citation: a citation is
// page plus quoted text and a document id, and the hash has to be the one the log recorded — verifying
// the bytes against a value taken from the citation would verify the citation against itself.
export function evidenceDocument(events: readonly SlimEvent[], documentId: string): EvidenceDocument | null {
  // A fold error is the board's to report, not the pane's: this returns null and the pane says the log
  // names no such document, because a pane that threw would take the finding down with it.
  try {
    const document = fold(events).documents.find((entry) => entry.documentId === documentId);
    if (!document) return null;
    return {
      documentId: document.documentId,
      filename: document.filename,
      sha256: document.sha256,
      pageCount: document.pageCount,
    };
  } catch {
    return null;
  }
}

// The passage a quote covers in one page's text: the runs it spans, first and last, inclusive, in the
// order pdf.js read them — which is the order of the divs a text layer writes, so the range is exactly
// what can be marked.
//
// Character offsets are deliberately not part of this. A citation is page plus quoted text (ADR-0001),
// so the range is derived from the quote every time and never stored; a pdf.js text-layer change moves
// the divs, not the citation.
export type QuoteMatch = {
  from: number;
  to: number;
};

// The run of a page's text, as pdf.js read it. One string per positioned run, in reading order.
export type TextRun = string;

// pdf.js and the author of a quote both vary whitespace — a line break where the quote had a space, a
// double space where it had one — so both sides are collapsed to single spaces before they are compared.
// The same idea as normalize() in the backend, which is what decides whether a quote is on its page at
// all; here it is what decides whether a passage can be marked.
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

// Whether the quote can be marked in this page's text layer, and where. Null means no: the pane then
// shows the quote panel and says why, which is a fallback rather than a failure (spec decision 33).
//
// Two joins, because a boundary between two runs is ambiguous. pdf.js may split one line into several
// runs at boundaries of its own — a font change, a kerning array — and it also ends a run at a line
// break it inserted itself, so joining every boundary with a space finds a passage that straddles either,
// and joining none finds one a split word left without the space it should have. Whichever finds the
// passage first wins, and the first match on the page is the one marked: a passage quoted twice is a
// question for the analyst, and the first one is the one the page reads as.
export function findQuote(items: readonly TextRun[], quote: string): QuoteMatch | null {
  const wanted = collapse(quote);
  if (wanted === "") return null;
  for (const joiner of [" ", ""] as const) {
    const page = flatten(items, joiner);
    const at = page.text.indexOf(wanted);
    if (at !== -1) return { from: page.owner[at]!, to: page.owner[at + wanted.length - 1]! };
  }
  return null;
}

type FlatPage = { text: string; owner: number[] };

// The page's runs as one string, plus the run each character of it came from — which is how a match in
// the string is mapped back onto the divs a text layer wrote for those runs.
function flatten(items: readonly TextRun[], joiner: string): FlatPage {
  let text = "";
  const owner: number[] = [];
  items.forEach((run, index) => {
    if (index > 0) {
      // The joiner belongs to the run before it. A match can never start or end on one, because the
      // quote is collapsed the same way, so this only has to be consistent rather than clever.
      text += joiner;
      owner.push(index - 1);
    }
    const collapsed = collapse(run);
    text += collapsed;
    for (let at = 0; at < collapsed.length; at += 1) owner.push(index);
  });
  return { text, owner };
}

// What has happened to the citation in the pane, as what was done to it rather than as a set of flags
// set and cleared: the same discipline as the audit log (ADR-0002), a list in and one state out, and
// every state reachable from a sequence that can be written down in a test.
export type EvidenceEvent =
  // A citation chip was opened. Everything below belongs to it, so this also starts the pane over:
  // another citation is another document, another fetch and another hash.
  | { type: "citation.opened" }
  // The bytes served for the document's filename hashed to what document.ingested recorded.
  | { type: "document.fetched"; sha256: Sha256 }
  // They hashed to something else. That is not the cited document, so nothing is drawn from them.
  | { type: "document.hash-mismatch"; expected: Sha256; found: Sha256 }
  // The fetch failed: offline, a 404, a body that would not decode. The quote still has to be readable.
  | { type: "document.fetch-failed"; detail: string }
  // pdf.js read a page and gave back its runs: everything findQuote needs to say whether the primary
  // path is available.
  | { type: "page.read"; page: number; runs: readonly TextRun[] }
  // The page could not be read or drawn: past the end of the document, or a font the build will not
  // load. The document may well be the cited one; the page is what is missing.
  | { type: "page.unavailable"; detail: string }
  // The analyst moved to another page of the document already open beside them.
  | { type: "page.jumped"; page: number };

// Which of the two paths the pane is on, or null while the document is still being read — when the quote
// is on screen and the pane is explicit that it has not decided yet.
export type EvidencePath = "text-layer" | "quote-panel";

// The word beside the colour. Every outcome has one, because an analyst has to be able to tell a
// highlight from a fallback without reading the pane's colours — the board's rule, carried into the pane.
export type EvidenceMode =
  | "reading"
  | "highlighted"
  | "quote-panel"
  | "document-missing"
  | "document-unverified"
  | "page-unreadable";

export const EVIDENCE_MODE_LABEL: Record<EvidenceMode, string> = {
  reading: "Reading the document",
  highlighted: "Highlighted in the document",
  "quote-panel": "Quote panel — passage not found",
  "document-missing": "Quote panel — document not fetched",
  "document-unverified": "Quote panel — document not verified",
  "page-unreadable": "Quote panel — page not readable",
};

export type EvidenceState = {
  status: "reading" | "verified" | "page-read" | "fetch-failed" | "hash-mismatch" | "page-unavailable";
  // The page on screen. Null is the cited page: a citation opens on the page it cites, never on page 1,
  // and only a page jump moves away from it.
  page: number | null;
  // The hash the bytes were checked against, once checked: the pane's proof that this is the document
  // the log recorded rather than whatever happens to be served at that filename.
  sha256: Sha256 | null;
  // The runs of the page on screen, in pdf.js's order.
  runs: readonly TextRun[];
  // What the browser or pdf.js last said about a failure the pane cannot classify on its own.
  detail: string | null;
  // The hash the served bytes actually had, when it was not the cited one.
  found: Sha256 | null;
};

const opened = (): EvidenceState => ({
  status: "reading",
  page: null,
  sha256: null,
  runs: [],
  detail: null,
  found: null,
});

// What has happened, as told: a fold over the pane's own events, exactly as the board folds the log
// (spec decision 31, ADR-0002). It cannot know which async report belongs to which citation — two chips
// opened in quick succession race, and the pane drops the loser's report before it is ever dispatched.
export function paneState(events: readonly EvidenceEvent[]): EvidenceState {
  let state = opened();
  for (const event of events) state = apply(state, event);
  return state;
}

function apply(state: EvidenceState, event: EvidenceEvent): EvidenceState {
  switch (event.type) {
    case "citation.opened":
      return opened();
    case "page.jumped":
      // The document is still open and still verified; what is being read is another page of it, and the
      // runs held are the runs of the page left behind. Saying so keeps the pane from marking the old
      // page's runs as though they were the page now on screen.
      return { ...state, status: "verified", page: event.page, runs: [] };
    case "document.fetched":
      return state.status === "reading" ? { ...state, status: "verified", sha256: event.sha256 } : state;
    case "document.hash-mismatch":
      return state.status === "reading" ? { ...state, status: "hash-mismatch", found: event.found } : state;
    case "document.fetch-failed":
      return state.status === "reading" ? { ...state, status: "fetch-failed", detail: event.detail } : state;
    case "page.read":
      // Never for a document whose bytes were not verified, and never for a page the analyst has jumped
      // away from: both are stale reports, and a stale page must not be marked as the cited one.
      if (state.status !== "verified" || (state.page !== null && state.page !== event.page)) return state;
      return { ...state, status: "page-read", page: event.page, runs: event.runs };
    case "page.unavailable":
      // Before the fetch as well as after it: a citation whose page is past the end of the document is
      // known to be unreadable from the log alone, and there is nothing to fetch for it.
      return state.status === "reading" || state.status === "verified"
        ? { ...state, status: "page-unavailable", detail: event.detail }
        : state;
  }
}

// The bytes the cited document is served from, fetched and hashed before anything is drawn from them,
// with the event that says what came of it.
//
// A hash that is not the one document.ingested recorded is not the cited document, so it is reported
// rather than rendered (ADR-0001). The bytes come back with the verdict rather than being fetched a
// second time by the pane: one citation view is one fetch of one document, however many renderings of it
// that view goes on to do.
//
// Never throws, and never returns an event on its own, because both the verdict and the bytes are needed
// by the caller and a rejection it had to classify would be the same work twice.
export type VerifiedDocument =
  | { verdict: "verified"; event: EvidenceEvent; bytes: DocumentBytes }
  | { verdict: "rejected"; event: EvidenceEvent };

export async function fetchVerifiedDocument(document: EvidenceDocument): Promise<VerifiedDocument> {
  let bytes: DocumentBytes;
  try {
    bytes = await fetchPackFile(document.filename);
  } catch (cause) {
    return { verdict: "rejected", event: { type: "document.fetch-failed", detail: errorMessage(cause) } };
  }
  // Hashed before pdf.js sees the bytes: getDocument transfers them to its worker, which detaches the
  // buffer, and a detached buffer reads as empty and would hash as the empty string's digest.
  const sha256 = await sha256Hex(bytes);
  return sha256 === document.sha256
    ? { verdict: "verified", event: { type: "document.fetched", sha256 }, bytes }
    : {
        verdict: "rejected",
        event: { type: "document.hash-mismatch", expected: document.sha256, found: sha256 },
      };
}

// What the pane shows, said once here rather than discovered in a demo. The fallback is specified: for
// every state there is a path, a word for it, and a sentence saying why that one.
export type EvidenceView = {
  // Which of the two designed paths is in use; null while the document is still being read.
  path: EvidencePath | null;
  mode: EvidenceMode;
  modeLabel: string;
  detail: string;
  // The page on screen, and the page the citation names. The two differ only once the analyst jumps.
  page: number;
  citedPage: number;
  pageCount: number;
  // The passage, verbatim, on every path — this is what the finding's own quote is checked against, and
  // what the pane falls back to.
  quote: string;
  // The runs the passage covers, when the primary path is available; null on every fallback.
  match: QuoteMatch | null;
  // Whether the page itself is on screen, and whether there is anything to move it within.
  showsPage: boolean;
  canJump: boolean;
  onCitedPage: boolean;
  // The hash the bytes were checked against, for the pane's provenance line; null until they are.
  sha256: Sha256 | null;
};

export function evidenceView(
  state: EvidenceState,
  citation: BoardCitation,
  document: EvidenceDocument,
): EvidenceView {
  const page = state.page ?? citation.page;
  const onCitedPage = page === citation.page;
  // The primary path is available only when the cited page's own runs hold the passage. Matched on this
  // page's runs and not on the document, because a quote that also appears on some other page must not
  // be marked in the wrong place, and the pane says which page it marked.
  const match = state.status === "page-read" && onCitedPage ? findQuote(state.runs, citation.quote) : null;
  const showsPage = state.status === "page-read";
  // Whether there is a document to move within, which outlives a page being drawn — the jump stays put
  // while the next page is read rather than blinking out of the pane and back.
  const canJump = (state.status === "verified" || state.status === "page-read") && document.pageCount > 1;
  const shown = {
    page,
    citedPage: citation.page,
    pageCount: document.pageCount,
    quote: citation.quote,
    match,
    showsPage,
    canJump,
    onCitedPage,
    sha256: state.sha256,
  };
  const cited = `page ${citation.page} of ${document.filename}`;

  switch (state.status) {
    case "reading":
      return decided(shown, null, "reading", `Fetching ${document.filename} by hash and checking it against the case log.`);
    case "verified":
      return decided(
        shown,
        null,
        "reading",
        `The bytes match the hash the log recorded. Reading the text layer on ${cited}.`,
      );
    case "page-read":
      if (match !== null) {
        return decided(shown, "text-layer", "highlighted", `The cited passage is marked in the text layer on ${cited}.`);
      }
      if (!onCitedPage) {
        return decided(
          shown,
          "quote-panel",
          "quote-panel",
          `You are on page ${page}; the cited passage is on page ${citation.page}.`,
        );
      }
      return decided(
        shown,
        "quote-panel",
        "quote-panel",
        `The text layer on ${cited} does not hold that passage, so the quote is shown beside the page instead.`,
      );
    case "page-unavailable":
      return decided(
        shown,
        "quote-panel",
        "page-unreadable",
        `${state.detail ?? "The cited page could not be read."} The quote is below, with the page it is cited from.`,
      );
    case "hash-mismatch":
      return decided(
        shown,
        "quote-panel",
        "document-unverified",
        `The bytes served for ${document.filename} hash to ${short(state.found ?? document.sha256)}, not the ` +
          `${short(document.sha256)} the log recorded, so nothing is drawn from them. The quote is below.`,
      );
    case "fetch-failed":
      return decided(
        shown,
        "quote-panel",
        "document-missing",
        `${document.filename} could not be fetched: ${state.detail ?? "the request failed"}. The quote is below, ` +
          `as cited from page ${citation.page}.`,
      );
  }
}

const decided = (
  shown: Omit<EvidenceView, "path" | "mode" | "modeLabel" | "detail">,
  path: EvidencePath | null,
  mode: EvidenceMode,
  detail: string,
): EvidenceView => ({ ...shown, path, mode, modeLabel: EVIDENCE_MODE_LABEL[mode], detail });

// Hashes are shown short enough to compare by eye and long enough to be worth comparing.
const short = (sha256: string) => `${sha256.slice(0, 12)}…`;