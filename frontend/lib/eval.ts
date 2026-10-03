import {
  activeFindings,
  type CaseState,
  fold,
  type GroundTruth,
  type GroundTruthEntry,
  type PackManifest,
  type Persona,
  type SlimEvent,
  type Verdict,
} from "@qryvox/shared";

// The eval (#15, #35): how well the pipeline did, measured in the browser against the pack's answer key.
// Everything is a pure function of the event log and the static answer key, so the tiles move as the log
// does — a re-run that supersedes findings, a replay to an earlier seq — and the answer key is never sent
// anywhere, least of all to a model. Each measure says its own definition beside its number.

// Which pack a case reviewed: the one whose manifest lists every document the case holds, by hash. A case
// whose documents match no pack has no answer key, and the tiles say so rather than scoring against one.
export function packOf(events: readonly SlimEvent[], manifests: readonly { dir: string; manifest: PackManifest }[]): string | null {
  const hashes = fold(events).documents.map((d) => d.sha256);
  if (hashes.length === 0) return null;
  return manifests.find(({ manifest }) => hashes.every((h) => manifest.documents.some((d) => d.sha256 === h)))?.dir ?? null;
}

const normalise = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

// A finding matches a planted one when they share a category and a quote: the finding's citation or its
// counterpart contains the planted citation's quote, or is contained by it. Containment in either
// direction, because a model may quote a clause with or without its number ("3.3 The Fund…"); either
// side, because a finding may be raised on the passage the answer key calls its counterpart.
export function matches(finding: { category: string; citation: { quote: string }; counterpart: { quote: string } | null }, planted: GroundTruthEntry): boolean {
  if (finding.category !== planted.category) return false;
  const target = normalise(planted.citation.quote);
  return [finding.citation.quote, finding.counterpart?.quote]
    .filter((q): q is string => q !== undefined)
    .map(normalise)
    .some((q) => q.includes(target) || target.includes(q));
}

export type FindingsScore = {
  planted: number;
  found: number;
  onBoard: number;
  matched: number;
  missed: GroundTruthEntry[];
  extra: { findingId: string; claim: string }[];
};

// Recall is planted findings found ÷ planted findings; precision is findings on the board that match a
// planted one ÷ findings on the board. Superseded findings are off the board and count for nothing.
export function findingsScore(state: CaseState, truth: GroundTruth): FindingsScore {
  const board = activeFindings(state);
  const missed = truth.entries.filter((planted) => !board.some((f) => matches(f, planted)));
  const extra = board.filter((f) => !truth.entries.some((planted) => matches(f, planted)));
  return {
    planted: truth.entries.length,
    found: truth.entries.length - missed.length,
    onBoard: board.length,
    matched: board.length - extra.length,
    missed,
    extra: extra.map((f) => ({ findingId: f.finding_id, claim: f.claim })),
  };
}

export type AdviceScore = {
  assessed: number;
  matched: number;
  rows: { name: string; expected: Verdict; got: Verdict | null }[];
};

// Personas whose advice in play has the verdict the answer key expects ÷ personas with advice in play.
export function adviceScore(state: CaseState, personas: readonly Persona[]): AdviceScore {
  const rows = personas.map((persona) => {
    const advice = state.advice.filter((a) => a.client_id === persona.profile.client_id && a.supersededAtSeq === null).at(-1);
    return { name: persona.name, expected: persona.expected_verdict, got: advice?.verdict ?? null };
  });
  const assessed = rows.filter((r) => r.got !== null);
  return { assessed: assessed.length, matched: assessed.filter((r) => r.got === r.expected).length, rows };
}

// A ratio as a person reads it: the fraction first, the percentage beside it, and no number at all for
// nothing over nothing.
export function ratio(n: number, d: number): { fraction: string; percent: string | null } {
  return { fraction: `${n} of ${d}`, percent: d === 0 ? null : `${Math.round((n / d) * 100)}%` };
}
