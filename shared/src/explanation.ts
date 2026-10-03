import { Explanation } from "./advice.js";
import type { SlimEvent } from "./events.js";

// The explanation the client page shows for one advice: the output of the latest completed explain run
// on it, or null before one has run. Read off the event list, because the fold keeps no step outputs.
export function explanationFor(events: readonly SlimEvent[], adviceId: string): Explanation | null {
  const completed = [...events]
    .sort((a, b) => a.seq - b.seq)
    .filter((e) => e.type === "step.completed" && e.payload.step === "explain" && e.payload.input_run_id === adviceId);
  const latest = completed.at(-1);
  return latest?.type === "step.completed" ? Explanation.parse(latest.payload.output) : null;
}
