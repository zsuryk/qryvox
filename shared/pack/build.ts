import { createHash } from "node:crypto";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { GroundTruth, type PackCitation, PackManifest } from "../src";
import { DOCUMENTS, FOOTER, GROUND_TRUTH, ISSUER, PACK_ID, PRODUCT, type SourceDocument } from "./source";

export type BuiltPack = {
  pdfs: { filename: string; bytes: Uint8Array }[];
  manifest: PackManifest;
  groundTruth: GroundTruth;
};

// Fixed metadata so the same source always renders the same bytes and the manifest hashes stay valid.
const FIXED_DATE = new Date("2026-09-30T00:00:00.000Z");
const PRODUCER = "qryvox fabricated pack generator";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;

const STYLES = {
  portrait: { title: 20, heading: 13, body: 10.5, footer: 7 },
  landscape: { title: 30, heading: 22, body: 18, footer: 8 },
};

export async function buildPack(): Promise<BuiltPack> {
  checkGroundTruth();

  const pdfs = [];
  const documents = [];
  for (const source of DOCUMENTS) {
    const bytes = await renderDocument(source);
    pdfs.push({ filename: source.filename, bytes });
    documents.push({
      document_id: source.document_id,
      kind: source.kind,
      filename: source.filename,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      page_count: source.pages.length,
    });
  }

  return {
    pdfs,
    manifest: PackManifest.parse({ pack_id: PACK_ID, product: PRODUCT, issuer: ISSUER, documents }),
    groundTruth: GroundTruth.parse({ pack_id: PACK_ID, entries: GROUND_TRUTH }),
  };
}

// Every cited quote must be a whole body line on the cited page of the cited document.
function checkGroundTruth(): void {
  const citations = GROUND_TRUTH.flatMap((e) => (e.counterpart ? [e.citation, e.counterpart] : [e.citation]));
  for (const c of citations) {
    if (!bodyLines(c.document_id, c.page).includes(c.quote)) {
      throw new Error(`ground truth quote not found as a line on ${c.document_id} p${c.page}: "${c.quote}"`);
    }
  }
}

function bodyLines(documentId: string, page: number): string[] {
  const source = DOCUMENTS.find((d) => d.document_id === documentId);
  return (source?.pages[page - 1] ?? []).filter((line) => !line.startsWith("#"));
}

function isQuoted(documentId: string, page: number, line: string): boolean {
  return GROUND_TRUTH.some((e) =>
    [e.citation, e.counterpart].some(
      (c: PackCitation | null) => c?.document_id === documentId && c.page === page && c.quote === line,
    ),
  );
}

async function renderDocument(source: SourceDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(source.title);
  pdf.setAuthor(ISSUER);
  pdf.setSubject("Fabricated document for a software demonstration");
  pdf.setProducer(PRODUCER);
  pdf.setCreator(PRODUCER);
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);

  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const size = source.orientation === "portrait" ? A4 : ([A4[1], A4[0]] as [number, number]);
  const style = STYLES[source.orientation];

  source.pages.forEach((lines, i) => {
    const page = pdf.addPage(size);
    const pageNumber = i + 1;
    const width = page.getWidth() - 2 * MARGIN;
    let y = page.getHeight() - MARGIN;

    for (const raw of lines) {
      if (!/^[\x20-\x7e]*$/.test(raw)) throw new Error(`non-ASCII text in ${source.document_id}: "${raw}"`);
      const [text, font, fontSize, spaceBefore] = raw.startsWith("## ")
        ? [raw.slice(3), fonts.bold, style.heading, style.heading]
        : raw.startsWith("# ")
          ? [raw.slice(2), fonts.bold, style.title, 0]
          : [raw, fonts.regular, style.body, 0];

      const wrapped = wrap(text, font, fontSize, width);
      if (wrapped.length > 1 && isQuoted(source.document_id, pageNumber, raw)) {
        throw new Error(`quoted line would wrap on ${source.document_id} p${pageNumber}: "${raw}"`);
      }

      y -= spaceBefore;
      for (const line of wrapped) {
        y -= fontSize * 1.45;
        page.drawText(line, { x: MARGIN, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.12) });
      }
    }

    const footerTop = drawFooter(page, fonts.regular, style.footer, width, `Page ${pageNumber} of ${source.pages.length}`);
    if (y < footerTop + style.body) {
      throw new Error(`${source.document_id} p${pageNumber} overflows into the footer`);
    }
  });

  return pdf.save({ useObjectStreams: false });
}

// Draws the fictional-document notice and page number at the bottom; returns the footer's top edge.
function drawFooter(page: PDFPage, font: PDFFont, fontSize: number, width: number, label: string): number {
  const lines = [...wrap(FOOTER, font, fontSize, width), label];
  const lineHeight = fontSize * 1.4;
  const top = MARGIN / 2 + lines.length * lineHeight;
  // Top-down, so text extraction reads the footer in order.
  lines.forEach((line, i) => {
    page.drawText(line, { x: MARGIN, y: top - (i + 1) * lineHeight, size: fontSize, font, color: rgb(0.4, 0.4, 0.45) });
  });
  return top;
}

function wrap(text: string, font: PDFFont, fontSize: number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && font.widthOfTextAtSize(candidate, fontSize) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}
