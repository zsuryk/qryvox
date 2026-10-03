import { z } from "zod";
import { KnowledgeLevel, ProfileField } from "./client.js";
import { Citation } from "./finding.js";
import { SuitabilityRuleId } from "./rules.js";

// Advice (CONTEXT.md): a verdict for one client on one product, with its reasons and disclosures. The
// suitability rules decide it, never a model; an adviser approves it before the client sees it.

export const Verdict = z.enum(["suitable", "conditional", "not_suitable"]);
export type Verdict = z.infer<typeof Verdict>;

// What one rule found for this client. "meets" reasons are kept too: a suitable verdict is explained by
// what it meets, not by an empty list.
export const ReasonEffect = z.enum([
  // The rule holds.
  "meets",
  // The rule holds, with something the client must understand (S3).
  "warns",
  // The rule cannot be settled from the documents; the adviser must confirm it (S5).
  "conditional",
  // The rule fails; the product does not fit this client.
  "blocks",
]);
export type ReasonEffect = z.infer<typeof ReasonEffect>;

// One ground for a verdict: the rule, the client's answer it compares against, and the product passage
// it rests on. The citation is null only when nothing in the pack speaks to it (S5: the client excludes
// something no screen covers).
export const Reason = z.object({
  rule: SuitabilityRuleId,
  effect: ReasonEffect,
  profile_field: ProfileField,
  citation: Citation.nullable(),
});
export type Reason = z.infer<typeof Reason>;

// Something the client must be told whatever the verdict (S6): a finding on the product the analyst has
// not dismissed, with the passage it cites.
export const Disclosure = z.object({
  rule: SuitabilityRuleId,
  finding_id: z.string().min(1),
  citation: Citation,
});
export type Disclosure = z.infer<typeof Disclosure>;

// What advice.drafted records. The advice's id is that event's event_id, as a case is named after its
// case.opened, so a retried draft lands on the same advice.
export const Advice = z.object({
  client_id: z.string().min(1),
  // The client.profiled event the advice was drafted on: a later profile version supersedes it.
  profile_seq: z.number().int().positive(),
  // The completed attributes run it read the product from: a re-run supersedes it.
  attributes_run_id: z.string().min(1),
  verdict: Verdict,
  reasons: z.array(Reason).min(1),
  disclosures: z.array(Disclosure),
  rules_version: z.string().min(1),
}).refine((a) => a.verdict === verdictFor(a.reasons), {
  message: "the verdict must be the one its reasons amount to (verdictFor)",
  path: ["verdict"],
});
export type Advice = z.infer<typeof Advice>;

// The adviser's decision. Like a disposition, only a person makes it; nothing approves itself.
export const AdviceDecision = z.enum(["approved", "rejected"]);
export type AdviceDecision = z.infer<typeof AdviceDecision>;

export const SupersedeCause = z.enum(["profile_changed", "product_changed"]);
export type SupersedeCause = z.infer<typeof SupersedeCause>;

// The verdict a set of reasons amounts to: any block makes it not suitable, any open condition
// conditional, and otherwise suitable. Warnings and disclosures never change the verdict, only what the
// client is told.
export function verdictFor(reasons: readonly Reason[]): Verdict {
  if (reasons.some((r) => r.effect === "blocks")) return "not_suitable";
  if (reasons.some((r) => r.effect === "conditional")) return "conditional";
  return "suitable";
}

// --- Explanation (the explain step, #30) ---

// What a passage explains: "r<i>" is reasons[i], "d<i>" is disclosures[i] of the advice.
export const ExplanationRef = z.string().regex(/^[rd]\d+$/);
export type ExplanationRef = z.infer<typeof ExplanationRef>;

export const ExplanationPassage = z.object({ ref: ExplanationRef, text: z.string().min(1) });
export type ExplanationPassage = z.infer<typeof ExplanationPassage>;

// The advice in words at one depth: a summary of the verdict, then one passage per reason and per
// disclosure. It restates what the advice already holds and nothing else (the explain step checks).
export const ExplanationDepth = z.object({ summary: z.string().min(1), passages: z.array(ExplanationPassage) });
export type ExplanationDepth = z.infer<typeof ExplanationDepth>;

// The explain step's output: all three depths in one run, so the client page switches depth without
// another model call.
export const Explanation = z.object({
  advice_id: z.uuid(),
  depths: z.object({ novice: ExplanationDepth, informed: ExplanationDepth, expert: ExplanationDepth }),
}) satisfies z.ZodType<{ depths: Record<KnowledgeLevel, ExplanationDepth> }>;
export type Explanation = z.infer<typeof Explanation>;
