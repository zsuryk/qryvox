import { z } from "zod";
import { DocumentKind, type SlimEvent, StepName } from "./events.js";
import { FindingCategory } from "./finding.js";

// Intent on the canvas (#48, #51): what the analyst wants to see next, as chips. A chip is first-class: the
// analyst picks chips by hand, and the parse step reads free text into the same chips, so typing is only a
// shorter way to the chip set the buttons give. The chips choose what to look at; nothing in them is a
// decision, and nothing here changes the board state.

// The steps a chip can ask for: any step but parse itself, which only ever produces chips, and rationale,
// which only words the findings a chip already reaches (and whose absence keeps parse@1's prompt as it was).
export const ChipStep = StepName.exclude(["parse", "rationale"]);
export type ChipStep = z.infer<typeof ChipStep>;

// One chip names any of a category, a document kind (its authority) and a step; null is "any". A chip
// that names nothing would select everything, which is what having no chips already means.
export const IntentChip = z
  .object({
    category: FindingCategory.nullable(),
    authority: DocumentKind.nullable(),
    step_kind: ChipStep.nullable(),
  })
  .refine((c) => c.category !== null || c.authority !== null || c.step_kind !== null, {
    message: "a chip names a category, an authority or a step",
  });
export type IntentChip = z.infer<typeof IntentChip>;

// What the browser sends to parse: the analyst's own words, short enough to be an intent and not a brief.
export const ParseInput = z.object({ intent: z.string().trim().min(1).max(500) });
export type ParseInput = z.infer<typeof ParseInput>;

// What a parse run stores as its step.completed output. An empty list is a valid answer: nothing in the
// words maps onto a chip, and the analyst's own chips stand.
export const ParseOutput = z.object({ chips: z.array(IntentChip).max(12) });
export type ParseOutput = z.infer<typeof ParseOutput>;

export type ResolvedIntent = {
  chips: IntentChip[];
  // "parse" when a completed parse run contributed chips; "manual" when the analyst's chips stand alone
  // because there was no parse run, it failed, it is still running, or its output does not parse.
  source: "parse" | "manual";
};

// The chips to act on: the analyst's own, then any a completed parse run adds, without duplicates. It
// reads the log and returns chips, and that is all: a failed parse falls back to the manual chips and
// leaves the log, and so the board state folded from it, exactly as it was.
export function resolveIntent(events: readonly SlimEvent[], parseRunId: string | null, manual: readonly IntentChip[]): ResolvedIntent {
  const completed = events.find(
    (e) => e.type === "step.completed" && e.step_run_id === parseRunId && e.payload.step === "parse",
  );
  const parsed = completed?.type === "step.completed" ? ParseOutput.safeParse(completed.payload.output) : null;
  if (!parsed?.success) return { chips: dedupe(manual), source: "manual" };
  return { chips: dedupe([...manual, ...parsed.data.chips]), source: "parse" };
}

const chipKey = (c: IntentChip) => `${c.category}|${c.authority}|${c.step_kind}`;

function dedupe(chips: readonly IntentChip[]): IntentChip[] {
  const seen = new Set<string>();
  return chips.filter((c) => !seen.has(chipKey(c)) && seen.add(chipKey(c)));
}
