import type { SlimEvent } from "./events.js";
import type { StepRun } from "./state.js";

// How long the model gets to answer one step before the call is given up (LLM_TIMEOUT_MS's default), and
// the margin after it before a run still "running" is taken to have been abandoned (#75).
export const STEP_TIMEOUT_MS = 240_000;
export const ABANDONED_MARGIN_MS = 60_000;

// A run the log still shows as running long after its call could have lasted: the browser that started it
// closed or lost its connection, and nothing will ever settle it. Taken as abandoned, never as completed or
// failed: the log is not rewritten, so a late completion by the same run id still wins in the fold. `now` is
// the reader's clock, in epoch milliseconds, because the fold has none.
export function isAbandoned(events: readonly SlimEvent[], run: StepRun, now: number): boolean {
  if (run.status !== "running") return false;
  const started = events.find((e) => e.seq === run.startedAtSeq);
  return started !== undefined && now - Date.parse(started.at) > STEP_TIMEOUT_MS + ABANDONED_MARGIN_MS;
}
