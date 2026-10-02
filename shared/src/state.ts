import type { DocumentKind, StepName } from "./events.js";
import type { Finding } from "./finding.js";

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

export type CaseState = {
  caseId: string | null;
  openedAt: string | null;
  documents: CaseDocument[];
  // In the order they started. A retried run keeps its id: a failure followed by a completion is completed.
  stepRuns: StepRun[];
  // Every finding ever created, in creation order; see activeFindings() for the board.
  findings: CaseFinding[];
  // Highest seq folded so far; 0 means no events.
  lastSeq: number;
};

export function emptyCaseState(): CaseState {
  return { caseId: null, openedAt: null, documents: [], stepRuns: [], findings: [], lastSeq: 0 };
}

// The board: findings not superseded by a later run.
export function activeFindings(state: CaseState): CaseFinding[] {
  return state.findings.filter((f) => f.supersededAtSeq === null);
}
