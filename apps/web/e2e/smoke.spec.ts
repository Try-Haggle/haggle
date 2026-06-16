/**
 * Smoke tests — verify the public shell renders without API or auth.
 * Safe to run against any environment that boots the Next.js app.
 */

import { expect, test } from "@playwright/test";

test.describe("Public shell smoke", () => {
  test("sign-up page renders", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { name: /haggle/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByLabel(/confirm password/i)).toBeVisible();
  });

  test("sign-up preserves the next query param", async ({ page }) => {
    const target = "/claim/buyer?session_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await page.goto(`/sign-up?next=${encodeURIComponent(target)}`);
    await expect(page).toHaveURL(/\/sign-up\?next=/);
    // The "sign in" cross-link below the form should carry the same next.
    const signInLink = page.getByRole("link", { name: /sign in/i });
    await expect(signInLink).toHaveAttribute(
      "href",
      new RegExp(`next=${encodeURIComponent(target).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`),
    );
  });

  test("/sign-in page renders", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
});
