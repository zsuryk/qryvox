import { type CardId, excerptCardId, findingCardId, findingIdOfCard } from "./card.js";
import type { SlimEvent } from "./events.js";
import { Citation, type FindingCategory } from "./finding.js";
import { fold } from "./fold.js";
import { nearestStatements, latestStatements } from "./similar.js";
import { activeFindings, type CaseFinding, type CaseState } from "./state.js";

// The cards a case has on its canvas (#48), read from its log: one rule for the browser, which lays them
// out, and for the server, which refuses an operation on a card the case does not have (#65). Like
// everything else they are a fold: no card is stored anywhere.
//
// One card per active finding, each followed by an excerpt card for its citation and its counterpart, the
// first time that passage appears: a passage two findings share is one card. Then, in the order they were
// asked for, what find similar brought: the instant neighbours of every press (#60, similarNeighbours), an
// excerpt card per passage naming the card it was found from in neighbourOf; and the candidates every
// completed find-similar run offers (#64), naming the run in candidateOf. A passage that already has a card
// gets no second one. Last, every statement of the case's latest unseeded extract run that has no card yet,
// marked latent: each was grounded against its page when it was extracted, so the case has it as a card
// and an operation on it is the analyst's to make, but nothing has brought it onto the canvas, and the
// canvas draws it only once an operation names it. Which cards are docked, pinned or discarded is the board
// state beside them, not a property of the card.
export type CaseCard =
  | { cardId: CardId; kind: "finding"; finding: CaseFinding }
  | {
      cardId: CardId;
      kind: "excerpt";
      citation: Citation;
      candidateOf?: string;
      neighbourOf?: { cardId: CardId; seed: Citation; atSeq: number };
      latent?: true;
    };

// How many neighbours a press of find similar brings at once.
export const INSTANT_NEIGHBOURS = 5;

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
  // Presses and runs, by the seq each began at: a run looked further after the press that led to it.
  const found = [
    ...state.board.similarRequests.map((request) => ({ seq: request.atSeq, request })),
    ...state.seededRuns.map((run) => ({ seq: run.startedAtSeq, run })),
  ].sort((a, b) => a.seq - b.seq);
  const passages = found.some((f) => "request" in f) ? passageIndex(events, state) : new Map<CardId, Citation>();
  for (const entry of found) {
    if ("run" in entry) {
      if (entry.run.status !== "completed") continue;
      for (const citation of seededPassages(events, entry.run.stepRunId)) {
        add({ cardId: excerptCardId(citation), kind: "excerpt", citation, candidateOf: entry.run.stepRunId });
      }
      continue;
    }
    const { cardId, atSeq } = entry.request;
    const findingId = findingIdOfCard(cardId);
    const seed = findingId !== null ? state.findings.find((f) => f.finding_id === findingId)?.citation : passages.get(cardId);
    if (!seed) continue;
    for (const citation of similarNeighbours(events, seed, atSeq)) {
      add({ cardId: excerptCardId(citation), kind: "excerpt", citation, neighbourOf: { cardId, seed, atSeq } });
    }
  }
  for (const citation of latestStatements(events)) add({ cardId: excerptCardId(citation), kind: "excerpt", citation, latent: true });
  return cards;
}

// The passages a press of find similar at `atSeq` brought at once (#60): the statements most like the
// seed's passage, ranked from the latest extract run as the log stood at that press, so a later extract run
// never changes what an earlier press found. No model is called and nothing is stored: the press is the
// card.similar_requested on the log, and this is read from it.
export function similarNeighbours(events: readonly SlimEvent[], seed: Citation, atSeq: number): Citation[] {
  const before = events.filter((e) => e.seq <= atSeq);
  return nearestStatements(before, seed, INSTANT_NEIGHBOURS).map((n) => n.citation);
}

// Every passage the log has quoted that a card could show, by its card id: findings' citations and
// counterparts, every completed extract run's statements, and every completed seeded run's passages. It is
// how a press on an excerpt card finds the passage the card shows, which the card id only hashes.
function passageIndex(events: readonly SlimEvent[], state: CaseState): Map<CardId, Citation> {
  const index = new Map<CardId, Citation>();
  const put = (citation: Citation) => index.set(excerptCardId(citation), citation);
  for (const finding of state.findings) {
    put(finding.citation);
    if (finding.counterpart) put(finding.counterpart);
  }
  for (const event of events) {
    if (event.type !== "step.completed" || event.payload.step !== "extract") continue;
    const statements = Citation.array().safeParse(event.payload.output.statements);
    if (statements.success) statements.data.forEach(put);
  }
  for (const run of state.seededRuns) seededPassages(events, run.stepRunId).forEach(put);
  return index;
}

// The categories a card may be docked under in the plan region: its finding's; for an excerpt card, those
// of every finding citing its passage; and for a find-similar candidate or neighbour no finding cites, those
// of the card it was found from (the card pressed, or the card whose passage seeded the run), so a passage
// found by drifting from a fee finding docks under fees. A latent statement no finding cites has none, and a
// card with none cannot be docked.
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
    if (found.size > 0) return;
    if (current.neighbourOf) {
      const from = cards.find((c) => c.cardId === current.neighbourOf!.cardId);
      if (from) visit(from, seen);
      return;
    }
    if (current.candidateOf === undefined) return;
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
