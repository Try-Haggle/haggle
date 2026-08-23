/**
 * POST /api/drafts/:id/auto-detect — taxonomy enrichment contract.
 *
 * The criteria / PAUSE system is keyed by TAGS, but the vision tagger emits descriptive
 * attributes ("256gb", "space-black") and can fail outright (unreachable image, no API
 * key). These tests pin the guarantee that matters: the item-type tag the taxonomy needs
 * is derived deterministically from the listing text, and a vision outage degrades
 * instead of failing the request.
 */

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../middleware/auth.js";

vi.mock("@haggle/db", () => ({
  eq: (c: unknown, v: unknown) => ({ __op: "eq", c, v }),
  listingDrafts: { id: {}, userId: {} },
}));

const { autoDetectMock } = vi.hoisted(() => ({ autoDetectMock: vi.fn() }));
vi.mock("../services/listing-auto-detect.service.js", () => ({
  autoDetectListing: autoDetectMock,
}));

const { getDraftByIdMock, patchDraftMock } = vi.hoisted(() => ({
  getDraftByIdMock: vi.fn(),
  patchDraftMock: vi.fn(),
}));
vi.mock("../services/draft.service.js", () => ({
  getDraftById: getDraftByIdMock,
  patchDraft: patchDraftMock,
  createDraft: vi.fn(),
  getDraftsByUserId: vi.fn(),
  publishDraft: vi.fn(),
  validateDraft: vi.fn(() => []),
}));

vi.mock("../middleware/require-auth.js", () => ({
  requireAuth: async () => {},
}));

import { registerDraftRoutes } from "../routes/drafts.js";

const USER: AuthUser = { id: "user-1", email: "s@example.com" } as AuthUser;

function buildApp() {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    (request as unknown as { user: AuthUser }).user = USER;
  });
  registerDraftRoutes(app, {} as never, { publish: vi.fn(), dispatch: vi.fn() } as never);
  return app;
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    userId: USER.id,
    photoUrl: "https://example.com/p.jpg",
    title: "iPhone 15 Pro 256GB Space Black",
    description: null,
    tags: [],
    negotiationAgentSnapshot: null,
    ...overrides,
  };
}

async function call(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({ method: "POST", url: "/api/drafts/draft-1/auto-detect" });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  patchDraftMock.mockResolvedValue(undefined);
});

describe("auto-detect — taxonomy enrichment (vision OK)", () => {
  it("adds the item-type tag when vision returned only attributes", async () => {
    getDraftByIdMock.mockResolvedValue(draft());
    autoDetectMock.mockResolvedValue({
      ok: true,
      tags: ["256gb", "space-black", "minor-scratches"],
    });

    const app = buildApp();
    const { status, body } = await call(app);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.visionOk).toBe(true);
    // vision tags preserved…
    expect(body.tags).toEqual(expect.arrayContaining(["256gb", "space-black"]));
    // …plus the taxonomy item-type token that unlocks the IMEI/activation gates.
    expect(body.inferred).toContain("iphone");
    expect(body.tags).toContain("iphone");
    // persisted, not just returned
    expect(patchDraftMock).toHaveBeenCalledWith(
      expect.anything(),
      "draft-1",
      expect.objectContaining({ tags: expect.arrayContaining(["iphone"]) }),
    );
    await app.close();
  });

  it("keeps tags the seller already added", async () => {
    getDraftByIdMock.mockResolvedValue(draft({ tags: ["seller-added"] }));
    autoDetectMock.mockResolvedValue({ ok: true, tags: ["v-tag"] });

    const app = buildApp();
    const { body } = await call(app);

    expect(body.tags.slice(0, 2)).toEqual(["seller-added", "v-tag"]);
    await app.close();
  });
});

describe("auto-detect — vision FAILURE degrades instead of 500", () => {
  it("still enriches + persists taxonomy tags when vision fails", async () => {
    // The real local-dev failure: OpenAI cannot reach a localhost image URL.
    getDraftByIdMock.mockResolvedValue(draft({ title: "Queen mattress, memory foam" }));
    autoDetectMock.mockResolvedValue({
      ok: false,
      error: { message: "image unreachable" },
    });

    const app = buildApp();
    const { status, body } = await call(app);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.visionOk).toBe(false);
    // The safety-critical part still happens.
    expect(body.inferred).toContain("mattress");
    expect(patchDraftMock).toHaveBeenCalledWith(
      expect.anything(),
      "draft-1",
      expect.objectContaining({ tags: expect.arrayContaining(["mattress"]) }),
    );
    await app.close();
  });

  it("only persists tags — never touches the negotiation snapshot", async () => {
    getDraftByIdMock.mockResolvedValue(draft({ negotiationAgentSnapshot: { keep: 1 } }));
    autoDetectMock.mockResolvedValue({ ok: false, error: { message: "boom" } });

    const app = buildApp();
    await call(app);

    const patch = patchDraftMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(patch.negotiationAgentSnapshot).toBeUndefined();
    await app.close();
  });

  it("returns cleanly when neither vision nor inference finds anything", async () => {
    getDraftByIdMock.mockResolvedValue(draft({ title: "Vintage brass telescope", tags: ["a"] }));
    autoDetectMock.mockResolvedValue({ ok: false, error: { message: "boom" } });

    const app = buildApp();
    const { status, body } = await call(app);

    expect(status).toBe(200);
    expect(body.inferred).toEqual([]);
    expect(body.tags).toEqual(["a"]);
    await app.close();
  });
});

describe("auto-detect — accessory listings stay un-enriched", () => {
  it("an iPhone case does not get the phone's item-type tag", async () => {
    getDraftByIdMock.mockResolvedValue(draft({ title: "iPhone 15 case, leather" }));
    autoDetectMock.mockResolvedValue({ ok: true, tags: ["leather"] });

    const app = buildApp();
    const { body } = await call(app);

    expect(body.inferred).toEqual([]);
    expect(body.tags).not.toContain("iphone");
    await app.close();
  });
});

describe("auto-detect — guards", () => {
  it("404s an unknown draft", async () => {
    getDraftByIdMock.mockResolvedValue(null);
    const app = buildApp();
    const { status } = await call(app);
    expect(status).toBe(404);
    await app.close();
  });

  it("403s another user's draft", async () => {
    getDraftByIdMock.mockResolvedValue(draft({ userId: "someone-else" }));
    const app = buildApp();
    const { status } = await call(app);
    expect(status).toBe(403);
    await app.close();
  });

  it("400s when photo or title is missing", async () => {
    getDraftByIdMock.mockResolvedValue(draft({ photoUrl: null }));
    const app = buildApp();
    const { status } = await call(app);
    expect(status).toBe(400);
    await app.close();
  });
});
