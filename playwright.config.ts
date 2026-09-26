import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev:web",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_DEMO_MODE: "true" },
    timeout: 60000,
  },
});
