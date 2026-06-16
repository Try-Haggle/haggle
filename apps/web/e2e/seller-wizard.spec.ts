/**
 * Phase 5 flow — seller publishes a listing and the side effect persists
 * a `negotiation_agents` row.
 *
 * Skipped by default; same gating as buyer-claim-flow.spec.ts.
 *
 * The persistence check is exercised through the same /negotiations/agents
 * API the wizard uses for the side effect, so the assertion does not need
 * direct DB access.
 */

import { APIRequestContext, expect, request, test } from "@playwright/test";
import { SELLER_USER } from "./fixtures/test-users.js";

const ENABLED = process.env.RUN_FLOW_E2E === "1";
const API_BASE = process.env.E2E_API_BASE_URL ?? "http://localhost:3001";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(SELLER_USER.email);
  await page.getByLabel(/^password$/i).fill(SELLER_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(sell|buy)\/dashboard/);
}

async function authedApi(
  page: import("@playwright/test").Page,
): Promise<APIRequestContext> {
  const token = await page.evaluate(() => {
    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith("sb-"),
    );
    for (const k of keys) {
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { access_token?: string };
        if (parsed.access_token) return parsed.access_token;
      } catch {
        // ignore — keep scanning.
      }
    }
    return null;
  });
  if (!token) throw new Error("Could not extract Supabase access token");
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

test.describe("Seller wizard publish side effect", () => {
  test.skip(!ENABLED, "set RUN_FLOW_E2E=1 to enable (requires seeded user)");

  test("publish creates a negotiation_agents row for the seller", async ({
    page,
  }) => {
    await signIn(page);

    // Snapshot the agent count before so the side-effect delta is provable.
    const api = await authedApi(page);
    const before = await api.get("/negotiations/agents?role=seller");
    expect(before.ok()).toBeTruthy();
    const beforeRows = ((await before.json()) as { agents: unknown[] }).agents
      .length;

    await page.goto("/sell/listings/new");
    // The wizard is a 5-step form. Fill the minimum required fields and
    // accept defaults everywhere else. Step ordering may shift over time —
    // we drive by visible labels rather than step numbers.
    await page
      .getByLabel(/title/i)
      .fill("E2E iPhone Pro");
    await page.getByLabel(/description/i).fill("Lightly used E2E unit.");
    // Pick first non-placeholder option (index 1) — the test is environment-
    // agnostic about exact label text.
    await page.getByLabel(/category/i).selectOption({ index: 1 });
    await page.getByLabel(/condition/i).selectOption({ index: 1 });

    // Pricing
    await page.getByLabel(/asking price/i).fill("900");
    await page.getByLabel(/floor price/i).fill("770");

    // Agent step — pick the first preset.
    await page.getByRole("button", { name: /hunter|closer|balancer|verifier/i }).first().click();

    // Publish.
    await page.getByRole("button", { name: /publish/i }).click();
    await expect(page.getByText(/published|share link/i)).toBeVisible({
      timeout: 30_000,
    });

    // The side effect should have appended exactly one agent row.
    const after = await api.get("/negotiations/agents?role=seller");
    expect(after.ok()).toBeTruthy();
    const afterRows = ((await after.json()) as { agents: unknown[] }).agents.length;
    expect(afterRows).toBe(beforeRows + 1);
  });
});
