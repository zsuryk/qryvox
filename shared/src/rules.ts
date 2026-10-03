import { z } from "zod";

// The institution's own rules (CONTEXT.md, "Rules"): fabricated institutional policy, never quoted
// regulation. One versioned set in two groups. Product rules say what a pack's documents must carry for the
// product to go on the shelf; the compliance step checks them, and a breach is a policy_gap finding.
// Suitability rules decide whether a shelved product fits a client; a pure function applies them, never a
// model. Every event that applies a rule records RULES_VERSION, as step events record their prompt version.
export const RULES_VERSION = "rules@1";

export const RuleGroup = z.enum(["product", "suitability"]);
export type RuleGroup = z.infer<typeof RuleGroup>;

export const ProductRuleId = z.enum(["P1", "P2", "P3", "P4"]);
export type ProductRuleId = z.infer<typeof ProductRuleId>;

export const SuitabilityRuleId = z.enum(["S1", "S2", "S3", "S4", "S5", "S6"]);
export type SuitabilityRuleId = z.infer<typeof SuitabilityRuleId>;

export type Rule = {
  id: ProductRuleId | SuitabilityRuleId;
  group: RuleGroup;
  // Short enough for a board card or an advice reason.
  title: string;
  // The rule in full. The compliance prompt and the explanations may show this text, and nothing else
  // about the rule.
  text: string;
};

export const RULES = [
  {
    id: "P1",
    group: "product",
    title: "Marketing names every PPM risk",
    text: "The factsheet and the marketing deck each name every type of risk listed in the PPM's risk factors.",
  },
  {
    id: "P2",
    group: "product",
    title: "No capital protection is stated",
    text: "A product that is not capital protected says so in its factsheet.",
  },
  {
    id: "P3",
    group: "product",
    title: "Exit charges are key facts",
    text: "Any charge on leaving the product appears in the factsheet's key facts.",
  },
  {
    id: "P4",
    group: "product",
    title: "Income targets are not promises",
    text: "A document that states an income target also says that distributions are not guaranteed.",
  },
  {
    id: "S1",
    group: "suitability",
    title: "Long enough horizon",
    text: "The client's investment horizon is at least the product's minimum holding period.",
  },
  {
    id: "S2",
    group: "suitability",
    title: "Risk within the client's level",
    text: "The product's risk level, mapped from its attributes, is no higher than the client's risk level.",
  },
  {
    id: "S3",
    group: "suitability",
    title: "Income may come from capital",
    text: "A client who relies on the income is warned when distributions may be paid out of capital.",
  },
  {
    id: "S4",
    group: "suitability",
    title: "Money available when needed",
    text:
      "A client who may need the money at short notice is not offered a product whose dealing terms delay " +
      "redemption or charge for leaving early.",
  },
  {
    id: "S5",
    group: "suitability",
    title: "Exclusions backed by the PPM",
    text:
      "A client's exclusion is met only if the PPM backs it; a screen claimed only in marketing makes the " +
      "advice conditional on the adviser confirming it.",
  },
  {
    id: "S6",
    group: "suitability",
    title: "Open findings are disclosed",
    text: "Every fees or terms finding on the product that the analyst has not dismissed is disclosed to the client.",
  },
] as const satisfies readonly Rule[];

export function ruleById(id: ProductRuleId | SuitabilityRuleId): Rule {
  return RULES.find((r) => r.id === id)!;
}
