/**
 * The buyer-safe view of a published listing.
 *
 * One builder so every surface that shows a listing — the listing page, and the
 * conversation's detail panel — shows the same fields with the same redactions.
 * Reimplementing this per route is how a private field eventually leaks through
 * the newest one.
 */

import { parseListingParcel, parseSellerFulfillmentOffer } from "../lib/negotiation-fulfillment.js";
import {
  extractSellerProductFacts,
  extractSellerRequiredCriteria,
} from "./listing-strategy.service.js";

interface PublishedListingRow {
  negotiationAgentSnapshot: unknown;
  sellerId: string | null;
  [key: string]: unknown;
}

export interface PublicListingView {
  listing: Record<string, unknown>;
  /** Just a UUID — used by callers for an ownership check. */
  sellerId: string | null;
}

export function toPublicListingView(row: PublishedListingRow): PublicListingView {
  // floorPrice, sellerId, and the raw strategy never reach a buyer.
  const { negotiationAgentSnapshot, sellerId, ...publicFields } = row;
  const cfg = (negotiationAgentSnapshot as Record<string, unknown> | null) ?? {};

  return {
    listing: {
      ...publicFields,
      // The agent's preset name only — never its thresholds.
      sellerAgentPreset: cfg.preset ?? null,
      specs: extractSellerProductFacts(cfg),
      // Check id + ask only: no stance, leverage, or floor.
      sellerRequiredCriteria: extractSellerRequiredCriteria(cfg),
      sellerFulfillmentOffer: parseSellerFulfillmentOffer(cfg.sellerFulfillmentOffer) ?? null,
      parcel: parseListingParcel(cfg.parcel) ?? null,
    },
    sellerId: sellerId ?? null,
  };
}
