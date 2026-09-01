import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../middleware/auth.js";

const { withdrawOwnedListingMock } = vi.hoisted(() => ({
  withdrawOwnedListingMock: vi.fn(),
}));

vi.mock("../services/draft.service.js", () => ({
  getListingByIdForUser: vi.fn(),
  getListingsByUserId: vi.fn(),
  withdrawOwnedListing: withdrawOwnedListingMock,
}));

vi.mock("../middleware/require-auth.js", () => ({
  requireAuth: async () => {},
}));

import { registerListingsRoutes } from "../routes/listings.js";

const USER: AuthUser = { id: "seller-1", email: "s@example.com" } as AuthUser;

function buildApp() {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    (request as unknown as { user: AuthUser }).user = USER;
  });
  registerListingsRoutes(app, {} as never);
  return app;
}

beforeEach(() => {
  withdrawOwnedListingMock.mockReset();
});

describe("DELETE /api/listings/:id", () => {
  it("withdraws the owner's listing", async () => {
    withdrawOwnedListingMock.mockResolvedValue({ ok: true });
    const app = buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/listings/listing-1" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(withdrawOwnedListingMock).toHaveBeenCalledWith(
      {},
      { actorId: USER.id, listingKey: "listing-1" },
    );
  });

  it("returns 404 when the listing is missing or not owned", async () => {
    withdrawOwnedListingMock.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    const app = buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/listings/listing-1" });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("not_found");
  });

  it("returns 409 when a sale is already funding", async () => {
    withdrawOwnedListingMock.mockResolvedValue({ ok: false, error: "LISTING_HAS_ACTIVE_SALE" });
    const app = buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/listings/listing-1" });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe("LISTING_HAS_ACTIVE_SALE");
  });
});
