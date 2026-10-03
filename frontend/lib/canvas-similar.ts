import {
  ANALYST_ACTOR,
  type CardId,
  type Citation,
  ErrorResponse,
  excerptCardId,
  FIND_SIMILAR_STEP,
  INSTANT_NEIGHBOURS,
  nearestStatements,
  type RunStepRequest,
  type SeedableStep,
  SlimEvent,
} from "@qryvox/shared";
import { StepFailureError } from "./api";
import type { CanvasView } from "./canvas-source";
import { errorMessage } from "./errors";
import recordedRuns from "./similar-recorded.json";

// Find similar, in two parts. A press of Similar first brings the card's nearest neighbours among the
// statements the case's extract run already holds (#60): no model, at once, and nothing stored but the
// press itself (card.similar_requested), from which the shared fold reads them back as cards
// (caseCards' neighbourOf). Once pressed, the card offers Look further, the model's run below.
//
// Look further (#57): from a card, a seeded re-run of extract over the documents (#64), whose passages come
// back as candidate cards (canvasView's candidateOf). A card of either kind re-runs extract, seeded with the
// passage it shows — a finding card with its own citation (#66), an excerpt card with its passage — because
// that is what the press means: more passages like the one on this card. The request is a card event
// (card.similar_requested) and the run an ordinary step run with a new step_run_id, so both are on the record
// like anything else, and a seeded run never becomes another step's input, so the findings on the board never
// change.

export type SimilarPlan = { step: SeedableStep; seed: Citation; inputRunId: string | null };

// What pressing Similar on a card would run, or why it cannot.
export function planSimilar(view: CanvasView, cardId: CardId): { plan: SimilarPlan } | { refused: string } {
  const card = view.cards.find((c) => c.cardId === cardId);
  if (!card) return { refused: "This card is no longer on the canvas." };
  // The passage the card shows: the finding's own citation, or the excerpt's.
  const seed = card.kind === "excerpt" ? card.citation : card.finding.citation;
  // extract reads the documents, so it consumes no earlier run.
  return { plan: { step: FIND_SIMILAR_STEP, seed, inputRunId: null } };
}

// What a press of Similar brings at once, read from the log as it stands: the neighbours' cards, in rank
// order, and which of them are not on the canvas yet. The rest already have a card, which is not drawn twice.
export type InstantSimilar = { neighbours: CardId[]; fresh: CardId[] };

export function instantSimilar(view: CanvasView, events: readonly SlimEvent[], cardId: CardId): InstantSimilar | { refused: string } {
  const planned = planSimilar(view, cardId);
  if ("refused" in planned) return planned;
  const neighbours = nearestStatements(events, planned.plan.seed, INSTANT_NEIGHBOURS).map((n) => excerptCardId(n.citation));
  const shown = new Set(view.cards.map((c) => c.cardId));
  return { neighbours, fresh: neighbours.filter((id) => !shown.has(id)) };
}

// Whether Similar has been pressed on this card, so its button now looks further, with the model.
export function asked(view: CanvasView, cardId: CardId): boolean {
  return view.state.board.similarRequests.some((r) => r.cardId === cardId);
}

// What a press came to, in a line.
export function instantSaid(found: InstantSimilar): string {
  const { neighbours, fresh } = found;
  if (neighbours.length === 0) return "Nothing the documents' extracted statements say is like it. Look further asks the model.";
  const had = neighbours.length - fresh.length;
  const added = fresh.length === 0 ? "" : `${fresh.length} added, marked Similar · instant`;
  const kept = had === 0 ? "" : `${had} already on the canvas, highlighted`;
  return `${neighbours.length} similar passage${neighbours.length === 1 ? "" : "s"} from the extracted statements: ${[added, kept].filter(Boolean).join("; ")}. Look further asks the model for more.`;
}

// The run's request, under a new run id: each press is a run of its own.
export function similarRequest(plan: SimilarPlan, stepRunId: string): RunStepRequest {
  return { step_run_id: stepRunId, step: plan.step, input_run_id: plan.inputRunId, seed: plan.seed };
}

// The candidate cards a run added to the canvas.
export function candidatesOf(view: CanvasView, stepRunId: string): CardId[] {
  return view.cards.flatMap((c) => (c.kind === "excerpt" && c.candidateOf === stepRunId ? [c.cardId] : []));
}

// Why a run did not finish, in a line the analyst can act on. A step that ran and failed (422, 502) left
// its step.failed on the log, and the reason it gives; a refusal before any run (401, 409, 429, 503) is
// the server's own reason, without the status line around it.
export function similarFailure(cause: unknown): string {
  if (cause instanceof StepFailureError) return `the model's run failed (${cause.failure.error}). It is on the record as a failed run.`;
  const message = errorMessage(cause);
  const status = /^POST \S+: (\d{3}) ([\s\S]*)$/.exec(message);
  if (!status) return message;
  let reason = status[2]!;
  try {
    reason = ErrorResponse.parse(JSON.parse(reason)).error;
  } catch {
    // Not the error contract: the text as the server sent it.
  }
  return status[1] === "429" ? `too many runs just now (${reason}). Try again in a little while.` : reason;
}

// --- The fixture. The recorded case has no model behind it, so find similar there plays back runs that
// were made on a model against that same recorded log, seeded from its cards: the events the backend
// wrote for them, with the heavy raw responses left out as the event list leaves them out. A card with no
// recording says so instead of pretending to run.

type RecordedRun = { step: SeedableStep; seed: Citation; input_run_id: string | null; model: string; prompt_version: string; output: Record<string, unknown> };
const RECORDED = recordedRuns as RecordedRun[];

function recordingFor(plan: SimilarPlan): RecordedRun | undefined {
  return RECORDED.find(
    (r) =>
      r.step === plan.step &&
      r.input_run_id === plan.inputRunId &&
      r.seed.document_id === plan.seed.document_id &&
      r.seed.page === plan.seed.page &&
      r.seed.quote === plan.seed.quote,
  );
}

export function hasRecording(view: CanvasView, cardId: CardId): boolean {
  const planned = planSimilar(view, cardId);
  return "plan" in planned && recordingFor(planned.plan) !== undefined;
}

// The recorded run as it would land on this log now: step.started and step.completed at the next seqs,
// under the run id given, or null when there is no recording for this plan.
export function playback(events: readonly SlimEvent[], plan: SimilarPlan, stepRunId: string, at: string): SlimEvent[] | null {
  const recorded = recordingFor(plan);
  const last = events.at(-1);
  if (!recorded || !last) return null;
  const run = { step: recorded.step, model: recorded.model, prompt_version: recorded.prompt_version, input_run_id: recorded.input_run_id, seed: recorded.seed };
  return (["step.started", "step.completed"] as const).map((type, i) =>
    SlimEvent.parse({
      seq: last.seq + 1 + i,
      event_id: crypto.randomUUID(),
      case_id: last.case_id,
      actor: ANALYST_ACTOR,
      at,
      step_run_id: stepRunId,
      type,
      v: 1,
      payload: type === "step.started" ? run : { ...run, output: recorded.output },
    }),
  );
}
