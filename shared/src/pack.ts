import { z } from "zod";
import { DocumentKind, Sha256 } from "./events";
import { Citation, FindingCategory, FindingKind } from "./finding";

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
