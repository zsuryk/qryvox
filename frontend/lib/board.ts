import {
  ruleById,
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

const KIND_LABELS: Record<FindingKind, string> = {
  contradiction: "Contradiction",
  unsupported_claim: "Unsupported claim",
  disclosure_gap: "Disclosure gap",
  policy_gap: "Policy gap",
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
  // For a policy gap, the institutional rule it breaks, as rules@1 words it; null on every other kind.
  rule: { id: string; title: string; text: string } | null;
  citation: BoardCitation | null;
  // The passage it conflicts with, or that it lacks, when the log carries one.
  counterpart: BoardCitation | null;
  runId: string;
  seq: number;
};

// The run scope the board belongs to: which findings run put it up, and what it replaced. The model and the
// prompt version are null only when the log names a run it carries no step.started for, so that a missing
// run reads as missing rather than as a model name nobody wrote.
export type RunScope = {
  runIds: readonly string[];
  step: StepName | null;
  model: string | null;
  promptVersion: string | null;
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
    visible: shown.length,
    active: active.length,
    // The scope describes the board, so a filter never changes which run put it up or what it replaced.
    scope: runScope(state, active),
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
    rationale: rationale(finding),
    rule: finding.rule ? { id: finding.rule, title: ruleById(finding.rule).title, text: ruleById(finding.rule).text } : null,
    citation: citation(finding.citation, documents),
    counterpart: citation(finding.counterpart, documents),
    runId: finding.stepRunId,
    seq: finding.createdAtSeq,
  };
}

// One line saying why this is a finding, in this finding's own terms: which document the claim comes from
// and which document it runs into. The kind only decides the shape of the sentence.
function rationale(finding: CaseFinding): string {
  const from = finding.citation.document_id;
  const against = finding.counterpart?.document_id;
  switch (finding.kind) {
    case "contradiction":
      return against === undefined
        ? "Two documents state the same fact differently."
        : `Two documents state the same fact differently: ${from} and ${against}.`;
    case "unsupported_claim":
      return `Nothing else in the pack backs what ${from} states.`;
    case "disclosure_gap":
      return `${from} promises it without the risk disclosure ${against ?? "the pack"} attaches to it.`;
    // The rule, in its own words: what the institution requires that this document does not do.
    case "policy_gap":
      return finding.rule
        ? `${from} falls short of the institution's rule: ${ruleById(finding.rule).text}`
        : `${from} falls short of an institutional rule.`;
  }
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

// One scope for the whole board: the runs its findings came from, oldest first, the model that answered the
// newest of them, and the findings a later run replaced. Null when nothing is on the board.
function runScope(state: CaseState, active: readonly CaseFinding[]): RunScope | null {
  if (active.length === 0) return null;
  const runs = [...new Set(active.map((finding) => finding.stepRunId))].flatMap((stepRunId) => {
    const run = state.stepRuns.find((candidate) => candidate.stepRunId === stepRunId);
    return run ? [run] : [];
  });
  const newest = runs.sort((a, b) => a.startedAtSeq - b.startedAtSeq).at(-1) ?? null;
  const seqs = active.map((finding) => finding.createdAtSeq);
  return {
    runIds: [...new Set(active.map((finding) => finding.stepRunId))],
    step: newest?.step ?? null,
    model: newest?.model ?? null,
    promptVersion: newest?.promptVersion ?? null,
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
