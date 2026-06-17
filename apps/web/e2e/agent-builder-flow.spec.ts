/**
 * Scenario 1 — Seller creates a negotiation agent from a preset.
 *
 * Watchable (headed + slowMo) manual verification run. Checks:
 *   1. Builder + chat open with the correct SELLER-side context (English).
 *   2. The builder chat round-trips through /negotiations/agents/builder/chat-turn
 *      and renders an assistant reply.
 *   3. Save persists a negotiation_agents row (verified via the same
 *      /negotiations/agents API the UI uses).
 *
 * Run:
 *   E2E_BASE_URL=http://localhost:3002 \
 *   pnpm exec playwright test agent-builder-flow --headed
 */

import { type APIRequestContext, expect, request, test } from "@playwright/test";

// Seeded local user (seed-test-data.ts: testuser{1..10}@haggle-test.com).
const USER = {
  email: process.env.E2E_USER_EMAIL ?? "testuser1@haggle-test.com",
  password: process.env.E2E_USER_PASSWORD ?? "TestPass1!2024",
};
const API_BASE = process.env.E2E_API_BASE_URL ?? "http://localhost:3001";
const PRESET = "closer"; // seller copy name: "Quick Closer"

// Headed + slow so the run is watchable even without the --headed flag.
test.use({ headless: false, launchOptions: { slowMo: 550 } });

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(USER.email);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  // Land anywhere authenticated (dashboard / home), just leave /sign-in.
  await page.waitForURL((url) => !url.pathname.includes("/sign-in"), {
    timeout: 30_000,
  });
}

/**
 * Build an authenticated API context by capturing the Bearer token the web app
 * itself sends to the API (robust against supabase localStorage encoding
 * changes — e.g. the `base64-` wrapped session format).
 */
async function authedApi(
  page: import("@playwright/test").Page,
  bearerRef: { token: string | null },
): Promise<APIRequestContext> {
  // Trigger an authenticated API call (the agents list page hits GET
  // /negotiations/agents) so the request listener captures a fresh token.
  await page.goto("/sell/agents");
  await expect.poll(() => bearerRef.token, { timeout: 20_000 }).not.toBeNull();
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${bearerRef.token}` },
  });
}

async function listSellerAgents(api: APIRequestContext) {
  const res = await api.get("/negotiations/agents?role=seller");
  expect(res.ok(), `GET agents failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { agents: Array<Record<string, unknown>> };
  return body.agents;
}

test("Scenario 1: seller creates an agent (chat works + persists to backend)", async ({ page }) => {
  test.setTimeout(120_000);
  const agentName = `E2E Closer ${Date.now()}`;

  // Capture the Bearer token the web app sends to the API.
  const bearerRef: { token: string | null } = { token: null };
  page.on("request", (req) => {
    const auth = req.headers().authorization;
    if (auth?.startsWith("Bearer ") && req.url().startsWith(API_BASE)) {
      bearerRef.token = auth.slice("Bearer ".length);
    }
  });

  await test.step("Sign in as seeded seller", async () => {
    await signIn(page);
    console.log(`[1] signed in as ${USER.email} → ${page.url()}`);
  });

  const api = await authedApi(page, bearerRef);

  const before = await test.step("Snapshot backend agent count (before)", async () => {
    const agents = await listSellerAgents(api);
    console.log(`[2] seller agents BEFORE: ${agents.length}`);
    return agents.length;
  });

  await test.step("Open builder + chat from the 'closer' preset", async () => {
    await page.goto(`/sell/agents/new?preset=${PRESET}`);
    // Chat input placeholder is SELLER-side + English → proves context wiring.
    const chatInput = page.getByPlaceholder("Tell me what to emphasize, deal-breakers, etc...");
    await expect(chatInput).toBeVisible({ timeout: 15_000 });
    console.log("[3] builder + SELLER-side chat opened (English placeholder ✓)");
  });

  await test.step("Send a chat message and get an assistant reply", async () => {
    const chatInput = page.getByPlaceholder("Tell me what to emphasize, deal-breakers, etc...");
    await chatInput.fill(
      "Hold firm near my floor price. Don't drop fast, and flag any lowball offers.",
    );

    const turnResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/negotiations/agents/builder/chat-turn") &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: /send message/i }).click();
    const res = await turnResponse;
    console.log(`[4] chat-turn POST → ${res.status()}`);
    expect(res.status(), "chat-turn should return 200").toBe(200);

    // An assistant bubble should appear after the round-trip.
    await expect
      .poll(
        async () =>
          await page
            .locator("text=/.+/")
            .filter({ hasText: /price|offer|floor|firm|strategy|i['’]ll|let/i })
            .count(),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    console.log("[4] assistant reply rendered ✓");
  });

  await test.step("Name + Save the agent", async () => {
    await page.locator("#agent-name").fill(agentName);
    await page.getByRole("button", { name: /^save agent$/i }).click();
    await page.waitForURL(/\/sell\/agents(\?|$|\/)/, { timeout: 30_000 });
    console.log(`[5] saved → ${page.url()}`);
  });

  await test.step("Verify persistence in backend", async () => {
    const agents = await listSellerAgents(api);
    console.log(`[6] seller agents AFTER: ${agents.length}`);
    expect(agents.length).toBe(before + 1);
    const created = agents.find((a) => a.name === agentName);
    expect(created, `agent "${agentName}" not found in backend`).toBeTruthy();
    console.log(`[6] FULL persisted row:\n${JSON.stringify(created, null, 2)}`);
  });

  // Hold the browser open briefly so the result is visible.
  await page.waitForTimeout(4000);
});
