export type CaseState = {
  caseId: string | null;
  openedAt: string | null;
  // Highest seq folded so far; 0 means no events.
  lastSeq: number;
};

export function emptyCaseState(): CaseState {
  return { caseId: null, openedAt: null, lastSeq: 0 };
}
