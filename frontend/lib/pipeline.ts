import { fold, type RunStepRequest, type SlimEvent, type StepName, type StepResult, type StepRun } from "@qryvox/shared";
import { errorMessage } from "./errors";

// The run, as the browser drives it: four stateless steps, each one awaited call, in this order
// (spec decision 19, ADR-0001). No background job, no stream, no server-side orchestration — which is
// why every word of progress below is read out of the case's log rather than remembered here. A browser
// that goes away mid-run has lost nothing but its place in the queue, and the log says where that was.
//
// step_run_id is the browser's to name (spec decision 25), and that one decision is what makes a failure
// recoverable and a retry free: a step never attempted gets a fresh id, and a step being retried is sent
// under the id its first attempt used, so the server can tell a retry from a second run before it spends
// anything (ADR-0002).
//
// Nothing in this file touches React or the DOM, so test/pipeline.test.ts drives the whole run in Node
// through the same three seams the case page hands it: the transport, the case log, and the id source.

// The four steps, in the order the run makes them. Each consumes the previous one's stored output, so the
// order is the whole of the pipeline's shape.
export const PIPELINE_STEPS = ["extract", "decompose", "contradictions", "findings"] as const satisfies readonly StepName[];

// What each step does, in the analyst's words rather than the step's: this is the only place the
// interface names the pipeline at all.
export const STEP_LABELS: Record<StepName, string> = {
  extract: "Extract statements",
  decompose: "Decompose into claims",
  contradictions: "Cross-check claims",
  findings: "Raise findings",
  // Not in PIPELINE_STEPS: run for advice, after the board (#29, #31).
  attributes: "Read product facts",
  explain: "Explain advice",
};

// pending is the fold's "no run for this step", kept as its own word so the panel can say a step has not
// run rather than leaving the row blank.
export type StepStatus = "pending" | "running" | "completed" | "failed";

// One step as the log tells it. Every field here is read out of the fold, never out of this module.
export type StepProgress = {
  step: StepName;
  // The run this step stands on: the newest the log names for it, or null where the log names none.
  runId: string | null;
  status: StepStatus;
  // What the server said when that run failed; null unless it did.
  error: string | null;
  // The completed run whose output it consumed, and null for extract, which reads the documents.
  inputRunId: string | null;
  // The event that last spoke for the run: step.completed or step.failed, or step.started while it runs.
  seq: number | null;
};

export type PipelineState = {
  // Always the four steps in order, whatever the log holds.
  steps: readonly StepProgress[];
  // The highest seq folded, so the panel can say how much of the log it read.
  lastSeq: number;
};

// What an attempt was told. step is null when the case log itself could not be read back, which is not a
// step's failure: nothing was run, and nothing here decides anything about a finding (spec decision 34).
export type AttemptFailure = { step: StepName | null; error: string };

// The run as it stands once an advance settles: the fold of the log it left behind, and that same log,
// so the board beneath the panel is rendered from one read rather than fetched twice.
export type PipelineRun = {
  pipeline: PipelineState;
  events: readonly SlimEvent[];
  failure: AttemptFailure | null;
};

// One awaited call. lib/api.ts's runStep with the case bound in, or a fake that records it: the runner
// never learns how a step is actually run.
export type StepTransport = (request: RunStepRequest) => Promise<StepResult>;

// Where a run's id comes from: crypto.randomUUID() in the browser, a counter in a test.
export type RunIdSource = () => string;

export type PipelineDeps = {
  steps: StepTransport;
  newRunId: RunIdSource;
  // The case's whole log, read again after every step settles. The runner decides nothing from the calls
  // it made: what has happened is whatever the log now says.
  readLog: () => Promise<readonly SlimEvent[]>;
  // Called the moment a step's call goes out, so the panel shows what is running rather than waiting for
  // a fold that has not yet seen the step.started the server is about to write.
  onStep?: (step: StepName, runId: string) => void;
};

// What the analyst asked for: one action per button on the run panel.
export type PipelineAction =
  | { kind: "start" }
  | { kind: "resume" }
  | { kind: "retry"; step: StepName }
  | { kind: "rerun"; step: StepName };

// The four steps as the log reads them. The newest run of each step wins, because a re-run appends a new
// run and the board shows the latest (ADR-0002); the runs before it stay in the log.
export function pipelineState(events: readonly SlimEvent[]): PipelineState {
  const state = fold(events);
  return {
    steps: PIPELINE_STEPS.map((step) => {
      const run = state.stepRuns.filter((candidate) => candidate.step === step).at(-1);
      return {
        step,
        runId: run?.stepRunId ?? null,
        status: run?.status ?? "pending",
        error: run?.error ?? null,
        inputRunId: run?.inputRunId ?? null,
        seq: run?.settledAtSeq ?? run?.startedAtSeq ?? null,
      };
    }),
    lastSeq: state.lastSeq,
  };
}

// The step a resume continues from: the first the log does not say completed. A run that stopped on a
// failure resumes there, under the run id it failed under.
export function resumePoint(state: PipelineState): StepProgress | null {
  return state.steps.find((step) => step.status !== "completed") ?? null;
}

// The step the log says failed, which is where the run stopped and where a retry is offered.
export function failedStep(state: PipelineState): StepProgress | null {
  return state.steps.find((step) => step.status === "failed") ?? null;
}

