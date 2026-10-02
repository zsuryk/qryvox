import { PDFJS_VERSION } from "@qryvox/shared";
import { cp, mkdir, readFile, rm } from "node:fs/promises";

// pdf.js loads its worker and its fonts at runtime, from URLs the caller has to name (see PdfAssets
// in lib/pdf.ts). Next emits neither out of node_modules, so they are copied out of the installed
// pdfjs-dist into public/, where the browser fetches them as static files alongside the pack.
//
// Copying from the resolved package rather than committing the files is what keeps the browser and
// the Node caller in lib/pdf.ts on one build: there is only one pdfjs-dist to copy from. The version
// is asserted first, so a bumped pin without a matching install fails here rather than mid-extraction.

const pdfjsDir = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const outDir = new URL("../public/pdfjs/", import.meta.url);

// The worker, flattened out of legacy/build/ because its URL is named in lib/pdf.ts, and the fonts the
// pack's pdf-lib pages do not embed. Not the cmaps: getDocument is never given a cMapUrl, so a CID-keyed
// PDF has no way to ask for one, and 1.6 MB of files nothing can request is not worth carrying.
const assets: readonly (readonly [from: string, to: string])[] = [
  ["legacy/build/pdf.worker.mjs", "pdf.worker.mjs"],
  ["standard_fonts", "standard_fonts"],
];

const installed = JSON.parse(await readFile(new URL("package.json", pdfjsDir), "utf8")) as { version: string };
if (installed.version !== PDFJS_VERSION) {
  throw new Error(
    `pdfjs-dist ${installed.version} is installed but PDFJS_VERSION is ${PDFJS_VERSION}. ` +
      `Re-pin both in pnpm-workspace.yaml and shared/src/pack.ts, then run pack:generate.`,
  );
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
for (const [from, to] of assets) await cp(new URL(from, pdfjsDir), new URL(to, outDir), { recursive: true });

console.log(`pdf.js ${PDFJS_VERSION}: copied ${assets.map(([, to]) => to).join(", ")} into public/pdfjs/`);
