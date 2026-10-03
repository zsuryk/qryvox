import type { DocumentKind, GroundTruthEntry } from "../src";

// The fabricated pack, authored as text. scripts/generate-pack.ts renders it to PDFs and writes the
// manifest and ground truth from this one source, so the answer key cannot drift from the documents.
//
// Line markup: "# " title, "## " heading, anything else body text. Every ground-truth quote must be a
// whole body line on its cited page; the generator refuses to wrap one, so pdf.js extracts it intact.
// Everything that is not planted must agree across documents — an accidental contradiction costs precision.

export type SourceDocument = {
  document_id: string;
  kind: DocumentKind;
  filename: string;
  title: string;
  orientation: "portrait" | "landscape";
  pages: string[][];
};

export const PACK_ID = "larkspur-v1";
export const PRODUCT = "Larkspur Global Income Fund";
export const ISSUER = "Calderhaven Asset Management Ltd";

export const FOOTER =
  "Fictional document created for a software demonstration. Calderhaven Asset Management Ltd and the " +
  "Larkspur Global Income Fund do not exist. Nothing in this document is an offer or investment advice.";

const factsheet: SourceDocument = {
  document_id: "factsheet",
  kind: "factsheet",
  filename: "larkspur-factsheet.pdf",
  title: "Larkspur Global Income Fund - Factsheet",
  orientation: "portrait",
  pages: [
    [
      "# Larkspur Global Income Fund",
      "Factsheet - Share class A (USD) - 30 September 2026",
      "Issuer: Calderhaven Asset Management Ltd",
      "## Fund objective",
      "The Fund aims to provide a regular income with the potential for modest capital growth over a period of at least five years.",
      "## Investment approach",
      "The Fund invests only in investment-grade bonds.",
      "Holdings are diversified across government and corporate issuers in developed markets.",
      "## Key facts",
      "Launch date: 14 March 2022",
      "Base currency: US dollar",
      "Annual management fee: 0.85% per annum",
      "Minimum initial investment: USD 1,000",
      "Dealing: daily, on any business day",
    ],
    [
      "## Risk and reward profile",
      "The value of investments and the income from them can fall as well as rise.",
      "Bond prices generally fall when interest rates rise.",
      "Currency movements may affect the value of holdings not denominated in US dollars.",
      "## Important information",
      "This factsheet is a summary. Read the private placement memorandum before investing.",
    ],
  ],
};

const ppm: SourceDocument = {
  document_id: "ppm",
  kind: "ppm",
  filename: "larkspur-ppm-excerpt.pdf",
  title: "Larkspur Global Income Fund - Private Placement Memorandum (Excerpt)",
  orientation: "portrait",
  pages: [
    [
      "# Private Placement Memorandum (Excerpt)",
      "Larkspur Global Income Fund - issued by Calderhaven Asset Management Ltd",
      "## Section 3. Investment objective and policy",
      "3.1 The Fund aims to provide a regular income with the potential for modest capital growth over at least five years.",
      "3.2 The Fund invests primarily in bonds issued by governments and companies in developed markets.",
      "3.3 The Fund may invest up to 40% of its net assets in sub-investment-grade bonds.",
      "3.4 Securities are selected by the investment manager's credit committee.",
      "3.5 The Fund may use derivatives for hedging purposes only.",
    ],
    [
      "## Section 5. Risk factors",
      "5.1 The Fund is not capital protected. Investors may lose some or all of the amount invested.",
      "5.2 Distributions are not guaranteed and may be paid out of capital.",
      "5.3 Sub-investment-grade bonds carry a higher risk of default than investment-grade bonds.",
      "5.4 The Fund is exposed to interest rate, credit and currency risk.",
    ],
    [
      "## Section 7. Fees and dealing",
      "7.1 The annual management fee is 1.25% of the net asset value of the Fund.",
      "7.2 A redemption charge of 2.00% applies to units redeemed within 24 months of purchase.",
      "7.3 Redemptions are processed monthly, on the last business day of each month.",
      "7.4 Redemption requests must be received at least 30 calendar days before the dealing day.",
      "7.5 The minimum initial investment is USD 1,000.",
    ],
  ],
};

const deck: SourceDocument = {
  document_id: "deck",
  kind: "deck",
  filename: "larkspur-marketing-deck.pdf",
  title: "Larkspur Global Income Fund - Investor Presentation",
  orientation: "landscape",
  pages: [
    [
      "# Larkspur Global Income Fund",
      "Income for the next chapter - Calderhaven Asset Management",
      "## Why Larkspur",
      "A diversified portfolio of government and corporate bonds.",
      "Every holding is screened to exclude fossil fuel companies.",
    ],
    [
      "## Your income",
      "Target income of 6% a year, paid every month.",
      "Simple, transparent pricing.",
      "No entry or exit charges.",
    ],
    [
      "## Getting started",
      "Invest from USD 1,000.",
      "Speak to your adviser or platform to find out more.",
    ],
  ],
};

const feeTable: SourceDocument = {
  document_id: "fee-table",
  kind: "fee_table",
  filename: "larkspur-fee-table.pdf",
  title: "Larkspur Global Income Fund - Schedule of Fees",
  orientation: "portrait",
  pages: [
    [
      "# Schedule of Fees",
      "Larkspur Global Income Fund - Share class A (USD)",
      "## Charges taken from your investment",
      "Entry charge: none",
      "Redemption charge: 2.00% on units redeemed within 24 months of purchase",
      "## Charges taken from the Fund over a year",
      "Annual management fee: 1.25% of net asset value",
      "Performance fee: none",
      "Transaction costs are charged to the Fund as they are incurred.",
    ],
  ],
};

