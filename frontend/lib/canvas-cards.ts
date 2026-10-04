import {
  cardCategories,
  type CardId,
  type CaseState,
  type Citation,
  dispositionOf,
  type Disposition,
  type DocumentKind,
  citingFindings,
  findingCardId,
  type PlanSlot,
  type Severity,
} from "@qryvox/shared";
import { categoryLabel, KIND_LABELS, rationale, SEVERITY_LABELS } from "./board";
import type { CanvasCard, CanvasView } from "./canvas-source";
import { CARD_W, type CardSize } from "./tiling";

// What a canvas card says (#54), as a pure function of the card and the folded state: the words and the
// facts the one Card component draws, for both kinds. Nothing here calls a model: a finding card's
// rationale is the line a rationale run wrote for it (#62), read off the log, or where there is none the
// claim board's own line (lib/board.ts), derived from the finding the log recorded.

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
  // Whether the rationale is the model's sentence (#62) rather than the derived line.
  written: boolean;
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
  // Set when the passage came from find similar rather than from a finding (#57, #64).
  candidate: boolean;
  // Set when it came at once, from a press's lexical neighbours (#60), rather than from a model's run.
  instant: boolean;
  // For a candidate, what it was found from, in words: "Similar to “…”, factsheet page 1".
  similarTo: string | null;
};

export type CardModel = FindingCardModel | ExcerptCardModel;

