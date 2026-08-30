/**
 * UCP binding — HNP is the negotiation slice, not discovery.
 *
 * UCP (or any commerce protocol) finds the listing and later runs checkout.
 * HNP only agrees price/terms, then hands a compact bridge object over.
 */

import type { HnpIssueValue, HnpMoney } from "../core.js";

export const UCP_HNP_EXTENSION_ID = "ucp.extension.negotiation.hnp" as const;

/** Opaque handle UCP/marketplace already understands. HNP does not dereference it. */
export interface UcpListingRef {
  source: string;
  listing_id: string;
  canonical_url?: string;
}

export interface HnpUcpCheckoutBridge {
  extension: typeof UCP_HNP_EXTENSION_ID;
  listing: UcpListingRef;
  agreement_hash: string;
  accepted_total: HnpMoney;
  accepted_issues: HnpIssueValue[];
  settlement_preconditions: string[];
}

export function hnpAgreementToUcpCheckoutBridge(input: {
  listing: UcpListingRef;
  agreement_hash: string;
  accepted_total: HnpMoney;
  accepted_issues?: HnpIssueValue[];
  settlement_preconditions?: string[];
}): HnpUcpCheckoutBridge {
  return {
    extension: UCP_HNP_EXTENSION_ID,
    listing: input.listing,
    agreement_hash: input.agreement_hash,
    accepted_total: input.accepted_total,
    accepted_issues: input.accepted_issues ?? [],
    settlement_preconditions: input.settlement_preconditions ?? [],
  };
}
