import path from "node:path";
import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  // Workspace packages live outside apps/web and must be traced into the build.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: [
    "@clipstage/contracts",
    "@videoflow/core",
    "@videoflow/react-video-editor",
    "@videoflow/renderer-dom",
    "@videoflow/renderer-browser",
  ],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
