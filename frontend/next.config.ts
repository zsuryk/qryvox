import type { NextConfig } from "next";

// .env.example lives at the repository root (spec decision 42); Next only reads env files in frontend/.
try {
  process.loadEnvFile("../.env");
} catch {
  // no root .env: the defaults in lib/api.ts apply
}

const nextConfig: NextConfig = {
  // @qryvox/shared resolves to its build (shared/dist), which `pnpm dev` refreshes first. Turbopack cannot
  // read the source: it does not map the source's "./x.js" imports to their .ts files.
  transpilePackages: ["@qryvox/shared"],
};

export default nextConfig;
