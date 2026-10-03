import { Citation, Exclusion, type IngestedDocument, ProductAttributes } from "@qryvox/shared";
import { z } from "zod";
import { documentsAsText, groundCitation, loadDocuments, normalize } from "./inputs.js";
import { StepPrecondition, type StepDefinition } from "./step.js";

// attributes@1 — reads the pack for the facts suitability needs (#29). Every value must be cited, ground on
// its page, and, when it is a number, be stated in its own quote: an attribute is read, never computed.
// Each one is checked on its own, so one bad attribute is dropped rather than sinking the rest; the run
// fails only when an attribute the suitability rules need is missing, and says which.

type AttributesInput = { documents: IngestedDocument[] };
type ScalarKey = Exclude<keyof ProductAttributes, "exclusion_screens">;

// Every scalar attribute: S1–S5 read all of them.
const SCALARS = [
  "min_holding_years",
  "sub_investment_grade_max_pct",
  "capital_protected",
  "distributions_may_use_capital",
  "dealing_frequency",
  "redemption_notice_days",
  "exit_charge_within_months",
  "derivatives_use",
] as const satisfies readonly ScalarKey[];

// Numbers the quote must state, as digits or in words.
const NUMERIC = new Set<ScalarKey>(["min_holding_years", "sub_investment_grade_max_pct", "redemption_notice_days", "exit_charge_within_months"]);

// The model answers loosely; each attribute is parsed against ProductAttributes one at a time in ground().
const AttributesReply = z.record(z.string(), z.unknown());
type AttributesReply = z.infer<typeof AttributesReply>;

const ScreenReply = z.object({ exclusion: Exclusion, citation: Citation });

export const ATTRIBUTES_SYSTEM_PROMPT = `You read the documents of one investment product and report the facts below. You are reading, not judging: report what the documents state, never what you infer or calculate.

For each fact, give its value and a citation: the document_id, the 1-based page, and a quote copied verbatim from that page (the same words, numbers and punctuation) that states the value.
Prefer the PPM, the most authoritative document. Use another document only when the PPM says nothing about that fact.

Facts:
- min_holding_years: the minimum period the product says to hold it for, in whole years (integer).
- sub_investment_grade_max_pct: the most the product may hold in sub-investment-grade (high-yield) bonds, as a percentage (0 if it may hold none).
- capital_protected: true only if the documents say the capital is protected or guaranteed.
- distributions_may_use_capital: true if distributions or income may be paid out of capital.
- dealing_frequency: how often investors can redeem: "daily", "weekly", "monthly" or "quarterly".
- redemption_notice_days: the notice in days a redemption request needs (0 if none).
- exit_charge_within_months: the period in months within which a charge applies on redeeming (0 if there is no exit charge; then cite the passage that lists the charges).
- derivatives_use: "none", "hedging" or "investment".
- exclusion_screens: every exclusion screen any document claims, each as {"exclusion": "fossil_fuels" | "tobacco" | "weapons", "citation": …}. If the PPM states the screen, cite the PPM; otherwise cite the document that claims it.

Respond with only a JSON object and no other text, in exactly this shape:
{"min_holding_years":{"value":<integer>,"citation":{"document_id":"<document_id>","page":<page>,"quote":"<verbatim>"}},"sub_investment_grade_max_pct":{…},"capital_protected":{…},"distributions_may_use_capital":{…},"dealing_frequency":{…},"redemption_notice_days":{…},"exit_charge_within_months":{…},"derivatives_use":{…},"exclusion_screens":[{"exclusion":"<exclusion>","citation":{…}}]}`;

export const attributes: StepDefinition<AttributesInput, ProductAttributes, AttributesReply> = {
  name: "attributes",

  async loadInput(db, caseId, inputRunId) {
    if (inputRunId !== null) throw new StepPrecondition("attributes reads the documents; input_run_id must be null");
    return { documents: await loadDocuments(db, caseId) };
  },

  messages({ documents }) {
    return [
      { role: "system", content: ATTRIBUTES_SYSTEM_PROMPT },
      { role: "user", content: documentsAsText(documents) },
    ];
  },

  output: AttributesReply,

  ground(reply, { documents }) {
    const found: Partial<Record<ScalarKey, unknown>> = {};
    const missing: string[] = [];
    for (const key of SCALARS) {
      const parsed = ProductAttributes.shape[key].safeParse(reply[key]);
      if (!parsed.success) {
        missing.push(`${key} (not given in the expected form)`);
        continue;
      }
      const citation = groundCitation(documents, parsed.data.citation);
      if (!citation) {
        missing.push(`${key} (its quote is not on the cited page)`);
        continue;
      }
      if (NUMERIC.has(key) && !states(citation.quote, parsed.data.value as number)) {
        missing.push(`${key} (its quote does not state ${String(parsed.data.value)})`);
        continue;
      }
      found[key] = { value: parsed.data.value, citation };
    }
    if (missing.length > 0) {
      return { error: `the attributes suitability needs could not all be established: ${missing.join("; ")}` };
    }
    return {
      output: ProductAttributes.parse({ ...found, exclusion_screens: screens(reply.exclusion_screens, documents) }),
    };
  },
};

// Screens are optional: an ungrounded one is dropped. Whether the PPM backs a screen is decided here, by
// the kind of document its grounded quote is on, never taken from the model. One screen per exclusion,
// a PPM-backed citation preferred.
function screens(reply: unknown, documents: readonly IngestedDocument[]): ProductAttributes["exclusion_screens"] {
  const kinds = new Map(documents.map((d) => [d.document_id, d.kind]));
  const grounded = (Array.isArray(reply) ? reply : []).flatMap((item) => {
    const parsed = ScreenReply.safeParse(item);
    const citation = parsed.success ? groundCitation(documents, parsed.data.citation) : undefined;
    if (!parsed.success || !citation) return [];
    return [{ exclusion: parsed.data.exclusion, backed_by_ppm: kinds.get(citation.document_id) === "ppm", citation }];
  });
  return Exclusion.options.flatMap((exclusion) => {
    const claims = grounded.filter((s) => s.exclusion === exclusion);
    const best = claims.find((s) => s.backed_by_ppm) ?? claims[0];
    return best ? [best] : [];
  });
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

// The quote states the number: as digits standing alone (so 4 is not found in 40 or 2.4), or in words
// up to twelve. Zero is "none", which documents phrase too many ways to check, so it is not checked.
function states(quote: string, n: number): boolean {
  if (n === 0) return true;
  const text = normalize(quote).toLowerCase();
  const digits = new RegExp(`(^|[^\\d.])${String(n).replace(".", "\\.")}(?![\\d]|\\.\\d)`);
  const word = WORDS[n];
  return digits.test(text) || (word !== undefined && new RegExp(`\\b${word}\\b`).test(text));
}
