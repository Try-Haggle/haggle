import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    devtoolSegmentExplorer: false,
  },
};

export default nextConfig;
