import { PDFJS_VERSION } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { assertPdfjsVersion, extractPageTexts } from "../lib/pdf";
import { groundTruth, manifest, nodeAssets, packDir, pdfjsDir, readBytes, readJson } from "./helpers";

// The highest-value test in stage 1: if a planted quote is not in the text pdf.js reads off its cited
// page, citation highlighting cannot work and every downstream surface is at risk. A failure names the
// document and the page, so the fix is one line in shared/pack/source.ts and a `pack:generate`.

// Parsing the manifest is the pin that runs in the browser today, because fetchPackManifest parses with
// this schema and pdfjs_version is a literal in it.
const installedVersion = (readJson(pdfjsDir, "package.json") as { version: string }).version;

// Node wants a directory path where the browser will want a URL, and pdf.js finds its own worker there.
// This test is the Node caller; the drop-zone intake is the browser one.

const pageTexts = new Map<string, string[]>();
for (const document of manifest.documents) {
  // readFileSync hands back a Buffer and pdf.js rejects one; the browser only ever has a Uint8Array.
  const bytes = new Uint8Array(readBytes(packDir, document.filename));
  try {
    pageTexts.set(document.document_id, await extractPageTexts(bytes, nodeAssets));
  } catch (cause) {
    throw new Error(`${document.document_id} (${document.filename}) did not extract: ${cause}`, { cause });
  }
}

const citedPassages = groundTruth.entries.flatMap((entry) => [
  { finding: entry.id, passage: "citation", ...entry.citation },
  ...(entry.counterpart ? [{ finding: entry.id, passage: "counterpart", ...entry.counterpart }] : []),
]);

describe("the pinned pdf.js build", () => {
  it("is the one version the catalog resolved and the manifest records", () => {
    expect(installedVersion).toBe(PDFJS_VERSION);
    expect(manifest.pdfjs_version).toBe(PDFJS_VERSION);
  });

  it("refuses to run against a build it did not pin", () => {
    expect(() => assertPdfjsVersion("0.0.0-not-the-pin")).toThrow(installedVersion);
  });
});

describe("extraction", () => {
  it("produces one page of text per page of every document in the pack", () => {
    expect([...pageTexts.keys()].sort()).toEqual(manifest.documents.map((d) => d.document_id).sort());

    for (const { document_id, page_count } of manifest.documents) {
      const pages = pageTexts.get(document_id) ?? [];
      expect(pages, `${document_id} should extract ${page_count} pages`).toHaveLength(page_count);
      expect(pages.filter((text) => text.trim() === ""), `${document_id} has a page with no text`).toEqual([]);
    }
  });
});

describe("every planted passage", () => {
  it.each(citedPassages)("$finding ($passage): $document_id p$page holds its quote", ({ document_id, page, quote }) => {
    const text = (pageTexts.get(document_id) ?? [])[page - 1];

    expect(text, `${document_id} p${page} was not extracted`).toBeDefined();
    expect(text, `${document_id} p${page} does not contain its quoted passage`).toContain(quote);
  });
});
