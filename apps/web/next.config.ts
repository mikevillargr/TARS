import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next 16 blocks cross-origin requests to /_next/* dev resources by default,
  // and treats 127.0.0.1 and localhost as different origins. Browsing the dev
  // server on the "wrong" one silently blocks the dev runtime: React never
  // hydrates, so every page renders its SSR shell and nothing is clickable —
  // no error, just a dead app. Allow both so either URL works.
  // Dev-only; has no effect on the production build.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
