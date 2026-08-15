import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — apps/web flows.
 *
 * Requirements to run locally:
 *   1. Postgres reachable via apps/api/.env DATABASE_URL
 *   2. Supabase project (or local stack) reachable via apps/web/.env.local
 *   3. Migration 0024 applied (Phase 1 rename + role column)
 *   4. Test users seeded — see e2e/fixtures/test-users.ts
 *
 * The webServer block boots `pnpm --filter @haggle/web dev` on demand.
 * For CI we expect a pre-warmed server reachable at E2E_BASE_URL.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SMOKE_SUPABASE_URL = "http://127.0.0.1:54321";
const SMOKE_SUPABASE_ANON_KEY = "playwright-smoke-anon-key";

export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // ulimit raises the file-descriptor cap so Next.js' Watchpack does
        // not hit EMFILE on macOS (default 256).
        command: "bash -lc 'ulimit -n 65535; pnpm --filter @haggle/web dev'",
        url: BASE_URL,
        env: {
          ...process.env,
          // Public smoke only verifies that the auth shell renders. Supplying
          // inert defaults keeps @supabase/ssr from crashing before the form
          // mounts while preserving real local credentials when configured.
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? SMOKE_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? SMOKE_SUPABASE_ANON_KEY,
        },
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
