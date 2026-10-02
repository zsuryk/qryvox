import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
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

// One page of the pack as pdf.js read it, split the two ways this codebase needs it: the positioned text
// runs themselves, and the page's text as the pack's quotes were extracted from it. One pass over
// getTextContent produces both, because reading the runs again separately would be a second chance for
// them to disagree — and the whole citation design rests on them not disagreeing (ADR-0001).
type PageText = {
  runs: string[];
  text: string;
};

async function readPageTexts(bytes: Uint8Array, assets: PdfAssets): Promise<PageText[]> {
  if (assets.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = assets.workerSrc;
  const loading = pdfjs.getDocument({ data: bytes, standardFontDataUrl: assets.standardFontDataUrl });
  try {
    const pdf = await loading.promise;
    const pages: PageText[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const runs: string[] = [];
      let text = "";
      for (const item of content.items) {
        // Anything with no str is marked content — a tag pdf.js walks past rather than draws — and has
        // no run and no place in the extracted text.
        if (!("str" in item)) continue;
        runs.push(item.str);
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      pages.push({ runs, text });
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}

// The text of each page, in page order — index n holds the text of page n + 1.
export async function extractPageTexts(bytes: Uint8Array, assets: PdfAssets): Promise<string[]> {
  return (await readPageTexts(bytes, assets)).map((page) => page.text);
}

// The positioned text runs of each page, in page order — index n holds the runs of page n + 1.
//
// A citation's quote is matched against runs like these: in the browser they come off the text layer
// (TextLayer.textContentItemsStr, in this same order, one entry per div), and here they come off
// getTextContent, so a test can drive the matcher on the real runs of the real pack.
export async function extractPageRuns(bytes: Uint8Array, assets: PdfAssets): Promise<string[][]> {
  return (await readPageTexts(bytes, assets)).map((page) => page.runs);
}

// The browser's half of a citation: the document open, and one page of it drawn with a text layer over
// the canvas. A TextLayer needs a real DOM container and cannot be constructed in Node, so none of this
// can be asserted by a test — which is why everything testable about a citation is decided on the runs
// (extractPageRuns above) rather than on the pixels (spec decision 1).

// pdf.js's own types, taken from the package's types entry rather than imported from its guts: getDocument
// is overloaded, so these cannot be derived from its signature without picking the wrong one.
type LoadingTask = PDFDocumentLoadingTask;
type OpenDocumentProxy = Awaited<LoadingTask["promise"]>;

// From here down is the rendering half — canvas, text layer, measured columns — and it touches the DOM,
// where the extraction above deliberately does not. It lives in this file anyway, which is a departure from
// the shape the rest of lib/ keeps, and the reason is the one at the top: this is the single place the
// pinned build is imported and the single place its version is checked. Splitting the render half out would
// mean a second module loading pdf.js, and the pack's quotes are matched against text read by *one* build —
// so the risk of two importers drifting apart is worse than the tidiness of separating them. What protects
// the DOM half is the production build and the browser, since Node has no document to draw into.

// How far a page may be scaled to fit the column it is drawn in. Read off the pane: a portrait
// factsheet and a landscape deck both have to be readable there, and neither may be scaled to a smudge
// by a pane that is briefly hidden while it measures.
const MIN_SCALE = 0.4;
const MAX_SCALE = 2;

export type RenderedPage = {
  // The page that was drawn, which is the one the pane asked for — the pane records it rather than
  // assuming, so a document that answered with something else is visible as that.
  page: number;
  // The page's text runs in pdf.js's order: what findQuote matches, and one entry per textDiv below.
  runs: readonly string[];
  // One absolutely positioned div per run, over the canvas. This is where a passage is marked, which is
  // the whole of the primary path (spec decision 33).
  textDivs: readonly HTMLElement[];
  width: number;
  height: number;
  // Takes the page down: the render task cancelled and the page's nodes out of the container.
  destroy(): Promise<void>;
};

export type OpenDocument = {
  pageCount: number;
  // Draws one page into a container the pane owns, replacing whatever was drawn there before.
  drawPage(options: { page: number; container: HTMLElement }): Promise<RenderedPage>;
  // Releases the document, the text layer and the worker behind it. Called when the pane is closed or the
  // citation changes: pdf.js keeps a worker per document, so a pane that cycled through citations
  // without this would leave one worker behind for every citation an analyst opened.
  destroy(): Promise<void>;
};

export async function openPdf(bytes: Uint8Array, assets: PdfAssets): Promise<OpenDocument> {
  if (assets.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = assets.workerSrc;
  const loading = pdfjs.getDocument({ data: bytes, standardFontDataUrl: assets.standardFontDataUrl });
  const pdf = await loading.promise;
  let current: RenderedPage | null = null;

  return {
    pageCount: pdf.numPages,

    async drawPage({ page, container }): Promise<RenderedPage> {
      // One page at a time: the text layer and the canvas of the page before are taken down first, or a
      // document opened on a document would pile its pages up in the same column.
      await current?.destroy();
      current = null;
      const drawn = await drawPage(pdf, page, container);
      current = drawn;
      return drawn;
    },

    async destroy(): Promise<void> {
      await current?.destroy();
      current = null;
      await loading.destroy();
      // Drops the font-measurement canvases pdf.js leaves on document.body for the text layer. It is a
      // no-op while any text layer is still being rendered, and only the caches go.
      pdfjs.TextLayer.cleanup();
    },
  };
}

async function drawPage(pdf: OpenDocumentProxy, page: number, container: HTMLElement): Promise<RenderedPage> {
  const pdfPage = await pdf.getPage(page);
  const unit = pdfPage.getViewport({ scale: 1 });
  const scale = clampScale(fitWidth(container, unit.width) / unit.width);
  const viewport = pdfPage.getViewport({ scale });

  // The surface holds the canvas and the text layer, and is what pdf.js's absolute positioning is
  // measured against; the container is the pane's own scrolling box. Sized to the whole pixel, because
  // that is what the text layer sizes itself to — `round(down, …, 1px)` — and a surface a fraction wider
  // would let the layer clip the right edge of the last line on the page.
  const surface = element("div", {
    position: "relative",
    width: `${Math.floor(viewport.width)}px`,
    height: `${Math.floor(viewport.height)}px`,
    background: "#ffffff",
  });
  const canvas = element("canvas", { display: "block", width: `${viewport.width}px`, height: `${viewport.height}px` });
  // The text layer's own divs are styled by the pane (see TEXT_LAYER_CSS in app/evidence.tsx): pdf.js
  // writes them itself, so they cannot be handed to React or given inline styles one by one.
  const layer = element("div", { position: "absolute", inset: "0", overflow: "clip" });
  layer.className = "textLayer";
  // What the text layer sizes itself with: the scale the page was drawn at, and the rounding steps its
  // width and height expressions need. Without them the computed size is invalid and the layer collapses.
  layer.style.setProperty("--total-scale-factor", String(scale));
  layer.style.setProperty("--scale-round-x", "1px");
  layer.style.setProperty("--scale-round-y", "1px");
  surface.append(canvas, layer);
  container.replaceChildren(surface);

  // Drawn at the device's pixel ratio, so the passage an analyst is checking does not look softer than
  // the quote beside it that says what it says.
  const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  const task = pdfPage.render({
    canvas,
    viewport,
    // Only when the device is denser than the CSS pixel the page was laid out in; at 1:1 the canvas is
    // already the right size and pdf.js's own transform is the identity.
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  });
  // The text content and the page image are read in parallel: neither needs the other, and a page is
  // nothing to an analyst without both.
  const [, textContent] = await Promise.all([task.promise, pdfPage.getTextContent()]);
  const textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: layer, viewport });
  await textLayer.render();

  let down = false;
  return {
    page,
    runs: [...textLayer.textContentItemsStr],
    textDivs: [...textLayer.textDivs],
    width: viewport.width,
    height: viewport.height,
    async destroy(): Promise<void> {
      // Idempotent, because both the page's own drawer and the pane's cleanup reach for it.
      if (down) return;
      down = true;
      task.cancel();
      surface.remove();
    },
  };
}

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

// The width the page may occupy: the pane's own box less its padding, because clientWidth counts the
// padding and a page drawn to the full clientWidth scrolls the pane sideways for two dozen pixels. A
// container that measures nothing — a pane not yet on screen — falls back to the page's own width,
// which is the scale an analyst can read, at the price of a scrollbar.
function fitWidth(container: HTMLElement, pageWidth: number): number {
  const style = getComputedStyle(container);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return container.clientWidth - padding || pageWidth;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  return node;
}
