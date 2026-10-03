import type { Persona } from "../src";
import { LARKSPUR_V1, type PackSource } from "./build";
import { PERSONAS } from "./personas";
import { DOCUMENTS, GROUND_TRUTH, type SourceDocument } from "./source";

// Larkspur v2 (#37): the issuer's revised pack, as fabricated as v1. Written as edits on v1, so everything
// not edited here is identical and the two cannot drift apart elsewhere. The revision fixes two things:
// - the factsheet now states the 1.25% management fee the fee table charges (the fee contradiction goes);
// - the PPM now states the fossil fuel exclusion the deck claims (the unsupported claim goes, and a
//   client who excludes fossil fuels no longer needs the adviser to confirm it).
// Document ids are v1's, so ingesting v2 into a case replaces each v1 document; filenames differ.

export const PACK_ID_V2 = "larkspur-v2";

const EDITS: Record<string, { replace?: Record<string, string>; append?: { page: number; line: string } }> = {
  factsheet: {
    replace: {
      "Factsheet - Share class A (USD) - 30 September 2026": "Factsheet - Share class A (USD) - 31 October 2026",
      "Annual management fee: 0.85% per annum": "Annual management fee: 1.25% per annum",
    },
  },
  ppm: { append: { page: 1, line: "3.6 The Fund excludes companies that derive revenue from fossil fuels." } },
};

function revise(document: SourceDocument): SourceDocument {
  const edit = EDITS[document.document_id] ?? {};
  const pages = document.pages.map((lines, i) => [
    ...lines.map((line) => edit.replace?.[line] ?? line),
    ...(edit.append?.page === i + 1 ? [edit.append.line] : []),
  ]);
  for (const old of Object.keys(edit.replace ?? {})) {
    if (!document.pages.flat().includes(old)) throw new Error(`v2 edit: "${old}" is not in ${document.document_id}`);
  }
  return { ...document, filename: document.filename.replace(/\.pdf$/, "-v2.pdf"), title: `${document.title} (revised)`, pages };
}

const RESOLVED = new Set(["fees-management-fee", "strategy-fossil-fuel-screen"]);
const DISCLOSED = ["fees-exit-charge", "terms-dealing-frequency", "policy-factsheet-exit-charge"];

const personas: Persona[] = PERSONAS.map((p) =>
  p.profile.client_id === "persona-lee"
    ? {
        ...p,
        // The PPM now backs the screen, so S5 meets it and nothing is left for the adviser to confirm.
        expected_verdict: "suitable",
        expected_reasons: p.expected_reasons.map((r) => (r.rule === "S5" ? { rule: "S5", effect: "meets" } : r)),
        expected_disclosures: DISCLOSED,
      }
    : { ...p, expected_disclosures: DISCLOSED },
);

export const LARKSPUR_V2: PackSource = {
  ...LARKSPUR_V1,
  packId: PACK_ID_V2,
  documents: DOCUMENTS.map(revise),
  groundTruth: GROUND_TRUTH.filter((e) => !RESOLVED.has(e.id)),
  personas,
};
