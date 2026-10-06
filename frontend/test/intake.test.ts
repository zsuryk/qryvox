import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeFile,
  type DocumentBytes,
  documentEventId,
  type DocumentTile,
  intake,
  type IntakeApi,
  type IntakeFile,
  parseDocument,
  RejectedDocument,
  sha256Hex,
} from "../lib/intake";
import { packSources } from "../lib/pack";
import { manifest, nodeAssets, packDir, readBytes } from "./helpers";

// The drop zone, driven headlessly: the same pack files the browser fetches, through the same
// functions, with pdf.js reading them the way the browser will. What a tile shows and what reaches
// the log are both decided in lib/intake.ts, so this is where they are asserted.

// The pack the browser has under /pack, served off the committed files. The intake button goes through
// exactly this fetch, so the test exercises the same route the button takes.
const servePack = () =>
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    const path = new URL(String(url), "http://localhost").pathname;
    const name = path === "/pack/manifest.json" ? "manifest.json" : path.slice("/pack/".length);
    return new Response(readBytes(packDir, name), { status: 200 });
  });

beforeEach(servePack);
afterEach(() => vi.unstubAllGlobals());

// One dropped File: no ids, no kinds, just a name and its bytes.
const dropped = (filename: string, body?: DocumentBytes): IntakeFile => ({
  filename,
  read: async () => body ?? Uint8Array.from(readBytes(packDir, filename)),
});

const packFile = (documentId: string) => manifest.documents.find((d) => d.document_id === documentId)!;

type Call = { caseId: string; eventId: string; filename: string; sha256: string; pages: string[] };

// The API the drop zone talks to, counted. Documents finish in whatever order pdf.js gets round to,
// so the assertions below compare sets, not sequences.
function recorder(overrides: Partial<IntakeApi> = {}) {
  const calls: Call[] = [];
  let opened = 0;
  const api: IntakeApi = {
    openCase: async () => `case-${++opened}`,
    ingest: async (caseId, eventId, document) => {
      calls.push({ caseId, eventId, filename: document.filename, sha256: document.sha256, pages: document.pages });
      return { seq: calls.length + 1 };
    },
    ...overrides,
  };
  return { api, calls, opened: () => opened };
}

// Every tile intake reported, with only the last report of each kept.
function tiles() {
  const seen: DocumentTile[] = [];
  const settled = () => [...new Map(seen.map((tile) => [tile.key, tile])).values()];
  return { seen, settled, onTile: (tile: DocumentTile) => seen.push(tile) };
}

describe("reading a document in the browser", () => {
  it("records the id, hash, filename, kind, page count, text and pdf.js version the manifest says it will", async () => {
    const files = await packSources();

    for (const expected of manifest.documents) {
      const file = files.find((f) => f.filename === expected.filename)!;
      const document = await parseDocument(file, await file.read(), nodeAssets);

      expect(document.document_id).toBe(expected.document_id);
      expect(document.filename).toBe(expected.filename);
      expect(document.kind).toBe(expected.kind);
      expect(document.sha256).toBe(expected.sha256);
      expect(document.page_count).toBe(expected.page_count);
      expect(document.pages).toHaveLength(expected.page_count);
      expect(document.pages.every((page) => page.trim() !== ""), `${expected.document_id} has an empty page`).toBe(true);
      expect(document.pdfjs_version).toBe(manifest.pdfjs_version);
    }
  });

  it("hashes bytes the way the manifest recorded them", async () => {
    const bytes = Uint8Array.from(readBytes(packDir, "larkspur-ppm-excerpt.pdf"));
    expect(await sha256Hex(bytes)).toBe(packFile("ppm").sha256);
  });

  it("reports a PDF it cannot read rather than ingesting it empty", async () => {
    const broken = dropped("larkspur-factsheet.pdf", new TextEncoder().encode("not a pdf") as DocumentBytes);
    await expect(parseDocument(broken, await broken.read(), nodeAssets)).rejects.toThrow();
  });
});

