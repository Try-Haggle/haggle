import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublishedListingByPublicId = vi.fn();

vi.mock("../services/draft.service.js", () => ({
  getPublishedListingByPublicId: (...args: unknown[]) => getPublishedListingByPublicId(...args),
  getPublishedPriceBuckets: vi.fn(),
  getPublishedPriceRange: vi.fn(),
  listPublishedListings: vi.fn(),
}));

vi.mock("../services/trust-score.service.js", () => ({
  getPublicTrustSummariesByActorIds: vi.fn(async () => new Map()),
  getTrustScore: vi.fn(async () => null),
  toPublicTrustSummary: vi.fn(() => null),
}));

import { registerPublicListingRoutes } from "../routes/public-listing.js";

const base = {
  id: "listing-1",
  publicId: "abc12345",
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  title: "Phone",
  description: "d",
  category: "electronics",
  condition: "good",
  photoUrl: null,
  targetPrice: "100",
  tags: [],
  negotiationAgentSnapshot: null,
  sellingDeadline: null,
  holdState: null,
};

describe("GET /api/public/listings/:publicId", () => {
  beforeEach(() => vi.clearAllMocks());

  async function get() {
    const app = Fastify();
    registerPublicListingRoutes(app, {} as never);
    const res = await app.inject({ method: "GET", url: "/api/public/listings/abc12345" });
    await app.close();
    return res;
  }

  it("returns 404 for a seller-less (userId=null) listing", async () => {
    getPublishedListingByPublicId.mockResolvedValue({ ...base, sellerId: null });
    const res = await get();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: "not_found" });
  });

  it("still returns a listing that has a seller", async () => {
    getPublishedListingByPublicId.mockResolvedValue({ ...base, sellerId: "seller-1" });
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, sellerId: "seller-1" });
  });
});
