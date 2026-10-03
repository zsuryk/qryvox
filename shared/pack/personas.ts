import type { Persona } from "../src";

// Three fabricated clients and the advice the rules (rules@2) should give each on the Larkspur pack (#20). Like the
// product, none of them exists. Every fees and terms finding is open, so all three are told the same four
// things (S6), the factsheet's missing exit charge among them; what differs is the verdict.
const DISCLOSED = ["fees-management-fee", "fees-exit-charge", "terms-dealing-frequency", "policy-factsheet-exit-charge"];

export const PERSONAS: Persona[] = [
  {
    name: "Mrs Chan",
    summary: "Retired, cautious, needs the monthly income and may need the money at short notice; new to investing.",
    profile: {
      client_id: "persona-chan",
      goal: "income",
      horizon_years: 2,
      risk_level: 2,
      knowledge: "novice",
      relies_on_income: true,
      may_need_cash_at_short_notice: true,
      exclusions: [],
      aged_65_or_over: true,
    },
    expected_verdict: "not_suitable",
    expected_reasons: [
      // Two years against a five-year minimum (PPM 3.1).
      { rule: "S1", effect: "blocks" },
      // Risk level 2 against the product's 3 (up to 40% sub-investment-grade, PPM 3.3).
      { rule: "S2", effect: "blocks" },
      // Distributions may be paid out of capital (PPM 5.2).
      { rule: "S3", effect: "warns" },
      // Monthly dealing, 30 days' notice, 2.00% within 24 months (PPM 7.3, 7.4, 7.2).
      { rule: "S4", effect: "blocks" },
      { rule: "S4", effect: "blocks" },
      { rule: "S4", effect: "blocks" },      // Income, which is what Larkspur is built for (PPM 3.1).
      { rule: "S7", effect: "meets" },
    ],
    expected_disclosures: DISCLOSED,
  },
  {
    name: "Mr Lee",
    summary: "In his forties, investing for growth over ten years, comfortable with risk, and excludes fossil fuels.",
    profile: {
      client_id: "persona-lee",
      goal: "growth",
      horizon_years: 10,
      risk_level: 4,
      knowledge: "informed",
      relies_on_income: false,
      may_need_cash_at_short_notice: false,
      exclusions: ["fossil_fuels"],
    },
    expected_verdict: "conditional",
    expected_reasons: [
      { rule: "S1", effect: "meets" },
      { rule: "S2", effect: "meets" },
      // The fossil fuel screen is only in the deck; the PPM does not back it.
      { rule: "S5", effect: "conditional" },      // Growth, where Larkspur is built mainly for income: told, not blocked.
      { rule: "S7", effect: "warns" },
    ],
    expected_disclosures: DISCLOSED,
  },
  {
    name: "Ms Wong",
    summary: "An experienced investor with a six-year horizon, a moderate risk level and no exclusions.",
    profile: {
      client_id: "persona-wong",
      goal: "income",
      horizon_years: 6,
      risk_level: 3,
      knowledge: "expert",
      relies_on_income: false,
      may_need_cash_at_short_notice: false,
      exclusions: [],
    },
    expected_verdict: "suitable",
    expected_reasons: [
      { rule: "S1", effect: "meets" },
      { rule: "S2", effect: "meets" },      { rule: "S7", effect: "meets" },
    ],
    expected_disclosures: DISCLOSED,
  },
];
