/**
 * Phase 6 flow — anonymous buyer guest claim.
 *
 * Skipped by default because it depends on:
 *   - a seeded published listing reachable via /l/${SEED_LISTING_PUBLIC_ID}
 *   - the API server up (so `POST /negotiations/start` returns a session)
 *   - a buyer test user seeded in Supabase (for the sign-in stub)
 *
 * To run: set RUN_FLOW_E2E=1 and supply env vars from fixtures/test-users.ts.
 */

import { expect, test } from "@playwright/test";
import { BUYER_USER, SEED_LISTING_PUBLIC_ID } from "./fixtures/test-users.js";

const ENABLED = process.env.RUN_FLOW_E2E === "1";

test.describe("Buyer guest claim flow", () => {
  test.skip(!ENABLED, "set RUN_FLOW_E2E=1 to enable (requires seeded data)");

  test("anonymous buyer can run /negotiations/start, then claim after signup", async ({
    page,
    context,
  }) => {
    // 1. Land on the public listing as a guest.
    await page.goto(`/l/${SEED_LISTING_PUBLIC_ID}`);
    await expect(
      page.getByRole("heading", { name: /Item for Sale/i }),
    ).toBeVisible();

    // 2. Pick the default preset and start the negotiation.
    const startButton = page.getByRole("button", { name: /start negotiation/i });
    await expect(startButton).toBeVisible();
    await startButton.click();
    await page.waitForURL(/\/buy\/negotiations\/[^/]+/);

    // 3. The result page must show the guest-claim banner.
    const banner = page.getByText(/sign up to (buy|lock in|save)/i);
    await expect(banner).toBeVisible();

    // The guest_buyer_id should have been written to localStorage.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("haggle:guest-buyer-ids"),
    );
    expect(stored).toBeTruthy();
    const ids = JSON.parse(stored as string) as string[];
    expect(ids.length).toBeGreaterThan(0);

    // 4. Click the sign-up CTA and complete the form using BUYER_USER.
    await page.getByRole("link", { name: /sign up/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(BUYER_USER.email);
    await page.getByLabel(/^password$/i).fill(BUYER_USER.password);
    await page.getByLabel(/confirm password/i).fill(BUYER_USER.password);
    await page.getByRole("button", { name: /sign up/i }).click();

    // 5. After Supabase email verification (skipped in test environment via a
    //    pre-confirmed user), the browser should land on /claim/buyer and
    //    auto-trigger POST /claim/negotiation-sessions.
    await page.waitForURL(/\/claim\/buyer/, { timeout: 30_000 });
    await expect(page.getByText(/account linked|claimed/i)).toBeVisible({
      timeout: 15_000,
    });

    // 6. localStorage should have been cleared.
    const afterClaim = await page.evaluate(() =>
      window.localStorage.getItem("haggle:guest-buyer-ids"),
    );
    expect(afterClaim).toBeNull();

    // 7. We get bounced back to the negotiation result page (now owned).
    await page.waitForURL(/\/buy\/negotiations\/[^/]+/);
    await expect(banner).not.toBeVisible();

    await context.close();
  });
});
