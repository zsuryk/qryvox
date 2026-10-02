import { z } from "zod";
import { Finding } from "./finding.js";

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

// The four analysis steps, driven by the browser in this order (ADR-0001).
export const StepName = z.enum(["extract", "decompose", "contradictions", "findings"]);
export type StepName = z.infer<typeof StepName>;

// Which prompt produced a step's output. The prompt text lives in the backend and never reaches the
// interface; only its version is part of the contract, recorded on every step event.
export const PROMPT_VERSIONS = {
  extract: "extract@1",
  decompose: "decompose@1",
  contradictions: "contradictions@1",
  findings: "findings@1",
} as const satisfies Record<StepName, string>;

const stepRun = {
  step: StepName,
  model: z.string().min(1),
  prompt_version: z.string().min(1),
  // The completed run whose output this run consumed; null for extract, which reads the documents.
  input_run_id: z.string().min(1).nullable(),
};

// Step events always carry the run's step_run_id in the envelope.
const stepEnvelope = { ...envelope, step_run_id: z.string().min(1) };

export const StepStarted = z.object({
  ...stepEnvelope,
  type: z.literal("step.started"),
  v: z.literal(1),
  payload: z.object(stepRun),
});

const stepCompletedPayload = z.object({
  ...stepRun,
  // The parsed, schema-checked output; its shape depends on the step.
  output: z.record(z.string(), z.unknown()),
  // The model's raw response body, kept for audit. Heavy.
  raw_response: z.unknown(),
});

export const StepCompleted = z.object({
  ...stepEnvelope,
  type: z.literal("step.completed"),
  v: z.literal(1),
  payload: stepCompletedPayload,
});

const stepFailedPayload = z.object({
  ...stepRun,
  error: z.string(),
  // What the model returned when its output failed to parse; null when no response arrived. Heavy.
  raw_response: z.unknown(),
});

export const StepFailed = z.object({
  ...stepEnvelope,
  type: z.literal("step.failed"),
  v: z.literal(1),
  payload: stepFailedPayload,
});

// Appended by a findings run, in the same transaction as its step.completed; step_run_id is that run.
export const FindingCreated = z.object({
  ...stepEnvelope,
  type: z.literal("finding.created"),
  v: z.literal(1),
  payload: Finding,
});

// A later findings run replaces the board: each finding still active when it completes is superseded in
// the same transaction. step_run_id is the superseding run. The finding and its dispositions stay in the log.
export const FindingSuperseded = z.object({
  ...stepEnvelope,
  type: z.literal("finding.superseded"),
  v: z.literal(1),
  payload: z.object({ finding_id: z.string().min(1) }),
});

// Full events: what the hash covers and what the per-event payload endpoint returns.
export const Event = z.discriminatedUnion("type", [
  CaseOpened,
  DocumentIngested,
  StepStarted,
  StepCompleted,
  StepFailed,
  FindingCreated,
  FindingSuperseded,
]);
export type Event = z.infer<typeof Event>;

// Slim events: what the event list endpoint returns and what the browser folds.
// Heavy fields (extracted text, raw model responses) are omitted; parsing a full event strips them.
export const SlimEvent = z.discriminatedUnion("type", [
  CaseOpened,
  DocumentIngested.extend({ payload: IngestedDocument.omit({ pages: true }) }),
  StepStarted,
  StepCompleted.extend({ payload: stepCompletedPayload.omit({ raw_response: true }) }),
  StepFailed.extend({ payload: stepFailedPayload.omit({ raw_response: true }) }),
  FindingCreated,
  FindingSuperseded,
]);
export type SlimEvent = z.infer<typeof SlimEvent>;

export type EventType = Event["type"];
export const EVENT_TYPES = Event.options.map((o) => o.shape.type.value) as readonly EventType[];
