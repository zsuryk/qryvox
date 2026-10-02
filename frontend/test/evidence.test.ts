import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { CATEGORIES, boardView, type BoardCitation } from "../lib/board";
import {
  evidenceDocument,
  evidenceView,
  fetchVerifiedDocument,
  type EvidenceDocument,
  type EvidenceEvent,
  findQuote,
  paneState,
  type EvidenceState,
} from "../lib/evidence";
import { type DocumentBytes, sha256Hex } from "../lib/intake";
import { extractPageRuns } from "../lib/pdf";
import { Board, type EvidenceSelection } from "../app/board";
import { groundTruth, manifest, nodeAssets, packDir, readBytes } from "./helpers";

// The citation pane, driven headlessly. What a citation decides — which runs of the cited page the
// passage covers, and whether the pane can mark them at all — happens on text, so the whole of it is
// decided here. What it paints cannot be: a pdf.js TextLayer needs a real DOM container, which Node
// does not have, so the canvas and the text layer are left to the browser and the runs are what the pack
// integrity test already proves the quotes are found in (testing decision 9).

const events = SlimEvent.array().parse(recorded);

// The pack the browser fetches from /pack, served off the committed files — the same route the pane takes,
// so the bytes hashed here are the bytes the pane hashes there.
const served: string[] = [];
beforeEach(() => {
  served.length = 0;
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    const path = new URL(String(url), "http://localhost").pathname;
    served.push(path);
    const name = path === "/pack/manifest.json" ? "manifest.json" : path.slice("/pack/".length);
    return new Response(readBytes(packDir, name), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

// The positioned runs of every page of every document, read by the pinned pdf.js build the browser reads
// them with. One pass for the whole test file, as it is one pass in the browser.
const packRuns = new Map<string, string[][]>();
for (const document of manifest.documents) {
  packRuns.set(
    document.document_id,
    await extractPageRuns(new Uint8Array(readBytes(packDir, document.filename)), nodeAssets),
  );
}

const runsOf = (documentId: string, page: number): string[] =>
  (packRuns.get(documentId) ?? [])[page - 1] ?? [];

const packDocument = (documentId: string): EvidenceDocument => {
  const document = manifest.documents.find((entry) => entry.document_id === documentId);
  if (!document) throw new Error(`${documentId} is not in the pack`);
  return { documentId: document.document_id, filename: document.filename, sha256: document.sha256, pageCount: document.page_count };
};

// What the runs a match covers spell out, collapsed the way the matcher reads them.
const marked = (runs: readonly string[], match: { from: number; to: number }): string =>
  runs.slice(match.from, match.to + 1).join(" ").replace(/\s+/g, " ").trim();

const citedPassages = groundTruth.entries.flatMap((entry) => [
  { finding: entry.id, passage: "citation", ...entry.citation },
  ...(entry.counterpart ? [{ finding: entry.id, passage: "counterpart", ...entry.counterpart }] : []),
]);

describe("matching a cited passage against the runs of its page", () => {
  it.each(citedPassages)("$finding ($passage): $document_id p$page holds its quote as runs it can mark", ({ document_id, page, quote }) => {
    const runs = runsOf(document_id, page);
    const match = findQuote(runs, quote);

    expect(match, `${document_id} p${page} does not hold its quoted passage`).not.toBeNull();
    // The runs it would mark spell the passage and nothing else: an analyst who clicks a citation sees
    // that sentence highlighted, not the rest of the page with a line of it tinted.
    expect(marked(runs, match!)).toBe(quote);
  });

  it("marks a passage that sits wholly inside one run", () => {
    const runs = runsOf("factsheet", 1);
    const match = findQuote(runs, "Annual management fee: 0.85% per annum");

    expect(match).toEqual({ from: runs.indexOf("Annual management fee: 0.85% per annum"), to: runs.indexOf("Annual management fee: 0.85% per annum") });
    expect(runs[match!.from]).toBe("Annual management fee: 0.85% per annum");
  });

  it("marks a passage that straddles two runs of one line, as a font change would split it", () => {
    // A pdf.js run boundary is not a word boundary: a line set in two fonts arrives as two runs.
    const runs = ["Annual management fee:", "0.85% per annum"];

    expect(findQuote(runs, "Annual management fee: 0.85% per annum")).toEqual({ from: 0, to: 1 });
  });

  it("marks a passage that straddles a line break pdf.js inserted", () => {
    // The pack generator never wraps a quoted line, but a long line still wraps on the page: this is the
    // real pair of runs that a source line became, and the passage only exists if the join is generous.
    const runs = runsOf("factsheet", 1);

    expect(runs[7]).toMatch(/growth over a period of$/);
    expect(runs[8]).toMatch(/^at least five years\./);
    expect(
      findQuote(runs, "The Fund aims to provide a regular income with the potential for modest capital growth over a period of at least five years."),
    ).toEqual({ from: 7, to: 8 });
  });

  it("marks a passage a line break split inside a word", () => {
    // The text layer keeps the hyphen a wrapped line was broken at; the quote has it too, so the runs are
    // joined as they are rather than as two words.
    const runs = ["The Fund invests only in investment-", "grade bonds."];

    expect(findQuote(runs, "The Fund invests only in investment-grade bonds.")).toEqual({ from: 0, to: 1 });
  });

  it("ignores the whitespace differences pdf.js and an author of a quote both introduce", () => {
    const runs = runsOf("factsheet", 1);
    const quote = "Annual management fee: 0.85% per annum";

    // A quote whose every space has become a line break, one with the padding and doubled space a
    // copy-and-paste leaves behind, and one that straddles the line break the page itself put in it.
    expect(findQuote(runs, quote.replace(/ /g, "\n"))).toEqual(findQuote(runs, quote));
    expect(findQuote(runs, `  ${quote.replace("fee: ", "fee:  ")}\t`)).toEqual(findQuote(runs, quote));
    expect(findQuote(runs, "growth over a period of\n\nat least five years.")).toEqual({ from: 7, to: 8 });
  });

  it("does not match a passage that differs from the quote in anything but whitespace", () => {
    const runs = runsOf("factsheet", 1);

    // The fee table's wording of the same fee, which is the contradiction the board is built on.
    expect(findQuote(runs, "Annual management fee: 1.25% of net asset value")).toBeNull();
    expect(findQuote(runs, "Annual management fee: 0.85% per year")).toBeNull();
    expect(findQuote(runs, "annual management fee: 0.85% per annum")).toBeNull();
    expect(findQuote(runs, "   ")).toBeNull();
    // A run is marked whole, so a quote that is part of one marks the run it sits in: the mark is a lead
    // to the passage, and the exact words are the quote printed beside it.
    expect(findQuote(runs, "Annual management fee: 0.85%")).toEqual({ from: 19, to: 19 });
  });

  it("marks the first of two runs holding the same passage", () => {
    const runs = ["Net assets are USD 5m at 30 September.", "Net assets are USD 5m at 30 September."];

    expect(findQuote(runs, "Net assets are USD 5m at 30 September.")).toEqual({ from: 0, to: 0 });
  });
});

const factsheet = packDocument("factsheet");
const deck = packDocument("deck");

// The citation the pane is driven with unless a test says otherwise: the factsheet's management fee, the
// contradiction the board puts first.
const feeCitation: BoardCitation = {
  documentId: factsheet.documentId,
  documentName: factsheet.filename,
  page: 1,
  quote: "Annual management fee: 0.85% per annum",
};
const citationFor = (over: Partial<BoardCitation> = {}): BoardCitation => ({ ...feeCitation, ...over });

const opened: EvidenceEvent = { type: "citation.opened" };
const fetched = (sha256 = factsheet.sha256): EvidenceEvent => ({ type: "document.fetched", sha256 });
const pageRead = (page: number, runs: readonly string[] = runsOf("factsheet", page)): EvidenceEvent => ({
  type: "page.read",
  page,
  runs,
});
const pane = (
  events: readonly EvidenceEvent[],
  citation: BoardCitation = feeCitation,
  document: EvidenceDocument = factsheet,
) => evidenceView(paneState(events), citation, document);

describe("the pane", () => {
  it("is reading the document until the bytes are verified, and says so rather than showing a page", () => {
    expect(pane([opened])).toMatchObject({ mode: "reading", modeLabel: "Reading the document", path: null, showsPage: false });
    expect(pane([opened, fetched()])).toMatchObject({ mode: "reading", path: null, showsPage: false });
    expect(pane([opened, fetched()]).detail).toContain("match the hash the log recorded");
    // The quote is on screen from the first render, whatever the pane cannot yet do with the document.
    expect(pane([opened]).quote).toBe(feeCitation.quote);
  });

  it("marks the passage in the text layer when the cited page holds it", () => {
    const view = pane([opened, fetched(), pageRead(1)]);

    expect(view).toMatchObject({
      path: "text-layer",
      mode: "highlighted",
      modeLabel: "Highlighted in the document",
      showsPage: true,
      onCitedPage: true,
      page: 1,
      citedPage: 1,
      pageCount: 2,
      match: { from: 19, to: 19 },
    });
    expect(view.detail).toBe("The cited passage is marked in the text layer on page 1 of larkspur-factsheet.pdf.");
    expect(view.sha256).toBe(factsheet.sha256);
    // A two-page document can be moved within, which is the page jump beside the quote.
    expect(view.canJump).toBe(true);
    // Reading another page of an open document is not the same as reading the document: the jump stays
    // available and the runs of the page left behind are not marked as the new one.
    expect(pane([opened, fetched(), pageRead(1), { type: "page.jumped", page: 2 }])).toMatchObject({
      mode: "reading",
      page: 2,
      canJump: true,
      showsPage: false,
      match: null,
    });
  });

  it("opens on the page the citation names, never on the first page", () => {
    const citation = citationFor({
      documentId: deck.documentId,
      documentName: deck.filename,
      page: 2,
      quote: "No entry or exit charges.",
    });

    expect(pane([opened, fetched(deck.sha256), pageRead(2, runsOf("deck", 2))], citation, deck)).toMatchObject({
      path: "text-layer",
      mode: "highlighted",
      page: 2,
      citedPage: 2,
      pageCount: 3,
    });
    // Read before anything has been asked of it, the pane still shows the cited page.
    expect(pane([opened], citation, deck)).toMatchObject({ page: 2, citedPage: 2 });
  });

  it("falls back to the quote panel when the page's text layer does not hold the passage", () => {
    const view = pane([opened, fetched(), pageRead(1, ["Dealing: daily, on any business day"])]);

    expect(view).toMatchObject({ path: "quote-panel", mode: "quote-panel", modeLabel: "Quote panel — passage not found", match: null });
    // The page is still there to read; what is missing is the mark on it.
    expect(view.showsPage).toBe(true);
    expect(view.detail).toBe(
      "The text layer on page 1 of larkspur-factsheet.pdf does not hold that passage, so the quote is shown beside the page instead.",
    );
    expect(view.quote).toBe(feeCitation.quote);
  });

  it("falls back to the quote panel when the document would not fetch, and never to an empty pane", () => {
    const view = pane([opened, { type: "document.fetch-failed", detail: "GET /pack/larkspur-factsheet.pdf: 404" }]);

    expect(view).toMatchObject({
      path: "quote-panel",
      mode: "document-missing",
      modeLabel: "Quote panel — document not fetched",
      showsPage: false,
      canJump: false,
      sha256: null,
    });
    expect(view.detail).toContain("404");
    expect(view.quote).toBe(feeCitation.quote);
  });

  it("refuses to draw bytes whose hash is not the one the log recorded, and names both", () => {
    const view = pane([opened, { type: "document.hash-mismatch", expected: factsheet.sha256, found: deck.sha256 }]);

    expect(view).toMatchObject({ path: "quote-panel", mode: "document-unverified", showsPage: false });
    expect(view.detail).toContain(`${factsheet.sha256.slice(0, 12)}… the log recorded`);
    expect(view.detail).toContain(deck.sha256.slice(0, 12));
    expect(view.quote).toBe(feeCitation.quote);
  });

  it("falls back to the quote panel when the page itself could not be read", () => {
    const view = pane([opened, fetched(), { type: "page.unavailable", detail: "Page 9 is not one of the 2 pages this document has." }]);

    expect(view).toMatchObject({ path: "quote-panel", mode: "page-unreadable", showsPage: false });
    expect(view.detail).toContain("Page 9 is not one of the 2 pages this document has.");
    expect(view.quote).toBe(feeCitation.quote);
  });

  it("keeps the page jump on the fallback, which is the quote panel *and* a page jump (ADR-0001)", () => {
    // The document was fetched and its hash checked; only the page failed. The bytes are there, so there
    // is something to move within — a pane that dropped the jump here would be half the named fallback.
    const unreadable = pane([opened, fetched(), { type: "page.unavailable", detail: "that page would not paint" }]);
    expect(unreadable).toMatchObject({ showsPage: false, canJump: true, path: "quote-panel" });

    // And it moves: jumping from the fallback lands on a page the pane is now reading, not the one that
    // failed — which is what "quote panel plus a page jump" has to mean for the jump to be worth having.
    const recovered = pane([opened, fetched(), { type: "page.unavailable", detail: "no" }, { type: "page.jumped", page: 2 }]);
    expect(recovered).toMatchObject({ page: 2, citedPage: 1, showsPage: false, canJump: true, sha256: factsheet.sha256 });
  });

  it("offers no page jump when there is no verified document to move within", () => {
    // Nothing fetched and nothing verified: the quote panel is all there is, and pretending otherwise
    // would offer a control that cannot do what it says.
    for (const failed of [
      { type: "document.fetch-failed", detail: "404" },
      { type: "document.hash-mismatch", expected: factsheet.sha256, found: deck.sha256 },
    ] as const) {
      expect(pane([opened, failed])).toMatchObject({ canJump: false, path: "quote-panel" });
    }
  });

  it("ignores a page jump when the document never arrived, rather than drawing from bytes it lacks", () => {
    const view = pane([opened, { type: "document.fetch-failed", detail: "404" }, { type: "page.jumped", page: 2 }]);

    expect(view).toMatchObject({ mode: "document-missing", sha256: null });
    expect(paneState([opened, { type: "document.fetch-failed", detail: "404" }, { type: "page.jumped", page: 2 }]).page).toBeNull();
  });

  it("says which page the passage is on once the analyst has moved away from it", () => {
    const view = pane([opened, fetched(), pageRead(2), { type: "page.jumped", page: 1 }, pageRead(1)]);

    expect(view).toMatchObject({ page: 1, citedPage: 1, showsPage: true, path: "text-layer" });

    const elsewhere = pane([opened, fetched(), pageRead(1), { type: "page.jumped", page: 2 }, pageRead(2)]);
    expect(elsewhere).toMatchObject({ page: 2, onCitedPage: false, path: "quote-panel", showsPage: true });
    expect(elsewhere.detail).toBe("You are on page 2; the cited passage is on page 1.");
  });

  it("starts over when another citation is opened", () => {
    const state: EvidenceState = paneState([
      opened,
      fetched(),
      pageRead(1),
      { type: "citation.opened" },
      { type: "document.fetch-failed", detail: "offline" },
    ]);

    expect(state).toMatchObject({ status: "fetch-failed", page: null, runs: [], sha256: null });
    expect(pane([opened, fetched(), pageRead(1), { type: "citation.opened" }]).mode).toBe("reading");
  });

  it("drops a page it never verified, and a page the analyst has jumped away from", () => {
    // Nothing is drawn from bytes the log did not vouch for, however complete the page read that follows.
    expect(pane([opened, pageRead(1)])).toMatchObject({ mode: "reading", showsPage: false });

    const jumped = paneState([opened, fetched(), { type: "page.jumped", page: 2 }, pageRead(1)]);
    expect(jumped).toMatchObject({ status: "verified", page: 2, runs: [] });
  });
});

describe("fetching a document by its hash", () => {
  it("fetches the pack's own bytes from the static asset, and hands back what it hashed", async () => {
    const fetched = await fetchVerifiedDocument(factsheet);

    expect(served).toEqual([`/pack/${factsheet.filename}`]);
    expect(fetched.verdict).toBe("verified");
    expect(fetched.event).toEqual({ type: "document.fetched", sha256: factsheet.sha256 });
    expect(await sha256Hex((fetched as { bytes: DocumentBytes }).bytes)).toBe(factsheet.sha256);
  });

  it("fetches it again on every call, because nothing about a document is kept between renders", async () => {
    await fetchVerifiedDocument(factsheet);
    await fetchVerifiedDocument(factsheet);

    expect(served).toEqual([`/pack/${factsheet.filename}`, `/pack/${factsheet.filename}`]);
  });

  it("refuses bytes that are not the document the log recorded", async () => {
    const feeTable = packDocument("fee-table");
    // The factsheet's filename, the fee table's bytes: the kind of swap a citation must not be fooled by.
    vi.stubGlobal("fetch", async () => new Response(readBytes(packDir, feeTable.filename), { status: 200 }));
    const fetched = await fetchVerifiedDocument(factsheet);

    expect(fetched.verdict).toBe("rejected");
    expect(fetched.event).toEqual({ type: "document.hash-mismatch", expected: factsheet.sha256, found: feeTable.sha256 });
    expect(fetched).not.toHaveProperty("bytes");
  });

  it("reports a fetch that failed rather than throwing, and keeps the quote readable", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));

    const fetched = await fetchVerifiedDocument(factsheet);
    expect(fetched.verdict).toBe("rejected");
    expect(fetched.event).toMatchObject({ type: "document.fetch-failed" });
    expect((fetched.event as { detail: string }).detail).toContain("404");
    expect(pane([opened, fetched.event]).quote).toBe(feeCitation.quote);
  });
});

