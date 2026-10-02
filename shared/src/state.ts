import type { DocumentKind, StepName } from "./events";

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

export type CaseState = {
  caseId: string | null;
  openedAt: string | null;
  documents: CaseDocument[];
  // In the order they started. A retried run keeps its id: a failure followed by a completion is completed.
  stepRuns: StepRun[];
  // Highest seq folded so far; 0 means no events.
  lastSeq: number;
};

export function emptyCaseState(): CaseState {
  return { caseId: null, openedAt: null, documents: [], stepRuns: [], lastSeq: 0 };
}
