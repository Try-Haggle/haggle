import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerDraftRoutes } from "../src/routes/drafts.js";

// ─── Mock DB ─────────────────────────────────────────────────

const MOCK_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const MOCK_DRAFT = {
  id: MOCK_UUID,
  status: "draft" as const,
  userId: null,
  claimToken: null,
  claimExpiresAt: null,
  title: "Test Item",
  category: "electronics",
  brand: "Apple",
  model: "iPhone 15",
  condition: "good",
  description: "A great phone",
  targetPrice: "999.99",
  floorPrice: "799.99",
  strategyConfig: null,
  createdAt: new Date("2026-02-19T00:00:00Z"),
  updatedAt: new Date("2026-02-19T00:00:00Z"),
};

function createMockDb(initialDraft = MOCK_DRAFT) {
  const store = new Map<string, typeof MOCK_DRAFT>();
  if (initialDraft) store.set(initialDraft.id, { ...initialDraft });

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((condition: unknown) => {
          // Extract the id from the eq() call — in tests we just use the store
          const id = extractIdFromCondition(condition);
          const row = id ? store.get(id) : undefined;
          return Promise.resolve(row ? [row] : []);
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            // For simplicity, return the stored draft with updates applied
            const draft = store.get(MOCK_UUID);
            return Promise.resolve(draft ? [draft] : []);
          }),
        }),
      }),
    }),
  } as unknown;
}

// In tests the condition is opaque — we parse the UUID from the mock call args
function extractIdFromCondition(_condition: unknown): string | null {
  // The mock chain captures what's passed; for our tests we track via URL params
  return null;
}

// ─── Simpler approach: intercept at route level ──────────────

function buildApp(db: unknown): FastifyInstance {
  const app = Fastify();
  registerDraftRoutes(app, db as any);
  return app;
}

describe("Draft REST API", () => {
  // Use a real-ish mock that captures the ID from where() calls
  function createTrackingDb(drafts: Map<string, typeof MOCK_DRAFT>) {
    let capturedId: string | null = null;
    let capturedUpdates: Record<string, unknown> = {};

    const whereFnSelect = vi.fn().mockImplementation(() => {
      const row = capturedId ? drafts.get(capturedId) : undefined;
      return Promise.resolve(row ? [row] : []);
    });

    const returningFn = vi.fn().mockImplementation(() => {
      if (!capturedId) return Promise.resolve([]);
      const draft = drafts.get(capturedId);
      if (!draft) return Promise.resolve([]);
      // Apply updates
      const updated = { ...draft, ...capturedUpdates };
      drafts.set(capturedId, updated);
      return Promise.resolve([updated]);
    });

    const whereFnUpdate = vi.fn().mockReturnValue({ returning: returningFn });
    const setFn = vi.fn().mockImplementation((updates: Record<string, unknown>) => {
      capturedUpdates = updates;
      return { where: whereFnUpdate };
    });

    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: whereFnSelect,
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: setFn,
      }),
      // Helper to set the captured ID (called via eq() extraction)
      _setCapturedId(id: string) {
        capturedId = id;
      },
      _whereFnSelect: whereFnSelect,
      _whereFnUpdate: whereFnUpdate,
    };
  }

  // Since we can't easily intercept drizzle's eq(), we'll use a different
  // approach: build a minimal mock where the `where` fn captures and checks.
  function createSimpleDb(drafts: Map<string, typeof MOCK_DRAFT>) {
    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            // Return first draft for valid UUIDs, empty for others
            // Tests control this by setting up the store
            return Promise.resolve([...drafts.values()]);
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockImplementation(() => {
              return Promise.resolve([...drafts.values()]);
            }),
          }),
        }),
      }),
    } as unknown;
  }

  // ─── GET /api/drafts/:id ───────────────────────────────────

  describe("GET /api/drafts/:id", () => {
    it("returns 400 for invalid UUID format", async () => {
      const app = buildApp(createSimpleDb(new Map()));
      const res = await app.inject({
        method: "GET",
        url: "/api/drafts/not-a-uuid",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INVALID_ID");
    });

    it("returns 404 for non-existent draft", async () => {
      const app = buildApp(createSimpleDb(new Map()));
      const res = await app.inject({
        method: "GET",
        url: `/api/drafts/${MOCK_UUID}`,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 200 with draft data for existing draft", async () => {
      const store = new Map([[MOCK_UUID, { ...MOCK_DRAFT }]]);
      const app = buildApp(createSimpleDb(store));
      const res = await app.inject({
        method: "GET",
        url: `/api/drafts/${MOCK_UUID}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(MOCK_UUID);
      expect(body.data.title).toBe("Test Item");
      expect(body.data.target_price).toBe("999.99");
      expect(body.data.created_at).toBeDefined();
    });
  });

  // ─── PATCH /api/drafts/:id ─────────────────────────────────

  describe("PATCH /api/drafts/:id", () => {
    it("returns 400 for invalid UUID format", async () => {
      const app = buildApp(createSimpleDb(new Map()));
      const res = await app.inject({
        method: "PATCH",
        url: "/api/drafts/bad-id",
        payload: { title: "New" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("INVALID_ID");
    });

    it("returns 400 for unrecognized fields (strict mode)", async () => {
      const store = new Map([[MOCK_UUID, { ...MOCK_DRAFT }]]);
      const app = buildApp(createSimpleDb(store));
      const res = await app.inject({
        method: "PATCH",
        url: `/api/drafts/${MOCK_UUID}`,
        payload: { title: "Ok", unknown_field: "bad" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid enum value", async () => {
      const store = new Map([[MOCK_UUID, { ...MOCK_DRAFT }]]);
      const app = buildApp(createSimpleDb(store));
      const res = await app.inject({
        method: "PATCH",
        url: `/api/drafts/${MOCK_UUID}`,
        payload: { category: "invalid_category" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid price format", async () => {
      const store = new Map([[MOCK_UUID, { ...MOCK_DRAFT }]]);
      const app = buildApp(createSimpleDb(store));
      const res = await app.inject({
        method: "PATCH",
        url: `/api/drafts/${MOCK_UUID}`,
        payload: { target_price: "abc" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 for non-existent draft", async () => {
      const app = buildApp(createSimpleDb(new Map()));
      const res = await app.inject({
        method: "PATCH",
        url: `/api/drafts/${MOCK_UUID}`,
        payload: { title: "Updated" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    });

    it("returns 200 on valid update", async () => {
      const store = new Map([[MOCK_UUID, { ...MOCK_DRAFT }]]);
      const app = buildApp(createSimpleDb(store));
      const res = await app.inject({
        method: "PATCH",
        url: `/api/drafts/${MOCK_UUID}`,
        payload: { title: "Updated Item", target_price: "899.99" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(MOCK_UUID);
    });

    it("accepts valid enum values", async () => {
      const store = new Map([[MOCK_UUID, { ...MOCK_DRAFT }]]);
      const app = buildApp(createSimpleDb(store));
      const res = await app.inject({
        method: "PATCH",
        url: `/api/drafts/${MOCK_UUID}`,
        payload: { category: "fashion", condition: "like_new" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });
});
