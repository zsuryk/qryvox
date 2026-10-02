import { IngestedDocument, type StepName } from "@qryvox/shared";
import type { z } from "zod";
import type { Db } from "../db/client";
import { findCompletedRun, listEventsOfType } from "../log";
import { StepPrecondition } from "./step";

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

// True when the quote appears on that page of that document.
export function onPage(documents: readonly IngestedDocument[], documentId: string, page: number, quote: string): boolean {
  const text = documents.find((d) => d.document_id === documentId)?.pages[page - 1];
  return text !== undefined && normalize(text).includes(normalize(quote));
}

// The document text as the model sees it: every page labelled, so it can cite document and page.
export function documentsAsText(documents: readonly IngestedDocument[]): string {
  return documents
    .map((d) =>
      [
        `=== document_id: ${d.document_id} (${d.kind}, ${d.filename}) ===`,
        ...d.pages.map((page, i) => `--- page ${i + 1} ---\n${page}`),
      ].join("\n"),
    )
    .join("\n\n");
}
