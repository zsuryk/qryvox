import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  // .next/ and any .next-*/ dev or build output (a second distDir): generated, never linted.
  // frontend/public/pdfjs/ holds served assets, not code we wrote: the pinned pdf.js build that
  // frontend/scripts/pdfjs-assets.ts copies in before dev and build.
  { ignores: ["**/node_modules/", "**/.next/", "**/.next-*/", "**/dist/", "**/.vercel/", "**/next-env.d.ts", "frontend/public/pdfjs/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["frontend/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
);