export function cardModel(card: CanvasCard, state: CaseState, rationales: ReadonlyMap<string, string> = new Map()): CardModel {
  if (card.kind === "finding") {
    const f = card.finding;
    const cited = cardCitation(f.citation, state);
    const decided = dispositionOf(state, f.finding_id);
    return {
      kind: "finding",
      cardId: card.cardId,
      title: f.claim,
      rationale: rationales.get(f.finding_id) ?? rationale(f),
      written: rationales.has(f.finding_id),
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
    linked: citingFindings(card.cardId, state).map((f) => ({
      cardId: findingCardId(f.finding_id),
      label: `${categoryLabel(f.category)} · ${KIND_LABELS[f.kind].toLowerCase()}`,
    })),
    candidate: card.candidateOf !== undefined || card.neighbourOf !== undefined,
    instant: card.neighbourOf !== undefined,
    similarTo: card.neighbourOf ? similarLine(card.neighbourOf.seed, state) : card.candidateOf === undefined ? null : similarTo(card.candidateOf, state),
  };
}

// A card's size from what it says (#80): its height follows its text — the title, the rationale line
// (two lines when the model wrote it, #62), or the excerpt's quote — within a band no card leaves, so
// truncation stays bounded (#81 expands the rest, in place). Pure arithmetic on the model, the same in
// tests as on the canvas: the tiler (lib/tiling.ts) packs each card at this size. The width is the
// flow's one shared width.
export const CARD_MIN_H = 180;
export const CARD_MAX_H = 480;

// The clamped line budget per text block while collapsed, and the bounded excerpt when expanded (#81).
const TITLE_LINES = 3;
const RATIONALE_LINES = 1;
const RATIONALE_WRITTEN_LINES = 2;
const QUOTE_LINES = 4;
const EXPANDED_TITLE_LINES = 10;
const EXPANDED_RATIONALE_LINES = 10;
const EXPANDED_QUOTE_LINES = 12;

// Roughly how many characters of each block fit on a line at the flow's width and type.
const TITLE_CHARS = 34;
const RATIONALE_CHARS = 50;
const QUOTE_CHARS = 40;

const TITLE_LINE_PX = 23;
const RATIONALE_LINE_PX = 18;
const QUOTE_LINE_PX = 23;
// Padding, the badge row, the chips row and the action row around the text.
const CHROME_PX = 146;

export type TextBlock = "title" | "rationale" | "quote";
export type ExpandedBlocks = Partial<Record<TextBlock, boolean>>;
// Which of a card's blocks are expanded, per card (#81). Absent means every block collapsed.
export type ExpandedMap = ReadonlyMap<CardId, ExpandedBlocks>;

function lineCount(text: string, perLine: number): number {
  return Math.max(1, Math.ceil(text.length / perLine));
}

function clampedLines(count: number, cap: number): number {
  return Math.min(count, cap);
}

// How many lines the block shows at its collapsed clamp, and so whether anything is hidden: a block
// that fits shows no Expand control (#81).
export function blockLines(model: CardModel, block: TextBlock): { shown: number; hidden: boolean } {
  if (model.kind === "finding") {
    if (block === "title") {
      const n = lineCount(model.title, TITLE_CHARS);
      return { shown: clampedLines(n, TITLE_LINES), hidden: n > TITLE_LINES };
    }
    const cap = model.written ? RATIONALE_WRITTEN_LINES : RATIONALE_LINES;
    const n = lineCount(model.rationale, RATIONALE_CHARS);
    return { shown: clampedLines(n, cap), hidden: n > cap };
  }
  const n = lineCount(model.quote, QUOTE_CHARS);
  return { shown: clampedLines(n, QUOTE_LINES), hidden: n > QUOTE_LINES };
}

export function cardSize(model: CardModel, expanded: ExpandedBlocks = {}): CardSize {
  let text = 0;
  if (model.kind === "finding") {
    const title = lineCount(model.title, TITLE_CHARS);
    text += clampedLines(title, expanded.title ? EXPANDED_TITLE_LINES : TITLE_LINES) * TITLE_LINE_PX;
    const cap = model.written ? RATIONALE_WRITTEN_LINES : RATIONALE_LINES;
    const rationale = lineCount(model.rationale, RATIONALE_CHARS);
    text += clampedLines(rationale, expanded.rationale ? EXPANDED_RATIONALE_LINES : cap) * RATIONALE_LINE_PX;
  } else {
    const quote = lineCount(model.quote, QUOTE_CHARS);
    text += clampedLines(quote, expanded.quote ? EXPANDED_QUOTE_LINES : QUOTE_LINES) * QUOTE_LINE_PX;
  }
  return { w: CARD_W, h: Math.min(CARD_MAX_H, Math.max(CARD_MIN_H, CHROME_PX + text)) };
}

// Where a card docks when it is docked by its button, or dropped on the plan region: its category, under
// the authority of the document it is cited on. An excerpt card takes the category of the first finding
// that cites it, and a find-similar candidate no finding cites the category of the card it was found from
// (cardCategories, shared/src/canvas.ts). A card with no category has no slot.
export function naturalSlot(card: CanvasCard, view: CanvasView): PlanSlot | null {
  const citation = card.kind === "finding" ? card.finding.citation : card.citation;
  const authority = documentKind(citation.document_id, view.state);
  const category = dockableCategories(card, view)[0];
  return authority && category ? { category, authority } : null;
}

// The categories a card may be docked under: the same rule the backend refuses a dock by (#55, #65).
export function dockableCategories(card: CanvasCard, view: CanvasView): PlanSlot["category"][] {
  return cardCategories(card, view.state, view.all);
}

// The passage a find-similar run was seeded with, as a line on the candidates it found.
function similarTo(runId: string, state: CaseState): string | null {
  const seed = state.seededRuns.find((r) => r.stepRunId === runId)?.seed;
  return seed ? similarLine(seed, state) : null;
}

function similarLine(seed: Citation, state: CaseState): string {
  return `Similar to “${seed.quote}”, ${cardCitation(seed, state).documentName} page ${seed.page}`;
}

function documentKind(documentId: string, state: CaseState): DocumentKind | null {
  return state.documents.find((d) => d.documentId === documentId)?.kind ?? null;
}

function cardCitation(citation: Citation, state: CaseState): CardCitation {
  const document = state.documents.find((d) => d.documentId === citation.document_id);
  return { citation, documentName: document?.filename ?? citation.document_id, kind: document?.kind ?? null };
}
