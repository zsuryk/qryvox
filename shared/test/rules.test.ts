import { describe, expect, it } from "vitest";
import { activeFindings, fold, ruleById, RULES, RULES_VERSION, SlimEvent } from "../src";
import recorded from "../fixtures/case-recorded.json";

const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;
const findingsRun = events.filter((e) => e.type === "finding.created").at(-1)!.step_run_id!;

// A policy_gap appended to the recorded stream at the next free seq, as a findings run would write it.
function policyGap(extra: Record<string, unknown> = {}) {
  const seq = events.length + 1;
  return {
    seq,
    event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    case_id: caseId,
    actor: "demo-analyst",
    at: "2026-10-03T12:00:00.000Z",
    step_run_id: findingsRun,
    type: "finding.created",
    v: 1,
    payload: {
      finding_id: "policy-credit-risk",
      category: "risk",
      kind: "policy_gap",
      severity: "medium",
      claim: "The factsheet names interest-rate and currency risk but not the credit risk the PPM lists.",
      citation: { document_id: "factsheet", page: 2, quote: "Bond prices generally fall when interest rates rise." },
      counterpart: { document_id: "ppm", page: 2, quote: "5.4 The Fund is exposed to interest rate, credit and currency risk." },
      rule: "P1",
      ...extra,
    },
  };
}

describe("the rules", () => {
  it("is one versioned set: unique ids, each in the group its prefix names", () => {
    expect(RULES_VERSION).toBe("rules@2");
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const rule of RULES) {
      expect(rule.group).toBe(rule.id.startsWith("P") ? "product" : "suitability");
    }
    expect(RULES.filter((r) => r.group === "product").map((r) => r.id)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(RULES.filter((r) => r.group === "suitability").map((r) => r.id)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
  });

  it("looks a rule up by id", () => {
    expect(ruleById("S1").title).toBe("Long enough horizon");
  });
});

describe("policy_gap findings", () => {
  it("fold onto the board like any other kind, naming the rule they break", () => {
    const state = fold([...events, SlimEvent.parse(policyGap())]);
    const gap = activeFindings(state).find((f) => f.finding_id === "policy-credit-risk");

    expect(gap).toMatchObject({ kind: "policy_gap", rule: "P1", supersededAtSeq: null });
  });

  it("leave stage-1 findings, which name no rule, parsing as before", () => {
    expect(activeFindings(fold(events)).every((f) => f.rule === undefined)).toBe(true);
  });

  it("name a product rule, never a suitability rule", () => {
    expect(SlimEvent.safeParse(policyGap({ rule: "S1" })).success).toBe(false);
  });
});
