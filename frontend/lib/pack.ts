import { GroundTruth, PackManifest } from "@qryvox/shared";
import type { DocumentBytes, IntakeFile } from "./intake";

// The fabricated packs are served from public/: PDFs and manifests under /pack, answer keys under /eval.
// Larkspur sits at the top of each, where it always has; the revised Larkspur (v2) and the second
// product (Wrenfield) in a folder of their own beneath it. Regenerate with
// `pnpm --filter @qryvox/shared pack:generate`.

export const PACKS = [
  { id: "larkspur-v1", label: "Larkspur Global Income Fund", dir: "" },
  { id: "larkspur-v2", label: "Larkspur, revised", dir: "v2/" },
  { id: "wrenfield-v1", label: "Wrenfield Short Duration Fund", dir: "wrenfield/" },
] as const;
export type PackId = (typeof PACKS)[number]["id"];

export const packUrl = (filename: string, dir = "") => `/pack/${dir}${filename}`;

export async function fetchPackManifest(dir = ""): Promise<PackManifest> {
  const res = await fetch(`/pack/${dir}manifest.json`);
  if (!res.ok) throw new Error(`GET /pack/${dir}manifest.json: ${res.status}`);
  return PackManifest.parse(await res.json());
}

// The bytes of one document in the pack, for the intake button to hand to the same parse a dropped
// file goes through. Uint8Array because that is what pdf.js takes: readFileSync in Node hands back a
// Buffer and the browser hands back an ArrayBuffer, and pdf.js rejects the first.
export async function fetchPackFile(filename: string, dir = ""): Promise<DocumentBytes> {
  const res = await fetch(packUrl(filename, dir));
  if (!res.ok) throw new Error(`GET ${packUrl(filename, dir)}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// A document a case recorded, by its filename, from whichever pack serves it: Larkspur's folder first,
// as before, and the other packs' folders only when it is not there. Which bytes these are is not decided
// here: the caller hashes them against the case log, so a file found elsewhere can never pass as another.
export async function fetchAnyPackFile(filename: string): Promise<DocumentBytes> {
  let first: unknown = null;
  for (const pack of PACKS) {
    try {
      return await fetchPackFile(filename, pack.dir);
    } catch (cause) {
      first ??= cause;
    }
  }
  throw first;
}

// The pack as intake takes it: one source per document, read by filename, with the ids and kinds the
// manifest names. Loading the pack this way and dropping it onto the zone then differ only in where
// the bytes come from, which is what keeps the button on the same road as a hand drop.
export async function packSources(dir = ""): Promise<IntakeFile[]> {
  const { documents } = await fetchPackManifest(dir);
  return documents.map((document) => ({
    filename: document.filename,
    documentId: document.document_id,
    kind: document.kind,
    read: () => fetchPackFile(document.filename, dir),
  }));
}

// For the eval tiles only. Never send it to the backend: it is not a pipeline input.
export async function fetchGroundTruth(dir = ""): Promise<GroundTruth> {
  const res = await fetch(`/eval/${dir}ground-truth.json`);
  if (!res.ok) throw new Error(`GET /eval/${dir}ground-truth.json: ${res.status}`);
  return GroundTruth.parse(await res.json());
}
