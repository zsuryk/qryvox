import {
  type CardId,
  type CaseState,
  type Citation,
  dispositionOf,
  type Disposition,
  type DocumentKind,
  excerptCardId,
  findingCardId,
  type PlanSlot,
  type Severity,
} from "@qryvox/shared";
import { categoryLabel, KIND_LABELS, rationale, SEVERITY_LABELS } from "./board";
import type { CanvasCard } from "./canvas-source";

// What a canvas card says (#54), as a pure function of the card and the folded state: the words and the
// facts the one Card component draws, for both kinds. Nothing here calls a model: a finding card's
// rationale is the claim board's own line (lib/board.ts), derived from the finding the log recorded.

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  ppm: "PPM",
  fee_table: "Fee table",
  factsheet: "Factsheet",
  deck: "Deck",
};

// A passage a card cites, named the way the analyst knows the document.
export type CardCitation = { citation: Citation; documentName: string; kind: DocumentKind | null };

export type FindingCardModel = {
  kind: "finding";
  cardId: CardId;
  title: string;
  rationale: string;
  category: string;
  severity: Severity;
  severityLabel: string;
  kindLabel: string;
  // The document the finding is cited on, by kind: where it sits in the authority order.
  authority: string | null;
  disposition: Disposition | null;
  citation: CardCitation;
};

export type ExcerptCardModel = {
  kind: "excerpt";
  cardId: CardId;
  documentName: string;
  documentKind: string | null;
  page: number;
  quote: string;
  citation: CardCitation;
  // The finding cards that cite this passage, as their citation or their counterpart.
  linked: { cardId: CardId; label: string }[];
  // Set when the passage came from a find-similar run rather than from a finding (#57, #64).
  candidate: boolean;
};

export type CardModel = FindingCardModel | ExcerptCardModel;

export function cardModel(card: CanvasCard, state: CaseState): CardModel {
  if (card.kind === "finding") {
    const f = card.finding;
    const cited = cardCitation(f.citation, state);
    const decided = dispositionOf(state, f.finding_id);
    return {
      kind: "finding",
      cardId: card.cardId,
      title: f.claim,
      rationale: rationale(f),
      category: categoryLabel(f.category),
      severity: f.severity,
      severityLabel: SEVERITY_LABELS[f.severity],
      kindLabel: KIND_LABELS[f.kind],
      authority: cited.kind ? DOCUMENT_KIND_LABELS[cited.kind] : null,
      disposition: decided?.disposition ?? null,
      citation: cited,
    };
  }
  const cited = cardCitation(card.citation, state);
  return {
    kind: "excerpt",
    cardId: card.cardId,
    documentName: cited.documentName,
    documentKind: cited.kind ? DOCUMENT_KIND_LABELS[cited.kind] : null,
    page: card.citation.page,
    quote: card.citation.quote,
    citation: cited,
    linked: linkedFindings(card.cardId, state).map((f) => ({
      cardId: findingCardId(f.finding_id),
      label: `${categoryLabel(f.category)} · ${KIND_LABELS[f.kind].toLowerCase()}`,
    })),
    candidate: card.candidateOf !== undefined,
  };
}

// Where a card docks when it is docked by its button, or dropped on the plan region: its category, under
// the authority of the document it is cited on. An excerpt card takes the category of the first finding
// that cites it; a passage no finding cites (a find-similar candidate) has no category, so it has no
// slot of its own and cannot be docked until a finding cites it.
export function naturalSlot(card: CanvasCard, state: CaseState): PlanSlot | null {
  const citation = card.kind === "finding" ? card.finding.citation : card.citation;
  const authority = documentKind(citation.document_id, state);
  const category = card.kind === "finding" ? card.finding.category : linkedFindings(card.cardId, state)[0]?.category;
  return authority && category ? { category, authority } : null;
}

// The categories a card may be docked under: its finding's, or the categories of every finding citing
// its passage. A slot in any other category is the wrong place for it (#55).
export function dockableCategories(card: CanvasCard, state: CaseState): PlanSlot["category"][] {
  if (card.kind === "finding") return [card.finding.category];
  return [...new Set(linkedFindings(card.cardId, state).map((f) => f.category))];
}

function linkedFindings(cardId: CardId, state: CaseState) {
  return state.findings.filter(
    (f) =>
      f.supersededAtSeq === null &&
      (excerptCardId(f.citation) === cardId || (f.counterpart !== null && excerptCardId(f.counterpart) === cardId)),
  );
}

function documentKind(documentId: string, state: CaseState): DocumentKind | null {
  return state.documents.find((d) => d.documentId === documentId)?.kind ?? null;
}

function cardCitation(citation: Citation, state: CaseState): CardCitation {
  const document = state.documents.find((d) => d.documentId === citation.document_id);
  return { citation, documentName: document?.filename ?? citation.document_id, kind: document?.kind ?? null };
}
