import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The model_architecture route reads the PNG from the filesystem at runtime;
  // make sure Vercel's function bundle includes it.
  outputFileTracingIncludes: {
    "/api/model_architecture": ["./public/architecture.png"],
  },
};

export default nextConfig;
