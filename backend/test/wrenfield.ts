// The Wrenfield Short Duration Fund for HTTP tests (#39), and one fake model that answers for whichever
// of the two products a prompt is about, so both can be verified in one database and stand on one shelf.
import type { IngestedDocument, StepName } from "@qryvox/shared";
import { WRENFIELD } from "@qryvox/shared/pack-source-wrenfield";
import { ATTRIBUTES_SYSTEM_PROMPT } from "../src/steps/attributes";
import { CONTRADICTIONS_SYSTEM_PROMPT } from "../src/steps/contradictions";
import { DECOMPOSE_SYSTEM_PROMPT } from "../src/steps/decompose";
import { EXTRACT_SYSTEM_PROMPT } from "../src/steps/extract";
import { FINDINGS_SYSTEM_PROMPT } from "../src/steps/findings";
import { FakeLlm } from "./helpers";
import { larkspurLlm } from "./larkspur";

export const wrenfieldPack: IngestedDocument[] = WRENFIELD.documents.map((d) => ({
  document_id: d.document_id,
  sha256: "e".repeat(64),
  filename: d.filename,
  kind: d.kind,
  page_count: d.pages.length,
  pages: d.pages.map((lines) => lines.join("\n")),
  pdfjs_version: "5.0.0",
}));

const ppm = (page: number, quote: string) => ({ document_id: "ppm", page, quote });
const lowFee = { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.30% per annum" };
const tableFee = { document_id: "fee-table", page: 1, quote: "Annual management fee: 0.45% of net asset value" };
const income = { document_id: "deck", page: 2, quote: "Income paid every quarter." };
const notGuaranteed = ppm(2, "4.2 Distributions are not guaranteed and are paid only from income.");

const REPLIES = {
  extract: { statements: [lowFee, tableFee, income, notGuaranteed] },
  decompose: {
    claims: [
      { id: "w1", ...lowFee, category: "fees", topic: "management fee", assertion: "management fee is 0.30% a year" },
      { id: "w2", ...tableFee, category: "fees", topic: "management fee", assertion: "management fee is 0.45% of NAV" },
      { id: "w3", ...income, category: "risk", topic: "income", assertion: "income paid every quarter" },
      { id: "w4", ...notGuaranteed, category: "risk", topic: "income", assertion: "distributions not guaranteed" },
    ],
  },
  contradictions: {
    issues: [
      { kind: "contradiction", category: "fees", claim_id: "w1", counterpart_claim_id: "w2", explanation: "0.30% against 0.45%." },
      { kind: "disclosure_gap", category: "risk", claim_id: "w3", counterpart_claim_id: "w4", explanation: "Income promised without the warning." },
    ],
  },
  findings: {
    findings: [
      { issue: 1, severity: "high", claim: "The factsheet states a 0.30% management fee; the fee table states 0.45%." },
      { issue: 2, severity: "medium", claim: "The deck promises quarterly income without saying it is not guaranteed." },
    ],
  },
  attributes: {
    min_holding_years: { value: 1, citation: ppm(1, "2.1 The Fund aims to preserve capital and provide income over a period of at least one year.") },
    sub_investment_grade_max_pct: { value: 0, citation: ppm(1, "2.2 The Fund invests only in investment-grade bonds with less than two years to maturity.") },
    capital_protected: { value: false, citation: ppm(2, "4.1 The Fund is not capital protected. Investors may lose some of the amount invested.") },
    distributions_may_use_capital: { value: false, citation: notGuaranteed },
    dealing_frequency: { value: "daily", citation: ppm(3, "6.2 Units can be redeemed on any business day.") },
    redemption_notice_days: { value: 0, citation: ppm(3, "6.3 Redemption requests received by 12:00 are dealt the same day.") },
    exit_charge_within_months: { value: 0, citation: ppm(3, "6.4 No redemption charge applies.") },
    derivatives_use: { value: "none", citation: ppm(1, "2.3 The Fund does not use derivatives.") },
    exclusion_screens: [],
    product_name: { value: "Wrenfield Short Duration Fund", citation: ppm(1, "Wrenfield Short Duration Fund - issued by Ashcombe Investment Partners Ltd") },
  },
} satisfies Partial<Record<StepName, unknown>>;

const PROMPTS: [string, keyof typeof REPLIES][] = [
  [EXTRACT_SYSTEM_PROMPT, "extract"],
  [DECOMPOSE_SYSTEM_PROMPT, "decompose"],
  [CONTRADICTIONS_SYSTEM_PROMPT, "contradictions"],
  [FINDINGS_SYSTEM_PROMPT, "findings"],
  [ATTRIBUTES_SYSTEM_PROMPT, "attributes"],
];

// Wrenfield's prompts carry its name or its quotes; everything else is Larkspur's.
export function shelfLlm() {
  const larkspur = larkspurLlm();
  return new FakeLlm(async (messages) => {
    const about = messages.map((m) => m.content).join("\n");
    const step = PROMPTS.find(([prompt]) => messages[0]?.content === prompt)?.[1];
    if (step && /Wrenfield|0\.30%|Income paid every quarter/.test(about)) return JSON.stringify(REPLIES[step]);
    return (await larkspur.complete(messages)).content;
  });
}
