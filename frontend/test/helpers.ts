import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GroundTruth, PackManifest } from "@qryvox/shared";
import type { PdfAssets } from "../lib/pdf";

// What every frontend test that touches the fabricated pack needs: where it lives, what the manifest
// says it should contain, and the assets pdf.js takes in Node instead of the browser's /pdfjs copy.

export const readBytes = (dir: URL, name: string) => readFileSync(fileURLToPath(new URL(name, dir)));
export const readJson = (dir: URL, name: string): unknown => JSON.parse(readBytes(dir, name).toString("utf8"));
export const packDir = new URL("../public/pack/", import.meta.url);
export const evalDir = new URL("../public/eval/", import.meta.url);
export const pdfjsDir = new URL("../node_modules/pdfjs-dist/", import.meta.url);

export const manifest = PackManifest.parse(readJson(packDir, "manifest.json"));
export const groundTruth = GroundTruth.parse(readJson(evalDir, "ground-truth.json"));

// Node wants a directory path where the browser wants the copy under /pdfjs; same build either way.
export const nodeAssets: PdfAssets = { standardFontDataUrl: fileURLToPath(new URL("standard_fonts/", pdfjsDir)) };
