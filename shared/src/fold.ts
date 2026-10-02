import type { SlimEvent } from "./events";
import { emptyCaseState, type CaseState } from "./state";

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
  }
}
