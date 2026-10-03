// The real Larkspur pack for HTTP tests, and a fake model that answers every step on it: the four-step
// pipeline raising the two fee findings, and attributes as a correct model reads them.
import type { IngestedDocument, StepName } from "@qryvox/shared";
import { DOCUMENTS } from "@qryvox/shared/pack-source";
import { ATTRIBUTES_SYSTEM_PROMPT } from "../src/steps/attributes";
import { COMPLIANCE_SYSTEM_PROMPT } from "../src/steps/compliance";
import { EXPLAIN_SYSTEM_PROMPT } from "../src/steps/explain";
import { CONTRADICTIONS_SYSTEM_PROMPT } from "../src/steps/contradictions";
import { DECOMPOSE_SYSTEM_PROMPT } from "../src/steps/decompose";
import { EXTRACT_SYSTEM_PROMPT } from "../src/steps/extract";
import { FINDINGS_SYSTEM_PROMPT } from "../src/steps/findings";
import type { ChatMessage } from "../src/llm";
import { FakeLlm } from "./helpers";

// The real Larkspur pack, page text as the source writes it, so the canned reply quotes real passages.
export const pack: IngestedDocument[] = DOCUMENTS.map((d, i) => ({
  document_id: d.document_id,
  sha256: String(i).repeat(64),
  filename: d.filename,
  kind: d.kind,
  page_count: d.pages.length,
  pages: d.pages.map((lines) => lines.join("\n")),
  pdfjs_version: "5.0.0",
}));

const ppm = (page: number, quote: string) => ({ document_id: "ppm", page, quote });
export const deckScreen = { document_id: "deck", page: 1, quote: "Every holding is screened to exclude fossil fuel companies." };

