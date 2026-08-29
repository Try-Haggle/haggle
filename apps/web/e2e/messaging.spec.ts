/**
 * Two-account messaging rehearsal.
 *
 * Gated because it needs seeded accounts that already share a negotiation
 * session — a thread cannot be opened without one. Buyer and seller run in
 * separate BrowserContexts so the two identities never share cookies, which is
 * what makes the realtime assertion meaningful.
 *
 *   RUN_MESSAGING_E2E=1 pnpm exec playwright test e2e/messaging.spec.ts
 *
 * Running it several times inside a minute trips the API's global IP rate limit
 * (100 req/min) and the run fails on an empty conversation list — that is the
 * limiter, not the feature. Space repeat runs out.
 */

import { expect, type Page, test } from "@playwright/test";

const ENABLED = process.env.RUN_MESSAGING_E2E === "1";

const BUYER = {
  email: process.env.E2E_BUYER_EMAIL ?? "testuser2@haggle-test.com",
  password: process.env.E2E_BUYER_PASSWORD ?? "TestPass2!2024",
};
const SELLER = {
  email: process.env.E2E_SELLER_EMAIL ?? "testuser1@haggle-test.com",
  password: process.env.E2E_SELLER_PASSWORD ?? "TestPass1!2024",
};

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });
}

test.describe("Messaging", () => {
  test.skip(!ENABLED, "set RUN_MESSAGING_E2E=1 (needs seeded accounts with a negotiation)");

  test("both sides open the same thread from their negotiation screen", async ({ browser }) => {
    // This is the check that was missing when the entry point silently existed
    // on only one side.
    const context = await browser.newContext();
    const page = await context.newPage();
    const sessionId = process.env.E2E_SESSION_ID;
    test.skip(!sessionId, "set E2E_SESSION_ID to a negotiation shared by both accounts");

    try {
      await signIn(page, SELLER);
      await page.goto(`/sell/negotiations/${sessionId}`);
      await page.getByRole("button", { name: /Message buyer/ }).click();
      await page.waitForURL(/\/messages\?c=/, { timeout: 20_000 });
      const sellerThread = new URL(page.url()).searchParams.get("c");

      const buyerContext = await browser.newContext();
      const buyerPage = await buyerContext.newPage();
      try {
        await signIn(buyerPage, BUYER);
        await buyerPage.goto(`/buy/negotiations/${sessionId}`);
        await buyerPage.getByRole("button", { name: /Message seller/ }).click();
        await buyerPage.waitForURL(/\/messages\?c=/, { timeout: 20_000 });

        // One negotiation, one thread — not one per side.
        expect(new URL(buyerPage.url()).searchParams.get("c")).toBe(sellerThread);
      } finally {
        await buyerContext.close();
      }
    } finally {
      await context.close();
    }
  });

  test("a message sent by the buyer reaches the seller's open thread", async ({ browser }) => {
    const buyerContext = await browser.newContext();
    const sellerContext = await browser.newContext();
    const buyerPage = await buyerContext.newPage();
    const sellerPage = await sellerContext.newPage();

    try {
      await signIn(buyerPage, BUYER);
      await signIn(sellerPage, SELLER);

      await buyerPage.goto("/messages");
      await expect(buyerPage.getByRole("heading", { name: "Messages" })).toBeVisible();

      // Open the first thread on both sides.
      const buyerThread = buyerPage.getByTestId("conversation-item").first();
      // Generous: a cold Next dev compile can take longer than the list fetch.
      await expect(buyerThread).toBeVisible({ timeout: 30_000 });
      await buyerThread.click();

      await sellerPage.goto("/messages");
      const sellerThread = sellerPage.getByTestId("conversation-item").first();
      await expect(sellerThread).toBeVisible({ timeout: 30_000 });
      await sellerThread.click();

      const body = `e2e ${Date.now()}`;
      await buyerPage.getByRole("textbox", { name: "Message" }).fill(body);
      await buyerPage.getByRole("button", { name: "Send message" }).click();

      // Sent optimistically on the buyer's side...
      await expect(buyerPage.getByText(body)).toBeVisible();
      // ...and pushed to the seller's socket without a reload.
      await expect(sellerPage.getByText(body)).toBeVisible({ timeout: 15_000 });
    } finally {
      await buyerContext.close();
      await sellerContext.close();
    }
  });
});
