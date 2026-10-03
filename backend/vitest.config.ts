import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against @qryvox/shared's source, not its build, so a change there is tested without
// rebuilding shared/dist first. Exact match only: the package's JSON and pack subpaths resolve as usual.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@qryvox\/shared$/, replacement: fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) }],
  },
});
