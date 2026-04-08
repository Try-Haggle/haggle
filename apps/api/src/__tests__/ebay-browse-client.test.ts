import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EbayBrowseClient,
  EbayRateLimitExceededError,
  EbayAuthError,
  defaultIphoneFilter,
} from "../lib/ebay-browse-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof EbayBrowseClient>[0]> = {}) {
  return new EbayBrowseClient({
    clientId: "test_id",
    clientSecret: "test_secret",
    fetchImpl,
    baseBackoffMs: 1,
    ...overrides,
  });
}

describe("EbayBrowseClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails fast without credentials", async () => {
    const client = new EbayBrowseClient({
      clientId: "",
      clientSecret: "",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(client.hasCredentials()).toBe(false);
    await expect(
      client.searchActiveListings({ q: "iPhone" }),
    ).rejects.toBeInstanceOf(EbayAuthError);
  });

  it("caches OAuth token across calls within expiry", async () => {
    let tokenCalls = 0;
    let searchCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/identity/v1/oauth2/token")) {
        tokenCalls++;
        return jsonResponse({
          access_token: `tok_${tokenCalls}`,
          expires_in: 7200,
          token_type: "Application Access Token",
        });
      }
      searchCalls++;
      return jsonResponse({
        itemSummaries: [
          { itemId: `id_${searchCalls}`, title: "x", price: { value: "500", currency: "USD" } },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.searchActiveListings({ q: "iPhone 14 Pro" });
    await client.searchActiveListings({ q: "iPhone 14 Pro" });
    await client.searchActiveListings({ q: "iPhone 14 Pro" });

    expect(tokenCalls).toBe(1); // cached, not refetched
    expect(searchCalls).toBe(3);
    expect(client.getCallsToday()).toBe(3);
  });

  it("refetches token after expiry", async () => {
    let now = 1_700_000_000_000;
    let tokenCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/identity/v1/oauth2/token")) {
        tokenCalls++;
        return jsonResponse({ access_token: `tok_${tokenCalls}`, expires_in: 60, token_type: "x" });
      }
      return jsonResponse({ itemSummaries: [], total: 0, limit: 100, offset: 0 });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl, { now: () => now });
    await client.searchActiveListings({ q: "x" });
    // Advance past expiry (60s) + 60s safety window
    now += 200_000;
    await client.searchActiveListings({ q: "x" });
    expect(tokenCalls).toBe(2);
  });

  it("throws EbayRateLimitExceededError when counter at limit", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "t", expires_in: 7200, token_type: "x" }),
    ) as unknown as typeof fetch;
    const client = makeClient(fetchImpl, { dailyLimit: 4500 });
    client._setCallsTodayForTest(4500);
    await expect(
      client.searchActiveListings({ q: "iPhone" }),
    ).rejects.toBeInstanceOf(EbayRateLimitExceededError);
  });

  it("increments counter before call and blocks the next one at the ceiling", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/identity/v1/oauth2/token")) {
        return jsonResponse({ access_token: "t", expires_in: 7200, token_type: "x" });
      }
      return jsonResponse({ itemSummaries: [], total: 0, limit: 100, offset: 0 });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl, { dailyLimit: 2 });
    await client.searchActiveListings({ q: "x" });
    await client.searchActiveListings({ q: "x" });
    expect(client.getCallsToday()).toBe(2);
    await expect(client.searchActiveListings({ q: "x" })).rejects.toBeInstanceOf(
      EbayRateLimitExceededError,
    );
  });

  it("retries on 429 with backoff and eventually succeeds", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/identity/v1/oauth2/token")) {
        return jsonResponse({ access_token: "t", expires_in: 7200, token_type: "x" });
      }
      attempts++;
      if (attempts < 3) return new Response("rate limited", { status: 429 });
      return jsonResponse({ itemSummaries: [{ itemId: "a", title: "t", price: { value: "500", currency: "USD" } }], total: 1, limit: 100, offset: 0 });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    const resp = await client.searchActiveListings({ q: "x" });
    expect(resp.itemSummaries).toHaveLength(1);
    expect(attempts).toBe(3);
  });

  it("retries on 5xx then exhausts retries", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/identity/v1/oauth2/token")) {
        return jsonResponse({ access_token: "t", expires_in: 7200, token_type: "x" });
      }
      return new Response("server", { status: 503 });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl, { maxRetries: 2 });
    await expect(client.searchActiveListings({ q: "x" })).rejects.toThrow();
  });

  it("builds search URL with default category and filter", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/identity/v1/oauth2/token")) {
        return jsonResponse({ access_token: "t", expires_in: 7200, token_type: "x" });
      }
      return jsonResponse({ itemSummaries: [], total: 0, limit: 100, offset: 0 });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.searchActiveListings({
      q: "Apple iPhone 14 Pro",
      filter: defaultIphoneFilter(),
      limit: 50,
      offset: 100,
    });
    const searchCall = seen.find((u) => u.includes("/item_summary/search"));
    expect(searchCall).toBeDefined();
    expect(searchCall).toContain("q=Apple+iPhone+14+Pro");
    expect(searchCall).toContain("category_ids=9355");
    expect(searchCall).toContain("limit=50");
    expect(searchCall).toContain("offset=100");
    expect(searchCall).toContain("filter=");
  });
});
