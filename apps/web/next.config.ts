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
  // Dev now runs on webpack (`next dev --webpack`, see package.json), not
  // Turbopack — Turbopack's dev server idled at 200%+ CPU in this repo
  // (verified: webpack idles at 0%). The workspace-root inference warning
  // this leaves in the logs is cosmetic; silencing it means setting
  // outputFileTracingRoot, which affects the `output: "standalone"` PRODUCTION
  // build's file tracing — not worth the risk of excluding hoisted node_modules
  // (`next` lives in the monorepo root's node_modules, not apps/web's) to fix
  // a log line. Leave it as Next's own inferred default, which the working
  // production build already relies on.
};

export default nextConfig;
