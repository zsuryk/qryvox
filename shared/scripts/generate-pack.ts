// pnpm --filter @qryvox/shared pack:generate — renders shared/pack/source.ts (and v2, source-v2.ts) into
// the static packs. PDFs and manifests go to frontend/public/pack (served as files, never through a
// function body); the ground truth and the personas go to frontend/public/eval, apart from the documents
// the pipeline reads. v1 sits at the top of each directory, where it always has; v2 in a v2/ beneath it.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPack, LARKSPUR_V1, type PackSource } from "../pack/build";
import { LARKSPUR_V2 } from "../pack/source-v2";

const publicDir = new URL("../../frontend/public/", import.meta.url);

async function generate(source: PackSource, subdir: string) {
  const packDir = fileURLToPath(new URL(`pack/${subdir}`, publicDir));
  const evalDir = fileURLToPath(new URL(`eval/${subdir}`, publicDir));
  const { pdfs, manifest, groundTruth, personas } = await buildPack(source);

  mkdirSync(packDir, { recursive: true });
  mkdirSync(evalDir, { recursive: true });
  for (const { filename, bytes } of pdfs) writeFileSync(packDir + filename, bytes);
  writeFileSync(packDir + "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(evalDir + "ground-truth.json", JSON.stringify(groundTruth, null, 2) + "\n");
  writeFileSync(evalDir + "personas.json", JSON.stringify(personas, null, 2) + "\n");

  for (const d of manifest.documents) console.log(`${d.sha256.slice(0, 12)}  ${d.page_count}p  pack/${subdir}${d.filename}`);
  console.log(`${groundTruth.entries.length} planted findings, ${personas.personas.length} personas  eval/${subdir}`);
}

await generate(LARKSPUR_V1, "");
await generate(LARKSPUR_V2, "v2/");
