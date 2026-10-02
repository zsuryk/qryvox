import { GroundTruth, PackManifest } from "@qryvox/shared";
import type { DocumentBytes } from "./intake";

// The fabricated pack is served from public/: PDFs and manifest under /pack, the answer key under /eval.
// Regenerate with `pnpm --filter @qryvox/shared pack:generate`.

export const packUrl = (filename: string) => `/pack/${filename}`;

export async function fetchPackManifest(): Promise<PackManifest> {
  const res = await fetch("/pack/manifest.json");
  if (!res.ok) throw new Error(`GET /pack/manifest.json: ${res.status}`);
  return PackManifest.parse(await res.json());
}

// The bytes of one document in the pack, for the intake button to hand to the same parse a dropped
// file goes through. Uint8Array because that is what pdf.js takes: readFileSync in Node hands back a
// Buffer and the browser hands back an ArrayBuffer, and pdf.js rejects the first.
export async function fetchPackFile(filename: string): Promise<DocumentBytes> {
  const res = await fetch(packUrl(filename));
  if (!res.ok) throw new Error(`GET ${packUrl(filename)}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// For the eval tiles only. Never send it to the backend: it is not a pipeline input.
export async function fetchGroundTruth(): Promise<GroundTruth> {
  const res = await fetch("/eval/ground-truth.json");
  if (!res.ok) throw new Error(`GET /eval/ground-truth.json: ${res.status}`);
  return GroundTruth.parse(await res.json());
}
