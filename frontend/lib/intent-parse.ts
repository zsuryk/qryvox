import { ANALYST_ACTOR, type IntentChip, fold, ParseInput, ParseOutput, type RunStepRequest, SlimEvent } from "@qryvox/shared";

// The analyst's words on the canvas, read into chips by the parse step (#69). The step is an ordinary run
// through the steps endpoint, so the log records it like any other, and what the chips are is read back from
// the log: the latest completed parse run's chips, merged with the hand-picked ones by the shared
// resolveIntent. Nothing here is kept: a reload reads the same chips from the same log.

// Why the field will not send these words, or null where it will: what ParseInput holds a sentence to.
export function intentRefusal(text: string): string | null {
  const parsed = ParseInput.safeParse({ intent: text });
  if (parsed.success) return null;
  return text.trim() === "" ? "Type what you want to look at." : "That is a long way past an intent: keep it to a sentence or two.";
}

// The request: parse reads no earlier run, only the words, which the run records.
export function parseRequest(text: string, stepRunId: string): RunStepRequest {
  return { step_run_id: stepRunId, step: "parse", input_run_id: null, intent: text.trim() };
}

// The run id these words last went out under, or null if they never did. Sending the same words again is a
// retry under that id, so the server hands back the run it holds instead of calling the model a second time
// (ADR-0002), and a failed run is retried rather than left behind a new one.
export function parseRunFor(events: readonly SlimEvent[], text: string): string | null {
  const words = text.trim();
  const started = [...events].reverse().find((e) => e.type === "step.started" && e.payload.step === "parse" && e.payload.intent === words);
  return started?.step_run_id ?? null;
}

// The parse run whose chips stand: the latest to have completed. A run that failed or is still running
// leaves the chips as they were, which is why this is the latest completed one and not the latest.
export function standingParseRun(events: readonly SlimEvent[]): string | null {
  const runs = fold(events).stepRuns.filter((run) => run.step === "parse" && run.status === "completed");
  return runs.at(-1)?.stepRunId ?? null;
}

// The chips one completed parse run read from its words, or null if it has not completed or its output does
// not read as chips.
export function chipsOf(events: readonly SlimEvent[], runId: string): IntentChip[] | null {
  const done = events.find((e) => e.type === "step.completed" && e.step_run_id === runId && e.payload.step === "parse");
  const parsed = done?.type === "step.completed" ? ParseOutput.safeParse(done.payload.output) : null;
  return parsed?.success ? parsed.data.chips : null;
}

// Whether a run of these words already completed on the log.
export function parsedAlready(events: readonly SlimEvent[], text: string): boolean {
  const id = parseRunFor(events, text);
  return id !== null && fold(events).stepRuns.some((run) => run.stepRunId === id && run.status === "completed");
}

// --- The fixture. The recorded case has no model behind it, so a sentence there is read from a short list
// of sentences that were put to a model (parse@1 on kimi-k3, against the live backend), each with the chips it
// gave. The recording plays back as the two events the backend wrote, so the status panel and the chips are
// the same whether the words went to a model or to this list. A sentence that is not on the list says so
// rather than pretending to be read.

type Recorded = { words: string; chips: IntentChip[] };
const chip = (category: IntentChip["category"], authority: IntentChip["authority"], step_kind: IntentChip["step_kind"]): IntentChip => ({
  category,
  authority,
  step_kind,
});

export const RECORDED_INTENTS: readonly Recorded[] = [
  { words: "fee contradictions in the PPM", chips: [chip("fees", "ppm", "contradictions")] },
  {
    words: "Show me the fee contradictions between the PPM and the factsheet",
    chips: [chip("fees", "ppm", "contradictions"), chip("fees", "factsheet", "contradictions")],
  },
  { words: "PPM 裡的費用", chips: [chip("fees", "ppm", null)] },
  { words: "what a lovely afternoon", chips: [] },
];

const squash = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function recordedIntent(text: string): Recorded | undefined {
  return RECORDED_INTENTS.find((r) => squash(r.words) === squash(text));
}

const MODEL = "kimi-k3";
const PROMPT = "parse@1";

// The recorded run as it lands on this log now: step.started and step.completed at the next seqs, under the
// run id given; null when the words were not recorded.
export function playIntent(events: readonly SlimEvent[], text: string, stepRunId: string, at: string): SlimEvent[] | null {
  const recorded = recordedIntent(text);
  const last = events.at(-1);
  if (!recorded || !last) return null;
  const run = { step: "parse", model: MODEL, prompt_version: PROMPT, input_run_id: null, intent: text.trim() };
  const output: ParseOutput = { chips: recorded.chips };
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
      payload: type === "step.started" ? run : { ...run, output },
    }),
  );
}