// The whole run, from the top, on a new run id for every step: what an analyst presses on a case that has
// not been analysed. It is also what starting again means on one that has, since a re-run of everything
// is a re-run of the first step.
export function startRun(deps: PipelineDeps): Promise<PipelineRun> {
  return advance(deps, "extract", true);
}

// Carry the run on from wherever it stopped. Where a step failed this is the same call the Retry button
// makes; it is here for the browser that reloaded the case, or lost the response to a call the server had
// already recorded, and so knows only what the log says.
export function resumeRun(deps: PipelineDeps): Promise<PipelineRun> {
  return advance(deps, null, false);
}

// Run one step again under the run id it failed under, then carry the rest of the chain on. Reusing the
// id is what keeps it one run in the log rather than two runs of the same step (spec decision 25).
export function retryStep(deps: PipelineDeps, step: StepName): Promise<PipelineRun> {
  return advance(deps, step, false);
}

// Re-run a scope: new run ids from the chosen step onwards, so the findings run that follows supersedes
// the findings the last one left on the board, and the earlier scope keeps its completed runs. Their
// findings stay in the log, and so do the dispositions on them (spec decision 10).
export function rerunFrom(deps: PipelineDeps, step: StepName): Promise<PipelineRun> {
  return advance(deps, step, true);
}

// One entry point for the panel's buttons, so the shell that owns the run never maps actions itself.
export function runAction(deps: PipelineDeps, action: PipelineAction): Promise<PipelineRun> {
  switch (action.kind) {
    case "start":
      return startRun(deps);
    case "resume":
      return resumeRun(deps);
    case "retry":
      return retryStep(deps, action.step);
    case "rerun":
      return rerunFrom(deps, action.step);
  }
}

// Runs the chain from `from` onwards, awaiting each call in turn and stopping at the first failure: a
// failed step is resumable board state, not a dead job (ADR-0001), so stopping here is what makes being
// resumed from here possible. `from` of null means "wherever the log says the run stopped". `fresh` says
// a step is to be run again even if the log has it completed, which is the whole of a re-run scope.
async function advance(deps: PipelineDeps, from: StepName | null, fresh: boolean): Promise<PipelineRun> {
  let events = await deps.readLog();
  const start = from ?? resumePoint(pipelineState(events))?.step ?? null;
  // Nothing left to do: a resume on a finished run makes no call at all, rather than re-sending work
  // that is already on the log.
  if (start === null) return { pipeline: pipelineState(events), events, failure: null };

  // The fold's whole run list, not the four rows the panel shows: a step can hold a completed run and a
  // later failed one, and it is the completed one a step after it consumes.
  const calls = plan(fold(events).stepRuns, start, fresh, deps.newRunId);
  for (const call of calls) {
    deps.onStep?.(call.step, call.step_run_id);
    try {
      await deps.steps(call);
      // Re-read and re-fold as each step settles, so what the panel shows is the log rather than this
      // loop's memory of it, and the board beneath is the same read.
      events = await deps.readLog();
    } catch (cause) {
      // Re-read on the way out too: the step.failed the server appended is the log's own record of what
      // it said, and the row reads the reason from there. A call that never reached the server appends
      // nothing at all, so the browser's own words travel back beside the fold rather than in place of it.
      const after = await deps.readLog().catch(() => events);
      return { pipeline: pipelineState(after), events: after, failure: { step: call.step, error: errorMessage(cause) } };
    }
  }
  return { pipeline: pipelineState(events), events, failure: null };
}

// The calls one advance makes, in order, and both of its rules are about never spending twice.
//
// A step the log says completed is not called for again unless this is a re-run scope, which exists to
// run it again — so a completed run is never re-sent, and the server's free retry for a call whose
// response was lost never has to be taken. And a step whose run has not completed is sent under that
// run's id: the retry restarts the run rather than starting a second one beside it (spec decision 25).
function plan(runs: readonly StepRun[], from: StepName, fresh: boolean, newRunId: RunIdSource): RunStepRequest[] {
  const calls: RunStepRequest[] = [];
  // StepName also names steps outside this chain (attributes, #29); none of them is ever a resume point.
  const start = (PIPELINE_STEPS as readonly StepName[]).indexOf(from);
  // The run the previous step of this advance ran under, as named above it.
  let previousRunId: string | null = null;

  for (const [index, step] of PIPELINE_STEPS.entries()) {
    if (index < start) continue;
    const latest = runs.filter((run) => run.step === step).at(-1);
    if (!fresh && latest?.status === "completed") {
      previousRunId = latest.stepRunId;
      continue;
    }
    const carried = !fresh && latest !== undefined ? latest.stepRunId : null;
    const stepRunId = carried ?? newRunId();
    calls.push({
      step,
      step_run_id: stepRunId,
      // What this step consumes is the run of the step before it in this same chain: the one just named,
      // or the completed one the log holds when that step is not part of this advance. extract reads the
      // documents instead, and so takes none.
      input_run_id: previousRunId ?? completedRunBefore(runs, index),
    });
    previousRunId = stepRunId;
  }
  return calls;
}

// The newest completed run of the step before `index`, or null where the log holds none. A step cannot
// consume a run that never completed, and the server says exactly that when it is asked to, so the
// browser does not pre-empt the refusal with a guess of its own.
function completedRunBefore(runs: readonly StepRun[], index: number): string | null {
  const previous = PIPELINE_STEPS[index - 1];
  if (previous === undefined) return null;
  return runs.filter((run) => run.step === previous && run.status === "completed").at(-1)?.stepRunId ?? null;
}
