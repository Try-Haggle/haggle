import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "builder-budget-retry.spec.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4180",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "node apps/web/e2e/builder-fixture/server.mjs",
    url: "http://127.0.0.1:4180",
    reuseExistingServer: false,
  },
});
