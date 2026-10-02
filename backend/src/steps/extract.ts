import type { IngestedDocument } from "@qryvox/shared";
import { z } from "zod";
import { documentsAsText, loadDocuments, onPage } from "./inputs.js";
import { StepPrecondition, type StepDefinition } from "./step.js";

// extract@1 — lists every statement each document makes, verbatim, with its page.

export const ExtractOutput = z.object({
  statements: z.array(
    z.object({
      document_id: z.string().min(1),
      page: z.number().int().positive(),
      quote: z.string().min(1),
    }),
  ),
});
export type ExtractOutput = z.infer<typeof ExtractOutput>;

type ExtractInput = { documents: IngestedDocument[] };

export const EXTRACT_SYSTEM_PROMPT = `You read investment product documents and list the factual statements they make.

Rules:
- Copy each statement verbatim from the document text: the same words, numbers and punctuation. Never paraphrase, summarise, translate or merge sentences.
- One statement per sentence, or per line of a list or table.
- Include every statement about fees and charges, investment objective and strategy, holdings, risks, income and distributions, dealing and redemption, and other terms.
- Skip headings, page numbers and footer disclaimers.
- Give the document_id and the 1-based page number where each statement appears.
- Do not compute, infer, compare or judge anything.

Respond with only a JSON object and no other text, in exactly this shape:
{"statements":[{"document_id":"<document_id>","page":<page number>,"quote":"<verbatim statement>"}]}`;

export const extract: StepDefinition<ExtractInput, ExtractOutput> = {
  name: "extract",

  async loadInput(db, caseId, inputRunId) {
    if (inputRunId !== null) throw new StepPrecondition("extract reads the documents; input_run_id must be null");
    return { documents: await loadDocuments(db, caseId) };
  },

  messages({ documents }) {
    return [
      { role: "system", content: EXTRACT_SYSTEM_PROMPT },
      { role: "user", content: documentsAsText(documents) },
    ];
  },

  output: ExtractOutput,

  // Only statements found on their cited page survive: every downstream citation starts here, so an
  // invented or paraphrased quote must never reach the board. Fails the run if nothing is grounded.
  ground(output, { documents }) {
    const statements = output.statements.filter((s) => onPage(documents, s.document_id, s.page, s.quote));
    if (statements.length === 0) {
      return { error: `none of the ${output.statements.length} extracted statements appear verbatim on their cited page` };
    }
    return { output: { statements } };
  },
};
