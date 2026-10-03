import { ChipStep, DocumentKind, FindingCategory, IntentChip, ParseOutput } from "@qryvox/shared";
import { z } from "zod";
import { StepPrecondition, type StepDefinition } from "./step.js";

// parse@1 — reads the analyst's free-text intent on the canvas into intent chips (#51, #63): a category, a
// document kind (authority) and a step, each from its closed list or left open. Not part of the pipeline:
// it reads no documents and no earlier run, only the words the request carries, which the run records.

type ParseInput = { intent: string };

// What the model must answer: a list of chips whose fields are strings or null. The values are checked
// against the vocabulary in ground, so a reply that names something outside it loses that chip rather
// than the whole run; only a reply that is not this shape fails.
const ReplyChip = z.object({
  category: z.string().nullish(),
  authority: z.string().nullish(),
  step_kind: z.string().nullish(),
});
const ParseReply = z.object({ chips: z.array(ReplyChip) });
type ParseReply = z.infer<typeof ParseReply>;

export const PARSE_SYSTEM_PROMPT = `You read what an analyst types about what to look at next while reviewing one investment product's documents, and turn it into intent chips.

A chip has three fields. Each is one value from its list below, or null:
- category, the area concerned: ${FindingCategory.options.join(", ")}.
  fees: fees, charges, costs, expenses. strategy: what the fund invests in, its holdings, screens and objective. risk: risks, risk warnings and disclosures, guarantees, losing money. terms: dealing, redemption, notice periods, minimum investment, holding period and other terms.
- authority, the document concerned: ${DocumentKind.options.join(", ")}.
  ppm: the private placement memorandum, the prospectus or offering memorandum, the legal document. fee_table: the fee table or schedule of charges. factsheet: the factsheet. deck: the marketing deck, presentation or brochure.
- step_kind, the stage of the review concerned: ${ChipStep.options.join(", ")}.
  extract: the statements the documents make. decompose: the claims those statements make. contradictions: contradictions and inconsistencies between documents, the cross-check. compliance: the institution's product rules and policy gaps. findings: the findings raised. attributes: the product facts used for suitability. explain: explanations of advice.

Rules:
- Use only the values listed above, spelled exactly as written. Never invent a value.
- Leave a field null unless the text names it. Never guess.
- One chip per thing the analyst asks to look at. When the text ties a category to a document, as in "fees in the PPM", that is one chip with both.
- The text may be in any language, for example Traditional Chinese; map it onto the same values.
- If the text names nothing in these lists, answer with an empty list. That is a valid answer.
- Do not answer the analyst, judge the product or add anything else.

Respond with only a JSON object and no other text, in exactly this shape:
{"chips":[{"category":"fees","authority":"ppm","step_kind":null}]}`;

export const parse: StepDefinition<ParseInput, ParseOutput, ParseReply> = {
  name: "parse",

  async loadInput(_db, _caseId, inputRunId, intent) {
    if (inputRunId !== null) throw new StepPrecondition("parse reads the analyst's words; input_run_id must be null");
    // The request schema requires intent for parse; this only keeps a caller that skipped it honest.
    if (intent === undefined) throw new StepPrecondition("parse needs intent: the analyst's words");
    return { intent };
  },

  messages({ intent }) {
    return [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      { role: "user", content: `The analyst typed:\n${intent}` },
    ];
  },

  output: ParseReply,

  // Keeps the chips whose every value is in the vocabulary, once each. A chip naming anything outside it is
  // dropped whole, never kept with that field widened to "any", which would select more than was asked. An
  // empty list is not a failure: the words named nothing, and the analyst's own chips stand.
  ground(reply) {
    const seen = new Set<string>();
    const chips = reply.chips.flatMap((chip) => {
      const parsed = IntentChip.safeParse({
        category: vocabulary(chip.category),
        authority: vocabulary(chip.authority),
        step_kind: vocabulary(chip.step_kind),
      });
      const key = parsed.success ? JSON.stringify(parsed.data) : null;
      if (!parsed.success || seen.has(key!)) return [];
      seen.add(key!);
      return [parsed.data];
    });
    // ParseOutput holds at most twelve chips; more than that is no longer an intent, so the rest are dropped.
    return { output: ParseOutput.parse({ chips: chips.slice(0, 12) }) };
  },
};

// A model's value as the vocabulary spells it. The repair is narrow on purpose: case, and a space or hyphen
// for the underscore ("Fee table" for fee_table), and an empty string for null. Anything else stays as
// written and fails the chip.
function vocabulary(value: string | null | undefined): string | null {
  const spelled = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return spelled ? spelled : null;
}
