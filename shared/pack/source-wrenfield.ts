import type { Persona } from "../src";
import type { PackSource } from "./build";
import { PERSONAS } from "./personas";
import type { SourceDocument } from "./source";

// The Wrenfield Short Duration Fund (#39): a second fabricated product for the shelf, so advice that rules
// one product out can name another that fits. It is built to suit a cautious client who may need her
// money: one-year horizon, investment-grade only, daily dealing, no exit charge, income paid from income.
//
// Two planted findings: the factsheet states a lower management fee than the fee table, and the deck
// promises quarterly income without saying it is not guaranteed. Everything else agrees, and the factsheet
// and deck meet every product rule, so the pack raises no policy gap. Like Larkspur, it does not exist.

const PRODUCT = "Wrenfield Short Duration Fund";
const ISSUER = "Ashcombe Investment Partners Ltd";

const factsheet: SourceDocument = {
  document_id: "factsheet",
  kind: "factsheet",
  filename: "wrenfield-factsheet.pdf",
  title: `${PRODUCT} - Factsheet`,
  orientation: "portrait",
  pages: [
    [
      `# ${PRODUCT}`,
      "Factsheet - Share class A (USD) - 30 September 2026",
      `Issuer: ${ISSUER}`,
      "## Fund objective",
      "The Fund aims to preserve capital and provide income over a period of at least one year.",
      "## Investment approach",
      "The Fund invests only in investment-grade bonds with less than two years to maturity.",
      "The Fund does not use derivatives.",
      "## Key facts",
      "Launch date: 2 May 2023",
      "Base currency: US dollar",
      "Annual management fee: 0.30% per annum",
      "No entry or exit charges.",
      "Minimum initial investment: USD 500",
      "Dealing: daily, on any business day",
    ],
    [
      "## Risk and reward profile",
      "The Fund is not capital protected. You may get back less than you invest.",
      "The Fund is exposed to interest rate and credit risk.",
      "Distributions are not guaranteed.",
      "## Important information",
      "This factsheet is a summary. Read the private placement memorandum before investing.",
    ],
  ],
};

const ppm: SourceDocument = {
  document_id: "ppm",
  kind: "ppm",
  filename: "wrenfield-ppm-excerpt.pdf",
  title: `${PRODUCT} - Private Placement Memorandum (Excerpt)`,
  orientation: "portrait",
  pages: [
    [
      "# Private Placement Memorandum (Excerpt)",
      `${PRODUCT} - issued by ${ISSUER}`,
      "## Section 2. Investment objective and policy",
      "2.1 The Fund aims to preserve capital and provide income over a period of at least one year.",
      "2.2 The Fund invests only in investment-grade bonds with less than two years to maturity.",
      "2.3 The Fund does not use derivatives.",
    ],
    [
      "## Section 4. Risk factors",
      "4.1 The Fund is not capital protected. Investors may lose some of the amount invested.",
      "4.2 Distributions are not guaranteed and are paid only from income.",
      "4.3 The Fund is exposed to interest rate and credit risk.",
    ],
    [
      "## Section 6. Fees and dealing",
      "6.1 The annual management fee is 0.45% of the net asset value of the Fund.",
      "6.2 Units can be redeemed on any business day.",
      "6.3 Redemption requests received by 12:00 are dealt the same day.",
      "6.4 No redemption charge applies.",
      "6.5 The minimum initial investment is USD 500.",
    ],
  ],
};

const deck: SourceDocument = {
  document_id: "deck",
  kind: "deck",
  filename: "wrenfield-marketing-deck.pdf",
  title: `${PRODUCT} - Investor Presentation`,
  orientation: "landscape",
  pages: [
    [
      `# ${PRODUCT}`,
      `Your cash, working a little harder - ${ISSUER}`,
      "## Why Wrenfield",
      "Short-dated, investment-grade bonds.",
      "Your money back on any business day.",
    ],
    [
      "## Your income",
      "Income paid every quarter.",
      "Risks: interest rate and credit risk.",
      "Invest from USD 500.",
    ],
  ],
};

const feeTable: SourceDocument = {
  document_id: "fee-table",
  kind: "fee_table",
  filename: "wrenfield-fee-table.pdf",
  title: `${PRODUCT} - Schedule of Fees`,
  orientation: "portrait",
  pages: [
    [
      "# Schedule of Fees",
      `${PRODUCT} - Share class A (USD)`,
      "## Charges taken from your investment",
      "Entry charge: none",
      "Redemption charge: none",
      "## Charges taken from the Fund over a year",
      "Annual management fee: 0.45% of net asset value",
      "Performance fee: none",
      "Transaction costs are charged to the Fund as they are incurred.",
    ],
  ],
};

const DISCLOSED = ["wrenfield-fees-management-fee"];

// The same three clients, judged on Wrenfield.
const EXPECTED: Record<string, Pick<Persona, "expected_verdict" | "expected_reasons">> = {
  // One year against her two; level 2 against her 2; income only from income; daily dealing, same day,
  // no charge: everything Larkspur failed her on, this fund meets.
  "persona-chan": {
    expected_verdict: "suitable",
    expected_reasons: [
      { rule: "S1", effect: "meets" },
      { rule: "S2", effect: "meets" },
      { rule: "S3", effect: "meets" },
      { rule: "S4", effect: "meets" },
    ],
  },
  // Nothing in the pack screens out fossil fuels.
  "persona-lee": {
    expected_verdict: "not_suitable",
    expected_reasons: [
      { rule: "S1", effect: "meets" },
      { rule: "S2", effect: "meets" },
      { rule: "S5", effect: "blocks" },
    ],
  },
  "persona-wong": {
    expected_verdict: "suitable",
    expected_reasons: [
      { rule: "S1", effect: "meets" },
      { rule: "S2", effect: "meets" },
    ],
  },
};

export const WRENFIELD: PackSource = {
  packId: "wrenfield-v1",
  product: PRODUCT,
  issuer: ISSUER,
  footer:
    `Fictional document created for a software demonstration. ${ISSUER} and the ${PRODUCT} do not exist. ` +
    "Nothing in this document is an offer or investment advice.",
  documents: [factsheet, ppm, deck, feeTable],
  groundTruth: [
    {
      id: "wrenfield-fees-management-fee",
      category: "fees",
      kind: "contradiction",
      summary: "The factsheet states a 0.30% management fee; the fee table states 0.45%.",
      citation: { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.30% per annum" },
      counterpart: { document_id: "fee-table", page: 1, quote: "Annual management fee: 0.45% of net asset value" },
    },
    {
      id: "wrenfield-income-not-guaranteed",
      category: "risk",
      kind: "disclosure_gap",
      summary: "The deck promises quarterly income without saying, as the PPM does, that distributions are not guaranteed.",
      citation: { document_id: "deck", page: 2, quote: "Income paid every quarter." },
      counterpart: { document_id: "ppm", page: 2, quote: "4.2 Distributions are not guaranteed and are paid only from income." },
    },
  ],
  personas: PERSONAS.map((p) => ({ ...p, ...EXPECTED[p.profile.client_id]!, expected_disclosures: DISCLOSED })),
};
