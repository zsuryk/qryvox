import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFJS_VERSION } from "@qryvox/shared";

// One pdf.js build of one pinned version, imported here and nowhere else, so the browser and
// test/pack-integrity.test.ts read text the same way. The legacy build is the one pdf.js ships for Node,
// and it runs unchanged in a browser, which is what lets one build serve both.

// A citation is a page plus a quote, and the quote is matched against the text pdf.js reads off that
// page, so a text-layer change would move every highlight without breaking anything visible. Failing at
// load, in whichever process loads pdf.js, is what keeps that from being found as a broken highlight in a
// demo instead.
export function assertPdfjsVersion(expected: string): void {
  if (pdfjs.version !== expected) {
    throw new Error(
      `pdf.js ${pdfjs.version} is loaded but the pack's quotes were extracted with ${expected}. ` +
        `Re-pin pdfjs-dist in pnpm-workspace.yaml, then run pack:generate and the pack integrity test.`,
    );
  }
}
assertPdfjsVersion(PDFJS_VERSION);

// Where pdf.js loads what it does not inline. Node resolves its own worker from beside pdf.js itself, so
// workerSrc can be left unset there; a browser has no such default and has to name the file the bundler
// emitted, or getDocument rejects before it reads a page. Only the caller knows which it is.
export type PdfAssets = { standardFontDataUrl: string; workerSrc?: string };

// What the browser hands to extractPageTexts: the static copies scripts/pdfjs-assets.ts makes of the
// pinned build, which run before dev and before build. Both the trailing slash and the flat worker
// name are load-bearing — pdf.js resolves a font file against the first, and the second is the copy.
export const browserPdfAssets: PdfAssets = {
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  workerSrc: "/pdfjs/pdf.worker.mjs",
};

// The text of each page, in page order — index n holds the text of page n + 1.
export async function extractPageTexts(bytes: Uint8Array, assets: PdfAssets): Promise<string[]> {
  if (assets.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = assets.workerSrc;
  const loading = pdfjs.getDocument({ data: bytes, standardFontDataUrl: assets.standardFontDataUrl });
  try {
    const pdf = await loading.promise;
    const pages: string[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}
