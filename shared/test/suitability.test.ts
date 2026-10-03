import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeFindings,
  assessSuitability,
  type Finding,
  fold,
  GroundTruth,
  PersonaSet,
  type Reason,
  SlimEvent,
  undismissedFindings,
} from "../src";
import recorded from "../fixtures/case-recorded.json";
import { larkspurAttributes, larkspurV2Attributes } from "./larkspur";

const evalDir = new URL("../../frontend/public/eval/", import.meta.url);
const readJson = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(name, evalDir)), "utf8"));
const { personas } = PersonaSet.parse(readJson("personas.json"));
const groundTruth = GroundTruth.parse(readJson("ground-truth.json"));

// The board a perfect pipeline puts up: every planted finding, none dismissed.
const findings: Finding[] = groundTruth.entries.map((e) => ({
  finding_id: e.id,
  category: e.category,
  kind: e.kind,
  severity: "medium",
  claim: e.summary,
  citation: e.citation,
  counterpart: e.counterpart,
}));

const ruleAndEffect = (reasons: readonly { rule: string; effect: string }[]) =>
  reasons.map((r) => `${r.rule}:${r.effect}`).sort();
const persona = (id: string) => personas.find((p) => p.profile.client_id === id)!;

describe("the personas on Larkspur", () => {
  it.each(personas.map((p) => [p.name, p] as const))("%s gets the expected verdict, reasons and disclosures", (_, p) => {
    const assessment = assessSuitability(p.profile, larkspurAttributes, findings);

    expect(assessment.verdict).toBe(p.expected_verdict);
    expect(ruleAndEffect(assessment.reasons)).toEqual(ruleAndEffect(p.expected_reasons));
    expect(assessment.disclosures.map((d) => d.finding_id).sort()).toEqual([...p.expected_disclosures].sort());
  });

  it("cites the PPM passage behind each of Mrs Chan's blocks", () => {
    const blocks = assessSuitability(persona("persona-chan").profile, larkspurAttributes, findings).reasons.filter(
      (r) => r.effect === "blocks",
    );

    expect(blocks.map((r) => r.citation?.quote.slice(0, 3))).toEqual(["3.1", "3.3", "7.3", "7.4", "7.2"]);
    expect(blocks.every((r) => r.citation?.document_id === "ppm")).toBe(true);
  });

  it("is adaptive: Mr Lee with a two-year horizon is no longer suitable, on S1", () => {
    const lee = persona("persona-lee").profile;
    const assessment = assessSuitability({ ...lee, horizon_years: 2 }, larkspurAttributes, findings);

    expect(assessment.verdict).toBe("not_suitable");
    expect(assessment.reasons.find((r) => r.rule === "S1")?.effect).toBe("blocks");
  });

  it("discloses the authoritative side of a finding: the fee table's 1.25%, not the factsheet's 0.85%", () => {
    const { disclosures } = assessSuitability(persona("persona-wong").profile, larkspurAttributes, findings);

    expect(disclosures.find((d) => d.finding_id === "fees-management-fee")?.citation.quote).toContain("1.25%");
  });

  it("gives the same assessment every time, so replay recomputes the verdict exactly", () => {
    const p = persona("persona-lee").profile;
    expect(assessSuitability(p, larkspurAttributes, findings)).toEqual(assessSuitability(p, larkspurAttributes, findings));
  });
});

describe("the rules at their edges", () => {
  const wong = () => persona("persona-wong").profile;

  it("S5 blocks an exclusion no screen covers, citing nothing because nothing in the pack speaks to it", () => {
    const reasons = assessSuitability({ ...wong(), exclusions: ["tobacco"] }, larkspurAttributes, findings).reasons;

    expect(reasons.find((r) => r.rule === "S5")).toEqual<Reason>({
      rule: "S5",
      effect: "blocks",
      profile_field: "exclusions",
      citation: null,
    });
  });

  it("S5 meets an exclusion the PPM backs", () => {
    const backed = {
      ...larkspurAttributes,
      exclusion_screens: [{ ...larkspurAttributes.exclusion_screens[0]!, backed_by_ppm: true }],
    };
    const lee = persona("persona-lee").profile;

    expect(assessSuitability(lee, backed, findings).verdict).toBe("suitable");
  });

  it("S4 meets when the money is back within a week without a charge", () => {
    const liquid = {
      ...larkspurAttributes,
      dealing_frequency: { ...larkspurAttributes.dealing_frequency, value: "daily" as const },
      redemption_notice_days: { ...larkspurAttributes.redemption_notice_days, value: 0 },
      exit_charge_within_months: { ...larkspurAttributes.exit_charge_within_months, value: 0 },
    };
    const reasons = assessSuitability({ ...wong(), may_need_cash_at_short_notice: true }, liquid, findings).reasons;

    expect(reasons.filter((r) => r.rule === "S4").map((r) => r.effect)).toEqual(["meets"]);
  });

  it("S3 and S4 say nothing to a client they do not concern", () => {
    const rules = assessSuitability(wong(), larkspurAttributes, findings).reasons.map((r) => r.rule);
    expect(rules).not.toContain("S3");
    expect(rules).not.toContain("S4");
  });
});

describe("what S6 discloses from", () => {
  const events = SlimEvent.array().parse(recorded);

  it("is the board minus what the analyst dismissed; undecided findings still count", () => {
    const board = activeFindings(fold(events));
    const dismissed = board[0]!.finding_id;
    const seq = events.length + 1;
    const withDismissal = [
      ...events,
      SlimEvent.parse({
        seq,
        event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        case_id: events[0]!.case_id,
        actor: "demo-analyst",
        at: "2026-10-03T12:00:00.000Z",
        step_run_id: null,
        type: "disposition.changed",
        v: 1,
        payload: { finding_id: dismissed, disposition: "dismissed" },
      }),
    ];

    expect(undismissedFindings(fold(events)).map((f) => f.finding_id)).toEqual(board.map((f) => f.finding_id));
    expect(undismissedFindings(fold(withDismissal)).map((f) => f.finding_id)).not.toContain(dismissed);
  });
});

describe("the personas on Larkspur v2", () => {
  const v2 = PersonaSet.parse(readJson("v2/personas.json")).personas;
  const v2Truth = GroundTruth.parse(readJson("v2/ground-truth.json"));
  const v2Findings: Finding[] = v2Truth.entries.map((e) => ({
    finding_id: e.id,
    category: e.category,
    kind: e.kind,
    severity: "medium",
    claim: e.summary,
    citation: e.citation,
    counterpart: e.counterpart,
  }));

  it.each(v2.map((p) => [p.name, p] as const))("%s gets the expected verdict, reasons and disclosures", (_, p) => {
    const assessment = assessSuitability(p.profile, larkspurV2Attributes, v2Findings);

    expect(assessment.verdict).toBe(p.expected_verdict);
    expect(ruleAndEffect(assessment.reasons)).toEqual(ruleAndEffect(p.expected_reasons));
    expect(assessment.disclosures.map((d) => d.finding_id).sort()).toEqual([...p.expected_disclosures].sort());
  });

  it("Mr Lee is suitable once the PPM backs the screen, citing the PPM", () => {
    const lee = v2.find((p) => p.profile.client_id === "persona-lee")!.profile;
    const s5 = assessSuitability(lee, larkspurV2Attributes, v2Findings).reasons.find((r) => r.rule === "S5");

    expect(s5).toMatchObject({ effect: "meets", citation: { document_id: "ppm", quote: "3.6 The Fund excludes companies that derive revenue from fossil fuels." } });
  });
});