// What a correct model answers for Larkspur.
export const ATTRIBUTES_REPLY = {
  min_holding_years: { value: 5, citation: ppm(1, "3.1 The Fund aims to provide a regular income with the potential for modest capital growth over at least five years.") },
  sub_investment_grade_max_pct: { value: 40, citation: ppm(1, "3.3 The Fund may invest up to 40% of its net assets in sub-investment-grade bonds.") },
  capital_protected: { value: false, citation: ppm(2, "5.1 The Fund is not capital protected. Investors may lose some or all of the amount invested.") },
  distributions_may_use_capital: { value: true, citation: ppm(2, "5.2 Distributions are not guaranteed and may be paid out of capital.") },
  dealing_frequency: { value: "monthly", citation: ppm(3, "7.3 Redemptions are processed monthly, on the last business day of each month.") },
  redemption_notice_days: { value: 30, citation: ppm(3, "7.4 Redemption requests must be received at least 30 calendar days before the dealing day.") },
  exit_charge_within_months: { value: 24, citation: ppm(3, "7.2 A redemption charge of 2.00% applies to units redeemed within 24 months of purchase.") },
  derivatives_use: { value: "hedging", citation: ppm(1, "3.5 The Fund may use derivatives for hedging purposes only.") },
  exclusion_screens: [{ exclusion: "fossil_fuels", citation: deckScreen }],
  primary_objective: {
    value: "income",
    citation: ppm(1, "3.1 The Fund aims to provide a regular income with the potential for modest capital growth over at least five years."),
  },
  product_name: {
    value: "Larkspur Global Income Fund",
    citation: ppm(1, "Larkspur Global Income Fund - issued by Calderhaven Asset Management Ltd"),
  },
};
const managementFee = { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.85% per annum" };
const feeTableFee = { document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value" };
const noExitCharge = { document_id: "deck", page: 2, quote: "No entry or exit charges." };
const redemptionCharge = {
  document_id: "fee-table",
  page: 1,
  quote: "Redemption charge: 2.00% on units redeemed within 24 months of purchase",
};

// The passages the policy gaps rest on (#25): where the factsheet falls short, and what the PPM says.
const ratesRisk = { document_id: "factsheet", page: 2, quote: "Bond prices generally fall when interest rates rise." };
const ppmRisks = { document_id: "ppm", page: 2, quote: "5.4 The Fund is exposed to interest rate, credit and currency risk." };
const minimum = { document_id: "factsheet", page: 1, quote: "Minimum initial investment: USD 1,000" };
const ppmExit = { document_id: "ppm", page: 3, quote: "7.2 A redemption charge of 2.00% applies to units redeemed within 24 months of purchase." };
const canFall = { document_id: "factsheet", page: 2, quote: "The value of investments and the income from them can fall as well as rise." };
const ppmNotProtected = {
  document_id: "ppm",
  page: 2,
  quote: "5.1 The Fund is not capital protected. Investors may lose some or all of the amount invested.",
};

// Two fees findings on the board: the management fee stated two ways, and the exit charge the deck denies.
// A compliance run adds three policy gaps on the factsheet (P1, P2, P3).
const PIPELINE = {
  extract: {
    statements: [managementFee, feeTableFee, noExitCharge, redemptionCharge, ratesRisk, ppmRisks, minimum, ppmExit, canFall, ppmNotProtected],
  },
  decompose: {
    claims: [
      { id: "c1", ...managementFee, category: "fees", topic: "management fee", assertion: "management fee is 0.85% a year" },
      { id: "c2", ...feeTableFee, category: "fees", topic: "management fee", assertion: "management fee is 1.25% of NAV" },
      { id: "c3", ...noExitCharge, category: "fees", topic: "exit charge", assertion: "there is no exit charge" },
      { id: "c4", ...redemptionCharge, category: "fees", topic: "exit charge", assertion: "2.00% within 24 months" },
      { id: "c5", ...ratesRisk, category: "risk", topic: "interest rate risk", assertion: "bond prices fall when rates rise" },
      { id: "c6", ...ppmRisks, category: "risk", topic: "risk factors", assertion: "exposed to interest rate, credit and currency risk" },
      { id: "c7", ...minimum, category: "terms", topic: "minimum investment", assertion: "minimum USD 1,000" },
      { id: "c8", ...ppmExit, category: "fees", topic: "exit charge", assertion: "2.00% within 24 months" },
      { id: "c9", ...canFall, category: "risk", topic: "capital", assertion: "value can fall as well as rise" },
      { id: "c10", ...ppmNotProtected, category: "risk", topic: "capital protection", assertion: "not capital protected" },
    ],
  },
  contradictions: {
    issues: [
      { kind: "contradiction", category: "fees", claim_id: "c1", counterpart_claim_id: "c2", explanation: "0.85% against 1.25%." },
      { kind: "contradiction", category: "fees", claim_id: "c3", counterpart_claim_id: "c4", explanation: "No exit charge against 2.00%." },
    ],
  },
  findings: {
    findings: [
      { issue: 1, severity: "high", claim: "The factsheet states a 0.85% management fee; the fee table states 1.25%." },
      { issue: 2, severity: "high", claim: "The deck promises no exit charges; the fee table charges 2.00% within 24 months." },
    ],
  },
  compliance: {
    gaps: [
      { rule: "P1", claim_id: "c5", counterpart_claim_id: "c6", explanation: "The factsheet omits the credit risk the PPM lists." },
      { rule: "P2", claim_id: "c9", counterpart_claim_id: "c10", explanation: "The factsheet does not say the fund is not capital protected." },
      { rule: "P3", claim_id: "c7", counterpart_claim_id: "c8", explanation: "The factsheet's key facts omit the 2.00% exit charge." },
    ],
  },
  attributes: ATTRIBUTES_REPLY,
} satisfies Record<Exclude<StepName, "explain" | "parse">, unknown>;

const PROMPTS: [string, Exclude<StepName, "parse">][] = [
  [EXTRACT_SYSTEM_PROMPT, "extract"],
  [DECOMPOSE_SYSTEM_PROMPT, "decompose"],
  [CONTRADICTIONS_SYSTEM_PROMPT, "contradictions"],
  [FINDINGS_SYSTEM_PROMPT, "findings"],
  [COMPLIANCE_SYSTEM_PROMPT, "compliance"],
  [ATTRIBUTES_SYSTEM_PROMPT, "attributes"],
  [EXPLAIN_SYSTEM_PROMPT, "explain"],
];

// An explanation depends on the advice it explains, so a test that runs explain says how to answer.
export function larkspurLlm(explain: (messages: ChatMessage[]) => unknown = () => ({})) {
  return new FakeLlm((messages) => {
    // By its start: a step's system prompt may carry a note after it (the client's language, #43).
    const step = PROMPTS.find(([prompt]) => messages[0]?.content.startsWith(prompt))?.[1];
    if (!step) throw new Error("unknown prompt");
    return JSON.stringify(step === "explain" ? explain(messages) : PIPELINE[step]);
  });
}
