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

// The run, above the board it fills. Four rows in the order the run makes them, each saying in words where
// it has got to — running, done, failed, waiting — because the word is the signal and the colour only
// repeats it. Nothing here asks the analyst to write anything: the panel is four states and three
// buttons, and every one of them is a scope the run can take.
//
// Progress is folded out of the case's log here rather than kept, exactly as the board beneath it is: a
// reload, a shared link or a step that failed somewhere else all read the same (ADR-0002).

const MUTED = "#5b6270";
const LINE = "#d5d9e0";
const ACCENT = "#1f4f8f";
// One colour per state, and the word beside it in every row: a failed step must not rely on colour alone.
const STATE: Record<StepStatus, { label: string; colour: string }> = {
  running: { label: "Running", colour: ACCENT },
  completed: { label: "Done", colour: "#1c6b4a" },
  failed: { label: "Failed", colour: "#a02c2c" },
  pending: { label: "Waiting", colour: MUTED },
};

// Every control here is a real button, so it is reachable by keyboard and announced as one. No outline is
// removed anywhere in this file, which is what keeps the browser's focus ring visible on it.
const quiet = { background: "#ffffff", border: `1px solid ${LINE}`, borderRadius: 6, color: MUTED, cursor: "pointer", font: "inherit", fontSize: "0.85rem", padding: "6px 12px" } as const;
const strong = { ...quiet, background: ACCENT, borderColor: ACCENT, color: "#ffffff" } as const;

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
      <p style={{ color: "#a02c2c" }}>
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
    <section aria-labelledby="run-heading" style={{ marginBottom: 28 }}>
      <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 12 }}>
        <h2 id="run-heading" style={{ margin: 0 }}>
          Run
        </h2>
        <p style={{ color: MUTED, margin: 0 }}>
          <strong>{done}</strong> of <strong>{PIPELINE_STEPS.length}</strong> steps done · the board below is this run&apos;s
        </p>
      </div>

      <p aria-live="polite" role="status" style={{ color: retrying === null ? MUTED : "#a02c2c", margin: "8px 0 0" }}>
        {summary(state, running, retrying, lost, stoppedError, failure)}
      </p>

      {retrying === null && lost === null && resume !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction({ kind: done === 0 ? "start" : "resume" })}
          style={{ ...strong, marginTop: 10, opacity: busy ? 0.6 : 1 }}
        >
          {done === 0 ? "Run the pipeline" : `Resume from ${STEP_LABELS[resume.step]}`}
        </button>
      )}

      <ol style={{ listStyle: "decimal inside", margin: "12px 0 0", maxWidth: "70ch", padding: 0 }}>
        {state.steps.map((step) => {
          const status = statusOf(step);
          const offered = retrying?.step === step.step ? retrying : lost?.step === step.step ? lost : null;
          const error = offered === null ? null : stoppedError;
          return (
            <li key={step.step} style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 10, padding: "5px 0" }}>
              <span style={{ fontWeight: 600, minWidth: "17ch" }}>{STEP_LABELS[step.step]}</span>
              <span style={{ color: STATE[status].colour, fontSize: "0.85rem", fontWeight: 600 }}>{STATE[status].label}</span>
              <span style={{ color: MUTED, fontSize: "0.75rem" }}>
                {step.runId === null ? "not run yet" : `run ${step.runId.slice(0, 8)}…${step.seq === null ? "" : ` · event ${step.seq}`}`}
              </span>
              {offered !== null && lost === null && (
                <button
                  type="button"
                  aria-label={`Retry ${STEP_LABELS[step.step]} under run ${step.runId?.slice(0, 8) ?? "—"}`}
                  disabled={busy}
                  onClick={() => onAction({ kind: "retry", step: step.step })}
                  style={{ ...quiet, padding: "2px 10px" }}
                >
                  Retry
                </button>
              )}
              {offered !== null && lost !== null && (
                <button
                  type="button"
                  aria-label={`Continue the run from ${resume === null ? "the last step" : STEP_LABELS[resume.step]}`}
                  disabled={busy || resume === null}
                  onClick={() => onAction({ kind: "resume" })}
                  style={{ ...quiet, padding: "2px 10px" }}
                >
                  Continue
                </button>
              )}
              {error !== null && (
                <span style={{ color: "#a02c2c", flexBasis: "100%", fontSize: "0.85rem" }}>
                  {error}
                  {lost === null && step.runId !== null && " — the retry runs it again under the same run id, so it stays one run in the log."}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <details style={{ marginTop: 14 }}>
        <summary style={{ color: MUTED, cursor: "pointer", fontSize: "0.8rem" }}>Re-run a scope</summary>
        <p style={{ color: MUTED, fontSize: "0.8rem", margin: "8px 0", maxWidth: "62ch" }}>
          A re-run takes new run ids from the step you choose, so a new findings run supersedes the findings the last
          one put up. Their decisions stay in the log.
        </p>
        <div role="group" aria-label="Choose the step a re-run starts from" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {state.steps.map((step) => (
            <button
              key={step.step}
              type="button"
              aria-pressed={scope === step.step}
              disabled={busy}
              onClick={() => setScope((current) => (current === step.step ? null : step.step))}
              style={scope === step.step ? strong : quiet}
            >
              {STEP_LABELS[step.step]}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={scope === null ? "Choose a step to re-run" : `Re-run from ${STEP_LABELS[scope]}`}
          disabled={busy || scope === null}
          onClick={() => {
            if (scope === null) return;
            onAction({ kind: "rerun", step: scope });
            setScope(null);
          }}
          style={{ ...strong, marginTop: 8, opacity: busy || scope === null ? 0.6 : 1 }}
        >
          {scope === null ? "Re-run from…" : `Re-run from ${STEP_LABELS[scope]}`}
        </button>
      </details>
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
  if (done.length === PIPELINE_STEPS.length) return "All four steps completed.";
  if (last === undefined) return "Nothing has run yet. Start the run and each step waits for the one before it.";
  return `The run stopped after ${STEP_LABELS[last.step]}; it can be resumed.`;
}