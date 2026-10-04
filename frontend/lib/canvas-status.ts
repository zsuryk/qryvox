import {
  type CardId,
  type CaseCard,
  caseCards,
  type CaseState,
  findingCardId,
  findingIdOfCard,
  fold,
  isAbandoned,
  ParseOutput,
  RationaleOutput,
  similarNeighbours,
  type SlimEvent,
  type StepRun,
  type StepRunStatus,
} from "@qryvox/shared";
import { categoryLabel } from "./board";
import { DOCUMENT_KIND_LABELS } from "./canvas-cards";
import { STEP_LABELS } from "./pipeline";

// The canvas's status panel (#58): the case's own log, read as lines, with no logging of its own. One line
// per step run, in the order they started, saying where it got to and why it stopped if it failed; the
// parse step (the analyst's words read into intent chips) and find-similar's seeded runs are runs like
// any other and are listed with them. And one line per card operation, so everything done on the canvas
// is on the record the panel shows. Everything here is read from the events; nothing is kept.

export type RunLine = {
  kind: "run";
  seq: number;
  runId: string;
  label: string;
  // "abandoned" (#75): still running on the log long after its call could have lasted; nothing will settle it.
  status: StepRunStatus | "abandoned";
  // Why it failed, when it did: the latest step.failed's reason.
  error: string | null;
  // Attempts that failed before this one, under the same run id (a retry), with the last reason.
  failedAttempts: number;
  lastFailure: string | null;
  // What the run was given, where that is the point of it: a parse run's words, a seeded run's passage.
  detail: string | null;
  // What it came to, in a few words, where there is something to say: a parse run's chips.
  result: string | null;
  model: string;
};

export type CardLine = { kind: "card"; seq: number; text: string; card: string };

export type StatusLine = RunLine | CardLine;

export function statusLines(events: readonly SlimEvent[], now: number = Date.now()): StatusLine[] {
  const state = fold(events);
  const runs = [...state.stepRuns, ...state.seededRuns].map((run) => runLine(run, events, state, now));
  const shown = events.some((e) => e.type === "card.similar_requested") ? caseCards(events, state) : [];
  const cards = events.flatMap((event) => cardLine(event, state, events, shown));
  return [...runs, ...cards].sort((a, b) => a.seq - b.seq);
}

function runLine(run: StepRun, events: readonly SlimEvent[], state: CaseState, now: number): RunLine {
  const own = events.filter((e) => e.step_run_id === run.stepRunId && e.type.startsWith("step."));
  const failures = own.flatMap((e) => (e.type === "step.failed" ? [e.payload.error] : []));
  const started = own.find((e) => e.type === "step.started");
  const intent = started?.type === "step.started" ? started.payload.intent : undefined;
  const completed = own.find((e) => e.type === "step.completed");
  let result: string | null = null;
  if (run.step === "parse" && completed?.type === "step.completed") {
    const parsed = ParseOutput.safeParse(completed.payload.output);
    result = parsed.success
      ? parsed.data.chips.length === 0
        ? "No chips: the words map onto nothing, so the chips picked by hand stand."
        : `${parsed.data.chips.length} intent chip${parsed.data.chips.length === 1 ? "" : "s"}`
      : "Its output does not read as chips, so the chips picked by hand stand.";
  }
  // A rationale run (#62): how many of its findings run's findings it gave a line that held.
  if (run.step === "rationale" && completed?.type === "step.completed") {
    const parsed = RationaleOutput.safeParse(completed.payload.output);
    const of = state.findings.filter((f) => f.stepRunId === run.inputRunId).length;
    const n = parsed.success ? parsed.data.rationales.length : 0;
    result = `${n} of ${of} finding${of === 1 ? "" : "s"} given a line on why it matters`;
  }
  const failedBefore = run.status === "failed" ? failures.length - 1 : failures.length;
  return {
    kind: "run",
    seq: run.startedAtSeq,
    runId: run.stepRunId,
    label: run.seed ? `Look further · ${STEP_LABELS[run.step]}` : STEP_LABELS[run.step],
    status: isAbandoned(events, run, now) ? "abandoned" : run.status,
    error: run.status === "failed" ? run.error : null,
    failedAttempts: Math.max(0, failedBefore),
    lastFailure: failedBefore > 0 ? (failures[failedBefore - 1] ?? null) : null,
    detail: intent !== undefined ? `“${intent}”` : run.seed ? `More like “${run.seed.quote}”, page ${run.seed.page}` : null,
    result,
    model: run.model,
  };
}

function cardLine(event: SlimEvent, state: CaseState, events: readonly SlimEvent[], shown: readonly CaseCard[]): CardLine[] {
  const line = (text: string, cardId: CardId): CardLine[] => [{ kind: "card", seq: event.seq, text, card: cardName(cardId, state) }];
  switch (event.type) {
    case "card.docked": {
      const { category, authority } = event.payload.plan_slot;
      return line(`Docked to the plan under ${categoryLabel(category)} · ${DOCUMENT_KIND_LABELS[authority]}`, event.payload.card_id);
    }
    case "card.undocked":
      return line("Taken out of the plan", event.payload.card_id);
    case "card.pinned":
      return line("Pinned", event.payload.card_id);
    case "card.unpinned":
      return line("Unpinned, back into the flow", event.payload.card_id);
    case "card.discarded":
      return line("Discarded to the bin", event.payload.card_id);
    case "card.restored":
      return line("Restored from the bin", event.payload.card_id);
    // A press of Similar is an operation, not a run (#60): what it found at once, read back from the log.
    case "card.similar_requested":
      return line(instantLine(event.payload.card_id, event.seq, state, events, shown), event.payload.card_id);
    // A decision is not a card operation, but on the canvas it is made from a card (#59), so it is on the
    // record the panel shows as well.
    case "disposition.changed":
      return line(event.payload.disposition === "approved" ? "Approved the finding" : "Dismissed the finding", findingCardId(event.payload.finding_id));
    default:
      return [];
  }
}

function instantLine(cardId: CardId, seq: number, state: CaseState, events: readonly SlimEvent[], shown: readonly CaseCard[]): string {
  const findingId = findingIdOfCard(cardId);
  const card = shown.find((c) => c.cardId === cardId);
  const seed =
    findingId !== null ? state.findings.find((f) => f.finding_id === findingId)?.citation : card?.kind === "excerpt" ? card.citation : undefined;
  if (!seed) return "Similar · instant";
  const found = similarNeighbours(events, seed, seq).length;
  if (found === 0) return "Similar · instant: nothing already extracted is like it";
  const added = shown.filter((c) => c.kind === "excerpt" && c.neighbourOf?.atSeq === seq).length;
  return `Similar · instant: ${found} like it among the extracted statements, ${added === 0 ? "all already on the canvas" : `${added} new to the canvas`}`;
}

// A card as a person would name it: its finding's sentence, or the passage's document and page.
function cardName(cardId: CardId, state: CaseState): string {
  const findingId = findingIdOfCard(cardId);
  if (findingId !== null) return state.findings.find((f) => f.finding_id === findingId)?.claim ?? `finding ${findingId}`;
  const [, documentId, page] = cardId.split(":");
  const document = state.documents.find((d) => d.documentId === documentId);
  return `${document?.filename ?? documentId}, page ${page}`;
}
