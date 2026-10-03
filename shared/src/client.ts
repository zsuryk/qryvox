import { z } from "zod";
import { Citation } from "./finding.js";

// The client layer (stage 2): who advice is for and what a product is, as far as suitability needs.
// Nothing here is computed. A profile is a client's own answers; attributes are read from the documents.

// ---------------------------------------------------------------------------------------------------------
// Client profile

export const ClientGoal = z.enum(["income", "growth", "preservation"]);
export type ClientGoal = z.infer<typeof ClientGoal>;

// Depth of explanation, as well as a suitability input.
export const KnowledgeLevel = z.enum(["novice", "informed", "expert"]);
export type KnowledgeLevel = z.infer<typeof KnowledgeLevel>;

export const Exclusion = z.enum(["fossil_fuels", "tobacco", "weapons"]);

// The language a client reads in (#43): their pages, and the explanation the explain step writes for them.
export const ClientLanguage = z.enum(["en", "zh-Hant"]);
export type ClientLanguage = z.infer<typeof ClientLanguage>;
export type Exclusion = z.infer<typeof Exclusion>;

// A client's answers, every one chosen with a control: no free text anywhere (README: zero text boxes).
// client_id is pseudonymous. Names and any other personal data never enter the event log, which cannot
// forget them; whatever identifies the person lives outside it (CONTEXT.md, "Client profile").
export const ClientProfile = z.object({
  client_id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "a pseudonymous id: lowercase letters, digits and dashes, not a name"),
  goal: ClientGoal,
  horizon_years: z.number().int().min(1).max(40),
  // From the risk questionnaire: 1 is the most cautious, 5 the most risk-tolerant.
  risk_level: z.number().int().min(1).max(5),
  knowledge: KnowledgeLevel,
  relies_on_income: z.boolean(),
  may_need_cash_at_short_notice: z.boolean(),
  exclusions: z.array(Exclusion),
  // A coarse band, not a birth date (data minimisation): whether the client is 65 or over, one of the
  // signs of a vulnerable client (#42). Optional, so answers recorded before it still parse.
  aged_65_or_over: z.boolean().optional(),
  // English unless the client chose otherwise; optional, so answers recorded before it still parse.
  language: ClientLanguage.optional(),
});
export type ClientProfile = z.infer<typeof ClientProfile>;

// A client who calls for extra care (#42): 65 or over, or new to investing while relying on the income.
// Their advice can be approved only once the adviser confirms they have explained it to them directly.
export function vulnerability(profile: ClientProfile): string[] {
  return [
    ...(profile.aged_65_or_over ? ["65 or over"] : []),
    ...(profile.knowledge === "novice" && profile.relies_on_income ? ["new to investing and relies on the income"] : []),
  ];
}

// The answers a reason can rest on (an advice reason names one).
export const ProfileField = ClientProfile.keyof().exclude(["client_id"]);
export type ProfileField = z.infer<typeof ProfileField>;

// ---------------------------------------------------------------------------------------------------------
// Product attributes

// One fact about the product with the passage it was read from, so every reason built on it can cite it.
const cited = <T extends z.ZodType>(value: T) => z.object({ value, citation: Citation });

export const DealingFrequency = z.enum(["daily", "weekly", "monthly", "quarterly"]);
export type DealingFrequency = z.infer<typeof DealingFrequency>;

export const DerivativesUse = z.enum(["none", "hedging", "investment"]);
export type DerivativesUse = z.infer<typeof DerivativesUse>;

// The attributes step's output: what suitability needs to know about one product, each value cited, the
// PPM preferred because it is the most authoritative document. Values are read, never computed: a
// percentage or a period is the one the document states.
export const ProductAttributes = z.object({
  min_holding_years: cited(z.number().int().min(0)),
  sub_investment_grade_max_pct: cited(z.number().min(0).max(100)),
  capital_protected: cited(z.boolean()),
  distributions_may_use_capital: cited(z.boolean()),
  dealing_frequency: cited(DealingFrequency),
  redemption_notice_days: cited(z.number().int().min(0)),
  // 0 when the documents state no exit charge.
  exit_charge_within_months: cited(z.number().int().min(0)),
  derivatives_use: cited(DerivativesUse),
  // Screens the documents claim, and whether the PPM backs each one. A screen only marketing claims is
  // recorded unbacked, citing the marketing passage, so S5 can make the advice conditional on it.
  exclusion_screens: z.array(z.object({ exclusion: Exclusion, backed_by_ppm: z.boolean(), citation: Citation })),
  // What the product is built mainly for, as the PPM states its objective (#41): S7 compares it with the
  // client's goal. Optional so runs recorded before rules@2 still parse; the attributes step now requires it.
  primary_objective: cited(ClientGoal).optional(),
  // The product's name as a document states it: how the shelf tells products apart (#39). Optional, so a
  // run that could not quote it still reads everything suitability needs; such a product is not offered
  // as an alternative.
  product_name: cited(z.string().min(1)).optional(),
});
export type ProductAttributes = z.infer<typeof ProductAttributes>;

// The product's risk level for S2, mapped from its attributes by a fixed table: a comparison of stated
// facts, never a model's judgement and never a measure of returns or volatility.
//   1  capital protected, no sub-investment-grade allowance, no derivatives beyond hedging
//   2  not capital protected, otherwise as 1
//   3  a sub-investment-grade allowance of up to 50%
//   4  more than 50% sub-investment-grade, or derivatives used for investment
// 5 is reserved for what the rules do not describe (e.g. leverage) and is never mapped to.
export function productRiskLevel(attributes: ProductAttributes): 1 | 2 | 3 | 4 {
  const subIg = attributes.sub_investment_grade_max_pct.value;
  if (subIg > 50 || attributes.derivatives_use.value === "investment") return 4;
  if (subIg > 0) return 3;
  return attributes.capital_protected.value ? 1 : 2;
}
