import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../middleware/auth.js";
import { registerIntelligenceRoutes } from "../routes/intelligence.js";

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

function buildApp(db: import("@haggle/db").Database, user?: AuthUser) {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (request) => {
    request.user = user;
  });
  registerIntelligenceRoutes(app, db);
  return app;
}

describe("Intelligence routes", () => {
  it("requires auth for user memory controls", async () => {
    const app = buildApp({ execute: vi.fn() } as unknown as import("@haggle/db").Database);

    const res = await app.inject({ method: "GET", url: "/intelligence/memory/cards" });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
    await app.close();
  });

  it("requires auth for advisor memory saves", async () => {
    const app = buildApp({ execute: vi.fn() } as unknown as import("@haggle/db").Database);

    const res = await app.inject({
      method: "POST",
      url: "/intelligence/advisor-memory",
      payload: {
        message: "save this preference",
        memory: {
          categoryInterest: "laptop",
          mustHave: [],
          avoid: [],
          riskStyle: "balanced",
          negotiationStyle: "balanced",
          openingTactic: "fair_market_anchor",
          questions: [],
          source: ["save this preference"],
        },
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
    await app.close();
  });

  it("saves advisor memory for the authenticated user only", async () => {
    const execute = vi.fn().mockImplementation((query: { raw: string; values: unknown[] }) => {
      if (query.raw.includes("INSERT INTO user_memory_cards")) {
        return Promise.resolve([
          {
            id: "55555555-5555-4555-8555-555555555555",
            user_id: "44444444-4444-4444-8444-444444444444",
            card_type: "interest",
            memory_key: "advisor:category_interest",
            summary: "Interested in laptop",
            memory: { categoryInterest: "laptop" },
            strength: "0.6500",
            version: 1,
            updated_at: "2026-04-27T00:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const app = buildApp(
      { execute } as unknown as import("@haggle/db").Database,
      { id: "44444444-4444-4444-8444-444444444444", role: "authenticated" },
    );

    const res = await app.inject({
      method: "POST",
      url: "/intelligence/advisor-memory",
      payload: {
        user_id: "99999999-9999-4999-8999-999999999999",
        message: "대학원에서 쓸 가벼운 랩탑을 찾고 있어.",
        memory: {
          categoryInterest: "laptop",
          budgetMax: 500,
          targetPrice: 450,
          mustHave: ["lightweight"],
          avoid: [],
          riskStyle: "balanced",
          negotiationStyle: "balanced",
          openingTactic: "fair_market_anchor",
          questions: [],
          source: ["대학원에서 쓸 가벼운 랩탑을 찾고 있어."],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user_id).toBe("44444444-4444-4444-8444-444444444444");
    const memoryQueries = execute.mock.calls
      .map((call) => call[0] as { raw: string; values: unknown[] })
      .filter((query) => query.raw.includes("INSERT INTO user_memory_cards"));
    expect(memoryQueries.length).toBeGreaterThan(0);
    expect(JSON.stringify(memoryQueries[0]?.values)).toContain("44444444-4444-4444-8444-444444444444");
    expect(JSON.stringify(memoryQueries[0]?.values)).not.toContain("99999999-9999-4999-8999-999999999999");
    await app.close();
  });

  it("lists authenticated user's memory cards", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        status: "ACTIVE",
        cardType: "pricing",
        memoryKey: "price_resistance:ceiling:ceiling_70000",
        summary: "buyer pricing boundary: ceiling_70000",
        strength: "0.6500",
        memory: { normalizedValue: "ceiling_70000" },
        evidenceRefs: ["round-1:incoming#3-14"],
      },
    ]);
    const app = buildApp(
      { execute } as unknown as import("@haggle/db").Database,
      { id: "44444444-4444-4444-8444-444444444444", role: "authenticated" },
    );

    const res = await app.inject({ method: "GET", url: "/intelligence/memory/cards" });

    expect(res.statusCode).toBe(200);
    expect(res.json().cards).toHaveLength(1);
    expect(JSON.stringify(execute.mock.calls[0]?.[0].values)).toContain("44444444-4444-4444-8444-444444444444");
    await app.close();
  });

  it("suppresses one authenticated user's memory card", async () => {
    const execute = vi.fn().mockResolvedValue([{ id: "55555555-5555-4555-8555-555555555555" }]);
    const app = buildApp(
      { execute } as unknown as import("@haggle/db").Database,
      { id: "44444444-4444-4444-8444-444444444444", role: "authenticated" },
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/intelligence/memory/cards/55555555-5555-4555-8555-555555555555/suppress",
      payload: { reason: "wrong preference" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().affected).toBe(1);
    expect(execute.mock.calls[0]?.[0].raw).toContain("SET status = 'SUPPRESSED'");
    await app.close();
  });

  it("requires admin for source-only replay", async () => {
    const app = buildApp(
      { execute: vi.fn() } as unknown as import("@haggle/db").Database,
      { id: "44444444-4444-4444-8444-444444444444", role: "authenticated" },
    );

    const res = await app.inject({
      method: "POST",
      url: "/intelligence/ops/replay-source-only",
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ADMIN_REQUIRED");
    await app.close();
  });
});
