import type { ChipStep, IntentChip } from "@qryvox/shared";
import { categoryLabel } from "./board";
import { DOCUMENT_KIND_LABELS } from "./canvas-cards";

// What the intent chips do to the canvas (#70): they choose which of the case's cards are on it. The
// merged chips (the analyst's own and what a parse run read from their words, shared resolveIntent) are a
// filter and a focus over cards the case already has, and nothing more: a chip changing never calls a model,
// writes nothing to the log, and so cannot make a finding that was not there. The pipeline's steps are
// run from Review, and a chip only asks to see what a step already made.
//
// A chip selects the cards that match every field it names: the finding cards of its category, the cards
// that cite a document of its authority, the cards a step produced. Several chips together select what any
// of them selects. No chips selects nothing in particular, which is the whole default canvas. Cards the
// analyst has pinned or docked are theirs, not the filter's: they are always on the canvas, whatever the
// chips say. Everything here is a pure function of the log's fold and the chips.

export const CHIP_STEP_LABELS: Record<ChipStep, string> = {
  extract: "Statements",
  decompose: "Claims",
  contradictions: "Contradictions",
  findings: "Findings",
  compliance: "Policy gaps",
  attributes: "Product facts",
  explain: "Explanations",
};

// The steps that make cards. attributes and explain write product facts and advice, which are not cards, so
// a chip naming one selects nothing; it is not offered to pick by hand, but a parse run may still read the
// words into it, and then the canvas says that nothing matches.
export const CARD_STEPS = ["extract", "decompose", "contradictions", "compliance", "findings"] as const satisfies readonly ChipStep[];

export const chipKey = (c: IntentChip): string => `${c.category}|${c.authority}|${c.step_kind}`;

// A chip in words: "Fees · PPM · Contradictions", whichever of its fields it names.
export function chipLabel(chip: IntentChip): string {
  return [
    chip.category ? categoryLabel(chip.category) : null,
    chip.authority ? DOCUMENT_KIND_LABELS[chip.authority] : null,
    chip.step_kind ? CHIP_STEP_LABELS[chip.step_kind] : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
