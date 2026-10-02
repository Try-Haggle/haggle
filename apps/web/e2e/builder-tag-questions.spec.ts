import { expect, test } from "@playwright/test";

test.skip(
  ({ baseURL }) => baseURL !== "http://127.0.0.1:4181",
  "Run with playwright.tag-questions.config.ts.",
);

// The real listing builder component; only the stateless chat API is mocked.
test("budget and chat responses focus canonical choices while taps persist without a model turn", async ({
  page,
}) => {
  const submissions: Array<{
    previous_memory: { categoryCriteria: unknown[] };
    listings: Array<{ tags: string[] }>;
  }> = [];
  await page.route("**/api/**", async (route) => {
    expect(route.request().url()).toContain("/negotiations/agents/builder/chat-turn");
    const body = route.request().postDataJSON();
    submissions.push(body);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        memory: body.previous_memory,
        reply: "Your settings are saved. Use Quick Setup below.",
        quick_setup_check_id:
          submissions.length === 1
            ? "battery_health"
            : submissions.length === 2
              ? "carrier_lock"
              : "unknown_check",
      }),
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Should the agent require a clean IMEI (not lost/blacklisted) before closing?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Require clean IMEI", exact: true }).click();
  await expect(
    page.getByText("Should the agent require the phone be fully paid off (no carrier financing)?"),
  ).toBeVisible();
  expect(submissions).toHaveLength(0);
  await page.getByRole("button", { name: "Set budget" }).click();
  await expect(
    page.getByText("What minimum battery health do you want?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "90%+", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "80%+", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "85%+", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "90%+", exact: true }).click();
  await expect(page.getByText("Is an unlocked model required?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await expect(page.getByText("What storage capacity do you want?", { exact: true })).toBeVisible();
  const input = page.getByPlaceholder("Tell me your budget, must-haves, etc...");
  await input.fill("Save these preferences.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => submissions.length).toBe(2);
  await expect(page.getByText("Is an unlocked model required?", { exact: true })).toBeVisible();
  expect(submissions[1]?.previous_memory.categoryCriteria).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        checkId: "imei_verification",
        enforcement: "hard",
        stance: "clean IMEI required — not lost or blacklisted",
      }),
      expect.objectContaining({
        checkId: "battery_health",
        enforcement: "soft",
        requirement: "optional",
        stance: "battery health 90% or higher",
      }),
    ]),
  );
  expect(submissions[1]?.listings[0].tags).toEqual(["iphone-15-pro"]);
  await page.getByRole("button", { name: "Any", exact: true }).click();
  expect(submissions).toHaveLength(2);
  await expect(page.getByText("What storage capacity do you want?", { exact: true })).toBeVisible();
  await input.fill("Save my unlocked preference too.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => submissions.length).toBe(3);
  await expect(page.getByText("What storage capacity do you want?", { exact: true })).toBeVisible();
  expect(submissions[2]?.previous_memory.categoryCriteria).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ checkId: "carrier_lock", stance: "carrier lock acceptable" }),
    ]),
  );
});
