import type { Event } from "./events";
import { emptyCaseState, type CaseState } from "./state";

// One fold, two call sites: the API derives current state with it, the browser replays with it.
export function fold(events: readonly Event[]): CaseState {
  return events.reduce(apply, emptyCaseState());
}

function apply(state: CaseState, event: Event): CaseState {
  switch (event.type) {
    case "case.opened":
      return { ...state, caseId: event.case_id, openedAt: event.at, lastSeq: event.seq };
  }
}
