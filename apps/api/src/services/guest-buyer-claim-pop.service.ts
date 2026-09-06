import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Guest buyer claim proof-of-possession (PoP).
 *
 * Knowing `guest_buyer_id` alone must not be enough to claim sessions after
 * sign-up. At guest start the API mints a MAC capability bound to that id; the
 * browser stashes it next to the id, and `/claim/negotiation-sessions` requires
 * a matching proof.
 *
 * Equivalent binding to listing `claimToken` / auto-play `run_token`, without a
 * new table: domain-separated HMAC over the guest buyer UUID.
 */

export const GUEST_BUYER_CLAIM_POP_DOMAIN = "haggle.guest-buyer-claim.v1";

const LOCAL_DEV_FALLBACK_SECRET = "local-dev-guest-buyer-claim-pop-secret-v1!!";

function stagingOrProduction(): boolean {
  const haggleEnv = process.env.HAGGLE_ENV?.trim().toLowerCase();
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  return haggleEnv === "staging" || haggleEnv === "production" || nodeEnv === "production";
}

/**
 * Resolve the HMAC secret used to mint/verify guest claim PoP.
 * Staging/production require an explicit 32+ byte secret.
 */
export function resolveGuestBuyerClaimPopSecret(): string {
  const dedicated = process.env.GUEST_BUYER_CLAIM_POP_SECRET?.trim() ?? "";
  if (dedicated) {
    const bytes = Buffer.byteLength(dedicated, "utf8");
    if (bytes < 32 || bytes > 512) {
      throw new Error("[CONFIG] GUEST_BUYER_CLAIM_POP_SECRET must be 32 to 512 bytes.");
    }
    return dedicated;
  }

  if (stagingOrProduction()) {
    throw new Error("[CONFIG] GUEST_BUYER_CLAIM_POP_SECRET is required in staging and production.");
  }

  // Local / unit-test convenience only — never used when HAGGLE_ENV is staging/production.
  return LOCAL_DEV_FALLBACK_SECRET;
}

export function mintGuestBuyerClaimPop(
  guestBuyerId: string,
  secret: string = resolveGuestBuyerClaimPopSecret(),
): string {
  return createHmac("sha256", secret)
    .update(GUEST_BUYER_CLAIM_POP_DOMAIN)
    .update("\0")
    .update(guestBuyerId)
    .digest("base64url");
}

export function verifyGuestBuyerClaimPop(
  guestBuyerId: string,
  pop: string | undefined,
  secret: string = resolveGuestBuyerClaimPopSecret(),
): boolean {
  if (typeof pop !== "string" || pop.length < 32 || pop.length > 128) {
    return false;
  }
  const expected = Buffer.from(mintGuestBuyerClaimPop(guestBuyerId, secret));
  const actual = Buffer.from(pop);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
