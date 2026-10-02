import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/node_modules/", "**/.next/", "**/dist/", "**/.vercel/", "**/next-env.d.ts"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["frontend/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
);
