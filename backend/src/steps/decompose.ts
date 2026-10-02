import { FindingCategory, type IngestedDocument } from "@qryvox/shared";
import { z } from "zod";
import { ExtractOutput } from "./extract.js";
import { loadCompletedOutput, loadDocuments, onPage } from "./inputs.js";
import type { StepDefinition } from "./step.js";

// decompose@1 — splits extracted statements into atomic claims, each with a category, a topic shared
// across documents, and a short assertion. Quotes stay verbatim so every claim keeps its citation.

export const Claim = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  page: z.number().int().positive(),
  quote: z.string().min(1),
  category: FindingCategory,
  topic: z.string().min(1),
  assertion: z.string().min(1),
});
export type Claim = z.infer<typeof Claim>;

export const DecomposeOutput = z.object({ claims: z.array(Claim) });
export type DecomposeOutput = z.infer<typeof DecomposeOutput>;

type DecomposeInput = { statements: ExtractOutput["statements"]; documents: IngestedDocument[] };

export const DECOMPOSE_SYSTEM_PROMPT = `You turn statements from investment product documents into atomic claims.

Each statement comes with its document_id, document kind and page. Emit one claim per distinct fact a statement asserts (usually one per statement). For each claim give:
- id: "c1", "c2", ... in order.
- document_id and page: copied from the statement.
- quote: the exact words of the statement that assert this fact, copied character for character. Use the whole statement when it asserts a single fact.
- category: one of
  fees: management fees, entry, exit and redemption charges, performance fees, costs;
  strategy: objective, what the fund invests in, credit quality, how holdings are selected or screened, income targets;
  risk: risk warnings, capital protection, guarantees, what an investor can lose;
  terms: dealing and redemption frequency, notice periods, minimum investment, launch date, currency.
- topic: 2 to 4 lowercase words naming the subject. Use the same topic for the same subject in every document, for example "management fee", "exit charge", "credit quality", "dealing frequency", "income", "esg screening".
- assertion: what the claim says about its topic in at most 15 words, keeping every number exactly as written.

Do not compute, infer, compare or judge. Skip statements that assert nothing about the product.

Respond with only a JSON object and no other text, in exactly this shape:
{"claims":[{"id":"c1","document_id":"<document_id>","page":<page>,"quote":"<verbatim>","category":"fees","topic":"<topic>","assertion":"<assertion>"}]}`;

export const decompose: StepDefinition<DecomposeInput, DecomposeOutput> = {
  name: "decompose",

  async loadInput(db, caseId, inputRunId) {
    const { output } = await loadCompletedOutput(db, caseId, inputRunId, "extract", ExtractOutput);
    return { statements: output.statements, documents: await loadDocuments(db, caseId) };
  },

  messages({ statements, documents }) {
    const kinds = new Map(documents.map((d) => [d.document_id, d.kind]));
    const text = statements
      .map((s) => `- document_id: ${s.document_id} (${kinds.get(s.document_id)}), page ${s.page}: ${s.quote}`)
      .join("\n");
    return [
      { role: "system", content: DECOMPOSE_SYSTEM_PROMPT },
      { role: "user", content: `Statements:\n${text}` },
    ];
  },

  output: DecomposeOutput,

  // Claims keep only quotes found on their cited page, with unique ids. Fails if none survive.
  ground(output, { documents }) {
    const seen = new Set<string>();
    const claims = output.claims.filter((c) => {
      if (seen.has(c.id) || !onPage(documents, c.document_id, c.page, c.quote)) return false;
      seen.add(c.id);
      return true;
    });
    if (claims.length === 0) {
      return { error: `none of the ${output.claims.length} claims quote their cited page verbatim` };
    }
    return { output: { claims } };
  },
};
