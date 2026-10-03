import { z } from "zod";
import type { SlimEvent } from "./events.js";

// Card rationales (#62): one plain-language sentence on why a finding matters, written by the rationale
// step for every finding of one completed findings run in a single model call. Optional and never on the
// critical path: a card without one falls back to the line the board derives from the finding's kind and
// documents. Grounded like explain: whatever it quotes is verbatim from that finding's citation or
// counterpart, and every number it states is in them.

export const RATIONALE_MAX_LENGTH = 400;

export const Rationale = z.object({ finding_id: z.string().min(1), text: z.string().trim().min(1).max(RATIONALE_MAX_LENGTH) });
export type Rationale = z.infer<typeof Rationale>;

// The rationale step's output: at most one rationale per finding of the run it read (input_run_id), each
// naming a finding that run created. A finding whose rationale did not hold to its quotes has none.
export const RationaleOutput = z.object({ rationales: z.array(Rationale) });
export type RationaleOutput = z.infer<typeof RationaleOutput>;

// A finding's rationale: from the latest completed rationale run on the findings run that created it which
// has one for it, or null. A superseded finding has none, whatever was written for it while it was on the
// board: its findings run has been replaced, and so has what was said about it. Read off the event list,
// because the fold keeps no step outputs.
export function rationaleFor(events: readonly SlimEvent[], findingId: string): string | null {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const created = sorted.find((e) => e.type === "finding.created" && e.payload.finding_id === findingId);
  if (!created) return null;
  if (sorted.some((e) => e.type === "finding.superseded" && e.payload.finding_id === findingId)) return null;
  for (const event of sorted.reverse()) {
    if (event.type !== "step.completed" || event.payload.step !== "rationale" || event.payload.input_run_id !== created.step_run_id) continue;
    const output = RationaleOutput.safeParse(event.payload.output);
    const text = output.success ? output.data.rationales.find((r) => r.finding_id === findingId)?.text : undefined;
    if (text !== undefined) return text;
  }
  return null;
}
