/**
 * Listing-level claim: one sold slot per listing.
 *
 * OPEN_HOLD (default): anyone with an approved settlement may begin funding.
 * First successful CAS wins. Exclusive lock is a later product; the transition
 * exists here so the same row can carry it without a second mutex.
 *
 * A standing hold price is a checkout floor only (see hold-tick.ts). New
 * sessions still start from the published ask.
 */

import { canPayAgainstHold, isHoldFloorActive } from "./hold-tick.js";

export const LISTING_CLAIM_STATUSES = ["OPEN", "EXCLUSIVE", "FUNDING", "FUNDED"] as const;
export type ListingClaimStatus = (typeof LISTING_CLAIM_STATUSES)[number];

export const LISTING_LOCK_KINDS = ["OPEN_HOLD", "EXCLUSIVE"] as const;
export type ListingLockKind = (typeof LISTING_LOCK_KINDS)[number];

export const LISTING_CLAIM_ERROR_CODES = [
  "LISTING_SOLD",
  "LISTING_FUNDING_IN_PROGRESS",
  "LISTING_EXCLUSIVE_LOCK",
  "LISTING_CLAIM_CONFLICT",
  "LISTING_NOT_HELD",
  "LISTING_HOLD_TICK_NOT_MET",
] as const;
export type ListingClaimErrorCode = (typeof LISTING_CLAIM_ERROR_CODES)[number];

export interface ListingClaimSnapshot {
  status: ListingClaimStatus;
  lock_kind: ListingLockKind;
  exclusive_buyer_id: string | null;
  exclusive_until: string | null;
  funding_buyer_id: string | null;
  funding_lease_expires_at: string | null;
  hold_price_minor: number | null;
  hold_buyer_id: string | null;
  hold_expires_at: string | null;
}

export type ListingClaimEvent =
  | {
      type: "open_hold";
      buyer_id?: string;
      agreed_price_minor?: number;
      hold_expires_at?: string;
    }
  | { type: "begin_funding"; buyer_id: string; amount_minor?: number }
  | { type: "confirm_funded"; buyer_id: string }
  | { type: "release_funding"; buyer_id: string }
  | { type: "acquire_exclusive"; buyer_id: string; exclusive_until: string };

export type ListingClaimDecision =
  | { ok: true; next: ListingClaimSnapshot; idempotent?: boolean }
  | { ok: false; error: ListingClaimErrorCode };

const EMPTY_OPEN: ListingClaimSnapshot = {
  status: "OPEN",
  lock_kind: "OPEN_HOLD",
  exclusive_buyer_id: null,
  exclusive_until: null,
  funding_buyer_id: null,
  funding_lease_expires_at: null,
  hold_price_minor: null,
  hold_buyer_id: null,
  hold_expires_at: null,
};

function isPast(iso: string | null, nowMs: number): boolean {
  if (!iso) return true;
  const at = new Date(iso).getTime();
  return !Number.isFinite(at) || at <= nowMs;
}

function exclusiveBlocksOtherBuyer(
  claim: ListingClaimSnapshot,
  buyerId: string,
  nowMs: number,
): boolean {
  if (claim.lock_kind !== "EXCLUSIVE") return false;
  if (!claim.exclusive_buyer_id) return false;
  if (claim.exclusive_buyer_id === buyerId) return false;
  return !isPast(claim.exclusive_until, nowMs);
}

function fundingLeaseActive(claim: ListingClaimSnapshot, nowMs: number): boolean {
  if (claim.status !== "FUNDING") return false;
  return !isPast(claim.funding_lease_expires_at, nowMs);
}

export function canStartNegotiationOnListing(claim: ListingClaimSnapshot | null): boolean {
  return claim?.status !== "FUNDED";
}

/** Public listing badge. Never includes agreed price, buyer, or session ids. */
export const PUBLIC_LISTING_HOLD_STATES = ["held", "funding", "sold"] as const;
export type PublicListingHoldState = (typeof PUBLIC_LISTING_HOLD_STATES)[number];

export function toPublicListingHoldState(
  status: ListingClaimStatus | null | undefined,
): PublicListingHoldState | null {
  if (status === "FUNDED") return "sold";
  if (status === "FUNDING") return "funding";
  if (status === "OPEN" || status === "EXCLUSIVE") return "held";
  return null;
}

export function canPreparePaymentOnListing(
  claim: ListingClaimSnapshot | null,
  buyerId: string,
  nowIso: string,
  amountMinor?: number,
): { ok: true } | { ok: false; error: ListingClaimErrorCode } {
  if (!claim) return { ok: true };
  if (claim.status === "FUNDED") return { ok: false, error: "LISTING_SOLD" };
  const nowMs = new Date(nowIso).getTime();
  if (exclusiveBlocksOtherBuyer(claim, buyerId, nowMs)) {
    return { ok: false, error: "LISTING_EXCLUSIVE_LOCK" };
  }
  const tick = canPayAgainstHold(claim, buyerId, amountMinor, nowIso);
  if (!tick.ok) return { ok: false, error: tick.error };
  return { ok: true };
}

