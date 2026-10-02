"use client";

import { useState } from "react";
import type { SlimEvent, StepName } from "@qryvox/shared";
import { fetchEvents, runStep } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { type AttemptFailure, type PipelineAction, type PipelineDeps, runAction } from "../lib/pipeline";
import Board from "./board";
import Pipeline from "./pipeline";

// The case surface, as the client owns it: the run at the top, the board the run fills beneath it, and
// the log both are folded from. The server component fetches the events and hands them over; from here on
// the browser is what runs the pipeline (spec decision 19), so it is what holds the log as most recently
// read — the page's own copy of it is a fetch behind the moment a step settles (ADR-0002).
//
// The citation pane and the disposition console drop in beside <Board> below, both as client components
// of their own: this file is deliberately nothing more than the log, the run wiring and the board, so
// that neither has to know how the other is built.

export type CaseViewProps = {
  events: readonly SlimEvent[];
  caseId: string;
  // Re-reads the case on the server. A run appends to the log, so the page's own line about the case's
  // event count and the chain verdict are out of date the moment a step settles.
  refetch: () => void | Promise<void>;
};

export default function CaseView({ events, caseId, refetch }: CaseViewProps) {
  // The log this surface is folded from: the server's copy until a run reads a newer one, and that read
  // until the server hands over something newer still. The prop is held beside it because a refresh of
  // the server component replaces it wholesale, and comparing the two is how the newer one is recognised
  // without an effect that would re-render the board behind the analyst's back.
  const [read, setRead] = useState<{ server: readonly SlimEvent[]; log: readonly SlimEvent[] } | null>(null);
  const log = read !== null && read.server === events ? read.log : events;
  // The step whose call is in flight. The run reports it as each call goes out, which is the only way the
  // panel can show progress: the server's step.started has not landed in the log we hold yet.
  const [running, setRunning] = useState<StepName | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AttemptFailure | null>(null);

  // The three seams lib/pipeline.ts asks for, bound to this case. Built per run, so a run in flight can
  // never be handed another's state, and the run ids come from the browser because the server cannot tell
  // a retry from a second run without them (spec decision 25).
  const deps = (): PipelineDeps => ({
    steps: (request) => runStep(caseId, request),
    newRunId: () => crypto.randomUUID(),
    readLog: () => fetchEvents(caseId),
    onStep: (step) => setRunning(step),
  });

  async function drive(action: PipelineAction) {
    // Two clicks on the same button make one run: the panel is disabled while busy, and a double click
    // that beats the render would otherwise spend a second run's tokens.
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setRunning(null);
    try {
      const result = await runAction(deps(), action);
      setRead({ server: events, log: result.events });
      setFailure(result.failure);
    } catch (cause) {
      // The one failure the run cannot report for itself: the case log would not read back, so nothing
      // knows what it says. Said plainly, and the run is left where it was, to be resumed.
      setFailure({ step: null, error: errorMessage(cause) });
    } finally {
      setRunning(null);
      setBusy(false);
      try {
        await refetch();
      } catch {
        // A refresh that fails costs the page its event count, not the run: the log on screen is the
        // newer of the two, and nothing about the step that just settled is in doubt.
      }
    }
  }

  return (
    <>
      <Pipeline log={log} running={running} busy={busy} failure={failure} onAction={(action) => void drive(action)} />
      <Board events={log} />
    </>
  );
}