import { ProductAttributes } from "../src";

// Larkspur's attributes as a correct attributes run would return them: every value the PPM states, quoted
// verbatim from the pack source with its page, and the fossil fuel screen only the deck claims.
const ppm = (page: number, quote: string) => ({ document_id: "ppm", page, quote });

export const larkspurAttributes = ProductAttributes.parse({
  min_holding_years: {
    value: 5,
    citation: ppm(1, "3.1 The Fund aims to provide a regular income with the potential for modest capital growth over at least five years."),
  },
  sub_investment_grade_max_pct: {
    value: 40,
    citation: ppm(1, "3.3 The Fund may invest up to 40% of its net assets in sub-investment-grade bonds."),
  },
  capital_protected: {
    value: false,
    citation: ppm(2, "5.1 The Fund is not capital protected. Investors may lose some or all of the amount invested."),
  },
  distributions_may_use_capital: {
    value: true,
    citation: ppm(2, "5.2 Distributions are not guaranteed and may be paid out of capital."),
  },
  dealing_frequency: {
    value: "monthly",
    citation: ppm(3, "7.3 Redemptions are processed monthly, on the last business day of each month."),
  },
  redemption_notice_days: {
    value: 30,
    citation: ppm(3, "7.4 Redemption requests must be received at least 30 calendar days before the dealing day."),
  },
  exit_charge_within_months: {
    value: 24,
    citation: ppm(3, "7.2 A redemption charge of 2.00% applies to units redeemed within 24 months of purchase."),
  },
  derivatives_use: {
    value: "hedging",
    citation: ppm(1, "3.5 The Fund may use derivatives for hedging purposes only."),
  },
  exclusion_screens: [
    {
      exclusion: "fossil_fuels",
      backed_by_ppm: false,
      citation: { document_id: "deck", page: 1, quote: "Every holding is screened to exclude fossil fuel companies." },
    },
  ],
});

// v2 (#37): the same, except the PPM now backs the fossil fuel screen (clause 3.6).
export const larkspurV2Attributes = ProductAttributes.parse({
  ...larkspurAttributes,
  exclusion_screens: [
    {
      exclusion: "fossil_fuels",
      backed_by_ppm: true,
      citation: ppm(1, "3.6 The Fund excludes companies that derive revenue from fossil fuels."),
    },
  ],
});
