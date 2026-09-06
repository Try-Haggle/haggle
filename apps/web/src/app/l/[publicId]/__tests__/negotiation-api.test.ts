/**
 * A3 — `/l/{publicId}` must hit the real negotiation session path.
 *
 * Guards:
 * 1. Start posts to `/negotiations/start` (not `/api/intents` / trigger-match).
 * 2. An open buyer session for the listing is resumed without a second start
 *    (strategy applied only once, at the original start).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message?: string) {
      super(message || code);
      this.status = status;
      this.code = code;
      this.name = "ApiError";
    }
  },
  api: {
    get: mocks.get,
    post: mocks.post,
  },
}));

import {
  findOpenBuyerSessionForListing,
  startListingNegotiation,
  startOrResumeListingNegotiation,
} from "../negotiation-api";

beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
});

describe("listing → session API (A3)", () => {
  it("starts via POST /negotiations/start — never intents", async () => {
    mocks.post.mockResolvedValueOnce({
      session_id: "sess-new",
      run_token: "tok-1",
    });

    const body = {
      listing_public_id: "pub-abc",
      negotiation_agent_preset_id: "balancer",
      agent_weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    };
    const res = await startListingNegotiation(body);

    expect(res).toEqual({ session_id: "sess-new", run_token: "tok-1", resumed: false });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith("/negotiations/start", body);
    const path = mocks.post.mock.calls[0]![0] as string;
    expect(path).not.toMatch(/intent/i);
    expect(path).not.toMatch(/trigger-match/i);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("finds an open buyer session for the listing", async () => {
    mocks.get.mockResolvedValueOnce({
      sessions: [
        { id: "s-closed", listing_id: "list-1", status: "ACCEPTED", current_round: 9 },
        { id: "s-other", listing_id: "list-2", status: "ACTIVE", current_round: 2 },
        { id: "s-open", listing_id: "list-1", status: "ACTIVE", current_round: 3 },
        { id: "s-early", listing_id: "list-1", status: "CREATED", current_round: 0 },
      ],
    });

    const found = await findOpenBuyerSessionForListing("user-1", "list-1");
    expect(found).toEqual({
      id: "s-open",
      listing_id: "list-1",
      status: "ACTIVE",
      current_round: 3,
    });
    expect(mocks.get).toHaveBeenCalledWith("/negotiations/sessions?user_id=user-1&role=BUYER");
  });

  it("resumes an open session without calling start (strategy once)", async () => {
    mocks.get.mockResolvedValueOnce({
      sessions: [{ id: "s-open", listing_id: "list-1", status: "NEAR_DEAL", current_round: 4 }],
    });

    const res = await startOrResumeListingNegotiation({
      userId: "user-1",
      listingId: "list-1",
      startBody: {
        listing_public_id: "pub-abc",
        negotiation_agent_preset_id: "balancer",
        agent_overrides: { weights: { w_p: 1, w_t: 0, w_r: 0, w_s: 0 } },
      },
    });

    expect(res).toEqual({ session_id: "s-open", run_token: "", resumed: true });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("starts a real session when no open session exists", async () => {
    mocks.get.mockResolvedValueOnce({
      sessions: [{ id: "s-done", listing_id: "list-1", status: "REJECTED", current_round: 2 }],
    });
    mocks.post.mockResolvedValueOnce({
      session_id: "sess-fresh",
      run_token: "tok-2",
      guest_buyer_id: "guest-9",
    });

    const startBody = {
      listing_public_id: "pub-abc",
      negotiation_agent_preset_id: "price-hunter",
    };
    const res = await startOrResumeListingNegotiation({
      userId: "user-1",
      listingId: "list-1",
      startBody,
    });

    expect(res).toEqual({
      session_id: "sess-fresh",
      run_token: "tok-2",
      guest_buyer_id: "guest-9",
      resumed: false,
    });
    expect(mocks.post).toHaveBeenCalledWith("/negotiations/start", startBody);
  });

  it("starts directly for guests (no session-list lookup)", async () => {
    mocks.post.mockResolvedValueOnce({
      session_id: "sess-guest",
      run_token: "tok-g",
      guest_buyer_id: "guest-1",
    });

    const res = await startOrResumeListingNegotiation({
      userId: null,
      listingId: "list-1",
      startBody: { listing_public_id: "pub-abc", negotiation_agent_preset_id: "balancer" },
    });

    expect(res.session_id).toBe("sess-guest");
    expect(res.resumed).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledWith(
      "/negotiations/start",
      expect.objectContaining({ listing_public_id: "pub-abc" }),
    );
  });

  it("falls through to start when session list fails", async () => {
    mocks.get.mockRejectedValueOnce(new Error("network"));
    mocks.post.mockResolvedValueOnce({ session_id: "sess-fb", run_token: "tok-fb" });

    const res = await startOrResumeListingNegotiation({
      userId: "user-1",
      listingId: "list-1",
      startBody: { listing_public_id: "pub-abc", negotiation_agent_preset_id: "balancer" },
    });

    expect(res).toEqual({ session_id: "sess-fb", run_token: "tok-fb", resumed: false });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("starts with carrier fulfillment and no delivery address", async () => {
    mocks.post.mockResolvedValueOnce({
      session_id: "sess-no-addr",
      run_token: "tok-na",
    });

    const startBody = {
      listing_public_id: "eV9delRa",
      negotiation_agent_preset_id: "balancer",
      fulfillment: {
        methods: ["carrier"] as const,
        preferred: "carrier" as const,
        // buyer_address intentionally omitted — address is checkout-stage
      },
    };
    const res = await startOrResumeListingNegotiation({
      userId: null,
      listingId: "list-1",
      startBody,
    });

    expect(res.session_id).toBe("sess-no-addr");
    expect(res.resumed).toBe(false);
    expect(mocks.post).toHaveBeenCalledWith("/negotiations/start", startBody);
    expect(startBody.fulfillment).not.toHaveProperty("buyer_address");
  });
});
