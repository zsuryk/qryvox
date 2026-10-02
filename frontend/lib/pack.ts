import { GroundTruth, PackManifest } from "@qryvox/shared";

// The fabricated pack is served from public/: PDFs and manifest under /pack, the answer key under /eval.
// Regenerate with `pnpm --filter @qryvox/shared pack:generate`.

export const packUrl = (filename: string) => `/pack/${filename}`;

export async function fetchPackManifest(): Promise<PackManifest> {
  const res = await fetch("/pack/manifest.json");
  if (!res.ok) throw new Error(`GET /pack/manifest.json: ${res.status}`);
  return PackManifest.parse(await res.json());
}

// For the eval tiles only. Never send it to the backend: it is not a pipeline input.
export async function fetchGroundTruth(): Promise<GroundTruth> {
  const res = await fetch("/eval/ground-truth.json");
  if (!res.ok) throw new Error(`GET /eval/ground-truth.json: ${res.status}`);
  return GroundTruth.parse(await res.json());
}
