import { z } from "zod";

// Envelope fields carried by every event, named as in ADR-0002.
// seq is per case: 1, 2, 3… with no gaps, assigned inside the append transaction.
// hash / prev_hash / ip_hash stay server-side (ADR-0002: the browser never verifies the chain).
const envelope = {
  seq: z.number().int().positive(),
  event_id: z.uuid(),
  case_id: z.string().min(1),
  actor: z.string().min(1),
  at: z.iso.datetime(),
  step_run_id: z.string().min(1).nullable(),
};

export const DocumentKind = z.enum(["factsheet", "ppm", "deck", "fee_table"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

// What the browser sends after parsing a PDF with pdf.js.
export const IngestedDocument = z.object({
  document_id: z.string().min(1),
  sha256: Sha256,
  filename: z.string().min(1),
  kind: DocumentKind,
  page_count: z.number().int().positive(),
  // Extracted text, one entry per page; citations are page + quote, so text is kept per page.
  pages: z.array(z.string()),
  pdfjs_version: z.string().min(1),
});
export type IngestedDocument = z.infer<typeof IngestedDocument>;

export const CaseOpened = z.object({
  ...envelope,
  type: z.literal("case.opened"),
  v: z.literal(1),
  payload: z.object({}),
});

export const DocumentIngested = z.object({
  ...envelope,
  type: z.literal("document.ingested"),
  v: z.literal(1),
  payload: IngestedDocument,
});

// Full events: what the hash covers and what the per-event payload endpoint returns.
export const Event = z.discriminatedUnion("type", [CaseOpened, DocumentIngested]);
export type Event = z.infer<typeof Event>;

// Slim events: what the event list endpoint returns and what the browser folds.
// Heavy fields (extracted text, raw model responses) are omitted; parsing a full event strips them.
export const SlimEvent = z.discriminatedUnion("type", [
  CaseOpened,
  DocumentIngested.extend({ payload: IngestedDocument.omit({ pages: true }) }),
]);
export type SlimEvent = z.infer<typeof SlimEvent>;

export type EventType = Event["type"];
export const EVENT_TYPES = Event.options.map((o) => o.shape.type.value) as readonly EventType[];
