import { type DocumentKind, IngestedDocument, PDFJS_VERSION } from "@qryvox/shared";
import { extractPageTexts, type PdfAssets } from "./pdf";

// Intake: the pack arrives as files, the browser reads them, and each one becomes a document.ingested
// event on the case. The PDF never crosses the wire — only what was read out of it here — because
// the server has no pdf.js and must never need one (ADR-0001).
//
// Nothing in this module touches the DOM, so test/intake.test.ts drives the same path the drop zone
// does, on the same pack files, with the pdf.js build the browser gets.

// The bytes of one PDF. Pinned to a plain ArrayBuffer because that is what both crypto.subtle and
// pdf.js will take: a Uint8Array over a SharedArrayBuffer is a Uint8Array and is refused by both.
export type DocumentBytes = Uint8Array<ArrayBuffer>;

// What one document is, before it has been read. A dropped File names nothing but itself; the
// fabricated pack's manifest names all three, and is carried through the same path as a drop.
export type IntakeFile = {
  filename: string;
  read: () => Promise<DocumentBytes>;
  documentId?: string;
  kind?: DocumentKind;
};

export type TileStatus = "extracting" | "sending" | "ingested" | "skipped" | "failed";

// One document's progress, reported as a whole snapshot so a tile never shows a half-applied step.
// `key` is the filename: a second drop of the same pack updates the tiles already on screen.
export type DocumentTile = {
  key: string;
  filename: string;
  kind: DocumentKind | null;
  status: TileStatus;
  detail: string;
  seq: number | null;
};

export class RejectedDocument extends Error {
  override name = "RejectedDocument";
}

const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export async function sha256Hex(bytes: DocumentBytes): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The browser names the events it originates (ADR-0002). Deriving this one from the case and the
// file's own hash is what makes a retry free rather than merely possible: the same bytes dropped into
// the same case always produce the same event_id, so the server's appendOnce hands back the event it
// already wrote instead of appending a second, and re-dropping a pack appends nothing at all. The
// case is in the name so that the same pack dropped into a different case is a different event.
export async function documentEventId(caseId: string, sha256: string): Promise<string> {
  const name = new TextEncoder().encode(`${caseId}/${sha256}`);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", name)).slice(0, 16);
  // RFC 9562 version 8, the one version reserved for ids an application derives itself, so nothing
  // downstream mistakes this for a random v4 that could equally have come from anywhere.
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The contract admits only the four kinds the fabricated pack is built from, and a dropped PDF
// carries no kind of its own, so its filename is the only thing to go on. A name that matches none
// of them is refused by name rather than filed under a guess, which is the whole of what a
// non-PDF or an unrelated PDF dropped by accident turns into.
const KIND_PATTERNS: readonly (readonly [kind: DocumentKind, pattern: RegExp])[] = [
  ["fee_table", /fee[-_ ]?table/],
  ["factsheet", /fact[-_ ]?sheet/],
  ["ppm", /\b(ppm|prospectus)\b/],
  ["deck", /\b(deck|presentation|slides)\b/],
];

export function describeFile(filename: string): { documentId: string; kind: DocumentKind } {
  const stem = filename.replace(/\.pdf$/i, "");
  const kind = KIND_PATTERNS.find(([, pattern]) => pattern.test(stem.toLowerCase()))?.[0];
  if (!kind) {
    const known = KIND_PATTERNS.map(([k]) => k).join(", ");
    throw new RejectedDocument(`${filename} is not one of the document kinds this pack takes: ${known}`);
  }
  return { documentId: stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), kind };
}

// Everything a document.ingested event records about one PDF, read here in the browser.
export async function parseDocument(file: IntakeFile, bytes: DocumentBytes, assets: PdfAssets): Promise<IngestedDocument> {
  const identified =
    file.documentId && file.kind ? { documentId: file.documentId, kind: file.kind } : describeFile(file.filename);
  // Hashed before pdf.js sees the bytes: getDocument transfers them to its worker, which detaches the
  // buffer, and a detached buffer reads as empty and would hash as the empty string's digest.
  const sha256 = await sha256Hex(bytes);
  const pages = await extractPageTexts(bytes, assets);
  return IngestedDocument.parse({
    document_id: identified.documentId,
    sha256,
    filename: file.filename,
    kind: identified.kind,
    page_count: pages.length,
    pages,
    // Recorded on every document, because a quote read by a different pdf.js would not match the
    // text a citation is checked against (ADR-0001).
    pdfjs_version: PDFJS_VERSION,
  });
}

export type IntakeApi = {
  openCase: () => Promise<string>;
  ingest: (caseId: string, eventId: string, document: IngestedDocument) => Promise<{ seq: number }>;
};

export type IntakeOptions = {
  assets: PdfAssets;
  api: IntakeApi;
  // The hashes this case already holds, from the caller's reading of the log. A document whose hash is
  // in here is skipped before a request is made, so re-dropping a pack appends no event.
  ingested: readonly string[];
  onTile: (tile: DocumentTile) => void;
};

// Fans the files out concurrently and reports each one's whole progress as a tile, so the screen shows
// a document as soon as it is accepted rather than when the slowest one finishes. One document
// failing does not hold up or take down the others; its tile says why.
export async function intake(files: readonly IntakeFile[], options: IntakeOptions): Promise<IngestedDocument[]> {
  const held = new Set(options.ingested);
  // Memoised as a promise, not as a value: four files racing into the first send must open one case.
  let opening: Promise<string> | undefined;
  const caseId = () => (opening ??= options.api.openCase());

  const accepted = await Promise.all(
    files.map(async (file): Promise<IngestedDocument | null> => {
      const tile: DocumentTile = {
        key: file.filename,
        filename: file.filename,
        kind: file.kind ?? null,
        status: "extracting",
        detail: "reading the PDF in your browser",
        seq: null,
      };
      const report = (patch: Partial<DocumentTile>) => options.onTile({ ...tile, ...patch });
      options.onTile(tile);

      let document: IngestedDocument;
      try {
        document = await parseDocument(file, await file.read(), options.assets);
      } catch (cause) {
        report({ status: "failed", detail: reason(cause) });
        return null;
      }

      // The hash is the document's identity, so it is on the tile from here on: it is what a re-drop
      // is recognised by, and what an analyst checks against the manifest.
      const read = `${document.page_count} pages · ${document.sha256.slice(0, 12)}…`;
      report({ kind: document.kind, detail: read });

      if (held.has(document.sha256)) {
        report({ status: "skipped", detail: `already ingested on this case — nothing appended · ${read}` });
        return null;
      }

      try {
        report({ status: "sending", detail: read });
        const id = await caseId();
        const { seq } = await options.api.ingest(id, await documentEventId(id, document.sha256), document);
        report({ status: "ingested", seq, detail: `event ${seq} · ${read}` });
        return document;
      } catch (cause) {
        report({ status: "failed", detail: reason(cause) });
        return null;
      }
    }),
  );

  return accepted.filter((document): document is IngestedDocument => document !== null);
}
