import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPack } from "../pack/build";
import { GroundTruth, PackManifest } from "../src";

const publicDir = new URL("../../frontend/public/", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, publicDir)));
const readJson = (path: string): unknown => JSON.parse(read(path).toString("utf8"));

const built = await buildPack();
const manifest = PackManifest.parse(readJson("pack/manifest.json"));
const groundTruth = GroundTruth.parse(readJson("eval/ground-truth.json"));

describe("the committed pack", () => {
  it("is exactly what the generator renders, so the manifest hashes are valid", () => {
    for (const { filename, bytes } of built.pdfs) {
      expect(Buffer.from(bytes).equals(read(`pack/${filename}`)), `pack/${filename} is stale: run pack:generate`).toBe(
        true,
      );
    }
    expect(manifest).toEqual(built.manifest);
    expect(groundTruth).toEqual(built.groundTruth);
  });

  it("holds the four fabricated documents", () => {
    expect(manifest.documents.map((d) => d.kind).sort()).toEqual(["deck", "factsheet", "fee_table", "ppm"]);
  });
});

describe("the ground truth", () => {
  const entries = groundTruth.entries;

  it("plants six findings covering fees, strategy, risk and terms", () => {
    expect(entries).toHaveLength(6);
    expect(new Set(entries.map((e) => e.category))).toEqual(new Set(["fees", "strategy", "risk", "terms"]));
  });

  it("includes the three named cases", () => {
    const deckToPpm = entries.find((e) => e.kind === "unsupported_claim");
    const gap = entries.find((e) => e.kind === "disclosure_gap");
    const feeTwoWays = entries.find((e) => e.category === "fees" && e.citation.quote.includes("management fee"));

    expect(deckToPpm?.citation.document_id).toBe("deck");
    expect(gap).toMatchObject({ category: "risk", citation: { document_id: "deck" } });
    expect(feeTwoWays?.counterpart?.quote).toContain("management fee");
  });

  it("cites only documents and pages the manifest has", () => {
    const pages = new Map(manifest.documents.map((d) => [d.document_id, d.page_count]));
    for (const c of entries.flatMap((e) => [e.citation, e.counterpart ?? e.citation])) {
      expect(c.page).toBeLessThanOrEqual(pages.get(c.document_id) ?? 0);
    }
  });

  it("is a separate artifact the manifest never lists", () => {
    expect(manifest.documents.every((d) => d.filename.endsWith(".pdf"))).toBe(true);
  });
});
