import type { Advice, AdviceDecision, SupersedeCause } from "./advice.js";
import type { ClientProfile, KnowledgeLevel } from "./client.js";
import type { DocumentKind, StepName } from "./events.js";
import type { Disposition, Finding } from "./finding.js";

export type CaseDocument = {
  documentId: string;
  sha256: string;
  filename: string;
  kind: DocumentKind;
  pageCount: number;
  pdfjsVersion: string;
  ingestedAtSeq: number;
};

export type StepRunStatus = "running" | "completed" | "failed";

export type StepRun = {
  stepRunId: string;
  step: StepName;
  status: StepRunStatus;
  model: string;
  promptVersion: string;
  inputRunId: string | null;
  startedAtSeq: number;
  // Seq of the step.completed / latest step.failed; null while running.
  settledAtSeq: number | null;
  error: string | null;
};

export type CaseFinding = Finding & {
  // The findings run that created it.
  stepRunId: string;
  createdAtSeq: number;
  // Set once a later findings run replaced it; it then leaves the board but stays in the log.
  supersededAtSeq: number | null;
};

// One finding's current disposition, whoever decided it and at which seq. Held apart from CaseFinding
// rather than on it, so that a finding superseded off the board keeps the disposition it was given: the
// finding leaves the board, its decision stays in the log (spec decision 10).
export type FindingDisposition = {
  findingId: string;
  disposition: Disposition;
  actor: string;
  changedAtSeq: number;
};

// A client's latest profile. Earlier versions stay in the log; replay to an earlier seq shows them.
export type CaseClient = {
  clientId: string;
  profile: ClientProfile;
  // 1 for the first client.profiled, counting up with each new version.
  version: number;
  profiledAtSeq: number;
};

export type CaseAdvice = Advice & {
  // The advice.drafted event's event_id.
  adviceId: string;
  draftedAtSeq: number;
  // Set once a newer profile or attributes run replaced it; it then leaves the client's view.
  supersededAtSeq: number | null;
  supersededBecause: SupersedeCause | null;
  // The adviser's latest decision, or null while it waits for one.
  decision: { decision: AdviceDecision; actor: string; decidedAtSeq: number } | null;
};

export type CaseState = {
  caseId: string | null;
  openedAt: string | null;
  documents: CaseDocument[];
  // In the order they started. A retried run keeps its id: a failure followed by a completion is completed.
  stepRuns: StepRun[];
  // Every finding ever created, in creation order; see activeFindings() for the board.
  findings: CaseFinding[];
  // The latest disposition per finding that has one, in the order it was first decided. A finding with no
  // entry here has not been decided yet — which is not the same as dismissed, and never happens by itself.
  dispositions: FindingDisposition[];
  // Stage 2: each client's latest profile, in the order first profiled, and every advice ever drafted.
  clients: CaseClient[];
  advice: CaseAdvice[];
  // Depths clients chose to read at, where they shared it (#38), in order.
  readings: { clientId: string; adviceId: string; depth: KnowledgeLevel; atSeq: number }[];
  // Highest seq folded so far; 0 means no events.
  lastSeq: number;
};

export function emptyCaseState(): CaseState {
  return {
    caseId: null,
    openedAt: null,
    documents: [],
    stepRuns: [],
    findings: [],
    dispositions: [],
    clients: [],
    advice: [],
    readings: [],
    lastSeq: 0,
  };
}

// The board: findings not superseded by a later run.
export function activeFindings(state: CaseState): CaseFinding[] {
  return state.findings.filter((f) => f.supersededAtSeq === null);
}

// What the analyst decided about a finding, or null when they have not decided yet. Nothing else moves
// this: no step, and no fold rule, ever approves or dismisses on the analyst's behalf.
export function dispositionOf(state: CaseState, findingId: string): FindingDisposition | null {
  return state.dispositions.find((d) => d.findingId === findingId) ?? null;
}

// Advice still in play: not superseded by a newer profile or attributes run.
export function activeAdvice(state: CaseState): CaseAdvice[] {
  return state.advice.filter((a) => a.supersededAtSeq === null);
}

// What a client may see: advice in play that an adviser has approved. Nothing reaches a client otherwise.
export function approvedAdviceFor(state: CaseState, clientId: string): CaseAdvice[] {
  return activeAdvice(state).filter((a) => a.client_id === clientId && a.decision?.decision === "approved");
}

// The findings S6 discloses from: on the board and not dismissed by the analyst. Undecided findings count;
// only the analyst's explicit dismissal takes one out of what the client is told.
export function undismissedFindings(state: CaseState): CaseFinding[] {
  return activeFindings(state).filter((f) => dispositionOf(state, f.finding_id)?.disposition !== "dismissed");
}

// Clients whose advice was superseded and not yet redrafted, with why: what the adviser console lists as
// needing a new draft (#37). A client with advice in play is not listed.
export function adviceToRedraft(state: CaseState): { clientId: string; cause: SupersedeCause; supersededAtSeq: number }[] {
  return state.clients.flatMap((client) => {
    const theirs = state.advice.filter((a) => a.client_id === client.clientId);
    if (theirs.length === 0 || theirs.some((a) => a.supersededAtSeq === null)) return [];
    const last = theirs.at(-1)!;
    return [{ clientId: client.clientId, cause: last.supersededBecause!, supersededAtSeq: last.supersededAtSeq! }];
  });
}

// Three choices in a row of the same depth, other than the level the client's answers give, since those
// answers were last recorded: enough to suggest the adviser asks again. A suggestion only; nothing changes
// a profile but a new version the adviser records (#38).
export const READING_THRESHOLD = 3;

export function knowledgeSuggestion(state: CaseState, clientId: string): { depth: KnowledgeLevel; count: number } | null {
  const client = state.clients.find((c) => c.clientId === clientId);
  if (!client) return null;
  const since = state.readings.filter((r) => r.clientId === clientId && r.atSeq > client.profiledAtSeq);
  const recent = since.slice(-READING_THRESHOLD);
  const depth = recent[0]?.depth;
  if (recent.length < READING_THRESHOLD || depth === undefined || depth === client.profile.knowledge) return null;
  if (!recent.every((r) => r.depth === depth)) return null;
  let count = 0;
  for (const r of [...since].reverse()) {
    if (r.depth !== depth) break;
    count += 1;
  }
  return { depth, count };
}
