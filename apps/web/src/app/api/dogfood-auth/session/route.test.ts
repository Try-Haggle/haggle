import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LONG_SECRET = "s".repeat(32);

describe("POST /api/dogfood-auth/session", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 404 on production (fail-closed)", async () => {
    vi.stubEnv("HAGGLE_ENV", "production");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", LONG_SECRET);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/dogfood-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: "buyer" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when secret missing", async () => {
    vi.stubEnv("HAGGLE_ENV", "staging");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", "");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/dogfood-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: "buyer" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("maps upstream 404 to T1_API_NOT_LIVE without inventing tokens", async () => {
    vi.stubEnv("HAGGLE_ENV", "staging");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", LONG_SECRET);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/dogfood-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: "seller" }),
      }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("T1_API_NOT_LIVE");
    expect(body.access_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
  });
});