describe("the document a citation is opened against", () => {
  it("is the one the case log recorded, hash and page count included", () => {
    expect(evidenceDocument(events, "factsheet")).toEqual({
      documentId: "factsheet",
      filename: "larkspur-factsheet.pdf",
      sha256: packDocument("factsheet").sha256,
      pageCount: 2,
    });
    expect(evidenceDocument(events, "not-a-document")).toBeNull();
  });

  it("carries no extracted text, because the log the browser folds carries none", () => {
    // The slim document.ingested event omits the page text on purpose (ADR-0002), and that omission is what
    // forces the pane to re-read the document instead of rendering a copy the log was told not to hold.
    const ingested = events.filter((event) => event.type === "document.ingested");
    expect(ingested).toHaveLength(manifest.documents.length);
    expect(ingested.every((event) => !("pages" in event.payload))).toBe(true);
    expect(Object.keys(evidenceDocument(events, "factsheet")!)).toEqual(["documentId", "filename", "sha256", "pageCount"]);
  });
});

// The board, rendered to markup: no effects run here, so nothing is fetched and no canvas is drawn — but
// every control the analyst reaches for is in the markup, which is the part that has to be real rather
// than described. Rendered with react-dom/server, which ships with react-dom: no DOM-testing dependency
// is added for two assertions.
//
// Rendered markup is a string, so every assertion on it is a pattern. These three helpers keep the
// patterns off what an implementation may reasonably rewrite — attribute order, a colour, a separator —
// and on what it may not: what the control is, what it says, and what it points at. A test that pinned
// `style="background:#fde68a…"` would fail on a repaint with every behaviour unchanged, which is by the
// repo's own testing decision 1 the wrong test.
function chipFor(markup: string, filename: string): string {
  const chips = markup.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
  const chip = chips.find((tag) => tag.includes(filename));
  if (chip === undefined) throw new Error(`no citation chip naming ${filename} in:\n${markup}`);
  return chip;
}

