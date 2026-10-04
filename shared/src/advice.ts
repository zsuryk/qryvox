import { z } from "zod";
import { ClientLanguage, KnowledgeLevel, ProfileField } from "./client.js";
import { Citation } from "./finding.js";
import { SuitabilityRuleId } from "./rules.js";

// Advice (CONTEXT.md): a verdict for one client on one product, with its reasons and disclosures. The
// suitability rules decide it, never a model; an adviser approves it before the client sees it.

export const Verdict = z.enum(["suitable", "conditional", "not_suitable"]);
export type Verdict = z.infer<typeof Verdict>;

// The verdict as the client's page headlines it, above the explanation, in each language the client may
// read (#43). One copy for the page, which shows it, and the explain step, which must not repeat it (#67).
export const VERDICT_HEADLINE: Record<ClientLanguage, Record<Verdict, string>> = {
  en: {
    suitable: "This product suits you.",
    conditional: "This product may suit you, once your adviser confirms one thing.",
    not_suitable: "This product does not suit you.",
  },
  "zh-Hant": {
    suitable: "這個產品適合你。",
    conditional: "這個產品可能適合你，需待你的顧問確認一點。",
    not_suitable: "這個產品不適合你。",
  },
};

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

// Another verified product the same rules find suitable for the client (#39), from the case it was
// verified in: its own reasons, disclosures and citations, and the attributes run they were read from.
export const Alternative = z
  .object({
    case_id: z.string().min(1),
    product_name: z.string().min(1),
    attributes_run_id: z.string().min(1),
    verdict: z.literal("suitable"),
    reasons: z.array(Reason).min(1),
    disclosures: z.array(Disclosure),
  })
  .refine((a) => verdictFor(a.reasons) === "suitable", {
    message: "an alternative's reasons must amount to suitable",
    path: ["verdict"],
  });
export type Alternative = z.infer<typeof Alternative>;

// One product on the shelf as the rules find it for this client (#68), with any verdict: the same shape as
// an Alternative, but the products that do not suit are kept, each with the reasons that decided it.
export const ShelfEntry = z
  .object({
    case_id: z.string().min(1),
    product_name: z.string().min(1),
    attributes_run_id: z.string().min(1),
    verdict: Verdict,
    reasons: z.array(Reason).min(1),
    disclosures: z.array(Disclosure),
  })
  .refine((e) => verdictFor(e.reasons) === e.verdict, {
    message: "a shelf entry's verdict must be the one its reasons amount to (verdictFor)",
    path: ["verdict"],
  });
export type ShelfEntry = z.infer<typeof ShelfEntry>;

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
  // For advice that is not suitable: the other products on the shelf that are, by the same rules. Absent
  // when drafting did not look (suitable advice, and advice drafted before #39); empty when it looked and
  // nothing on the shelf fits.
  alternatives: z.array(Alternative).optional(),
  // Every other verified product with the verdict the same rules reach for this client, suitable or not
  // (#68): a comparison, never a recommendation. Absent on advice drafted before #68.
  shelf: z.array(ShelfEntry).optional(),
}).refine((a) => a.verdict === verdictFor(a.reasons), {
  message: "the verdict must be the one its reasons amount to (verdictFor)",
  path: ["verdict"],
});
export type Advice = z.infer<typeof Advice>;

// The adviser's decision. Like a disposition, only a person makes it; nothing approves itself.
export const AdviceDecision = z.enum(["approved", "rejected"]);
export type AdviceDecision = z.infer<typeof AdviceDecision>;

// Why an adviser rejected a draft (#42): chosen, never typed, so the record says why in a word a
// regulator can count. Required on a rejection.
export const RejectionReason = z.enum([
  "circumstances_not_captured",
  "product_facts_wrong",
  "explanation_not_adequate",
  "client_prefers_another_product",
  "needs_discussion_first",
]);
export type RejectionReason = z.infer<typeof RejectionReason>;

// What an adviser confirms on approving (#42). explained_directly is required for a vulnerable client.
export const DecisionConfirmation = z.enum(["explained_directly"]);
export type DecisionConfirmation = z.infer<typeof DecisionConfirmation>;

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

// The shelf comparison an advice carries: its shelf when it has one, otherwise the alternatives older
// advice recorded (all suitable), so a reader never has to ask which kind of advice it is.
export function shelfFor(advice: Pick<Advice, "shelf" | "alternatives">): readonly ShelfEntry[] {
  return advice.shelf ?? advice.alternatives ?? [];
}

// The reasons that decided a verdict, most decisive first: blocks, then open conditions, then warnings.
// A product that meets every rule has none: its verdict rests on what it meets, which a reader may still
// ask to see in full.
export function decidingReasons(reasons: readonly Reason[]): Reason[] {
  const of = (effect: Reason["effect"]) => reasons.filter((r) => r.effect === effect);
  return [...of("blocks"), ...of("conditional"), ...of("warns")];
}

// Verdicts in the order a client's list shows them (#71): what suits first, then what needs the adviser,
// then what does not suit.
export const VERDICT_ORDER: Record<Verdict, number> = { suitable: 0, conditional: 1, not_suitable: 2 };

// Reasons of one rule and one effect shown as one row (#71): Mrs Chan's three S4 blocks are one thing to
// read, with three passages behind it. Rows keep the order the reasons came in; a passage two reasons share
// is listed once; a reason nothing speaks to adds no passage.
export type ReasonGroup = { rule: Reason["rule"]; effect: ReasonEffect; reasons: Reason[]; citations: Citation[] };

export function groupReasons(reasons: readonly Reason[]): ReasonGroup[] {
  const groups: ReasonGroup[] = [];
  for (const reason of reasons) {
    let group = groups.find((g) => g.rule === reason.rule && g.effect === reason.effect);
    if (!group) groups.push((group = { rule: reason.rule, effect: reason.effect, reasons: [], citations: [] }));
    group.reasons.push(reason);
    const c = reason.citation;
    if (c && !group.citations.some((o) => o.document_id === c.document_id && o.page === c.page && o.quote === c.quote)) group.citations.push(c);
  }
  return groups;
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
  // The language it is written in (#43); quoted document text stays in the document's own language.
  language: ClientLanguage.optional(),
  depths: z.object({ novice: ExplanationDepth, informed: ExplanationDepth, expert: ExplanationDepth }),
}) satisfies z.ZodType<{ depths: Record<KnowledgeLevel, ExplanationDepth> }>;
export type Explanation = z.infer<typeof Explanation>;
