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
  primary_objective: {
    value: "income",
    citation: ppm(1, "3.1 The Fund aims to provide a regular income with the potential for modest capital growth over at least five years."),
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

// The Wrenfield Short Duration Fund (#39), as a correct attributes run reads its PPM.
export const wrenfieldAttributes = ProductAttributes.parse({
  min_holding_years: { value: 1, citation: ppm(1, "2.1 The Fund aims to preserve capital and provide income over a period of at least one year.") },
  sub_investment_grade_max_pct: { value: 0, citation: ppm(1, "2.2 The Fund invests only in investment-grade bonds with less than two years to maturity.") },
  capital_protected: { value: false, citation: ppm(2, "4.1 The Fund is not capital protected. Investors may lose some of the amount invested.") },
  distributions_may_use_capital: { value: false, citation: ppm(2, "4.2 Distributions are not guaranteed and are paid only from income.") },
  dealing_frequency: { value: "daily", citation: ppm(3, "6.2 Units can be redeemed on any business day.") },
  redemption_notice_days: { value: 0, citation: ppm(3, "6.3 Redemption requests received by 12:00 are dealt the same day.") },
  exit_charge_within_months: { value: 0, citation: ppm(3, "6.4 No redemption charge applies.") },
  derivatives_use: { value: "none", citation: ppm(1, "2.3 The Fund does not use derivatives.") },
  primary_objective: { value: "preservation", citation: ppm(1, "2.1 The Fund aims to preserve capital and provide income over a period of at least one year.") },
  exclusion_screens: [],
  product_name: { value: "Wrenfield Short Duration Fund", citation: ppm(1, "Wrenfield Short Duration Fund - issued by Ashcombe Investment Partners Ltd") },
});
