import { IngestedDocument, type StepName } from "@qryvox/shared";
import type { z } from "zod";
import type { Db } from "../db/client.js";
import { findCompletedRun, listEventsOfType } from "../log.js";
import { StepPrecondition } from "./step.js";

export async function loadDocuments(db: Db, caseId: string): Promise<IngestedDocument[]> {
  const rows = await listEventsOfType(db, caseId, "document.ingested");
  if (rows.length === 0) throw new StepPrecondition("no documents have been ingested into this case");
  return rows.map((r) => IngestedDocument.parse(r.payload));
}

// A step consumes the stored output of a completed run of the step before it, never a model's memory.
export async function loadCompletedOutput<T>(
  db: Db,
  caseId: string,
  runId: string | null,
  step: StepName,
  schema: z.ZodType<T>,
): Promise<{ output: T; inputRunId: string | null }> {
  const row = runId === null ? undefined : await findCompletedRun(db, caseId, runId);
  const payload = row?.payload as { step?: string; output?: unknown; input_run_id?: string | null } | undefined;
  if (!payload || payload.step !== step) {
    throw new StepPrecondition(`input_run_id must name a completed ${step} run in this case`);
  }
  return { output: schema.parse(payload.output), inputRunId: payload.input_run_id ?? null };
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
