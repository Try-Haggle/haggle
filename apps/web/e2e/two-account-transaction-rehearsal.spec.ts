/**
 * W2026-08-08-01 release rehearsal.
 *
 * This is intentionally gated and headed: it creates real staging data and pauses for manual
 * login when credentials are omitted, plus the two buyer-wallet checkpoints. The seller and buyer
 * run in separate BrowserContexts, so cookies, localStorage, and authenticated API calls cannot
 * leak between the two identities.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const ENABLED = process.env.RUN_TRANSACTION_REHEARSAL === "1";
const DEFAULT_WALLET_TIMEOUT_MS = 10 * 60 * 1000;

function variationEnabled(name: string): boolean {
  return process.env[name] === "1";
}

interface Credentials {
  email: string;
  password: string;
}

function optionalCredentials(prefix: "SELLER" | "BUYER"): Credentials | null {
  const email = process.env[`E2E_${prefix}_EMAIL`]?.trim();
  const password = process.env[`E2E_${prefix}_PASSWORD`]?.trim();
  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error(
      `E2E_${prefix}_EMAIL and E2E_${prefix}_PASSWORD must either both be set or both be omitted`,
    );
  }
  return { email, password };
}

function walletTimeoutMs(): number {
  const configured = Number(process.env.E2E_MANUAL_WALLET_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WALLET_TIMEOUT_MS;
}

function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function signIn(
  page: Page,
  account: Credentials | null,
  role: "seller" | "buyer",
  manualTimeout: number,
) {
  await page.goto("/sign-in");
  if (account) {
    await page.getByLabel(/email/i).fill(account.email);
    await page.getByLabel(/^password$/i).fill(account.password);
    await page.getByRole("button", { name: /sign in/i }).click();
  } else {
    await page.bringToFront();
    console.log(
      `\n[manual login checkpoint] Sign in to the ${role} window. Use the personal staging seller account only for seller, and the separate Haggle buyer account only for buyer.\n`,
    );
  }
  await page.waitForURL(/\/(sell|buy)\/dashboard/, {
    timeout: account ? 30_000 : manualTimeout,
  });
}

async function uploadListingPhoto(page: Page, photoPath: string) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('input[type="file"]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(photoPath);
}

async function publishListing(page: Page, photoPath: string, title: string): Promise<string> {
  await page.goto("/sell/listings/new");

  await test.step("seller uploads a real file", async () => {
    await expect(page.getByRole("heading", { name: "Add a photo" })).toBeVisible();
    await uploadListingPhoto(page, photoPath);
    await expect(page.getByText("Change photo", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
  });

  await test.step("seller describes and categorizes the item", async () => {
    await page.getByLabel(/^title/i).fill(title);
    await page
      .getByLabel(/^description/i)
      .fill("Two-account Base Sepolia release rehearsal. Test asset only; not for fulfillment.");
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Categorize it" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Next", exact: true }).click();
  });

  await test.step("seller sets deterministic test pricing and an agent", async () => {
    const prices = page.locator('input[inputmode="numeric"]');
    await prices.nth(0).fill("1");
    await prices.nth(1).fill("1");
    await page.getByLabel(/selling deadline/i).fill(futureDate(7));
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Choose your AI agent" })).toBeVisible();
    await page
      .getByRole("button", { name: /hunter|closer|balancer|verifier/i })
      .first()
      .click();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
  });

  await expect(page.getByRole("heading", { name: "Your listing is live!" })).toBeVisible({
    timeout: 30_000,
  });
  const shareLink = page.locator("span").filter({ hasText: /\/l\// }).first();
  await expect(shareLink).toBeVisible();
  const displayedUrl = (await shareLink.innerText()).trim();
  return new URL(displayedUrl, page.url()).toString();
}

test.describe("two-account linked transaction rehearsal", () => {
  test.skip(!ENABLED, "set RUN_TRANSACTION_REHEARSAL=1 and use separate seller/buyer accounts");

  test("seller link -> buyer negotiation -> wallet funding -> both order views", async ({
    browser,
  }) => {
    const seller = optionalCredentials("SELLER");
    const buyer = optionalCredentials("BUYER");
    if (seller && buyer) {
      expect(seller.email.toLowerCase()).not.toBe(buyer.email.toLowerCase());
    }

    const configuredPhotoPath = process.env.E2E_LISTING_PHOTO_PATH?.trim();
    if (!configuredPhotoPath) {
      throw new Error(
        "E2E_LISTING_PHOTO_PATH must point to the test item photo that the seller intends to publish",
      );
    }
    const photoPath = path.resolve(process.cwd(), configuredPhotoPath);
    expect(existsSync(photoPath), `listing photo does not exist: ${photoPath}`).toBe(true);

    const manualWalletTimeout = walletTimeoutMs();
    const exerciseWalletChange = variationEnabled("E2E_EXERCISE_WALLET_CHANGE");
    const exerciseWrongNetwork = variationEnabled("E2E_EXERCISE_WRONG_NETWORK");
    const exerciseRejectedSignature = variationEnabled("E2E_EXERCISE_REJECTED_SIGNATURE");
    test.setTimeout(manualWalletTimeout * 4 + 6 * 60 * 1000);

    const sellerContext = await browser.newContext();
    const buyerContext = await browser.newContext();
    const sellerPage = await sellerContext.newPage();
    const buyerPage = await buyerContext.newPage();
    const title = `Release rehearsal ${Date.now()}`;

    try {
      await test.step("sign in with isolated seller and buyer sessions", async () => {
        await signIn(sellerPage, seller, "seller", manualWalletTimeout);
        await signIn(buyerPage, buyer, "buyer", manualWalletTimeout);
      });

      const shareUrl = await publishListing(sellerPage, photoPath, title);

      await test.step("buyer opens the exact link created by the seller", async () => {
        await buyerPage.goto(shareUrl);
        await expect(buyerPage.getByRole("heading", { name: title })).toBeVisible();
        await expect(
          buyerPage.getByText("You own this listing", { exact: true }),
        ).not.toBeVisible();
      });

      await test.step("buyer runs the listing's real negotiation", async () => {
        await buyerPage
          .getByRole("button", { name: /hunter|closer|balancer|verifier/i })
          .first()
          .click();
        await buyerPage.getByRole("button", { name: /start negotiation/i }).click();
        await buyerPage.waitForURL(/\/buy\/negotiations\/[^/]+$/, { timeout: 30_000 });

        const checkoutLink = buyerPage.getByRole("link", { name: /continue to checkout/i });
        await expect(checkoutLink).toBeVisible({ timeout: 3 * 60 * 1000 });
        await checkoutLink.click();
        await buyerPage.waitForURL(/\/checkout$/, { timeout: 30_000 });
      });

      await test.step("buyer chooses the staging fulfillment and hUSDC rail", async () => {
        const integrationTest = buyerPage.getByRole("button", { name: /integration test/i });
        if (await integrationTest.isVisible()) await integrationTest.click();

        await buyerPage.getByRole("button", { name: /hUSDC Direct/i }).click();
        await expect(buyerPage.getByText(/Connect your wallet to pay with USDC/i)).toBeVisible();

        // Exercise both the checkout's own Back button and browser history before any irreversible
        // operation. The shipping/payment choices must survive both paths.
        await buyerPage.getByRole("button", { name: "Back to payment options" }).click();
        await expect(integrationTest).toHaveAttribute("aria-pressed", "true");
        await expect(buyerPage.getByRole("button", { name: /hUSDC Direct/i })).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        await buyerPage.goBack();
        await buyerPage.waitForURL(/\/buy\/negotiations\/[^/]+$/, { timeout: 30_000 });
        await buyerPage.goForward();
        await buyerPage.waitForURL(/\/checkout$/, { timeout: 30_000 });
        await expect(buyerPage.getByRole("button", { name: /integration test/i })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(buyerPage.getByRole("button", { name: /hUSDC Direct/i })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await buyerPage.getByRole("button", { name: /hUSDC Direct/i }).click();
      });

      await test.step("buyer connects a dedicated Base Sepolia wallet", async () => {
        await buyerPage.bringToFront();
        console.log(
          "\n[manual wallet checkpoint] In the buyer window, connect the dedicated Base Sepolia test wallet. Do not use a personal/mainnet wallet.\n",
        );
        await expect(buyerPage.getByText("Wallet connected", { exact: true })).toBeVisible({
          timeout: manualWalletTimeout,
        });

        if (exerciseWrongNetwork) {
          console.log(
            "\n[manual network checkpoint] Switch the buyer wallet to a network other than Base Sepolia. Haggle must block checkout and offer the safe switch back.\n",
          );
          await expect(buyerPage.getByText("Switch to Base Sepolia", { exact: true })).toBeVisible({
            timeout: manualWalletTimeout,
          });
          await buyerPage.getByRole("button", { name: "Switch network", exact: true }).click();
          await expect(
            buyerPage.getByText("Switch to Base Sepolia", { exact: true }),
          ).not.toBeVisible({ timeout: manualWalletTimeout });
        }

        await buyerPage.getByRole("button", { name: "Continue", exact: true }).click();

        if (exerciseWalletChange) {
          await expect(buyerPage.getByRole("button", { name: /Get hUSDC Quote/i })).toBeVisible();
          await buyerPage.getByRole("button", { name: "Back to wallet", exact: true }).click();
          const addressText = buyerPage.getByText(/^0x[0-9a-f]{40}$/i);
          const firstAddress = (await addressText.innerText()).trim();
          await buyerPage.getByRole("button", { name: "Change", exact: true }).click();
          console.log(
            "\n[manual wallet-change checkpoint] Select a different dedicated Base Sepolia test wallet. The previous signed request must not be reused.\n",
          );
          await expect(addressText).not.toHaveText(firstAddress, { timeout: manualWalletTimeout });
          await buyerPage
            .getByRole("button", { name: "Continue prepared payment", exact: true })
            .click();
        }

        await buyerPage.getByRole("button", { name: /Get hUSDC Quote/i }).click();
        const payButton = buyerPage.getByRole("button", { name: /Pay .* securely/i });
        await expect(payButton).toBeVisible({ timeout: 30_000 });
        await buyerPage.getByRole("button", { name: "Back to quote", exact: true }).click();
        await expect(buyerPage.getByRole("button", { name: /Get hUSDC Quote/i })).toBeVisible();
        await buyerPage.getByRole("button", { name: /Get hUSDC Quote/i }).click();
      });

      await test.step("buyer approves the single atomic funding transaction", async () => {
        const payButton = buyerPage.getByRole("button", { name: /Pay .* securely/i });
        await expect(payButton).toBeVisible({ timeout: 30_000 });
        await payButton.click();

        if (exerciseRejectedSignature) {
          console.log(
            "\n[manual rejection checkpoint] Reject this first wallet request. Haggle must keep the prepared payment and offer a safe retry.\n",
          );
          await expect(
            buyerPage.getByRole("heading", { name: "Payment could not continue" }),
          ).toBeVisible({ timeout: manualWalletTimeout });
          await buyerPage.getByRole("button", { name: "Try Again", exact: true }).click();
          await buyerPage.getByRole("button", { name: /Get hUSDC Quote/i }).click();
          await buyerPage.getByRole("button", { name: /Pay .* securely/i }).click();
        }

        console.log(
          "\n[manual wallet checkpoint] Approve the atomic hUSDC approval + deposit in the buyer wallet.\n",
        );
        await expect(buyerPage.getByText("Funding confirmed", { exact: true })).toBeVisible({
          timeout: manualWalletTimeout,
        });
      });

      let orderHref = "";
      await test.step("buyer sees the funded order", async () => {
        const orderLink = buyerPage.getByRole("link", { name: /view order/i });
        orderHref = (await orderLink.getAttribute("href")) ?? "";
        expect(orderHref).toMatch(/^\/orders\/[0-9a-f-]+$/i);
        await orderLink.click();
        await expect(buyerPage.getByRole("heading", { name: "Order Details" })).toBeVisible();
        await expect(buyerPage.getByText("SETTLED", { exact: true })).toBeVisible();
      });

      await test.step("the isolated seller account sees the same funded order", async () => {
        await sellerPage.goto("/orders");
        await sellerPage.getByRole("button", { name: "Selling", exact: true }).click();
        const sellerOrder = sellerPage.locator(`a[href="${orderHref}"]`);
        await expect(sellerOrder).toBeVisible({ timeout: 30_000 });
        await sellerOrder.click();
        await expect(sellerPage.getByRole("heading", { name: "Order Details" })).toBeVisible();
        await expect(sellerPage.getByText("SETTLED", { exact: true })).toBeVisible();
      });
    } finally {
      await buyerContext.close();
      await sellerContext.close();
    }
  });
});
