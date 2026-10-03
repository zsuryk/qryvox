import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPack, LARKSPUR_V1 } from "../pack/build";
import { LARKSPUR_V2 } from "../pack/source-v2";
import { WRENFIELD } from "../pack/source-wrenfield";
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

describe("Larkspur v2, the revised pack", () => {
  it("is exactly what the generator renders", async () => {
    const v2 = await buildPack(LARKSPUR_V2);
    for (const { filename, bytes } of v2.pdfs) {
      expect(Buffer.from(bytes).equals(read(`pack/v2/${filename}`)), `pack/v2/${filename} is stale: run pack:generate`).toBe(true);
    }
    expect(PackManifest.parse(readJson("pack/v2/manifest.json"))).toEqual(v2.manifest);
    expect(GroundTruth.parse(readJson("eval/v2/ground-truth.json"))).toEqual(v2.groundTruth);
    expect(PersonaSet.parse(readJson("eval/v2/personas.json"))).toEqual(v2.personas);
  });

  it("keeps v1's document ids, so ingesting it replaces each v1 document, under new filenames", () => {
    expect(LARKSPUR_V2.documents.map((d) => d.document_id)).toEqual(LARKSPUR_V1.documents.map((d) => d.document_id));
    expect(LARKSPUR_V2.documents.every((d) => d.filename.endsWith("-v2.pdf"))).toBe(true);
  });

  it("changes only the factsheet's date and fee, and adds the PPM's fossil fuel exclusion", () => {
    const lines = (source: typeof LARKSPUR_V1) => source.documents.flatMap((d) => d.pages.flat().map((l) => `${d.document_id}: ${l}`));
    const before = new Set(lines(LARKSPUR_V1));
    const after = new Set(lines(LARKSPUR_V2));
    expect([...after].filter((l) => !before.has(l))).toEqual([
      "factsheet: Factsheet - Share class A (USD) - 31 October 2026",
      "factsheet: Annual management fee: 1.25% per annum",
      "ppm: 3.6 The Fund excludes companies that derive revenue from fossil fuels.",
    ]);
  });

  it("no longer plants the two findings the revision resolves", () => {
    const ids = (source: typeof LARKSPUR_V1) => source.groundTruth.map((e) => e.id);
    expect(ids(LARKSPUR_V1).filter((id) => !ids(LARKSPUR_V2).includes(id))).toEqual(["fees-management-fee", "strategy-fossil-fuel-screen"]);
  });
});

describe("Wrenfield, the second product", () => {
  it("is exactly what the generator renders", async () => {
    const built = await buildPack(WRENFIELD);
    for (const { filename, bytes } of built.pdfs) {
      expect(Buffer.from(bytes).equals(read(`pack/wrenfield/${filename}`)), `pack/wrenfield/${filename} is stale`).toBe(true);
    }
    expect(PackManifest.parse(readJson("pack/wrenfield/manifest.json"))).toEqual(built.manifest);
    expect(GroundTruth.parse(readJson("eval/wrenfield/ground-truth.json"))).toEqual(built.groundTruth);
    expect(PersonaSet.parse(readJson("eval/wrenfield/personas.json"))).toEqual(built.personas);
  });

  it("names its own product and issuer, and plants two findings and no policy gap", () => {
    const manifest = PackManifest.parse(readJson("pack/wrenfield/manifest.json"));
    expect(manifest).toMatchObject({ pack_id: "wrenfield-v1", product: "Wrenfield Short Duration Fund", issuer: "Ashcombe Investment Partners Ltd" });
    expect(WRENFIELD.groundTruth.map((e) => e.kind)).toEqual(["contradiction", "disclosure_gap"]);
  });
});
