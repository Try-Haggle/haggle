import { expect, test } from "@playwright/test";

async function startDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo/checkout?presenter=1");
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(page.getByTestId("presenter-panel")).toBeVisible();
}

test("presenter can show buyer review, phase 1 release, and a separate dispute outcome", async ({
  page,
}) => {
  const realMoneyRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/(payments|shipments|settlement-releases)\//.test(new URL(request.url()).pathname)) {
      realMoneyRequests.push(request.url());
    }
  });

  await startDemo(page);
  await page.getByRole("button", { name: "Buyer review" }).click();
  await expect(page.getByTestId("demo-current-step")).toHaveText("Review");
  await expect(page.getByTestId("settlement-stage-review")).toHaveAttribute("data-state", "active");
  await expect(page.getByTestId("settlement-stage-done")).toHaveAttribute("data-state", "pending");
  await expect(page.getByText("Escrow $226.55")).toBeVisible();

  await page.getByRole("button", { name: "Confirm & release" }).click();
  await expect(page.getByTestId("demo-current-step")).toHaveText("Released");
  await expect(page.getByTestId("settlement-stage-done")).toHaveAttribute("data-state", "done");
  await expect(page.getByText("Phase 1 released · weight buffer held")).toBeVisible();
  await expect(page.getByText("Released to seller · demo")).toBeVisible();
  await expect(page.getByText("$225.05 paid")).toBeVisible();

  await page.getByRole("button", { name: "Buyer review" }).click();
  await page.getByRole("button", { name: "Release phase 1" }).click();
  await expect(page.getByTestId("settlement-stage-done")).toHaveAttribute("data-state", "done");
  await expect(page.getByText("Phase 1 released · weight buffer held")).toBeVisible();
  await expect(page.getByText("Phase 1 released", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Dispute opened" }).click();
  await expect(page.getByTestId("demo-current-step")).toHaveText("Dispute review");
  await expect(page.getByTestId("settlement-stage-freeze")).toHaveAttribute("data-state", "active");
  await page.getByRole("button", { name: "Buyer wins" }).click();
  await expect(page.getByTestId("demo-current-step")).toHaveText("Refunded");
  await expect(page.getByTestId("settlement-stage-result")).toHaveAttribute("data-state", "active");
  await expect(page.getByText("Buyer wins · full refund")).toBeVisible();
  await expect(page.getByText("No seller payout")).toBeVisible();
  expect(realMoneyRequests).toEqual([]);
});

test("auto-play reaches review and release without returning to setup", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: "Auto-play demo" }).click();

  await expect(page.getByTestId("settlement-stage-done")).toHaveAttribute("data-state", "done", {
    timeout: 45_000,
  });
  await expect(page.getByTestId("demo-current-step")).toHaveText("Released");
  await expect(page.getByText("Phase 1 released · weight buffer held")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start checkout" })).toHaveCount(0);
});

test("review and release fit a phone screen without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startDemo(page);
  await page.getByRole("button", { name: "Buyer review" }).click();
  await page.getByRole("button", { name: "Confirm & release" }).click();
  await expect(page.getByTestId("demo-current-step")).toHaveText("Released");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
});
