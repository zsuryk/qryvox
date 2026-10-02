import { z } from "zod";
import { DocumentKind, Sha256 } from "./events";

export const FindingCategory = z.enum(["fees", "strategy", "risk", "terms"]);
export type FindingCategory = z.infer<typeof FindingCategory>;

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

// A verbatim quote on one page of one document; page is 1-based.
export const PackCitation = z.object({
  document_id: z.string().min(1),
  page: z.number().int().positive(),
  quote: z.string().min(1),
});
export type PackCitation = z.infer<typeof PackCitation>;

export const PlantedKind = z.enum([
  // Two documents state the same fact differently.
  "contradiction",
  // A marketing claim the PPM does not back.
  "unsupported_claim",
  // A promise made without the risk disclosure that should accompany it.
  "disclosure_gap",
]);
export type PlantedKind = z.infer<typeof PlantedKind>;

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
