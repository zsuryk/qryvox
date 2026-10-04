import { Explanation } from "./advice.js";
import type { ClientLanguage } from "./client.js";
import type { SlimEvent } from "./events.js";

// The language an explanation is written in: the one it records, English for one written before #43 did.
const languageOf = (explanation: Explanation): ClientLanguage => explanation.language ?? "en";

// The explanation the client page shows for one advice: the output of the latest completed explain run
// on it, or null before one has run. Read off the event list, because the fold keeps no step outputs.
// With a language (#75), only a run written in that language counts: a client who reads in the other one
// has none until one is requested, and one already written is found again, never written twice.
export function explanationFor(events: readonly SlimEvent[], adviceId: string, language?: ClientLanguage): Explanation | null {
  const completed = [...events]
    .sort((a, b) => a.seq - b.seq)
    .filter((e) => e.type === "step.completed" && e.payload.step === "explain" && e.payload.input_run_id === adviceId)
    .flatMap((e) => (e.type === "step.completed" ? [Explanation.parse(e.payload.output)] : []))
    .filter((x) => language === undefined || languageOf(x) === language);
  return completed.at(-1) ?? null;
}

// Every language an advice's explanation has been written in, so the page can offer the other one.
export function explanationLanguages(events: readonly SlimEvent[], adviceId: string): ClientLanguage[] {
  const found = new Set<ClientLanguage>();
  for (const e of events) {
    if (e.type === "step.completed" && e.payload.step === "explain" && e.payload.input_run_id === adviceId) {
      found.add(languageOf(Explanation.parse(e.payload.output)));
    }
  }
  return [...found];
}