export const DOCUMENTS: SourceDocument[] = [factsheet, ppm, deck, feeTable];

export const GROUND_TRUTH: GroundTruthEntry[] = [
  {
    id: "fees-management-fee",
    category: "fees",
    kind: "contradiction",
    summary: "The factsheet states a 0.85% management fee; the fee table and PPM state 1.25%.",
    citation: { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.85% per annum" },
    counterpart: { document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value" },
  },
  {
    id: "fees-exit-charge",
    category: "fees",
    kind: "contradiction",
    summary: "The deck promises no exit charges; the fee table charges 2.00% on redemptions within 24 months.",
    citation: { document_id: "deck", page: 2, quote: "No entry or exit charges." },
    counterpart: {
      document_id: "fee-table",
      page: 1,
      quote: "Redemption charge: 2.00% on units redeemed within 24 months of purchase",
    },
  },
  {
    id: "strategy-credit-quality",
    category: "strategy",
    kind: "contradiction",
    summary: "The factsheet says investment-grade only; the PPM allows up to 40% sub-investment-grade.",
    citation: { document_id: "factsheet", page: 1, quote: "The Fund invests only in investment-grade bonds." },
    counterpart: {
      document_id: "ppm",
      page: 1,
      quote: "3.3 The Fund may invest up to 40% of its net assets in sub-investment-grade bonds.",
    },
  },
  {
    id: "strategy-fossil-fuel-screen",
    category: "strategy",
    kind: "unsupported_claim",
    summary: "The deck claims a fossil fuel exclusion screen; the PPM investment policy describes no such screen.",
    citation: { document_id: "deck", page: 1, quote: "Every holding is screened to exclude fossil fuel companies." },
    counterpart: null,
  },
  {
    id: "risk-income-not-guaranteed",
    category: "risk",
    kind: "disclosure_gap",
    summary:
      "The deck promises monthly income with no risk warning; the PPM says distributions are not guaranteed and may come from capital.",
    citation: { document_id: "deck", page: 2, quote: "Target income of 6% a year, paid every month." },
    counterpart: { document_id: "ppm", page: 2, quote: "5.2 Distributions are not guaranteed and may be paid out of capital." },
  },
  {
    id: "terms-dealing-frequency",
    category: "terms",
    kind: "contradiction",
    summary: "The factsheet offers daily dealing; the PPM processes redemptions monthly with 30 days of notice.",
    citation: { document_id: "factsheet", page: 1, quote: "Dealing: daily, on any business day" },
    counterpart: {
      document_id: "ppm",
      page: 3,
      quote: "7.3 Redemptions are processed monthly, on the last business day of each month.",
    },
  },

  // Policy gaps (#25): where a document falls short of the institution's product rules (rules@1), one
  // entry per document per rule. Cited like a disclosure gap: the passage where the missing text belongs,
  // and the PPM passage it should have carried. P4 also applies to the deck's income promise, but that
  // passage is already the planted disclosure gap above; the compliance step raises no second finding on
  // a claim already raised, so P4 adds no entry of its own.
  {
    id: "policy-factsheet-credit-risk",
    category: "risk",
    kind: "policy_gap",
    rule: "P1",
    summary: "The factsheet's risk section names interest-rate and currency risk but not the credit risk the PPM lists.",
    citation: { document_id: "factsheet", page: 2, quote: "Bond prices generally fall when interest rates rise." },
    counterpart: { document_id: "ppm", page: 2, quote: "5.4 The Fund is exposed to interest rate, credit and currency risk." },
  },
  {
    id: "policy-deck-risk-types",
    category: "risk",
    kind: "policy_gap",
    rule: "P1",
    summary: "The deck names none of the interest-rate, credit and currency risks the PPM lists.",
    citation: { document_id: "deck", page: 1, quote: "A diversified portfolio of government and corporate bonds." },
    counterpart: { document_id: "ppm", page: 2, quote: "5.4 The Fund is exposed to interest rate, credit and currency risk." },
  },
  {
    id: "policy-factsheet-capital-protection",
    category: "risk",
    kind: "policy_gap",
    rule: "P2",
    summary: "The factsheet does not say the fund is not capital protected, as the PPM does.",
    citation: { document_id: "factsheet", page: 2, quote: "The value of investments and the income from them can fall as well as rise." },
    counterpart: {
      document_id: "ppm",
      page: 2,
      quote: "5.1 The Fund is not capital protected. Investors may lose some or all of the amount invested.",
    },
  },
  {
    id: "policy-factsheet-exit-charge",
    category: "fees",
    kind: "policy_gap",
    rule: "P3",
    summary: "The factsheet's key facts list no exit charge, though the PPM charges 2.00% on redemptions within 24 months.",
    citation: { document_id: "factsheet", page: 1, quote: "Minimum initial investment: USD 1,000" },
    counterpart: {
      document_id: "ppm",
      page: 3,
      quote: "7.2 A redemption charge of 2.00% applies to units redeemed within 24 months of purchase.",
    },
  },
];
