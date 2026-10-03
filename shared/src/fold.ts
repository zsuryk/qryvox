import type { SlimEvent } from "./events.js";
import { emptyCaseState, type CaseState, type FindingDisposition, type StepRun } from "./state.js";

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
      // A document ingested again under the same id is a new version of it (a product update, #37): it
      // replaces the earlier one in place, and every later step reads it. The earlier stays in the log.
      const p = event.payload;
      const document = {
        documentId: p.document_id,
        sha256: p.sha256,
        filename: p.filename,
        kind: p.kind,
        pageCount: p.page_count,
        pdfjsVersion: p.pdfjs_version,
        ingestedAtSeq: event.seq,
      };
      const replaced = state.documents.some((d) => d.documentId === p.document_id);
      return {
        ...next,
        documents: replaced
          ? state.documents.map((d) => (d.documentId === p.document_id ? document : d))
          : [...state.documents, document],
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
    case "disposition.changed": {
      // The latest decision for a finding wins, in the position it was first decided, so replaying the
      // log to any seq shows what the analyst had decided by then. Who decided is the event's own actor.
      const { finding_id, disposition } = event.payload;
      const decided: FindingDisposition = {
        findingId: finding_id,
        disposition,
        actor: event.actor,
        changedAtSeq: event.seq,
      };
      return {
        ...next,
        dispositions: state.dispositions.some((d) => d.findingId === finding_id)
          ? state.dispositions.map((d) => (d.findingId === finding_id ? decided : d))
          : [...state.dispositions, decided],
      };
    }
    case "client.profiled": {
      const existing = state.clients.find((c) => c.clientId === event.payload.client_id);
      const profiled = {
        clientId: event.payload.client_id,
        profile: event.payload,
        version: (existing?.version ?? 0) + 1,
        profiledAtSeq: event.seq,
      };
      return {
        ...next,
        clients: existing ? state.clients.map((c) => (c === existing ? profiled : c)) : [...state.clients, profiled],
      };
    }
    case "advice.drafted":
      return {
        ...next,
        advice: [
          ...state.advice,
          {
            ...event.payload,
            adviceId: event.event_id,
            draftedAtSeq: event.seq,
            supersededAtSeq: null,
            supersededBecause: null,
            decision: null,
          },
        ],
      };
    case "advice.superseded":
      return {
        ...next,
        advice: state.advice.map((a) =>
          a.adviceId === event.payload.advice_id && a.supersededAtSeq === null
            ? { ...a, supersededAtSeq: event.seq, supersededBecause: event.payload.cause }
            : a,
        ),
      };
    case "advice.decided":
      // Deciding again replaces the decision; the log keeps both, as for dispositions.
      return {
        ...next,
        advice: state.advice.map((a) =>
          a.adviceId === event.payload.advice_id
            ? { ...a, decision: { decision: event.payload.decision, actor: event.actor, decidedAtSeq: event.seq } }
            : a,
        ),
      };
    case "client.read":
      return {
        ...next,
        readings: [
          ...state.readings,
          { clientId: event.payload.client_id, adviceId: event.payload.advice_id, depth: event.payload.depth, atSeq: event.seq },
        ],
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
