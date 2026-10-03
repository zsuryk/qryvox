"use client";

import { useState } from "react";
import type { SlimEvent, StepName } from "@qryvox/shared";
import { errorMessage } from "../lib/errors";
import {
  failedStep,
  type AttemptFailure,
  type PipelineAction,
  pipelineState,
  PIPELINE_STEPS,
  type PipelineState,
  resumePoint,
  type StepProgress,
  STEP_LABELS,
  type StepStatus,
} from "../lib/pipeline";

// The run, above the board it fills. One row per step, in the order the run makes them, each saying in words where
// it has got to — running, done, failed, waiting — because the word is the signal and the colour only
// repeats it. Nothing here asks the analyst to write anything: the panel is four states and three
// kinds of button, and every one of them is a scope the run can take.
//
// Progress is folded out of the case's log here rather than kept, exactly as the board beneath it is: a
// reload, a shared link or a step that failed somewhere else all read the same (ADR-0002).

// One tone per state, and the word beside it in every row: a failed step must not rely on colour alone.
// Every control here is a real button, so it is reachable by keyboard and announced as one, and the
// stylesheet never removes the focus ring.
const STATE: Record<StepStatus, { label: string; tone: string }> = {
  running: { label: "Running", tone: "badge--tint" },
  completed: { label: "Done", tone: "badge--positive" },
  failed: { label: "Failed", tone: "badge--negative" },
  pending: { label: "Waiting", tone: "" },
};

export type PipelineProps = {
  log: readonly SlimEvent[];
  // The step whose call is in flight, as the run reports it, and whether a run is in flight at all: a
  // step's call is made before the log can show it, so the fold alone would read as a stalled panel.
  running: StepName | null;
  busy: boolean;
  // What the last attempt was told, for the failure the log has nothing to say about.
  failure: AttemptFailure | null;
  onAction: (action: PipelineAction) => void;
};

