import {
  activeFindings,
  type CardId,
  type CaseFinding,
  type CaseState,
  Citation,
  excerptCardId,
  findingCardId,
  fold,
  SlimEvent,
} from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { fetchEvents } from "./api";

// Where the canvas (#48) gets its case from: the one seam between the canvas and the world. Both sources
// hand back the same thing, a case's event log, and everything the canvas shows is folded from it by the
// shared fold, so a fixture board and a live board differ only in where the events came from. Nothing on
// the canvas reads the API or a fixture any other way.
//
//   fixture — the recorded Larkspur case (the log the fold tests fold, whose documents are the static
//             pack's by hash), followed by a few card operations so the plan region, a pin and the
//             discard bin have something in them. No network, no model, no API running.
//   live    — the case's events from the backend, read the way every other page reads them.

export type CanvasMode = { kind: "fixture" } | { kind: "live"; caseId: string };

// The switch, and the only one: the canvas page calls this with its search params and hands the result to
// loadCanvasEvents. A case id in the address means that case, live; no case id means the fixture.
export function canvasMode(params: { get(name: string): string | null }): CanvasMode {
  const caseId = params.get("case");
  return caseId ? { kind: "live", caseId } : { kind: "fixture" };
}

// The transport, a seam so tests never touch the network. The default is the app's own.
export type CanvasDeps = { fetchEvents: (caseId: string) => Promise<SlimEvent[]> };

export async function loadCanvasEvents(mode: CanvasMode, deps: CanvasDeps = { fetchEvents }): Promise<SlimEvent[]> {
  return mode.kind === "fixture" ? fixtureEvents() : deps.fetchEvents(mode.caseId);
}

// The recorded log, then the card operations an analyst might have made on it, at the next seqs: the fee
// contradiction docked in its category under the authority of the document it cites, the next finding
// pinned, and the third discarded. Fixed ids and times, so the fixture is the same on every load.
export function fixtureEvents(): SlimEvent[] {
  const events = SlimEvent.array().parse(recorded);
  const state = fold(events);
  const [docked, pinned, discarded] = activeFindings(state);
  const caseId = events[0]!.case_id;
  const at = events.at(-1)!.at;
  const ops = [
    {
      type: "card.docked",
      payload: {
        card_id: findingCardId(docked!.finding_id),
        plan_slot: { category: docked!.category, authority: kindOf(state, docked!.citation) },
      },
    },
    { type: "card.pinned", payload: { card_id: findingCardId(pinned!.finding_id), world_pos: { x: 0, y: 0 } } },
    { type: "card.discarded", payload: { card_id: findingCardId(discarded!.finding_id) } },
  ];
  return [
    ...events,
    ...ops.map((op, i) => {
      const seq = events.length + 1 + i;
      return SlimEvent.parse({
        seq,
        event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        case_id: caseId,
        actor: "demo-analyst",
        at,
        step_run_id: null,
        v: 1,
        ...op,
      });
    }),
  ];
}

function kindOf(state: CaseState, citation: Citation) {
  const document = state.documents.find((d) => d.documentId === citation.document_id);
  if (!document) throw new Error(`the recorded case has no document ${citation.document_id}`);
  return document.kind;
}

// One card per active finding, each followed by an excerpt card for its citation and its counterpart, the
// first time that passage appears: a passage two findings share is one card. Then the candidates every
// completed find-similar run offers (#64): an excerpt card per passage it returned, naming the run in
// candidateOf, unless that passage already has a card. Which cards are docked, pinned or discarded is the
// board state on the fold beside them, not a property of the card.
export type CanvasCard =
  | { cardId: CardId; kind: "finding"; finding: CaseFinding }
  | { cardId: CardId; kind: "excerpt"; citation: Citation; candidateOf?: string };

export type CanvasView = { state: CaseState; cards: CanvasCard[] };

export function canvasView(events: readonly SlimEvent[]): CanvasView {
  const state = fold(events);
  const cards: CanvasCard[] = [];
  const seen = new Set<CardId>();
  const add = (card: CanvasCard) => {
    if (seen.has(card.cardId)) return;
    seen.add(card.cardId);
    cards.push(card);
  };
  for (const finding of activeFindings(state)) {
    add({ cardId: findingCardId(finding.finding_id), kind: "finding", finding });
    for (const citation of [finding.citation, finding.counterpart]) {
      if (citation) add({ cardId: excerptCardId(citation), kind: "excerpt", citation });
    }
  }
  for (const run of state.seededRuns) {
    if (run.status !== "completed") continue;
    for (const citation of candidatePassages(events, run.stepRunId)) {
      add({ cardId: excerptCardId(citation), kind: "excerpt", citation, candidateOf: run.stepRunId });
    }
  }
  return { state, cards };
}

// The passages a completed seeded run returned, read from its stored output the way the steps that would
// have consumed it read it: a seeded extract's statements are passages already; a seeded contradictions
// run's issues point at claims of the decompose run it consumed, whose quotes are the passages. Every quote
// was grounded by the server. Output that does not read as either gives no cards rather than a broken board.
function candidatePassages(events: readonly SlimEvent[], runId: string): Citation[] {
  const run = completedRun(events, runId);
  if (!run) return [];
  const statements = Citation.array().safeParse(run.output.statements);
  if (statements.success) return statements.data;
  const issues = run.output.issues;
  const claims = run.input_run_id ? completedRun(events, run.input_run_id)?.output.claims : undefined;
  if (!Array.isArray(issues) || !Array.isArray(claims)) return [];
  // Only what a card needs of the decompose and contradictions outputs, whose full schemas live in the backend.
  const byId = new Map<unknown, Citation>();
  for (const claim of claims as { id?: unknown }[]) {
    const citation = Citation.safeParse(claim);
    if (citation.success) byId.set(claim.id, citation.data);
  }
  return (issues as { claim_id?: unknown; counterpart_claim_id?: unknown }[])
    .flatMap((issue) => [issue.claim_id, issue.counterpart_claim_id])
    .flatMap((id) => byId.get(id) ?? []);
}

function completedRun(events: readonly SlimEvent[], runId: string) {
  const event = events.find((e) => e.type === "step.completed" && e.step_run_id === runId);
  return event?.type === "step.completed" ? event.payload : undefined;
}
