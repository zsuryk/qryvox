import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @qryvox/shared ships TypeScript source, not a build.
  transpilePackages: ["@qryvox/shared"],
};

export default nextConfig;
