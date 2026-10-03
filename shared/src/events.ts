import { z } from "zod";
import { Advice, AdviceDecision, SupersedeCause } from "./advice.js";
import { ClientProfile } from "./client.js";
import { Disposition, Finding } from "./finding.js";

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
export type Sha256 = z.infer<typeof Sha256>;

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

// The four analysis steps, driven by the browser in this order (ADR-0001), then the steps stage 2 adds:
// compliance checks the documents against the product rules between contradictions and findings (#24);
// attributes reads the documents for the facts suitability needs (#29); explain words one advice's
// verdict at three depths (#30).
export const StepName = z.enum(["extract", "decompose", "contradictions", "findings", "compliance", "attributes", "explain"]);
export type StepName = z.infer<typeof StepName>;

// Which prompt produced a step's output. The prompt text lives in the backend and never reaches the
// interface; only its version is part of the contract, recorded on every step event.
export const PROMPT_VERSIONS = {
  extract: "extract@1",
  decompose: "decompose@1",
  contradictions: "contradictions@1",
  findings: "findings@1",
  compliance: "compliance@1",
  attributes: "attributes@1",
  explain: "explain@1",
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

// The analyst's decision, by button or keyboard, and the only disposition there is (spec decision 34).
// Who decided is the envelope's actor, so the audit trail identifies who decided what (spec decision 21);
// stage 1 has one fixed identity and no picker (spec decision 9). Deliberately not a step event: no
// step_run_id, because no run decided this and no model was called to produce it.
export const DispositionChanged = z.object({
  ...envelope,
  type: z.literal("disposition.changed"),
  v: z.literal(1),
  payload: z.object({ finding_id: z.string().min(1), disposition: Disposition }),
});

// --- The client layer (stage 2). None of these is a step event: no model produces them. ---

// A client's answers, appended by the browser. Each one is a new version of that client's profile; the
// server supersedes advice drafted on an older version in the same transaction.
export const ClientProfiled = z.object({
  ...envelope,
  type: z.literal("client.profiled"),
  v: z.literal(1),
  payload: ClientProfile,
});

// Advice drafted by applying the suitability rules (never a model) to the latest profile and attributes.
// The advice's id is this event's event_id.
export const AdviceDrafted = z.object({
  ...envelope,
  type: z.literal("advice.drafted"),
  v: z.literal(1),
  payload: Advice,
});

// Advice drafted on a profile or attributes run that has since been replaced. It leaves the client's view
// but stays in the log, with any decision it was given.
export const AdviceSuperseded = z.object({
  ...envelope,
  type: z.literal("advice.superseded"),
  v: z.literal(1),
  payload: z.object({ advice_id: z.uuid(), cause: SupersedeCause }),
});

// The adviser's sign-off. Who decided is the envelope's actor, as for a disposition (ADR-0004).
export const AdviceDecided = z.object({
  ...envelope,
  type: z.literal("advice.decided"),
  v: z.literal(1),
  payload: z.object({ advice_id: z.uuid(), decision: AdviceDecision }),
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
  DispositionChanged,
  ClientProfiled,
  AdviceDrafted,
  AdviceSuperseded,
  AdviceDecided,
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
  DispositionChanged,
  ClientProfiled,
  AdviceDrafted,
  AdviceSuperseded,
  AdviceDecided,
]);
export type SlimEvent = z.infer<typeof SlimEvent>;

export type EventType = Event["type"];
export const EVENT_TYPES = Event.options.map((o) => o.shape.type.value) as readonly EventType[];
