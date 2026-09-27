import type { NextConfig } from "next";
const config: NextConfig = {
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
