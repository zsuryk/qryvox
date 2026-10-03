import { type CardId, excerptCardId, findingCardId } from "./card.js";
import type { SlimEvent } from "./events.js";
import { Citation, type FindingCategory } from "./finding.js";
import { fold } from "./fold.js";
import { activeFindings, type CaseFinding, type CaseState } from "./state.js";

// The cards a case has on its canvas (#48), read from its log: one rule for the browser, which lays them
// out, and for the server, which refuses an operation on a card the case does not have (#65). Like
// everything else they are a fold: no card is stored anywhere.
//
// One card per active finding, each followed by an excerpt card for its citation and its counterpart, the
// first time that passage appears: a passage two findings share is one card. Then the candidates every
// completed find-similar run offers (#64): an excerpt card per passage it returned, naming the run in
// candidateOf, unless that passage already has a card. Which cards are docked, pinned or discarded is the
// board state beside them, not a property of the card.
export type CaseCard =
  | { cardId: CardId; kind: "finding"; finding: CaseFinding }
  | { cardId: CardId; kind: "excerpt"; citation: Citation; candidateOf?: string };

export function caseCards(events: readonly SlimEvent[], state: CaseState = fold(events)): CaseCard[] {
  const cards: CaseCard[] = [];
  const seen = new Set<CardId>();
  const add = (card: CaseCard) => {
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
    for (const citation of seededPassages(events, run.stepRunId)) {
      add({ cardId: excerptCardId(citation), kind: "excerpt", citation, candidateOf: run.stepRunId });
    }
  }
  return cards;
}

// The categories a card may be docked under in the plan region: its finding's; for an excerpt card, those
// of every finding citing its passage; and for a find-similar candidate no finding cites, those of the card
// it was found from (the card whose passage seeded the run), so a passage found by drifting from a fee
// finding docks under fees. A card with none cannot be docked.
export function cardCategories(card: CaseCard, state: CaseState, cards: readonly CaseCard[]): FindingCategory[] {
  const found = new Set<FindingCategory>();
  const visit = (current: CaseCard, seen: Set<CardId>) => {
    if (seen.has(current.cardId)) return;
    seen.add(current.cardId);
    if (current.kind === "finding") {
      found.add(current.finding.category);
      return;
    }
    for (const finding of citingFindings(current.cardId, state)) found.add(finding.category);
    if (found.size > 0 || current.candidateOf === undefined) return;
    const seed = state.seededRuns.find((r) => r.stepRunId === current.candidateOf)?.seed;
    const from = seed && cards.find((c) => c.cardId === excerptCardId(seed));
    if (from) visit(from, seen);
  };
  visit(card, new Set());
  return [...found];
}

// The active findings that cite a passage, as their citation or their counterpart.
export function citingFindings(cardId: CardId, state: CaseState): CaseFinding[] {
  return activeFindings(state).filter(
    (f) => excerptCardId(f.citation) === cardId || (f.counterpart !== null && excerptCardId(f.counterpart) === cardId),
  );
}

// The passages a completed seeded run returned, read from its stored output the way the steps that would
// have consumed it read it: a seeded extract's statements are passages already; a seeded contradictions
// run's issues point at claims of the decompose run it consumed, whose quotes are the passages. Every quote
// was grounded by the server. Output that does not read as either gives no cards rather than a broken board.
export function seededPassages(events: readonly SlimEvent[], runId: string): Citation[] {
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
