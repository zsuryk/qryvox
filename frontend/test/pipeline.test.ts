import { describe, expect, it } from "vitest";
import {
  activeFindings,
  dispositionOf,
  fold,
  type Finding,
  PROMPT_VERSIONS,
  type RunStepRequest,
  SlimEvent,
  type StepName,
  type StepResult,
} from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { boardView, CATEGORIES } from "../lib/board";
import { StepFailureError } from "../lib/api";
import {
  PIPELINE_STEPS,
  type PipelineDeps,
  pipelineState,
  rerunFrom,
  resumeRun,
  retryStep,
  STEP_LABELS,
  startRun,
} from "../lib/pipeline";

// The run, driven the way the browser drives it: awaited calls against a stand-in for the step endpoint,
// with the log it appends to folded after every step. Nothing here asserts how the runner keeps its own
// state — every assertion is about the calls it made and about the log and the board they left.

const recordedLog = SlimEvent.array().parse(recorded);
const all = [...CATEGORIES];

// A whole real pipeline run: extract failed and was retried under the same run id, and a re-run of the
// last two steps superseded the finding the first findings run put up.
const extractRun = "47bd346a-4bf6-4080-8e0b-7cd1ce3af623";
const decomposeRun = "36420df8-f52b-4942-b7d3-7062a3921c73";

// What the stand-in was told to do on which steps, as many times as it is left in the script: a test that
// wants the second attempt to behave clears its step out first, which is what a flaky model does.
type StepScript = Partial<Record<StepName, string>>;
// A step in `fails` runs and fails; a step in `loses` runs to completion and then loses the answer on the
// way back. They are the two ways a call does not return, and the browser has to be able to tell them
// apart: one is a run to retry, the other is a run the log already holds.
type Script = { fails: StepScript; loses: StepScript };

// The common case, said once: a model misbehaving on one step and behaving on the rest.
const misbehavesOn = (step: StepName, error: string): Script => ({ fails: { [step]: error }, loses: {} });

type Call = { step: StepName; step_run_id: string; input_run_id: string | null };
type Told = { kind: "step"; step: StepName; run_id: string } | { kind: "call"; step: StepName; run_id: string };

