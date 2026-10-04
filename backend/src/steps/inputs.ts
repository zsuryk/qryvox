import { type Citation, IngestedDocument, type StepName } from "@qryvox/shared";
import type { z } from "zod";
import type { Db } from "../db/client.js";
import { findCompletedRun, listEventsOfType } from "../log.js";
import { StepPrecondition } from "./step.js";

// The case's documents, the latest version of each: a document ingested again under the same id (a
// product update, #37) replaces the earlier one for every step that runs after it, as it does in the fold.
export async function loadDocuments(db: Db, caseId: string): Promise<IngestedDocument[]> {
  const rows = await listEventsOfType(db, caseId, "document.ingested");
  if (rows.length === 0) throw new StepPrecondition("no documents have been ingested into this case");
  const latest = new Map<string, IngestedDocument>();
  for (const row of rows) {
    const document = IngestedDocument.parse(row.payload);
    latest.set(document.document_id, document);
  }
  return [...latest.values()];
}

// A step consumes the stored output of a completed run of the step before it, never a model's memory.
export async function loadCompletedOutput<T>(
  db: Db,
  caseId: string,
  runId: string | null,
  step: StepName | readonly StepName[],
  schema: z.ZodType<T>,
): Promise<{ output: T; inputRunId: string | null; step: StepName }> {
  const row = runId === null ? undefined : await findCompletedRun(db, caseId, runId);
  const payload = row?.payload as { step?: string; output?: unknown; input_run_id?: string | null; seed?: unknown } | undefined;
  const steps: readonly StepName[] = typeof step === "string" ? [step] : step;
  if (!payload || !steps.includes(payload.step as StepName)) {
    throw new StepPrecondition(`input_run_id must name a completed ${steps.join(" or ")} run in this case`);
  }
  // A find-similar run (#64) answers one passage, not the pack: its output is candidate cards for the
  // canvas, and feeding it on would let it reach the findings on the board.
  if (payload.seed !== undefined) {
    throw new StepPrecondition(`input_run_id ${runId} is a seeded find-similar run, which no step consumes`);
  }
  return { output: schema.parse(payload.output), inputRunId: payload.input_run_id ?? null, step: payload.step as StepName };
}

// pdf.js and models both vary whitespace; compare text with runs of whitespace collapsed.
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The document a citation names. A model is handed the ids in a header and asked to copy them, and models
// copy what they see: a header reading "factsheet (factsheet, larkspur-factsheet.pdf)" invites the whole
// token back as the id, which then matches no document and grounds nothing at all. So a cited id is
// matched exactly first, and only then by the longest known id it begins with — the repair is narrow on
// purpose. A citation still has to quote its page verbatim to be believed, and groundCitation hands it on
// under the real id, so a sloppy id never reaches the steps or the board that read it.
export function resolveDocument(
  documents: readonly IngestedDocument[],
  cited: string,
): IngestedDocument | undefined {
  const exact = documents.find((d) => d.document_id === cited);
  if (exact) return exact;
  const trimmed = cited.trim();
  return documents
    .filter((d) => trimmed === d.document_id || trimmed.startsWith(`${d.document_id} `) || trimmed.startsWith(`${d.document_id}(`))
    .sort((a, b) => b.document_id.length - a.document_id.length)[0];
}

// The citation, with its document_id rewritten to the document's real id, when the quote appears on that
// page of that document; undefined otherwise. The rewrite matters as much as the check: a repaired id
// left as the model wrote it reaches the board, and no document there answers to it.
export function groundCitation<T extends { document_id: string; page: number; quote: string }>(
  documents: readonly IngestedDocument[],
  citation: T,
): T | undefined {
  const document = resolveDocument(documents, citation.document_id);
  const text = document?.pages[citation.page - 1];
  if (!document || text === undefined || !normalize(text).includes(normalize(citation.quote))) return undefined;
  return { ...citation, document_id: document.document_id };
}

// The document text as the model sees it: every page labelled, so it can cite document and page. The id is
// alone on its line and nothing else is quoted on it, so there is no way to copy a longer token back as
// the id — the filename and kind sit on the next line, where they cannot be mistaken for part of it.
export function documentsAsText(documents: readonly IngestedDocument[]): string {
  return documents
    .map((d) =>
      [
        `=== document_id: ${d.document_id} ===`,
        `--- ${d.kind}, ${d.filename} ---`,
        ...d.pages.map((page, i) => `--- page ${i + 1} ---\n${page}`),
      ].join("\n"),
    )
    .join("\n\n");
}

// The passage a find-similar run is seeded with, as a seeded prompt shows it: document, kind and page, then
// the quote, which the run has already found verbatim on that page.
export function seedPassage(documents: readonly IngestedDocument[], seed: Citation): string {
  const kind = documents.find((d) => d.document_id === seed.document_id)?.kind;
  return `document_id: ${seed.document_id} (${kind}), page ${seed.page}\n"${seed.quote}"`;
}

// --- Checks on text a model writes about grounded passages (explain, rationale) ---

// Spans in double quotes, straight or curly, long enough to be a quotation rather than a word.
// Punctuation at the very ends is the sentence's, not the source's: a model writes "…of the Fund," with its
// own comma inside the quotation marks, or adds a full stop a table cell never had (Kimi K3 did both). Only
// the ends are trimmed; anything that changes the words inside still fails.
// Pairs are taken in order, short or long, and only then kept by length: a short quoted word ("income") must
// not leave its closing mark to pair with the next opening one, which made the sentence between two real
// quotations look like a quotation of its own and refused a faithful text (#78).
export function quotations(text: string): string[] {
  return [...text.matchAll(/["“]([^"”]*)["”]/g)]
    .map((m) => m[1]!)
    .filter((inside) => inside.length >= 8)
    .map((inside) => inside.replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, ""));
}

// Whether a quotation is in one of the passages it may come from, ignoring whitespace and case.
export function quotedFrom(quoted: string, sources: readonly string[]): boolean {
  return sources.some((q) => normalize(q).toLowerCase().includes(normalize(quoted).toLowerCase()));
}

// Numbers by value, not by spelling: "2.00%" in the source and "2%" in an explanation are the same charge.
export const value = (n: string) => String(Number(n));

// A source that says "five years" lets a text say "5" (#75): the number words one to twenty count as the
// numbers they name. Only a source is read this way; what a model writes is still checked by its digits.
const NUMBER_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

export function numbersIn(...texts: (string | number | null)[]): Set<string> {
  return new Set(
    texts.flatMap((t) => {
      if (t === null) return [];
      const text = String(t);
      const words = (text.toLowerCase().match(/\b[a-z]+\b/g) ?? []).flatMap((w) => {
        const at = NUMBER_WORDS.indexOf(w);
        return at < 0 ? [] : [String(at + 1)];
      });
      return [...(text.match(/\d+(?:\.\d+)?/g) ?? []).map(value), ...words];
    }),
  );
}

// The numbers a text states, as written. Rule ids (S1, P4) are names, not stated numbers.
export function statedNumbers(text: string): string[] {
  return text.replace(/\b[PS]\d+\b/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
}
