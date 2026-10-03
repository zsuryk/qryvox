import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { activeFindings, fold, GroundTruth, PackManifest, PersonaSet, SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import { adviceScore, findingsScore, matches, packOf, ratio } from "../lib/eval";

const pub = new URL("../public/", import.meta.url);
const read = (path: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(path, pub)), "utf8"));
const manifests = ["", "v2/", "wrenfield/"].map((dir) => ({ dir, manifest: PackManifest.parse(read(`pack/${dir}manifest.json`)) }));
const truth = GroundTruth.parse(read("eval/ground-truth.json"));
const personas = PersonaSet.parse(read("eval/personas.json")).personas;
const events = SlimEvent.array().parse(recorded);

describe("which answer key a case is measured against", () => {
  it("is the pack whose manifest lists every document the case holds, by hash", () => {
    expect(packOf(events, manifests)).toBe("");
  });

  it("is none for a case whose documents match no pack, and for a case with no documents", () => {
    const foreign = events.map((e) => (e.type === "document.ingested" ? { ...e, payload: { ...e.payload, sha256: "f".repeat(64) } } : e));
    expect(packOf(foreign, manifests)).toBeNull();
    expect(packOf(events.slice(0, 1), manifests)).toBeNull();
  });
});

describe("a finding matching a planted one", () => {
  const planted = truth.entries.find((e) => e.id === "strategy-credit-quality")!;
  const finding = (category: string, citation: string, counterpart: string | null = null) => ({
    category,
    citation: { quote: citation },
    counterpart: counterpart === null ? null : { quote: counterpart },
  });

  it("shares its category and a quote, contained either way, on either side", () => {
    expect(matches(finding("strategy", planted.citation.quote), planted)).toBe(true);
    expect(matches(finding("strategy", `${planted.citation.quote} Holdings are diversified.`), planted)).toBe(true);
    expect(matches(finding("strategy", "Something else entirely.", planted.citation.quote), planted)).toBe(true);
  });

  it("does not match across categories, or on another passage", () => {
    expect(matches(finding("risk", planted.citation.quote), planted)).toBe(false);
    expect(matches(finding("strategy", "Annual management fee: 0.85% per annum"), planted)).toBe(false);
  });
});

describe("the findings score", () => {
  it("states both denominators: found of planted, and matched of on the board", () => {
    const score = findingsScore(fold(events), truth);
    expect(score.planted).toBe(truth.entries.length);
    expect(score.onBoard).toBe(activeFindings(fold(events)).length);
    expect(score.found + score.missed.length).toBe(score.planted);
    expect(score.matched + score.extra.length).toBe(score.onBoard);
  });

  it("counts superseded findings for nothing: replayed to before the re-run, the board is the first run's", () => {
    const firstRun = events.find((e) => e.type === "finding.created")!.seq;
    const before = findingsScore(fold(events.filter((e) => e.seq <= firstRun)), truth);
    expect(before.onBoard).toBe(1);
  });
});

describe("the advice score", () => {
  it("counts only personas with advice in play, and says which verdict each got", () => {
    const score = adviceScore(fold(events), personas);
    expect(score).toMatchObject({ assessed: 0, matched: 0 });
    expect(score.rows.map((r) => r.got)).toEqual([null, null, null]);
  });
});

describe("a ratio", () => {
  it("reads as a fraction with its percentage, and has no percentage for nothing over nothing", () => {
    expect(ratio(9, 10)).toEqual({ fraction: "9 of 10", percent: "90%" });
    expect(ratio(0, 0)).toEqual({ fraction: "0 of 0", percent: null });
  });
});
