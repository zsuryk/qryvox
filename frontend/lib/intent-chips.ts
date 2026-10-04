import {
  cardCategories,
  type CardId,
  type CaseState,
  Citation,
  citingFindings,
  type ChipStep,
  type DocumentKind,
  excerptCardId,
  type IntentChip,
  type SlimEvent,
  latestStatements,
} from "@qryvox/shared";
import { categoryLabel } from "./board";
import { type CanvasCard, type CanvasView } from "./canvas-source";
import { DOCUMENT_KIND_LABELS } from "./canvas-cards";

// What the intent chips do to the canvas (#70): they choose which of the case's cards are on it. The
// merged chips (the analyst's own and what a parse run read from their words, shared resolveIntent) are a
// filter and a focus over cards the case already has, and nothing more: a chip changing never calls a model,
// writes nothing to the log, and so cannot make a finding that was not there. The pipeline's steps are
// run from Review, and a chip only asks to see what a step already made.
//
// A chip selects the cards that match every field it names: the finding cards of its category, the cards
// that cite a document of its authority, the cards a step produced. Several chips together select what any
// of them selects. No chips selects nothing in particular, which is the whole default canvas. Cards the
// analyst has pinned or docked are theirs, not the filter's: they are always on the canvas, whatever the
// chips say. Everything here is a pure function of the log's fold and the chips.

export const CHIP_STEP_LABELS: Record<ChipStep, string> = {
  extract: "Statements",
  decompose: "Claims",
  contradictions: "Contradictions",
  findings: "Findings",
  compliance: "Policy gaps",
  attributes: "Product facts",
  explain: "Explanations",
};

// The steps that make cards. attributes and explain write product facts and advice, which are not cards, so
// a chip naming one selects nothing; it is not offered to pick by hand, but a parse run may still read the
// words into it, and then the canvas says that nothing matches.
export const CARD_STEPS = ["extract", "decompose", "contradictions", "compliance", "findings"] as const satisfies readonly ChipStep[];

export const chipKey = (c: IntentChip): string => `${c.category}|${c.authority}|${c.step_kind}`;

// A chip in words: "Fees · PPM · Contradictions", whichever of its fields it names.
export function chipLabel(chip: IntentChip): string {
  return [
    chip.category ? categoryLabel(chip.category) : null,
    chip.authority ? DOCUMENT_KIND_LABELS[chip.authority] : null,
    chip.step_kind ? CHIP_STEP_LABELS[chip.step_kind] : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

// What a card is, as the chips read it.
type Facts = {
  state: CaseState;
  all: readonly CanvasCard[];
  statements: ReadonlySet<CardId>;
  claims: ReadonlySet<CardId>;
};

// The passages of the latest completed decompose run's claims, as card ids: a claim is a quote on a page.
function claimPassages(events: readonly SlimEvent[]): Set<CardId> {
  const latest = [...events]
    .sort((a, b) => b.seq - a.seq)
    .find((e) => e.type === "step.completed" && e.payload.step === "decompose");
  const claims = latest?.type === "step.completed" ? latest.payload.output.claims : undefined;
  if (!Array.isArray(claims)) return new Set();
  return new Set(claims.flatMap((claim) => {
    const citation = Citation.safeParse(claim);
    return citation.success ? [excerptCardId(citation.data)] : [];
  }));
}

function authoritiesOf(card: CanvasCard, state: CaseState): Set<DocumentKind> {
  const documents = card.kind === "finding" ? [card.finding.citation, card.finding.counterpart] : [card.citation];
  return new Set(
    documents.flatMap((c) => {
      const kind = c ? state.documents.find((d) => d.documentId === c.document_id)?.kind : undefined;
      return kind ? [kind] : [];
    }),
  );
}

// The findings a card stands for: itself, for a finding card, and for a passage, every finding that cites it.
function findingsOf(card: CanvasCard, state: CaseState) {
  return card.kind === "finding" ? [card.finding] : citingFindings(card.cardId, state);
}

// The cross-check (contradictions step) raises contradictions, unsupported claims and disclosure gaps; the
// institution's rules (compliance) raise policy gaps. Both come out of the findings step, as findings.
function stepMatches(step: ChipStep, card: CanvasCard, facts: Facts): boolean {
  switch (step) {
    case "extract":
      return card.kind === "excerpt" && facts.statements.has(card.cardId);
    case "decompose":
      return card.kind === "excerpt" && facts.claims.has(card.cardId);
    case "contradictions":
      return findingsOf(card, facts.state).some((f) => f.kind !== "policy_gap");
    case "compliance":
      return findingsOf(card, facts.state).some((f) => f.kind === "policy_gap");
    case "findings":
      return findingsOf(card, facts.state).length > 0;
    case "attributes":
    case "explain":
      return false;
  }
}

export function chipMatches(chip: IntentChip, card: CanvasCard, facts: Facts): boolean {
  if (chip.category !== null && !cardCategories(card, facts.state, facts.all).includes(chip.category)) return false;
  if (chip.authority !== null && !authoritiesOf(card, facts.state).has(chip.authority)) return false;
  return chip.step_kind === null || stepMatches(chip.step_kind, card, facts);
}

export type IntentCards = {
  // What the canvas lays out: the cards the chips select, then the analyst's own (pinned, docked) that they
  // do not, in the case's card order. With no chips, the default canvas.
  cards: CanvasCard[];
  // How many of the case's cards the chips select, the analyst's own aside. With no chips it is every card
  // on the default canvas.
  matched: number;
  // The case's cards altogether, latent statements included: what "n of m" counts against.
  total: number;
  // Chips are set and select no card: the canvas says so rather than showing an empty field unexplained.
  nothing: boolean;
};

export function intentCards(view: CanvasView, events: readonly SlimEvent[], chips: readonly IntentChip[]): IntentCards {
  if (chips.length === 0) return { cards: view.cards, matched: view.cards.length, total: view.all.length, nothing: false };
  const facts: Facts = {
    state: view.state,
    all: view.all,
    statements: new Set(latestStatements(events).map(excerptCardId)),
    claims: claimPassages(events),
  };
  const board = view.state.board;
  const own = new Set([...board.docked, ...board.pinned, ...board.discarded].map((entry) => entry.cardId));
  const selected = new Set(view.all.filter((card) => chips.some((chip) => chipMatches(chip, card, facts))).map((c) => c.cardId));
  return {
    cards: view.all.filter((card) => selected.has(card.cardId) || own.has(card.cardId)),
    matched: selected.size,
    total: view.all.length,
    nothing: selected.size === 0,
  };
}

// The same view, holding only the cards the chips let through: what the layout, the plan and the models
// are drawn from, while `all` stays whole for the lookups that need a card the filter hides.
export function intentView(view: CanvasView, shown: IntentCards): CanvasView {
  return shown.cards === view.cards ? view : { ...view, cards: shown.cards };
}
