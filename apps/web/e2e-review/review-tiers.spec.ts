import { expect, test } from "@playwright/test";

test("buyer advances T1 → T2 → T3 with fresh panel progress", async ({ page }, info) => {
  let tier = 1;
  let ready = false;
  const dispute = () => ({
    id: "d1",
    order_id: "o1",
    status: "UNDER_REVIEW",
    reason_code: "ITEM_NOT_AS_DESCRIBED",
    opened_by: "buyer",
    opened_at: "2026-09-26T00:00:00Z",
    evidence: [],
    metadata: {
      tier,
      review_phase: ready ? "ACTIVE" : "AWAITING_BONDS",
      ai_resolution_assessor: { status: "COMPLETED" },
      panel_review_evaluation: {
        tier,
        ready,
        assigned_count: tier === 2 ? 5 : 7,
        voted_count: ready ? 5 : 0,
        expected_reviewer_count: tier === 2 ? 5 : 7,
        outcome: ready ? "partial_refund" : undefined,
      },
    },
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/escalate")) {
      expect(route.request().postDataJSON().expected_tier).toBe(tier);
      tier++;
      ready = false;
      return route.fulfill({ json: { dispute: dispute(), deposits: [] } });
    }
    if (url.pathname === "/api/disputes/d1") return route.fulfill({ json: { dispute: dispute() } });
    return route.fulfill({
      json: {
        deposit: null,
        messages: [],
        analysis: {
          id: "a1",
          role: "buyer_advisor",
          content: "Evidence ready for review.",
          created_at: "2026-09-26T00:00:00Z",
        },
        reply: {
          id: "m1",
          role: "buyer_advisor",
          content: "Your evidence is ready for review.",
          created_at: "2026-09-26T00:00:00Z",
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Request Tier 2 review" }).click();
  await expect(page.getByText("0 / 5 votes submitted · 5 reviewers assigned")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request Tier 3 review" })).toHaveCount(0);
  ready = true;
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await page.getByRole("button", { name: "Request Tier 3 review" }).click();
  await expect(page.getByText("This is the final review tier.")).toBeVisible();
  await expect(page.getByText("0 / 7 votes submitted · 7 reviewers assigned")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("tier3.png"), fullPage: true });
});

test("juror reads both sides and submits one tier-bound vote", async ({ page }, info) => {
  let voted = false;
  let submissions = 0;
  await page.route("**/api/**", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        vote: 75,
        expected_tier: 3,
        reasoning: "The photos support the buyer's claim.",
      });
      submissions++;
      voted = true;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({
      json: {
        assignment_id: "a1",
        assignment_tier: 3,
        current_tier: 3,
        voting_open: true,
        dispute: {
          id: "d1",
          reason_code: "ITEM_NOT_AS_DESCRIBED",
          status: "UNDER_REVIEW",
          tier: 3,
        },
        order: { item_title: "Camera", amount_minor: 50000 },
        evidence: [
          { id: "e1", submitted_by: "buyer", type: "text", text: "Lens arrived broken", uri: null },
          {
            id: "e2",
            submitted_by: "seller",
            type: "text",
            text: "Lens was intact before shipping",
            uri: null,
          },
        ],
        my_vote: voted ? 75 : null,
        my_reasoning: voted ? "The photos support the buyer's claim." : null,
        panel: {
          ready: false,
          assigned_count: 7,
          voted_count: voted ? 3 : 2,
          expected_reviewer_count: 7,
        },
      },
    });
  });
  await page.goto("/?view=reviewer");
  await expect(page.getByText("Lens arrived broken")).toBeVisible();
  await expect(page.getByText("Lens was intact before shipping")).toBeVisible();
  await page.getByRole("button", { name: "75%", exact: true }).click();
  await page.getByLabel("Reasoning (optional)").fill("The photos support the buyer's claim.");
  await page.getByRole("button", { name: "Submit vote" }).click();
  await expect(page.getByText(/Your vote: 75\/100/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit vote" })).toHaveCount(0);
  expect(submissions).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("reviewer.png"), fullPage: true });
});
