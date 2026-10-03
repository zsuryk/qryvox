import { ClientProfile, SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import {
  adviceView,
  answersFor,
  answerText,
  blankProfile,
  factLines,
  newClientId,
  productFacts,
  profileSummary,
  RISK_QUESTIONS,
  riskLevelFrom,
} from "../lib/advice";

const events = SlimEvent.array().parse(recorded);

const chan: ClientProfile = {
  client_id: "persona-chan",
  goal: "income",
  horizon_years: 2,
  risk_level: 2,
  knowledge: "novice",
  relies_on_income: true,
  may_need_cash_at_short_notice: true,
  exclusions: [],
};

describe("the advice view", () => {
  it("on a verified case whose facts have not been read, says that is what blocks drafting", () => {
    const view = adviceView(events);
    expect(view.verified).toBe(true);
    expect(view.facts).toBeNull();
    expect(view.clients).toEqual([]);
    expect(view.blocked).toMatch(/facts have not been read/);
  });

  it("before the pack is verified, sends the analyst to the Review tab", () => {
    const opened = events.filter((e) => e.seq <= 5);
    expect(adviceView(opened).blocked).toMatch(/Review tab/);
  });

  it("reads the product's facts off the latest completed attributes run, with where each was read", () => {
    const seq = events.length + 1;
    const run = SlimEvent.parse({
      seq,
      event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      case_id: events[0]!.case_id,
      actor: "demo-analyst",
      at: "2026-10-03T12:00:00.000Z",
      step_run_id: "run-attributes",
      type: "step.completed",
      v: 1,
      payload: {
        step: "attributes",
        model: "fake",
        prompt_version: "attributes@1",
        input_run_id: null,
        output: {
          min_holding_years: { value: 1, citation: { document_id: "ppm", page: 1, quote: "at least one year" } },
          sub_investment_grade_max_pct: { value: 0, citation: { document_id: "ppm", page: 1, quote: "investment-grade" } },
          capital_protected: { value: false, citation: { document_id: "ppm", page: 2, quote: "not capital protected" } },
          distributions_may_use_capital: { value: false, citation: { document_id: "ppm", page: 2, quote: "only from income" } },
          dealing_frequency: { value: "daily", citation: { document_id: "ppm", page: 3, quote: "any business day" } },
          redemption_notice_days: { value: 0, citation: { document_id: "ppm", page: 3, quote: "the same day" } },
          exit_charge_within_months: { value: 0, citation: { document_id: "ppm", page: 3, quote: "No redemption charge" } },
          derivatives_use: { value: "none", citation: { document_id: "ppm", page: 1, quote: "does not use derivatives" } },
          exclusion_screens: [],
        },
      },
    });
    const facts = productFacts([...events, run]);

    expect(facts).toMatchObject({ runId: "run-attributes", riskLevel: 2 });
    expect(factLines(facts!.attributes)[0]).toEqual({ label: "Hold for at least", value: "1 year", where: "ppm p1" });
    expect(adviceView([...events, run]).blocked).toBeNull();
  });
});

describe("the risk questionnaire", () => {
  it("produces nothing until every question is answered, then the rounded mean of the answers", () => {
    expect(riskLevelFrom([0, 1, null])).toBeNull();
    expect(riskLevelFrom([0, 0, 0])).toBe(1);
    expect(riskLevelFrom([1, 1, 2])).toBe(2);
    expect(riskLevelFrom([4, 4, 4])).toBe(5);
  });

  it("can be filled to give any level back, for a profile loaded from elsewhere", () => {
    for (const level of [1, 2, 3, 4, 5]) expect(riskLevelFrom(answersFor(level))).toBe(level);
    expect(RISK_QUESTIONS.every((q) => q.options.length === 5)).toBe(true);
  });
});

describe("a client, in words", () => {
  it("is known by a pseudonymous id the contract accepts, never a name", () => {
    for (let i = 0; i < 20; i += 1) expect(ClientProfile.safeParse(blankProfile(newClientId())).success).toBe(true);
  });

  it("says each answer the way an adviser would say it back", () => {
    expect(answerText(chan, "horizon_years")).toBe("2 years");
    expect(answerText({ ...chan, horizon_years: 1 }, "horizon_years")).toBe("1 year");
    expect(answerText(chan, "may_need_cash_at_short_notice")).toBe("May need the money at short notice");
    expect(answerText({ ...chan, exclusions: ["fossil_fuels"] }, "exclusions")).toBe("Excludes fossil fuels");
    expect(profileSummary(chan)).toEqual(["Income", "2 years", "Risk level 2 of 5", "New to investing", "Relies on the income", "May need cash quickly"]);
  });
});
