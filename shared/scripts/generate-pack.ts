// pnpm --filter @qryvox/shared pack:generate — renders shared/pack/source.ts into the static pack.
// PDFs and manifest go to frontend/public/pack (served as files, never through a function body);
// the ground truth goes to frontend/public/eval, apart from the documents the pipeline reads.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPack } from "../pack/build";

const publicDir = new URL("../../frontend/public/", import.meta.url);
const packDir = fileURLToPath(new URL("pack/", publicDir));
const evalDir = fileURLToPath(new URL("eval/", publicDir));

const { pdfs, manifest, groundTruth } = await buildPack();

mkdirSync(packDir, { recursive: true });
mkdirSync(evalDir, { recursive: true });
for (const { filename, bytes } of pdfs) writeFileSync(packDir + filename, bytes);
writeFileSync(packDir + "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(evalDir + "ground-truth.json", JSON.stringify(groundTruth, null, 2) + "\n");

for (const d of manifest.documents) console.log(`${d.sha256.slice(0, 12)}  ${d.page_count}p  pack/${d.filename}`);
console.log(`${groundTruth.entries.length} planted findings  eval/ground-truth.json`);
