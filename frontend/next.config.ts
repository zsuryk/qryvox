import type { NextConfig } from "next";

// .env.example lives at the repository root (spec decision 42); Next only reads env files in frontend/.
try {
  process.loadEnvFile("../.env");
} catch {
  // no root .env: the defaults in lib/api.ts apply
}

const nextConfig: NextConfig = {
  // @qryvox/shared ships TypeScript source, not a build.
  transpilePackages: ["@qryvox/shared"],
};

export default nextConfig;
