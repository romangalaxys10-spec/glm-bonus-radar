import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable Turbopack's on-disk dev cache. A snapshot/restore cycle (container
  // recycle) can capture it mid-write; a corrupt cache wedges the dev server
  // with "Persisting failed: Another write batch or compaction is already
  // active" — HTTP hangs while background timers keep running, the platform
  // health check times out, and the space shows "problem deploying the code".
  // Cold compile of this app is only a few seconds, so losing the cache is
  // cheap; the wedge class is gone entirely.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
