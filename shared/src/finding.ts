import { z } from "zod";
import { ProductRuleId } from "./rules.js";

export const FindingCategory = z.enum(["fees", "strategy", "risk", "terms"]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingKind = z.enum([
  // Two documents state the same fact differently.
  "contradiction",
  // A marketing claim the PPM does not back.
  "unsupported_claim",
  // A promise made without the risk disclosure that should accompany it.
  "disclosure_gap",
  // A document falls short of an institutional product rule, whatever the other documents say .
  // The finding names the rule.
  "policy_gap",
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const Severity = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

// A verbatim quote on one page of one document; page is 1-based. Citations are page + quote, never
// character offsets, so highlighting survives pdf.js text-layer changes (ADR-0001).
export const Citation = z.object({
  document_id: z.string().min(1),
  page: z.number().int().positive(),
  quote: z.string().min(1),
});
export type Citation = z.infer<typeof Citation>;

// What the board shows. The citation is where the finding originates; the counterpart is the passage it
// conflicts with, or that it lacks, when there is one. Both quotes are verbatim document text: the
// findings step takes them from grounded claims, never from model prose.
export const Finding = z.object({
  finding_id: z.string().min(1),
  category: FindingCategory,
  kind: FindingKind,
  severity: Severity,
  // One sentence stating what the documents claim and where they conflict. Never a computed number.
  claim: z.string().min(1),
  citation: Citation,
  counterpart: Citation.nullable(),
  // The product rule a policy_gap breaks (rules.ts). Absent on every other kind, and on events written
  // today.
  rule: ProductRuleId.optional(),
});
export type Finding = z.infer<typeof Finding>;

// The analyst's decision on a finding, and the whole of it (spec decision 34). Nothing else is a
// disposition: the tool flags, the licensed human approves or dismisses, and no step ever decides
// either way. There is no third state here because there is no automatic transition out of these two.
export const Disposition = z.enum(["approved", "dismissed"]);
export type Disposition = z.infer<typeof Disposition>;
