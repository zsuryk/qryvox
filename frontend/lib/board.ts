import {
  activeFindings,
  fold,
  type CaseDocument,
  type CaseFinding,
  type CaseState,
  type Citation,
  type FindingCategory,
  type FindingKind,
  type Severity,
  type SlimEvent,
  type StepName,
} from "@qryvox/shared";

// The claim board, as a fold of the event log. Everything here is a pure function of the events: there is
// no store behind the board, and nothing is kept between one view and the next. A filter narrows the fold,
// it does not narrow a list the fold produced earlier (spec decision 31, ADR-0002).

// The four filters, in the order the board lists them. The vocabulary is the pack's: these are the areas
// an analyst scopes a review to.
export const CATEGORIES = ["fees", "strategy", "risk", "terms"] as const satisfies readonly FindingCategory[];

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  fees: "Fees",
  strategy: "Strategy",
  risk: "Risk",
  terms: "Terms",
};

export const categoryLabel = (category: FindingCategory) => CATEGORY_LABELS[category];

const SEVERITIES = ["high", "medium", "low"] as const satisfies readonly Severity[];

const SEVERITY_LABELS: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

// One line saying what made this a finding, so a card can carry a reason and not only a claim. The word
// for the kind goes with it: colour and shorthand alone would leave the reader guessing.
const KIND_LABELS: Record<FindingKind, string> = {
  contradiction: "Contradiction",
  unsupported_claim: "Unsupported claim",
  disclosure_gap: "Disclosure gap",
};

const KIND_RATIONALES: Record<FindingKind, string> = {
  contradiction: "Two documents state the same fact differently.",
  unsupported_claim: "A claim the rest of the pack does not back.",
  disclosure_gap: "A promise made without the risk disclosure that should go with it.",
};

// A citation as the board shows it: the document by name, the page, and the passage verbatim.
export type BoardCitation = {
  documentId: string;
  documentName: string;
  page: number;
  quote: string;
};

export type BoardCard = {
  findingId: string;
  category: FindingCategory;
  categoryLabel: string;
  kind: FindingKind;
  kindLabel: string;
  severity: Severity;
  severityLabel: string;
  // One sentence stating what the documents claim and where they conflict.
  claim: string;
  // One line saying why that counts as a finding.
  rationale: string;
  citation: BoardCitation | null;
  // The passage it conflicts with, or that it lacks, when the log carries one.
  counterpart: BoardCitation | null;
  runId: string;
  seq: number;
};

// The run scope the board belongs to: which findings run put it up, and what it replaced.
export type RunScope = {
  runIds: readonly string[];
  step: StepName;
  model: string;
  promptVersion: string;
  firstSeq: number;
  lastSeq: number;
  superseded: number;
};

// What an empty board says, in words rather than in blank space.
export type BoardNotice = { headline: string; detail: string };

export type BoardView = {
  cards: readonly BoardCard[];
  // Active findings per category, unfiltered: what a toggle would add back.
  counts: Record<FindingCategory, number>;
  selected: readonly FindingCategory[];
  visible: number;
  active: number;
  scope: RunScope | null;
  notice: BoardNotice | null;
};

export function boardView(events: readonly SlimEvent[], selected: readonly FindingCategory[]): BoardView {
  const state = fold(events);
  const active = activeFindings(state);
  const on = new Set(selected);
  const shown = active
    .filter((finding) => on.has(finding.category))
    .sort((a, b) => rank(a.severity) - rank(b.severity) || rankCategory(a.category) - rankCategory(b.category) || a.createdAtSeq - b.createdAtSeq);

  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<FindingCategory, number>;
  for (const finding of active) counts[finding.category] += 1;

  return {
    cards: shown.map((finding) => card(finding, state.documents)),
    counts,
    selected,
    visible: shown.length,
    active: active.length,
    scope: runScope(state, shown),
    notice: shown.length > 0 ? null : emptyNotice(active.length, selected),
  };
}

function card(finding: CaseFinding, documents: readonly CaseDocument[]): BoardCard {
  return {
    findingId: finding.finding_id,
    category: finding.category,
    categoryLabel: categoryLabel(finding.category),
    kind: finding.kind,
    kindLabel: KIND_LABELS[finding.kind],
    severity: finding.severity,
    severityLabel: SEVERITY_LABELS[finding.severity],
    claim: finding.claim,
    rationale: KIND_RATIONALES[finding.kind],
    citation: citation(finding.citation, documents),
    counterpart: citation(finding.counterpart, documents),
    runId: finding.stepRunId,
    seq: finding.createdAtSeq,
  };
}

function citation(source: Citation | null, documents: readonly CaseDocument[]): BoardCitation | null {
  if (source === null) return null;
  return {
    documentId: source.document_id,
    documentName: documents.find((d) => d.documentId === source.document_id)?.filename ?? source.document_id,
    page: source.page,
    quote: source.quote,
  };
}

// One scope for the whole board: the runs its findings came from, the model that answered them, and the
// findings a later run replaced. Null when nothing is on the board.
function runScope(state: CaseState, shown: readonly CaseFinding[]): RunScope | null {
  const runIds = [...new Set(shown.map((finding) => finding.stepRunId))];
  const latest = state.stepRuns.find((run) => run.stepRunId === runIds.at(-1));
  const seqs = shown.map((finding) => finding.createdAtSeq);
  if (runIds.length === 0 || seqs.length === 0) return null;
  return {
    runIds,
    step: latest?.step ?? "findings",
    model: latest?.model ?? "unknown",
    promptVersion: latest?.promptVersion ?? "unknown",
    firstSeq: Math.min(...seqs),
    lastSeq: Math.max(...seqs),
    superseded: state.findings.filter((finding) => finding.supersededAtSeq !== null).length,
  };
}

// An empty board says which of the three emptinesses it is: nothing on the case at all, nothing under the
// categories on, or no categories on. Either way it is stated, because a blank board reads as a broken one.
function emptyNotice(active: number, selected: readonly FindingCategory[]): BoardNotice {
  if (active === 0) {
    return {
      headline: "No findings on this case yet.",
      detail: "Nothing has been recorded to the board, so there is nothing to filter.",
    };
  }
  if (selected.length === 0) {
    return {
      headline: "No categories selected.",
      detail: `The board holds ${counted(active)} in other categories. Turn a category on to see them.`,
    };
  }
  return {
    headline: `No ${names(selected)} findings.`,
    detail: `The board holds ${counted(active)} in other categories.`,
  };
}

const counted = (n: number) => `${n} finding${n === 1 ? "" : "s"}`;

// "fees, strategy" / "risk" — the filters in the board's own order, so the sentence reads like the toggles.
export function names(selected: readonly FindingCategory[]): string {
  return CATEGORIES.filter((category) => selected.includes(category)).join(", ");
}

const rank = (severity: Severity) => SEVERITIES.indexOf(severity);
const rankCategory = (category: FindingCategory) => CATEGORIES.indexOf(category);
