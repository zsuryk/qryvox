import { activeFindings, type CaseCard, caseCards, type CaseState, type Citation, findingCardId, fold, rationaleFor, SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { fetchEvents } from "./api";

// Where the canvas (#48) gets its case from: the one seam between the canvas and the world. Both sources
// hand back the same thing, a case's event log, and everything the canvas shows is folded from it by the
// shared fold, so a fixture board and a live board differ only in where the events came from. Nothing on
// the canvas reads the API or a fixture any other way.
//
//   fixture — the recorded Larkspur case (the log the fold tests fold, whose documents are the static
//             pack's by hash), followed by a few card operations so the plan region, a pin and the
//             discard bin have something in them. No network, no model, no API running: find similar
//             plays back runs recorded on a model against this same log (lib/canvas-similar.ts).
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

// The cards, and the board state they are laid out with, folded from the log. Which cards a case has is
// shared/src/canvas.ts's rule (caseCards), the one the backend also checks a card operation against (#65):
// each active finding and the passages it cites, then what find similar brought, a press's instant
// neighbours (#60) and a completed run's candidates. A latent card, a statement of the extract run that
// nothing has brought onto the canvas, is the case's but is not drawn, until an operation names it.
// Which cards are docked, pinned or discarded is the board state beside them, not a property of the card.
export type CanvasCard = CaseCard;

// rationales: the model-written line on why each finding on the board matters, where a rationale run
// wrote one that held (#62, rationaleFor), by finding id. A finding without one shows the derived line.
export type CanvasView = { state: CaseState; cards: CanvasCard[]; rationales: ReadonlyMap<string, string> };

export function canvasView(events: readonly SlimEvent[]): CanvasView {
  const state = fold(events);
  const { docked, pinned, discarded } = state.board;
  const named = new Set([...docked, ...pinned, ...discarded].map((entry) => entry.cardId));
  const cards = caseCards(events, state).filter((card) => !(card.kind === "excerpt" && card.latent) || named.has(card.cardId));
  const rationales = new Map(
    activeFindings(state).flatMap((f): [string, string][] => {
      const text = rationaleFor(events, f.finding_id);
      return text === null ? [] : [[f.finding_id, text]];
    }),
  );
  return { state, cards, rationales };
}
