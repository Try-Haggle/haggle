/**
 * Eng1 T1 — dogfood persona ensure + session mint units.
 * SoT: docs/wip/dogfood-auth-sot.md §2–§3
 *
 * Asserts mint path uses Supabase admin generateLink/verifyOtp —
 * never test_unverified / unsigned local JWTs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOGFOOD_BUYER_USER_ID,
  DOGFOOD_PERSONA_EMAILS,
  DOGFOOD_SELLER_USER_ID,
} from "../lib/dogfood-auth-gate.js";
import {
  _setDogfoodAuthAdminForTest,
  ensureDogfoodPersonaUser,
  mintDogfoodWebSession,
} from "../services/dogfood-auth.service.js";

function makeAdminMock(options?: {
  existingBuyer?: boolean;
  existingSeller?: boolean;
  mintFail?: boolean;
}) {
  const users = new Map<string, { id: string; email: string }>();
  if (options?.existingBuyer) {
    users.set(DOGFOOD_BUYER_USER_ID, {
      id: DOGFOOD_BUYER_USER_ID,
      email: DOGFOOD_PERSONA_EMAILS.buyer,
    });
  }
  if (options?.existingSeller) {
    users.set(DOGFOOD_SELLER_USER_ID, {
      id: DOGFOOD_SELLER_USER_ID,
      email: DOGFOOD_PERSONA_EMAILS.seller,
    });
  }

  const createUser = vi.fn(async (attrs: { id: string; email: string }) => {
    const user = { id: attrs.id, email: attrs.email };
    users.set(attrs.id, user);
    return { data: { user }, error: null };
  });

  const getUserById = vi.fn(async (id: string) => {
    const user = users.get(id);
    if (!user) {
      return { data: { user: null }, error: { message: "User not found" } };
    }
    return { data: { user }, error: null };
  });

  const generateLink = vi.fn(async (_params: { type: "magiclink"; email: string }) => {
    if (options?.mintFail) {
      return { data: null, error: { message: "boom" } };
    }
    return {
      data: { properties: { hashed_token: "hashed-token-fixture" } },
      error: null,
    };
  });

  const verifyOtp = vi.fn(async (_params: { type: "email"; token_hash: string }) => {
    if (options?.mintFail) {
      return { data: { session: null }, error: { message: "boom" } };
    }
    return {
      data: {
        session: {
          access_token: "access-token-fixture",
          refresh_token: "refresh-token-fixture",
          expires_at: 1_700_000_000,
          expires_in: 900,
        },
      },
      error: null,
    };
  });

  return {
    auth: {
      admin: { getUserById, createUser, generateLink },
      verifyOtp,
    },
    spies: { createUser, getUserById, generateLink, verifyOtp },
  };
}

describe("dogfood auth service", () => {
  afterEach(() => {
    _setDogfoodAuthAdminForTest(null);
    vi.restoreAllMocks();
  });

  it("ensures buyer and seller with distinct fixed UUIDs", async () => {
    const admin = makeAdminMock();
    _setDogfoodAuthAdminForTest(admin);

    const buyer = await ensureDogfoodPersonaUser("buyer");
    const seller = await ensureDogfoodPersonaUser("seller");

    expect(buyer.userId).toBe(DOGFOOD_BUYER_USER_ID);
    expect(seller.userId).toBe(DOGFOOD_SELLER_USER_ID);
    expect(buyer.handle).toBe("dogfood_buyer");
    expect(seller.handle).toBe("dogfood_seller");
    expect(admin.spies.createUser).toHaveBeenCalledTimes(2);
  });

  it("is idempotent when persona already exists", async () => {
    const admin = makeAdminMock({ existingBuyer: true });
    _setDogfoodAuthAdminForTest(admin);

    const buyer = await ensureDogfoodPersonaUser("buyer");
    expect(buyer.userId).toBe(DOGFOOD_BUYER_USER_ID);
    expect(admin.spies.createUser).not.toHaveBeenCalled();
  });

  it("happy path mints buyer session via generateLink+verifyOtp (not test_unverified)", async () => {
    const admin = makeAdminMock({ existingBuyer: true });
    _setDogfoodAuthAdminForTest(admin);

    const session = await mintDogfoodWebSession("buyer");

    expect(session.persona).toBe("buyer");
    expect(session.user_id).toBe(DOGFOOD_BUYER_USER_ID);
    expect(session.access_token).toBe("access-token-fixture");
    expect(session.refresh_token).toBe("refresh-token-fixture");
    expect(session.expires_in).toBe(900);
    expect(admin.spies.generateLink).toHaveBeenCalledOnce();
    expect(admin.spies.verifyOtp).toHaveBeenCalledWith({
      type: "email",
      token_hash: "hashed-token-fixture",
    });
    // Mint path is admin generateLink+verifyOtp — not unsigned test_unverified JWTs.
    expect(admin.spies.generateLink.mock.calls[0][0]).toEqual({
      type: "magiclink",
      email: DOGFOOD_PERSONA_EMAILS.buyer,
    });
  });

  it("happy path mints seller session with seller UUID", async () => {
    const admin = makeAdminMock({ existingSeller: true });
    _setDogfoodAuthAdminForTest(admin);

    const session = await mintDogfoodWebSession("seller");
    expect(session.persona).toBe("seller");
    expect(session.user_id).toBe(DOGFOOD_SELLER_USER_ID);
    expect(session.handle).toBe("dogfood_seller");
  });

  it("fails closed when mint cannot produce a session", async () => {
    const admin = makeAdminMock({ existingBuyer: true, mintFail: true });
    _setDogfoodAuthAdminForTest(admin);
    await expect(mintDogfoodWebSession("buyer")).rejects.toThrow("DOGFOOD_SESSION_MINT_FAILED");
  });
});
