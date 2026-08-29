/**
 * Open-hold checkout floor. Negotiation still opens from the published ask.
 * The tick applies only when someone other than the standing holder funds.
 *
 * P is a maybe-deal, not a sale. After HOLD_FLOOR_MS it stops blocking
 * unless a funding lease is already live.
 */

export const HOLD_FLOOR_MS = 2 * 60 * 60 * 1000;

export const LISTING_HOLD_TICK_ERROR = "LISTING_HOLD_TICK_NOT_MET" as const;

export interface HoldFloorInput {
  hold_price_minor?: number | null;
  hold_buyer_id?: string | null;
  hold_expires_at?: string | null;
  status?: string | null;
  funding_lease_expires_at?: string | null;
}

export type HoldPayDecision =
  | { ok: true }
  | {
      ok: false;
      error: typeof LISTING_HOLD_TICK_ERROR;
      hold_price_minor: number;
      tick_minor: number;
      minimum_minor: number;
    };

function isPast(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return true;
  const at = new Date(iso).getTime();
  return !Number.isFinite(at) || at <= nowMs;
}

/** Seller-net tick in minor units. Not $0.01. */
export function holdTickMinor(priceMinor: number): number {
  if (!Number.isFinite(priceMinor) || priceMinor <= 0) return 0;
  const usd = priceMinor / 100;
  if (usd < 50) return Math.max(200, Math.round(usd * 0.05 * 100));
  if (usd < 200) return Math.max(500, Math.round(usd * 0.03 * 100));
  if (usd < 500) return Math.max(1_000, Math.round(usd * 0.02 * 100));
  if (usd < 1_000) return Math.max(2_000, Math.round(usd * 0.02 * 100));
  if (usd < 5_000) return Math.max(2_500, Math.round(usd * 0.02 * 100));
  return Math.max(5_000, Math.round(usd * 0.01 * 100));
}

export function holdFloorExpiresAt(fromIso: string, floorMs = HOLD_FLOOR_MS): string {
  return new Date(new Date(fromIso).getTime() + floorMs).toISOString();
}

export function isHoldFloorActive(
  claim: HoldFloorInput | null | undefined,
  nowMs: number,
): boolean {
  if (!claim) return false;
  if (typeof claim.hold_price_minor !== "number" || !(claim.hold_price_minor > 0)) return false;
  if (!claim.hold_buyer_id) return false;
  if (claim.hold_expires_at && !isPast(claim.hold_expires_at, nowMs)) return true;
  if (claim.status === "FUNDING" && !isPast(claim.funding_lease_expires_at, nowMs)) return true;
  return false;
}

export function canPayAgainstHold(
  claim: HoldFloorInput | null | undefined,
  buyerId: string,
  amountMinor: number | undefined,
  nowIso: string,
): HoldPayDecision {
  const nowMs = new Date(nowIso).getTime();
  if (!isHoldFloorActive(claim, nowMs) || !claim) return { ok: true };

  const holdPrice = claim.hold_price_minor as number;
  const tick = holdTickMinor(holdPrice);
  const isHolder = buyerId === claim.hold_buyer_id;
  const minimum = isHolder ? holdPrice : holdPrice + tick;

  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) {
    if (isHolder) return { ok: true };
    return {
      ok: false,
      error: LISTING_HOLD_TICK_ERROR,
      hold_price_minor: holdPrice,
      tick_minor: tick,
      minimum_minor: minimum,
    };
  }

  if (amountMinor >= minimum) return { ok: true };
  return {
    ok: false,
    error: LISTING_HOLD_TICK_ERROR,
    hold_price_minor: holdPrice,
    tick_minor: tick,
    minimum_minor: minimum,
  };
}
