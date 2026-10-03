import { z } from "zod";
import { ReasonEffect, Verdict } from "./advice.js";
import { ClientProfile } from "./client.js";
import { DocumentKind, Sha256 } from "./events.js";
import { Citation, FindingCategory, FindingKind } from "./finding.js";

// The one pdf.js build the pack is quoted from, and the one the browser parses with. Pinned to an exact
// version, not a range: a citation is a page plus a quote, and the quote is found in pdf.js's extracted
// text, so a text-layer change would silently move every highlight. Two places declare the version — the
// catalog entry that resolves the package and this constant — and they must agree; the manifest records
// it so drift shows up in the artifact the browser reads, not only in a lockfile.
export const PDFJS_VERSION = "6.3.289";

// One document of the fabricated pack, served as a static asset at /pack/<filename>.
export const PackDocument = z.object({
  document_id: z.string().min(1),
  kind: DocumentKind,
  filename: z.string().min(1),
  sha256: Sha256,
  page_count: z.number().int().positive(),
});
export type PackDocument = z.infer<typeof PackDocument>;

// /pack/manifest.json
export const PackManifest = z.object({
  pack_id: z.string().min(1),
  product: z.string().min(1),
  issuer: z.string().min(1),
  pdfjs_version: z.literal(PDFJS_VERSION),
  documents: z.array(PackDocument),
});
export type PackManifest = z.infer<typeof PackManifest>;

// Ground truth uses the same citation and kind vocabulary as findings, so eval compares like with like.
export const PackCitation = Citation;
export type PackCitation = Citation;
export const PlantedKind = FindingKind;
export type PlantedKind = FindingKind;

// One planted finding. The citation is where the finding originates; the counterpart is the passage
// it conflicts with, or that it lacks, when there is one.
export const GroundTruthEntry = z.object({
  id: z.string().min(1),
  category: FindingCategory,
  kind: PlantedKind,
  summary: z.string().min(1),
  citation: PackCitation,
  counterpart: PackCitation.nullable(),
});
export type GroundTruthEntry = z.infer<typeof GroundTruthEntry>;

// /eval/ground-truth.json — the answer key. Never an input to any analysis step.
export const GroundTruth = z.object({
  pack_id: z.string().min(1),
  entries: z.array(GroundTruthEntry),
});
export type GroundTruth = z.infer<typeof GroundTruth>;

// A fabricated client and the advice suitability should give them on this pack: the answer key for the
// client layer, as the ground truth is for findings. Never an input to any step. The name and summary are
// for people reading the eval; only the profile, under its pseudonymous id, ever enters a case.
export const Persona = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  profile: ClientProfile,
  expected_verdict: Verdict,
  // Every reason the rules should give, as rule and effect; order does not matter.
  expected_reasons: z.array(z.object({ rule: z.string().min(1), effect: ReasonEffect })),
  // Ground-truth ids of the findings S6 should disclose.
  expected_disclosures: z.array(z.string().min(1)),
});
export type Persona = z.infer<typeof Persona>;

// /eval/personas.json
export const PersonaSet = z.object({ pack_id: z.string().min(1), personas: z.array(Persona) });
export type PersonaSet = z.infer<typeof PersonaSet>;
