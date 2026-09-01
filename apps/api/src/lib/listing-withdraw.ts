/** Seller-deleted listings stay in DB this long, then the retention job purges them. */
export const LISTING_WITHDRAW_RETENTION_DAYS = 90;

const BLOCKING_CLAIM_STATUSES = new Set(["FUNDING", "FUNDED"]);

export const CLOSEABLE_SESSION_STATUSES = [
  "CREATED",
  "ACTIVE",
  "NEAR_DEAL",
  "STALLED",
  "WAITING",
  "NEGOTIATING_VERSION",
] as const;

export type ListingWithdrawBlock =
  | "ALREADY_WITHDRAWN"
  | "NOT_PUBLISHED"
  | "LISTING_HAS_ACTIVE_SALE"
  | "LISTING_HAS_ACCEPTED_DEAL";

export function listingWithdrawBlockReason(input: {
  draftStatus: string;
  claimStatus: string | null;
  hasAcceptedSession: boolean;
}): ListingWithdrawBlock | null {
  if (input.draftStatus === "expired") return "ALREADY_WITHDRAWN";
  if (input.draftStatus !== "published") return "NOT_PUBLISHED";
  if (input.claimStatus && BLOCKING_CLAIM_STATUSES.has(input.claimStatus)) {
    return "LISTING_HAS_ACTIVE_SALE";
  }
  if (input.hasAcceptedSession) return "LISTING_HAS_ACCEPTED_DEAL";
  return null;
}

/** Only seller-deleted rows are purged. Live, draft, and never-withdrawn rows stay. */
export function canPurgeWithdrawnListing(input: {
  withdrawnAt: Date | null;
  now: Date;
  hasCommerceOrder: boolean;
  hasSettlementApproval: boolean;
  hasActiveSaleClaim: boolean;
  hasAcceptedSession: boolean;
  retentionDays?: number;
}): boolean {
  if (!input.withdrawnAt) return false;
  const days = input.retentionDays ?? LISTING_WITHDRAW_RETENTION_DAYS;
  const ageMs = input.now.getTime() - input.withdrawnAt.getTime();
  if (ageMs < days * 24 * 60 * 60 * 1000) return false;
  if (input.hasCommerceOrder || input.hasSettlementApproval) return false;
  if (input.hasActiveSaleClaim || input.hasAcceptedSession) return false;
  return true;
}
