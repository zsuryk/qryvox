import {
  ANALYST_ACTOR,
  type CardId,
  type Citation,
  ErrorResponse,
  type RunStepRequest,
  type SeedableStep,
  similarStep,
  SlimEvent,
} from "@qryvox/shared";
import { StepFailureError } from "./api";
import type { CanvasView } from "./canvas-source";
import { errorMessage } from "./errors";
import recordedRuns from "./similar-recorded.json";

// Find similar (#57): from a card, a seeded re-run of the step that produced it (#64), whose passages come
// back as candidate cards (canvasView's candidateOf). A finding card re-runs contradictions over the latest
// completed decompose run, seeded with the passage the finding is cited on; an excerpt card re-runs extract
// over the documents, seeded with its own passage. The request is a card event (card.similar_requested) and
// the run an ordinary step run with a new step_run_id, so both are on the record like anything else, and a
// seeded run never becomes another step's input, so the findings on the board never change.

export type SimilarPlan = { step: SeedableStep; seed: Citation; inputRunId: string | null };

// What pressing Similar on a card would run, or why it cannot.
export function planSimilar(view: CanvasView, cardId: CardId): { plan: SimilarPlan } | { refused: string } {
  const card = view.cards.find((c) => c.cardId === cardId);
  if (!card) return { refused: "This card is no longer on the canvas." };
  const step = similarStep(cardId);
  if (card.kind === "excerpt") return { plan: { step, seed: card.citation, inputRunId: null } };
  // The latest completed decompose run of the pipeline: seeded runs are kept apart in the fold, so this is
  // never one of them.
  const decompose = view.state.stepRuns.filter((r) => r.step === "decompose" && r.status === "completed").at(-1);
  if (!decompose) return { refused: "There are no claims to look through: this case has no completed decompose run." };
  return { plan: { step, seed: card.finding.citation, inputRunId: decompose.stepRunId } };
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