const CASE = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-02T09:00:00.000Z";
// Event ids the log refuses to take as anything but a uuid, minted in order so a log reads in order.
const eventId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// One finding per findings run, as the step would put it up: a fee contradiction with both citations, so
// the board has something real to fold rather than a placeholder row.
const finding = (run: number): Finding => ({
  finding_id: `finding-${run}`,
  category: "fees",
  kind: "contradiction",
  severity: "high",
  claim: `The factsheet states 0.85% per annum where the fee table states 1.25% (run ${run}).`,
  citation: { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.85% per annum" },
  counterpart: { document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value" },
});

// The step endpoint, as the browser meets it. Appends what backend/src/steps/run.ts appends — step.started,
// then step.completed or step.failed, and for a findings run its findings plus a finding.superseded for
// every finding still on the board — and hands back the stored result of a run that already completed,
// which is what makes a retry of one free.
function stepApi(seed: readonly SlimEvent[] = [], script: Script = { fails: {}, loses: {} }) {
  const events: SlimEvent[] = [...seed];
  const calls: Call[] = [];
  const told: Told[] = [];
  // The case the seed belongs to, so a run driven onto the recorded case appends to that case's log.
  const caseId = events[0]?.case_id ?? CASE;
  let eventSeq = events.at(-1)?.seq ?? 0;
  let minted = events.length;
  let runs = 0;

  // The envelope the server writes around every event, so the stand-in cannot append something the fold
  // would never have been handed: the event goes through the log's own schema on the way in.
  const append = (event: Record<string, unknown>): number => {
    events.push(SlimEvent.parse({ ...event, seq: ++eventSeq, event_id: eventId(eventSeq), case_id: caseId, actor: "demo-analyst", at: AT, v: 1 }));
    return eventSeq;
  };

  const completed = (request: RunStepRequest): StepResult | null => {
    const stored = events.find((event) => event.type === "step.completed" && event.step_run_id === request.step_run_id);
    return stored === undefined
      ? null
      : { step_run_id: request.step_run_id, step: request.step, seq: stored.seq, prompt_version: PROMPT_VERSIONS[request.step], model: "fake-model", output: {} };
  };

  const deps = (): PipelineDeps => ({
    steps: async (request) => {
      calls.push({ ...request });
      told.push({ kind: "call", step: request.step, run_id: request.step_run_id });
      const stored = completed(request);
      if (stored !== null) return stored;

      const run = {
        step: request.step,
        model: "fake-model",
        prompt_version: PROMPT_VERSIONS[request.step],
        input_run_id: request.input_run_id,
      };
      append({ type: "step.started", payload: run, step_run_id: request.step_run_id });

      const failure = script.fails[request.step];
      if (failure !== undefined) {
        const seq = append({ type: "step.failed", payload: { ...run, error: failure }, step_run_id: request.step_run_id });
        throw new StepFailureError({ error: failure, step_run_id: request.step_run_id, seq });
      }

      // A findings run replaces the board: everything still on it is superseded in the same write as the
      // completion, then the new findings go up (ADR-0002's re-run rule).
      const superseded = new Set(
        events.filter((event) => event.type === "finding.superseded").map((event) => event.payload.finding_id),
      );
      const onBoard = events.filter((event) => event.type === "finding.created").map((event) => event.payload.finding_id);
      const seq = append({ type: "step.completed", payload: { ...run, output: {} }, step_run_id: request.step_run_id });
      const result: StepResult = {
        step_run_id: request.step_run_id,
        step: request.step,
        seq,
        prompt_version: run.prompt_version,
        model: run.model,
        output: {},
      };
      if (request.step === "findings") {
        for (const finding_id of onBoard.filter((id) => !superseded.has(id))) {
          append({ type: "finding.superseded", payload: { finding_id }, step_run_id: request.step_run_id });
        }
        append({ type: "finding.created", payload: finding(++runs), step_run_id: request.step_run_id });
      }

      // The run is on the log and complete; the answer to it is what gets lost.
      const lost = script.loses[request.step];
      if (lost !== undefined) throw new Error(lost);
      return result;
    },
    newRunId: () => `run-${++minted}`,
    readLog: async () => [...events],
    onStep: (step, runId) => told.push({ kind: "step", step, run_id: runId }),
  });

  return { deps, calls, told, events, script };
}

// A case that has been opened and nothing else, as the log is before any step runs.
const opened = (): SlimEvent[] => [
  {
    seq: 1,
    type: "case.opened",
    v: 1,
    event_id: eventId(1),
    case_id: CASE,
    actor: "demo-analyst",
    at: AT,
    step_run_id: null,
    payload: {},
  },
];

describe("starting the run", () => {
  it("runs the steps in order, each named before its call and each awaiting the one before it", async () => {
    const { deps, calls, told } = stepApi(opened());

    await startRun(deps());

    // One step is named, then called, then the next: the panel can only show what is running if the run
    // says so before the call goes out, and it is what a parallel runner would not look like.
    expect(told.map((entry) => [entry.kind, entry.step])).toEqual(
      PIPELINE_STEPS.flatMap((step) => [
        ["step", step],
        ["call", step],
      ]),
    );
    expect(calls.map((call) => call.step)).toEqual([...PIPELINE_STEPS]);
    // extract reads the documents and takes none; every step after it consumes the run before it, which
    // it can only know once that run has answered.
    expect(calls[0]!.input_run_id).toBeNull();
    expect(calls.slice(1).map((call) => call.input_run_id)).toEqual(calls.slice(0, -1).map((call) => call.step_run_id));
    expect(new Set(calls.map((call) => call.step_run_id)).size).toBe(PIPELINE_STEPS.length);
  });

  it("shows every step done on the panel, each against the run that did it, as the log records it", async () => {
    const { deps, calls, events } = stepApi(opened());

    await startRun(deps());

    expect(pipelineState(events).steps).toEqual(
      calls.map((call) => ({
        step: call.step,
        runId: call.step_run_id,
        status: "completed",
        error: null,
        inputRunId: call.input_run_id,
        seq: expect.any(Number),
      })),
    );
    expect(pipelineState(events).lastSeq).toBe(events.at(-1)!.seq);
  });

  it("puts the findings of its last run on the board, and only those", async () => {
    const { deps, events } = stepApi(opened());

    await startRun(deps());

    const view = boardView(events, all);
    expect(view.active).toBe(1);
    expect(view.cards.map((card) => card.runId)).toEqual([events.at(-1)!.step_run_id]);
    expect(view.scope?.step).toBe("findings");
  });
});

describe("a step that fails", () => {
  // The model behaving badly on one step, for as long as the test leaves it in the script.
  const failed = () => stepApi(opened(), misbehavesOn("decompose", "model output did not match the decompose schema"));

  it("stops the run at that step and says what the server said", async () => {
    const { deps, calls, events } = failed();

    const run = await startRun(deps());

    expect(calls.map((call) => call.step)).toEqual(["extract", "decompose"]);
    expect(run.failure).toEqual({ step: "decompose", error: "model output did not match the decompose schema" });
    // The log carries the reason too, which is where the panel reads it from.
    expect(pipelineState(events).steps.find((step) => step.step === "decompose")).toMatchObject({
      status: "failed",
      error: "model output did not match the decompose schema",
    });
    expect(pipelineState(events).steps.map((step) => step.status)).toEqual(["completed", "failed", "pending", "pending", "pending"]);
  });

  it("leaves the board usable, still folded from the log, while a step is failed", async () => {
    // The recorded case: a real board of six findings, and a re-run of the last scope that fails.
    const api = stepApi(recordedLog, misbehavesOn("findings", "model endpoint unreachable"));

    const run = await rerunFrom(api.deps(), "findings");

    expect(run.failure).toMatchObject({ step: "findings" });
    expect(boardView(run.events, all)).toMatchObject({ active: 6, visible: 6, cards: expect.any(Array) });
    expect(boardView(run.events, all).cards.map((card) => card.runId)).toEqual(activeFindings(fold(recordedLog)).map((finding) => finding.stepRunId));
  });

  it("retries under the run id it failed under, so it stays one run in the log", async () => {
    const api = failed();
    await startRun(api.deps());
    const first = api.calls.at(-1)!;
    delete api.script.fails.decompose;

    await retryStep(api.deps(), "decompose");

    expect(api.calls[2]).toEqual({ step: "decompose", step_run_id: first.step_run_id, input_run_id: first.input_run_id });
    // One run in the fold, started twice and completed once: a retry restarts its run, it does not add one.
    expect(fold(api.events).stepRuns.filter((run) => run.stepRunId === first.step_run_id)).toEqual([
      { stepRunId: first.step_run_id, step: "decompose", status: "completed", model: "fake-model", promptVersion: "decompose@1", inputRunId: first.input_run_id, startedAtSeq: expect.any(Number), settledAtSeq: expect.any(Number), error: null },
    ]);
    expect(api.events.filter((event) => event.type === "step.started" && event.step_run_id === first.step_run_id)).toHaveLength(2);
  });

  it("calls a run that has already completed not at all, so a resume spends nothing", async () => {
    const api = stepApi(opened());
    await startRun(api.deps());
    const before = { calls: api.calls.length, events: api.events.length };

    const run = await resumeRun(api.deps());

    expect(api.calls).toHaveLength(before.calls);
    expect(api.events).toHaveLength(before.events);
    expect(run.failure).toBeNull();
    expect(pipelineState(run.events).steps.map((step) => step.status)).toEqual(["completed", "completed", "completed", "completed", "completed"]);
  });

  it("takes an answer the log already holds as an answer, rather than asking for the run again", async () => {
    // The call that never came back: the run is on the log and complete, and the browser heard nothing.
    const api = stepApi(opened(), { fails: {}, loses: { contradictions: "Failed to fetch" } });

    const run = await startRun(api.deps());
    api.calls.length = 0;

    expect(run.failure).toEqual({ step: "contradictions", error: "Failed to fetch" });
    expect(pipelineState(run.events).steps.map((step) => step.status)).toEqual(["completed", "completed", "completed", "pending", "pending"]);

    await retryStep(api.deps(), "contradictions");

    // The step the log says completed is not sent again, so the server spends nothing on it; the chain
    // picks up at the rules check instead.
    expect(api.calls.map((call) => call.step)).toEqual(["compliance", "findings"]);
  });
});

describe("resuming", () => {
  it("continues from the failed step without redoing the ones that completed", async () => {
    const api = stepApi(opened(), misbehavesOn("contradictions", "model endpoint unreachable"));
    await startRun(api.deps());
    const stoppedAt = api.calls.at(-1)!;
    api.calls.length = 0;
    delete api.script.fails.contradictions;

    await retryStep(api.deps(), "contradictions");

    // extract and decompose are not sent again, and the failed run goes back out under its own id.
    expect(api.calls.map((call) => call.step)).toEqual(["contradictions", "compliance", "findings"]);
    expect(api.calls[0]!.step_run_id).toBe(stoppedAt.step_run_id);
    expect(api.calls[1]!.input_run_id).toBe(stoppedAt.step_run_id);
  });

  it("picks up a run a reloaded browser knows nothing about, from the first step the log has not completed", async () => {
    const first = stepApi(opened(), misbehavesOn("findings", "model endpoint unreachable"));
    await startRun(first.deps());
    const compliance = first.calls.at(-2)!;

    // A browser that has only the log, as after a reload: nothing in its memory of which ids it named.
    const reloaded = stepApi(first.events);

    await resumeRun(reloaded.deps());

    // The four that completed are not sent again, and the findings run is fed the compliance run the log
    // says completed rather than one this browser had to remember.
    expect(reloaded.calls.map((call) => call.step)).toEqual(["findings"]);
    expect(reloaded.calls[0]!.input_run_id).toBe(compliance.step_run_id);
    expect(reloaded.calls[0]!.step_run_id).toBe(first.calls.at(-1)!.step_run_id);
    expect(pipelineState(reloaded.events).steps.map((step) => step.status)).toEqual(["completed", "completed", "completed", "completed", "completed"]);
  });

  it("on a case reviewed before the rules check existed, runs the check and raises the findings again on it", async () => {
    // The recorded case ran four steps: its findings consumed the cross-check directly.
    const api = stepApi(recordedLog);

    await resumeRun(api.deps());

    expect(api.calls.map((call) => call.step)).toEqual(["compliance", "findings"]);
    expect(api.calls[0]!.input_run_id).toBe("1319d46c-9772-4f71-bb08-c0bfc3372780");
    expect(api.calls[1]!.input_run_id).toBe(api.calls[0]!.step_run_id);
    // Nothing before the check is sent again.
    expect(api.calls.some((call) => ["extract", "decompose", "contradictions"].includes(call.step))).toBe(false);
  });
});

describe("re-running a scope", () => {
  it("appends a new run with a fresh run id from the chosen step onwards, and spends nothing before it", async () => {
    const api = stepApi(recordedLog);

    await rerunFrom(api.deps(), "contradictions");

    expect(api.calls.map((call) => call.step)).toEqual(["contradictions", "compliance", "findings"]);
    const known = new Set(recordedLog.flatMap((event) => (event.step_run_id === null ? [] : [event.step_run_id])));
    expect(api.calls.some((call) => known.has(call.step_run_id))).toBe(false);
    // The step before the scope keeps supplying the input, and each new run consumes the new run before it
    // rather than the one it replaced.
    expect(api.calls[0]!.input_run_id).toBe(decomposeRun);
    expect(api.calls[1]!.input_run_id).toBe(api.calls[0]!.step_run_id);
    expect(api.calls[2]!.input_run_id).toBe(api.calls[1]!.step_run_id);
  });

  it("re-runs the findings of a case reviewed before the rules check on the cross-check it consumed", async () => {
    const api = stepApi(recordedLog);

    await rerunFrom(api.deps(), "findings");

    // No compliance run to feed it: the findings run is fed past it, as the case's own findings were.
    expect(api.calls.map((call) => [call.step, call.input_run_id])).toEqual([["findings", "1319d46c-9772-4f71-bb08-c0bfc3372780"]]);
  });

  it("supersedes the findings the earlier run left on the board, under the new run", async () => {
    const api = stepApi(recordedLog);

    const run = await rerunFrom(api.deps(), "findings");

    const runId = api.calls[0]!.step_run_id;
    const superseded = activeFindings(fold(recordedLog)).map((finding) => finding.finding_id);
    expect(run.events.filter((event) => event.type === "finding.superseded" && event.step_run_id === runId)).toHaveLength(6);
    expect(activeFindings(fold(run.events)).map((finding) => finding.finding_id)).not.toEqual(expect.arrayContaining(superseded));
    expect(boardView(run.events, all).cards.map((card) => card.findingId)).not.toEqual(expect.arrayContaining(superseded));
  });

  it("shows the latest run on the board, and the steps that led to it", async () => {
    const api = stepApi(recordedLog);

    const run = await rerunFrom(api.deps(), "contradictions");

    // Seven findings off the board in all: the one the recorded re-run replaced, and the six this run.
    const runId = api.calls.at(-1)!.step_run_id;
    expect(boardView(run.events, all).scope).toMatchObject({ runIds: [runId], step: "findings", superseded: 7 });
    expect(pipelineState(run.events).steps.map((step) => [STEP_LABELS[step.step], step.status])).toEqual([
      [STEP_LABELS.extract, "completed"],
      [STEP_LABELS.decompose, "completed"],
      [STEP_LABELS.contradictions, "completed"],
      [STEP_LABELS.compliance, "completed"],
      [STEP_LABELS.findings, "completed"],
    ]);
    // The run it replaced stays in the log, and the panel reads the newest run of each step.
    expect(fold(run.events).stepRuns.filter((step) => step.step === "contradictions")).toHaveLength(3);
    expect(pipelineState(run.events).steps[0]!.runId).toBe(extractRun);
  });

  it("keeps the dispositions of superseded findings in the log, off the board", async () => {
    // The analyst decides on one finding of the recorded run, and the re-run then supersedes it.
    const decided = activeFindings(fold(recordedLog))[0]!;
    const withDecision = [
      ...recordedLog,
      {
        seq: recordedLog.length + 1,
        type: "disposition.changed" as const,
        v: 1 as const,
        event_id: eventId(recordedLog.length + 1),
        case_id: recordedLog[0]!.case_id,
        actor: "demo-analyst",
        at: AT,
        step_run_id: null,
        payload: { finding_id: decided.finding_id, disposition: "approved" as const },
      },
    ];
    const api = stepApi(withDecision);

    const run = await rerunFrom(api.deps(), "findings");

    expect(boardView(run.events, all).cards.map((card) => card.findingId)).not.toContain(decided.finding_id);
    expect(dispositionOf(fold(run.events), decided.finding_id)).toMatchObject({ disposition: "approved", actor: "demo-analyst" });
  });

  it("decides nothing itself: a run appends no disposition of any kind", async () => {
    const api = stepApi(opened());

    await startRun(api.deps());
    await rerunFrom(api.deps(), "findings");

    expect(api.events.filter((event) => event.type === "disposition.changed")).toEqual([]);
  });
});

describe("the panel's reading of a case", () => {
  it("reads the recorded run off the log, including the step that was retried under the same run id", () => {
    const { steps } = pipelineState(recordedLog);

    expect(steps.map((step) => [STEP_LABELS[step.step], step.status, step.runId])).toEqual([
      [STEP_LABELS.extract, "completed", extractRun],
      [STEP_LABELS.decompose, "completed", decomposeRun],
      [STEP_LABELS.contradictions, "completed", "1319d46c-9772-4f71-bb08-c0bfc3372780"],
      // Recorded before the rules check existed: it reads as not yet run, not as a failure.
      [STEP_LABELS.compliance, "pending", null],
      [STEP_LABELS.findings, "completed", "6cc2d994-172d-4a5b-8e32-8a97eb693f97"],
    ]);
    expect(fold(recordedLog).stepRuns.filter((run) => run.stepRunId === extractRun)).toEqual([
      { stepRunId: extractRun, step: "extract", status: "completed", model: "recorded-fake-model", promptVersion: "extract@1", inputRunId: null, startedAtSeq: 8, settledAtSeq: 9, error: null },
    ]);
  });

  it("reads a case that has run nothing as every step still waiting", () => {
    expect(pipelineState(opened()).steps).toEqual(
      PIPELINE_STEPS.map((step) => ({ step, runId: null, status: "pending", error: null, inputRunId: null, seq: null })),
    );
  });

  it("reports a log with a gap as an error rather than as a run that never started", () => {
    expect(() => pipelineState(recordedLog.filter((event) => event.seq !== 7))).toThrow(/expected seq 7, got 8/);
  });
});
