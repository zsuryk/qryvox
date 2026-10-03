import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPack } from "../pack/build";
import { GroundTruth, PackManifest, PersonaSet } from "../src";

const publicDir = new URL("../../frontend/public/", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, publicDir)));
const readJson = (path: string): unknown => JSON.parse(read(path).toString("utf8"));

const built = await buildPack();
const manifest = PackManifest.parse(readJson("pack/manifest.json"));
const groundTruth = GroundTruth.parse(readJson("eval/ground-truth.json"));
const personas = PersonaSet.parse(readJson("eval/personas.json"));

describe("the committed pack", () => {
  it("is exactly what the generator renders, so the manifest hashes are valid", () => {
    for (const { filename, bytes } of built.pdfs) {
      expect(Buffer.from(bytes).equals(read(`pack/${filename}`)), `pack/${filename} is stale: run pack:generate`).toBe(
        true,
      );
    }
    expect(manifest).toEqual(built.manifest);
    expect(groundTruth).toEqual(built.groundTruth);
    expect(personas).toEqual(built.personas);
  });

  it("holds the four fabricated documents", () => {
    expect(manifest.documents.map((d) => d.kind).sort()).toEqual(["deck", "factsheet", "fee_table", "ppm"]);
  });
});

describe("the ground truth", () => {
  const entries = groundTruth.entries;

  it("plants six findings across fees, strategy, risk and terms, and four policy gaps", () => {
    expect(entries.filter((e) => e.kind !== "policy_gap")).toHaveLength(6);
    expect(entries.filter((e) => e.kind === "policy_gap").map((e) => e.rule)).toEqual(["P1", "P1", "P2", "P3"]);
    expect(new Set(entries.map((e) => e.category))).toEqual(new Set(["fees", "strategy", "risk", "terms"]));
  });

  it("names a rule on every policy gap and on nothing else", () => {
    for (const e of entries) expect(e.rule !== undefined).toBe(e.kind === "policy_gap");
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

describe("the personas", () => {
  it("disclose only findings the ground truth plants", () => {
    const planted = new Set(groundTruth.entries.map((e) => e.id));
    for (const p of personas.personas) expect(p.expected_disclosures.every((id) => planted.has(id))).toBe(true);
  });

  it("enter a case under pseudonymous ids only", () => {
    expect(personas.personas.map((p) => p.profile.client_id)).toEqual(["persona-chan", "persona-lee", "persona-wong"]);
  });
});