export function evaluateListingClaim(
  current: ListingClaimSnapshot | null,
  event: ListingClaimEvent,
  nowIso: string,
): ListingClaimDecision {
  const nowMs = new Date(nowIso).getTime();

  switch (event.type) {
    case "open_hold":
      return evaluateOpenHold(current, event, nowIso);

    case "begin_funding":
      return evaluateBeginFunding(
        current ?? EMPTY_OPEN,
        event.buyer_id,
        nowMs,
        nowIso,
        event.amount_minor,
      );

    case "confirm_funded":
      if (!current) {
        return {
          ok: true,
          next: { ...EMPTY_OPEN, status: "FUNDED", funding_buyer_id: event.buyer_id },
        };
      }
      if (current.status === "FUNDED" && current.funding_buyer_id === event.buyer_id) {
        return { ok: true, next: current, idempotent: true };
      }
      if (current.status === "FUNDED") return { ok: false, error: "LISTING_SOLD" };
      if (exclusiveBlocksOtherBuyer(current, event.buyer_id, nowMs)) {
        return { ok: false, error: "LISTING_EXCLUSIVE_LOCK" };
      }
      if (
        current.status === "FUNDING" &&
        current.funding_buyer_id &&
        current.funding_buyer_id !== event.buyer_id &&
        fundingLeaseActive(current, nowMs)
      ) {
        return { ok: false, error: "LISTING_FUNDING_IN_PROGRESS" };
      }
      return {
        ok: true,
        next: { ...current, status: "FUNDED", funding_buyer_id: event.buyer_id },
      };

    case "release_funding":
      if (!current) return { ok: true, next: EMPTY_OPEN, idempotent: true };
      if (current.status === "FUNDED") return { ok: true, next: current, idempotent: true };
      if (current.status !== "FUNDING") return { ok: true, next: current, idempotent: true };
      if (current.funding_buyer_id !== event.buyer_id) {
        return { ok: false, error: "LISTING_CLAIM_CONFLICT" };
      }
      return {
        ok: true,
        next: {
          ...current,
          status: current.lock_kind === "EXCLUSIVE" ? "EXCLUSIVE" : "OPEN",
          funding_buyer_id: null,
          funding_lease_expires_at: null,
        },
      };

    case "acquire_exclusive":
      if (!current) return { ok: false, error: "LISTING_NOT_HELD" };
      if (current.status === "FUNDED") return { ok: false, error: "LISTING_SOLD" };
      if (current.status === "FUNDING" && fundingLeaseActive(current, nowMs)) {
        return { ok: false, error: "LISTING_FUNDING_IN_PROGRESS" };
      }
      if (
        current.lock_kind === "EXCLUSIVE" &&
        current.exclusive_buyer_id &&
        current.exclusive_buyer_id !== event.buyer_id &&
        !isPast(current.exclusive_until, nowMs)
      ) {
        return { ok: false, error: "LISTING_EXCLUSIVE_LOCK" };
      }
      return {
        ok: true,
        next: {
          status: "EXCLUSIVE",
          lock_kind: "EXCLUSIVE",
          exclusive_buyer_id: event.buyer_id,
          exclusive_until: event.exclusive_until,
          funding_buyer_id: null,
          funding_lease_expires_at: null,
          hold_price_minor: current.hold_price_minor,
          hold_buyer_id: current.hold_buyer_id,
          hold_expires_at: current.hold_expires_at,
        },
        ...(current.lock_kind === "EXCLUSIVE" && current.exclusive_buyer_id === event.buyer_id
          ? { idempotent: true }
          : {}),
      };
  }
}

function evaluateOpenHold(
  current: ListingClaimSnapshot | null,
  event: Extract<ListingClaimEvent, { type: "open_hold" }>,
  nowIso: string,
): ListingClaimDecision {
  const price =
    typeof event.agreed_price_minor === "number" && event.agreed_price_minor > 0
      ? event.agreed_price_minor
      : undefined;
  const buyerId = event.buyer_id;
  const expires = event.hold_expires_at;

  if (!current) {
    if (!price || !buyerId) return { ok: true, next: EMPTY_OPEN };
    return {
      ok: true,
      next: {
        ...EMPTY_OPEN,
        hold_price_minor: price,
        hold_buyer_id: buyerId,
        hold_expires_at: expires ?? null,
      },
    };
  }

  const nowMs = new Date(nowIso).getTime();
  if (isHoldFloorActive(current, nowMs) || !price || !buyerId) {
    return { ok: true, next: current, idempotent: true };
  }

  return {
    ok: true,
    next: {
      ...current,
      hold_price_minor: price,
      hold_buyer_id: buyerId,
      hold_expires_at: expires ?? null,
    },
  };
}

function evaluateBeginFunding(
  current: ListingClaimSnapshot,
  buyerId: string,
  nowMs: number,
  nowIso: string,
  amountMinor?: number,
): ListingClaimDecision {
  if (current.status === "FUNDED") {
    return { ok: false, error: "LISTING_SOLD" };
  }

  if (exclusiveBlocksOtherBuyer(current, buyerId, nowMs)) {
    return { ok: false, error: "LISTING_EXCLUSIVE_LOCK" };
  }

  if (current.status === "FUNDING") {
    if (current.funding_buyer_id === buyerId) {
      return { ok: true, next: current, idempotent: true };
    }
    if (fundingLeaseActive(current, nowMs)) {
      return { ok: false, error: "LISTING_FUNDING_IN_PROGRESS" };
    }
  }

  const tick = canPayAgainstHold(current, buyerId, amountMinor, nowIso);
  if (!tick.ok) return { ok: false, error: tick.error };

  return {
    ok: true,
    next: {
      ...current,
      status: "FUNDING",
      funding_buyer_id: buyerId,
    },
  };
}
