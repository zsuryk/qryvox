import type { SlimEvent } from "./events.js";
import { emptyCaseState, type CaseState, type StepRun } from "./state.js";

export class FoldError extends Error {
  override name = "FoldError";
}

// One fold, two call sites: the API derives current state with it, the browser replays with it.
// Accepts slim or full events. Order of the input does not matter; the events must be one case's
// contiguous prefix 1..n — a gap is a hard error, never a partially built board.
export function fold(events: readonly SlimEvent[]): CaseState {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  sorted.forEach((event, i) => {
    if (event.seq !== i + 1) {
      throw new FoldError(`expected seq ${i + 1}, got ${event.seq}`);
    }
    if (event.case_id !== sorted[0]?.case_id) {
      throw new FoldError(`seq ${event.seq} belongs to case ${event.case_id}, not ${sorted[0]?.case_id}`);
    }
  });
  return sorted.reduce(apply, emptyCaseState());
}

function apply(state: CaseState, event: SlimEvent): CaseState {
  const next = { ...state, lastSeq: event.seq };
  switch (event.type) {
    case "case.opened":
      return { ...next, caseId: event.case_id, openedAt: event.at };
    case "document.ingested": {
      const p = event.payload;
      return {
        ...next,
        documents: [
          ...state.documents,
          {
            documentId: p.document_id,
            sha256: p.sha256,
            filename: p.filename,
            kind: p.kind,
            pageCount: p.page_count,
            pdfjsVersion: p.pdfjs_version,
            ingestedAtSeq: event.seq,
          },
        ],
      };
    }
    case "step.started": {
      // A retry reuses its run id: it restarts that run instead of adding another, and a run that
      // already completed stays completed (a concurrent duplicate may log its start late).
      const existing = state.stepRuns.find((r) => r.stepRunId === event.step_run_id);
      if (existing?.status === "completed") return next;
      const p = event.payload;
      const run: StepRun = {
        stepRunId: event.step_run_id,
        step: p.step,
        status: "running",
        model: p.model,
        promptVersion: p.prompt_version,
        inputRunId: p.input_run_id,
        startedAtSeq: event.seq,
        settledAtSeq: null,
        error: null,
      };
      return { ...next, stepRuns: existing ? state.stepRuns.map((r) => (r === existing ? run : r)) : [...state.stepRuns, run] };
    }
    case "finding.created":
      return {
        ...next,
        findings: [
          ...state.findings,
          { ...event.payload, stepRunId: event.step_run_id, createdAtSeq: event.seq, supersededAtSeq: null },
        ],
      };
    case "finding.superseded":
      return {
        ...next,
        findings: state.findings.map((f) =>
          f.finding_id === event.payload.finding_id && f.supersededAtSeq === null ? { ...f, supersededAtSeq: event.seq } : f,
        ),
      };
    case "step.completed":
    case "step.failed": {
      const completed = event.type === "step.completed";
      return {
        ...next,
        stepRuns: state.stepRuns.map((r) =>
          r.stepRunId !== event.step_run_id || r.status === "completed"
            ? r
            : {
                ...r,
                status: completed ? "completed" : "failed",
                settledAtSeq: event.seq,
                error: completed ? null : event.payload.error,
              },
        ),
      };
    }
  }
}