describe("naming a document the contract will accept", () => {
  it("reads the kind off the filename of each document in the pack", () => {
    expect(describeFile("larkspur-factsheet.pdf")).toEqual({ documentId: "larkspur-factsheet", kind: "factsheet" });
    expect(describeFile("Larkspur PPM Excerpt.PDF")).toEqual({ documentId: "larkspur-ppm-excerpt", kind: "ppm" });
    expect(describeFile("larkspur-fee-table.pdf")).toEqual({ documentId: "larkspur-fee-table", kind: "fee_table" });
    expect(describeFile("Larkspur-Marketing-Deck.pdf")).toEqual({ documentId: "larkspur-marketing-deck", kind: "deck" });
  });

  it("refuses a name that claims no kind rather than guessing one", () => {
    expect(() => describeFile("holiday-photos.pdf")).toThrow(RejectedDocument);
    expect(() => describeFile("holiday-photos.pdf")).toThrow("holiday-photos.pdf");
  });
});

describe("the event id the browser names", () => {
  const caseId = "9f2c1a40-1111-4222-8333-444444444444";
  const sha = packFile("ppm").sha256;

  it("is the same id every time for the same bytes in the same case, so a retry deduplicates", async () => {
    const again = await documentEventId(caseId, sha);

    expect(await documentEventId(caseId, sha)).toBe(again);
    expect(await documentEventId(caseId, packFile("deck").sha256)).not.toBe(again);
    expect(await documentEventId("00000000-0000-4000-8000-000000000000", sha)).not.toBe(again);
  });

  it("is a uuid the append contract will take", async () => {
    const eventId = await documentEventId(caseId, packFile("factsheet").sha256);
    expect(eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(eventId[14]).toBe("8");
  });
});

describe("intake", () => {
  it("opens one case and ingests every document in the pack through the same path as a drop", async () => {
    const { api, calls, opened } = recorder();
    const accepted = await intake(await packSources(), { assets: nodeAssets, api, ingested: [], onTile: () => {} });

    expect(accepted.map((d) => d.document_id).sort()).toEqual(manifest.documents.map((d) => d.document_id).sort());
    expect(new Set(calls.map((c) => c.filename))).toEqual(new Set(manifest.documents.map((d) => d.filename)));
    expect(new Map(calls.map((c) => [c.filename, c.pages.length]))).toEqual(
      new Map(manifest.documents.map((d) => [d.filename, d.page_count])),
    );
    expect(new Set(calls.map((c) => c.caseId))).toEqual(new Set(["case-1"]));
    expect(opened()).toBe(1);
    expect(new Set(calls.map((c) => c.eventId)).size).toBe(calls.length);
  });

  it("sends the extracted text, never the file", async () => {
    const { api, calls } = recorder();
    await intake([dropped("larkspur-factsheet.pdf")], { assets: nodeAssets, api, ingested: [], onTile: () => {} });

    const call = calls[0]!;
    expect(call.pages.join("\n")).toContain("Annual management fee: 0.85% per annum");
    expect(JSON.stringify(call)).not.toContain("%PDF");
  });

  it("settles a tile per document, with its filename, kind and the event it took", async () => {
    const { api } = recorder();
    const { settled, onTile } = tiles();
    await intake(await packSources(), { assets: nodeAssets, api, ingested: [], onTile });

    expect(settled().map((tile) => tile.filename).sort()).toEqual(manifest.documents.map((d) => d.filename).sort());
    expect(settled().map((tile) => tile.kind).sort()).toEqual(manifest.documents.map((d) => d.kind).sort());
    expect(settled().every((tile) => tile.status === "ingested")).toBe(true);
    expect(settled().map((tile) => tile.seq).sort()).toEqual([2, 3, 4, 5]);
  });

  it("shows a tile before the document has been accepted, and moves it along as it goes", async () => {
    const { api } = recorder();
    const { seen, onTile } = tiles();
    await intake([dropped("larkspur-fee-table.pdf")], { assets: nodeAssets, api, ingested: [], onTile });

    expect(seen.map((tile) => tile.status)).toEqual(["extracting", "extracting", "sending", "ingested"]);
    expect(seen[0]?.seq).toBeNull();
  });

  it("carries the kind it worked out from the filename onto the settled tile", async () => {
    // A dropped File starts out naming nothing but itself, so the kind is only known after the parse.
    const { api } = recorder();
    const { settled, onTile } = tiles();
    await intake([dropped("larkspur-fee-table.pdf")], { assets: nodeAssets, api, ingested: [], onTile });

    expect(settled()[0]).toMatchObject({ kind: "fee_table", status: "ingested" });
    expect(settled()[0]?.detail).toContain(packFile("fee-table").sha256.slice(0, 12));
  });

  it("appends nothing when the same pack is dropped again", async () => {
    const { api, calls } = recorder();
    const files = await packSources();
    const first = await intake(files, { assets: nodeAssets, api, ingested: [], onTile: () => {} });
    const second = await intake(files, { assets: nodeAssets, api, ingested: first.map((d) => d.sha256), onTile: () => {} });

    expect(calls).toHaveLength(manifest.documents.length);
    expect(second).toEqual([]);
  });

  it("says on the tile that an already-ingested pack was skipped, rather than passing over it silently", async () => {
    const { api } = recorder();
    const first = await intake([dropped("larkspur-fee-table.pdf")], { assets: nodeAssets, api, ingested: [], onTile: () => {} });
    const { settled, onTile } = tiles();
    await intake([dropped("larkspur-fee-table.pdf")], { assets: nodeAssets, api, ingested: first.map((d) => d.sha256), onTile });

    expect(settled()[0]).toMatchObject({ filename: "larkspur-fee-table.pdf", status: "skipped" });
    expect(settled()[0]?.detail).toContain("nothing appended");
  });

  it("fails the document it cannot name, and still ingests the rest of the pack", async () => {
    const { api, calls } = recorder();
    const { settled, onTile } = tiles();

    const accepted = await intake(
      [...(await packSources()), dropped("holiday-photos.pdf", new Uint8Array())],
      { assets: nodeAssets, api, ingested: [], onTile },
    );

    expect(accepted).toHaveLength(manifest.documents.length);
    expect(calls).toHaveLength(manifest.documents.length);
    expect(settled().at(-1)).toMatchObject({ filename: "holiday-photos.pdf", status: "failed" });
    expect(settled().at(-1)?.detail).toContain("holiday-photos.pdf");
  });

  it("fails the document the server refused, and leaves the tile showing why", async () => {
    const refused = recorder();
    const { settled, onTile } = tiles();

    await intake(await packSources(), {
      assets: nodeAssets,
      api: {
        ...refused.api,
        ingest: async (caseId, eventId, document) => {
          if (document.kind === "deck") throw new Error("POST /cases/case-1/documents: 400 page_count mismatch");
          return refused.api.ingest(caseId, eventId, document);
        },
      },
      ingested: [],
      onTile,
    });

    const deck = settled().find((tile) => tile.kind === "deck");
    expect(deck).toMatchObject({ status: "failed", seq: null });
    expect(deck?.detail).toContain("400");
  });

  it("never opens a case for a drop it will skip before it sends anything", async () => {
    const { api, opened } = recorder();
    const first = await intake([dropped("larkspur-fee-table.pdf")], { assets: nodeAssets, api, ingested: [], onTile: () => {} });
    const before = opened();

    await intake([dropped("larkspur-fee-table.pdf")], { assets: nodeAssets, api, ingested: first.map((d) => d.sha256), onTile: () => {} });

    expect(opened()).toBe(before);
  });
});