export default function Pipeline({ log, running, busy, failure, onAction }: PipelineProps) {
  const [scope, setScope] = useState<StepName | null>(null);

  // Guarded for the reason the board is: a gap in the log is a hard error, never four steps that look
  // as though they never ran.
  let state: PipelineState;
  try {
    state = pipelineState(log);
  } catch (cause) {
    return (
      <p className="notice notice--negative t-callout">
        This run cannot be read from the case&apos;s log: {errorMessage(cause)}
      </p>
    );
  }

  const done = state.steps.filter((step) => step.status === "completed").length;
  const resume = resumePoint(state);
  // The step the run stopped on: the one the log says failed, or — when the call never reached the server
  // and the log has nothing — the one this browser was told about.
  const stopped = failedStep(state) ?? state.steps.find((step) => step.step === failure?.step) ?? null;
  // A stop on a step the log already has done is not a failure to retry: it was the answer that was lost,
  // not the run, and the chain is picked up at the step after it. Two cases, two affordances, because
  // "retry" on a completed run would spend tokens to be told what the log already says.
  const lost = stopped !== null && stopped.status === "completed" ? stopped : null;
  const retrying = stopped !== null && lost === null ? stopped : null;
  const stoppedError = stopped === null ? null : stopped.error ?? failure?.error ?? null;

  // The step being run reads as running even where the fold has not seen its step.started yet: the
  // server writes that event, but the browser is the one that knows it asked.
  const statusOf = (step: StepProgress): StepStatus => (running === step.step ? "running" : step.status);

  return (
    <section aria-labelledby="run-heading" className="section">
      <div className="section-head">
        <h2 id="run-heading" className="t-title">
          Run
        </h2>
        <span className="t-footnote muted">
          {done} of {PIPELINE_STEPS.length} steps done · the board below is this run&apos;s
        </span>
      </div>

      <div className="card stack" style={{ "--stack-gap": "0.875rem" } as React.CSSProperties}>
        <div className="row spread">
          <p aria-live="polite" role="status" className={`t-callout${retrying === null ? "" : " text-negative"}`}>
            {summary(state, running, retrying, lost, stoppedError, failure)}
          </p>
          {retrying === null && lost === null && resume !== null && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => onAction({ kind: done === 0 ? "start" : "resume" })}
            >
              {done === 0 ? "Run the pipeline" : `Resume from ${STEP_LABELS[resume.step]}`}
            </button>
          )}
        </div>

        <ol className="steps">
          {state.steps.map((step, index) => {
            const status = statusOf(step);
            const offered = retrying?.step === step.step ? retrying : lost?.step === step.step ? lost : null;
            const error = offered === null ? null : stoppedError;
            return (
              <li key={step.step} className={`step step--${status}`}>
                <span className="step__index" aria-hidden>
                  {status === "completed" ? "✓" : index + 1}
                </span>
                <span className="t-callout strong step__name">{STEP_LABELS[step.step]}</span>
                <span className={`badge ${STATE[status].tone}`}>
                  <span className="dot" />
                  {STATE[status].label}
                </span>
                <span className="t-caption faint">
                  {step.runId === null ? "not run yet" : `run ${step.runId.slice(0, 8)}…${step.seq === null ? "" : ` · event ${step.seq}`}`}
                </span>
                {offered !== null && lost === null && (
                  <button
                    type="button"
                    className="btn btn--small"
                    aria-label={`Retry ${STEP_LABELS[step.step]} under run ${step.runId?.slice(0, 8) ?? "—"}`}
                    disabled={busy}
                    onClick={() => onAction({ kind: "retry", step: step.step })}
                  >
                    Retry
                  </button>
                )}
                {offered !== null && lost !== null && (
                  <button
                    type="button"
                    className="btn btn--small"
                    aria-label={`Continue the run from ${resume === null ? "the last step" : STEP_LABELS[resume.step]}`}
                    disabled={busy || resume === null}
                    onClick={() => onAction({ kind: "resume" })}
                  >
                    Continue
                  </button>
                )}
                {error !== null && (
                  <span className="t-footnote text-negative step__error">
                    {error}
                    {/* Two different promises, and the panel must not blur them: retrying a step that failed
                        calls the model again — there is no stored result to return — while continuing past a
                        step the log already holds a completed result for spends nothing, because the server
                        returns that result before it reaches the model (ADR-0002). Both reuse the run id,
                        which is what keeps a retry inside one run rather than forking a second. */}
                    {lost === null && step.runId !== null && " — retrying calls the model again, under the same run id."}
                    {lost !== null && " — the log already holds this run's result, so continuing costs nothing."}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <details>
          <summary>Re-run a scope</summary>
          <div className="stack" style={{ "--stack-gap": "0.625rem", marginTop: "0.75rem" } as React.CSSProperties}>
            <p className="t-footnote muted measure">
              A re-run takes new run ids from the step you choose, so a new findings run supersedes the findings the last
              one put up. Their decisions stay in the log.
            </p>
            <div role="group" aria-label="Choose the step a re-run starts from" className="row">
              {state.steps.map((step) => (
                <button
                  key={step.step}
                  type="button"
                  className="chip"
                  aria-pressed={scope === step.step}
                  disabled={busy}
                  onClick={() => setScope((current) => (current === step.step ? null : step.step))}
                >
                  {STEP_LABELS[step.step]}
                </button>
              ))}
            </div>
            <div>
              <button
                type="button"
                className="btn btn--primary"
                aria-label={scope === null ? "Choose a step to re-run" : `Re-run from ${STEP_LABELS[scope]}`}
                disabled={busy || scope === null}
                onClick={() => {
                  if (scope === null) return;
                  onAction({ kind: "rerun", step: scope });
                  setScope(null);
                }}
              >
                {scope === null ? "Re-run from…" : `Re-run from ${STEP_LABELS[scope]}`}
              </button>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

// What the panel says out loud, one sentence: what is running now, or what stopped the run and what can be
// done about it. A silent panel reads as a stalled page, which is the one thing this run never is.
function summary(
  state: PipelineState,
  running: StepName | null,
  retrying: StepProgress | null,
  lost: StepProgress | null,
  stoppedError: string | null,
  failure: AttemptFailure | null,
): string {
  if (running !== null) return `Running ${STEP_LABELS[running]}.`;
  if (retrying !== null) return `Stopped at ${STEP_LABELS[retrying.step]}: ${stoppedError ?? "the server did not say why"}.`;
  if (lost !== null) return `The log has ${STEP_LABELS[lost.step]} done — the last attempt never got an answer back.`;
  if (failure !== null) return failure.error;
  const done = state.steps.filter((step) => step.status === "completed");
  const last = done.at(-1);
  if (done.length === PIPELINE_STEPS.length) return `All ${PIPELINE_STEPS.length} steps completed.`;
  // A case reviewed before the rules check existed: its board stands, raised without the check.
  const missing = resumePoint(state);
  if (missing !== null && state.steps.some((step, i) => i > state.steps.indexOf(missing) && step.status === "completed")) {
    return `This case was reviewed before ${STEP_LABELS[missing.step].toLowerCase()} existed. Resume to run it; the findings are raised again on top of it.`;
  }
  if (last === undefined) return "Nothing has run yet. Start the run and each step waits for the one before it.";
  return `The run stopped after ${STEP_LABELS[last.step]}; it can be resumed.`;
}
