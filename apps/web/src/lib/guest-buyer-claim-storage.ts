/**
 * Browser stash for guest buyer claim capabilities.
 *
 * After anonymous `POST /negotiations/start`, the API returns
 * `guest_buyer_id` + `guest_claim_pop`. Knowledge of the UUID alone must not
 * claim sessions — the PoP travels with the id until post-signup claim.
 */

export const GUEST_BUYER_CLAIM_STORAGE_KEY = "haggle:guest-buyer-ids";

export type GuestBuyerClaimRecord = {
  guest_buyer_id: string;
  pop: string;
};

function isClaimRecord(value: unknown): value is GuestBuyerClaimRecord {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.guest_buyer_id === "string" && typeof rec.pop === "string" && rec.pop.length >= 32
  );
}

/** Read claimable guest records; drops legacy id-only entries (no PoP). */
export function readGuestBuyerClaims(): GuestBuyerClaimRecord[] {
  try {
    const raw = window.localStorage.getItem(GUEST_BUYER_CLAIM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: GuestBuyerClaimRecord[] = [];
    for (const item of parsed) {
      if (isClaimRecord(item)) {
        if (!out.some((c) => c.guest_buyer_id === item.guest_buyer_id)) {
          out.push({ guest_buyer_id: item.guest_buyer_id, pop: item.pop });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function stashGuestBuyerClaim(guestBuyerId: string, pop: string): void {
  if (!guestBuyerId || !pop || pop.length < 32) return;
  try {
    const list = readGuestBuyerClaims();
    if (!list.some((c) => c.guest_buyer_id === guestBuyerId)) {
      list.push({ guest_buyer_id: guestBuyerId, pop });
      window.localStorage.setItem(GUEST_BUYER_CLAIM_STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // localStorage full or disabled — fall through.
  }
}

export function clearGuestBuyerClaims(): void {
  try {
    window.localStorage.removeItem(GUEST_BUYER_CLAIM_STORAGE_KEY);
  } catch {
    // ignore
  }
}