const attr = (tag: string, name: string): string | null => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

const marks = (markup: string): string[] => markup.match(/<mark[^>]*>[\s\S]*?<\/mark>/g) ?? [];

describe("the board with its citation chips", () => {
  const cards = boardView(events, [...CATEGORIES]).cards;
  const card = cards[0]!;
  const html = (selected?: EvidenceSelection | null) =>
    renderToStaticMarkup(createElement(Board, { events, ...(selected === undefined ? {} : { selected }) }));
  const open = (which: number): EvidenceSelection => ({
    findingId: cards[which]!.findingId,
    citation: cards[which]!.citation!,
  });

  it("quotes every passage in the card itself, whatever the pane is showing", () => {
    const markup = html(open(0));

    expect(markup).toContain(card.citation!.quote);
    expect(markup).toContain(card.counterpart!.quote);
    expect(markup).toContain("Annual management fee: 0.85% per annum");
  });

  it("makes each citation a button that names the document and the page, and says which one is open", () => {
    const closed = chipFor(html(null), "larkspur-factsheet.pdf");
    expect(attr(closed, "type")).toBe("button");
    expect(attr(closed, "aria-expanded")).toBe("false");
    expect(closed).toContain("page 1");

    const openedNow = html(open(0));
    const chip = chipFor(openedNow, "larkspur-factsheet.pdf");
    expect(attr(chip, "aria-expanded")).toBe("true");
    expect(openedNow).toContain("open in the pane");
    // The pane beside the board, on the cited page, with the passage quoted verbatim and marked as a
    // quote rather than left blank while the document is fetched.
    expect(openedNow).toContain('aria-label="Evidence from larkspur-factsheet.pdf"');
    expect(openedNow).toContain("Reading the document");
    expect(marks(openedNow).some((mark) => mark.includes(card.citation!.quote))).toBe(true);
  });

  it("shows no evidence column until a citation is opened, so the board is the default view", () => {
    // Spec decision 31: the default view is the board with its filters, not an empty column asking to be
    // filled. The column appears when there is a citation to put in it.
    expect(html(null)).not.toContain("Evidence from");
    expect(html(open(0))).toContain("Evidence from larkspur-factsheet.pdf");
  });

  it("moves the pane to another citation's document and page, and works on a log alone", () => {
    // The deck's fee finding, two cards down: another document, and a page that is not the first one.
    expect(html(open(1))).toContain('aria-label="Evidence from larkspur-marketing-deck.pdf"');
    expect(html(open(1))).toContain("Page 2 of 3");

    // events on its own is how /board mounts it, and how this suite folds the case log.
    const alone = html();
    expect(alone).toContain("Claim board");
    expect(alone).toContain(card.citation!.quote);
  });
});
