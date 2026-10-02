import { GroundTruth, PackManifest } from "@qryvox/shared";
import type { DocumentBytes, IntakeFile } from "./intake";

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

// The pack as intake takes it: one source per document, read by filename, with the ids and kinds the
// manifest names. Loading the pack this way and dropping it onto the zone then differ only in where
// the bytes come from, which is what keeps the button on the same road as a hand drop.
export async function packSources(): Promise<IntakeFile[]> {
  const { documents } = await fetchPackManifest();
  return documents.map((document) => ({
    filename: document.filename,
    documentId: document.document_id,
    kind: document.kind,
    read: () => fetchPackFile(document.filename),
  }));
}

// For the eval tiles only. Never send it to the backend: it is not a pipeline input.
export async function fetchGroundTruth(): Promise<GroundTruth> {
  const res = await fetch("/eval/ground-truth.json");
  if (!res.ok) throw new Error(`GET /eval/ground-truth.json: ${res.status}`);
  return GroundTruth.parse(await res.json());
}
