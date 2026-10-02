import { expect, test } from "@playwright/test";

test.skip(
  ({ baseURL }) => baseURL !== "http://127.0.0.1:4180",
  "Run with playwright.builder.config.ts.",
);

// Runs the production component against a mocked chat endpoint; no account,
// database write, or provider call is needed. Use playwright.builder.config.ts.
test("budget submission recovers after repeated failures without losing prices", async ({
  page,
}) => {
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/**", async (route) => {
    expect(route.request().url()).toContain("/negotiations/agents/builder/chat-turn");
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: submissions.length < 3 ? 502 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        submissions.length < 3
          ? { error: "CHAT_TURN_FAILED", message: "Advisor failed." }
          : { reply: "Your budget is saved." },
      ),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Set budget" }).click();
  await expect(page.getByText("Advisor failed.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => submissions.length).toBe(2);
  await expect(page.getByText("Advisor failed.", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Your budget is saved.")).toBeVisible();
  await expect(page.getByText("Advisor failed.", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("My target price is $680, and my max budget is $850.", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Set budget" })).toHaveCount(0);
  expect(submissions).toHaveLength(3);
  for (const body of submissions) {
    expect(body).toMatchObject({
      message: "My target price is $680, and my max budget is $850.",
      previous_memory: { targetPrice: 680, budgetMax: 850 },
    });
  }
});
