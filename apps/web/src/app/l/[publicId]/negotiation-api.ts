/**
 * Listing CTA → real negotiation session.
 *
 * `/l/{publicId}` must open (or resume) a durable buyer session via
 * `POST /negotiations/start` — never the old intent/match path (`/api/intents`,
 * `trigger-match`). Strategy knobs are sent only on that start call; resuming
 * an already-open session reuses it without re-applying strategy.
 */
import { ApiError, api } from "@/lib/api-client";

export interface StartListingNegotiationResponse {
  session_id: string;
  run_token: string;
  guest_buyer_id?: string;
  /** Proof-of-possession minted with guest_buyer_id; required to claim. */
  guest_claim_pop?: string;
  /** True when an open session for this listing was reused (no new start). */
  resumed?: boolean;
}

export interface BuyerSessionSummary {
  id: string;
  listing_id: string;
  status: string;
  current_round: number;
}

/** Session statuses that mean "still in flight" — resume rather than start again. */
export const OPEN_BUYER_SESSION_STATUSES = new Set([
  "CREATED",
  "ACTIVE",
  "NEAR_DEAL",
  "STALLED",
  "WAITING",
  "NEGOTIATING_VERSION",
]);

export async function findOpenBuyerSessionForListing(
  userId: string,
  listingId: string,
): Promise<BuyerSessionSummary | null> {
  const data = await api.get<{ sessions: BuyerSessionSummary[] }>(
    `/negotiations/sessions?user_id=${encodeURIComponent(userId)}&role=BUYER`,
  );
  const open = (data.sessions ?? []).filter(
    (s) => s.listing_id === listingId && OPEN_BUYER_SESSION_STATUSES.has(s.status),
  );
  if (open.length === 0) return null;
  // Prefer the furthest-along open session if several exist.
  return open.reduce((best, s) => (s.current_round > best.current_round ? s : best));
}

/**
 * POST /negotiations/start — compiles buyer strategy once into the session snapshot.
 * Do not call this for browse/product clicks; only when the buyer commits to negotiate.
 */
export async function startListingNegotiation(
  body: Record<string, unknown>,
): Promise<StartListingNegotiationResponse> {
  try {
    const res = await api.post<StartListingNegotiationResponse>("/negotiations/start", body);
    return { ...res, resumed: false };
  } catch (err) {
    if (err instanceof ApiError && !err.message) {
      throw new Error(err.code ?? "Couldn't start the negotiation. Try again.");
    }
    throw err;
  }
}

/**
 * Listing page entry: resume an open buyer session for this listing when one
 * exists (strategy already applied at its original start); otherwise start a
 * new real session with the tuned strategy exactly once.
 */
export async function startOrResumeListingNegotiation(params: {
  userId?: string | null;
  listingId: string;
  startBody: Record<string, unknown>;
}): Promise<StartListingNegotiationResponse> {
  if (params.userId) {
    try {
      const existing = await findOpenBuyerSessionForListing(params.userId, params.listingId);
      if (existing) {
        return { session_id: existing.id, run_token: "", resumed: true };
      }
    } catch {
      // Session list is best-effort — the CTA must still be able to start.
    }
  }
  return startListingNegotiation(params.startBody);
}
