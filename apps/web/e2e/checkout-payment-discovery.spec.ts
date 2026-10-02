import { expect, test } from "@playwright/test";

test("full terms lead to both payment methods and the real MetaMask wallet chooser", async ({
  page,
}) => {
  const paymentRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/payments"))
      paymentRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Secure checkout", exact: true })).toBeVisible();
  await expect(page.getByTestId("checkout-payment-rail")).toHaveCount(0);
  await expect(page.getByText(/Connect MetaMask, Coinbase Wallet/)).toBeVisible();
  // Start at the bottom, as on a real long agreement. The handoff must restore the payment view.
  await page.getByTestId("checkout-pay-as-agreed").click();
  await expect(page.getByTestId("checkout-payment-panel")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Secure payment", exact: true })).toBeInViewport();
  const card = page.getByRole("button", { name: /Pay with card/ });
  const direct = page.getByRole("button", { name: /hUSDC Direct/ });
  await expect(card).toBeVisible();
  await expect(direct).toBeVisible();
  await expect(card).toBeDisabled();
  await expect(page.getByText(/Choose a fulfillment test above/)).toBeVisible();
  await page.getByRole("button", { name: /Integration test/ }).click();
  await direct.click();
  await expect(page.getByText("Connect your wallet to pay with USDC.")).toBeVisible();
  await page.getByRole("button", { name: "Back to payment options" }).click();
  await card.click();
  await expect(page.getByText(/Connect the wallet that should receive USDC/)).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("MetaMask", { exact: true })).toBeVisible();
  expect(paymentRequests).toEqual([]);
});

test("display language follows an explicit choice across the agreement and wallet step", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Display language", { exact: true }).selectOption("ko");
  await expect(page.getByRole("heading", { name: "안전한 결제", exact: true })).toBeVisible();
  await page.getByTestId("checkout-pay-as-agreed").click();
  await expect(page.getByRole("heading", { name: "결제 수단 선택" })).toBeVisible();
  await page.getByRole("button", { name: /연동 테스트/ }).click();
  await page.getByRole("button", { name: /카드로 결제/ }).click();
  await expect(page.getByText("카드 결제 후 USDC를 받을 지갑을 연결하세요.")).toBeVisible();
  await page.getByLabel("표시 언어", { exact: true }).selectOption("en");
  await expect(page.getByText(/Connect the wallet that should receive USDC/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Confirm agreed terms" })).toBeVisible();
  await expect(page.getByTestId("checkout-payment-rail")).toHaveCount(0);
});

test("incomplete agreed details explain the blocked handoff without loading a wallet", async ({
  page,
}) => {
  await page.goto("/?incomplete");
  await expect(page.getByTestId("checkout-pay-as-agreed")).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Some agreed details are missing");
  await expect(page.getByRole("link", { name: "Leave checkout" })).toHaveAttribute("href", "/back");
  await expect(page.getByTestId("checkout-payment-rail")).toHaveCount(0);
});
