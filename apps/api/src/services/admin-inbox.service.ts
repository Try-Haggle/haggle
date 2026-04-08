/**
 * Admin Ops Inbox aggregator (Step 57).
 *
 * Read-only service that surfaces actionable items for the admin ops
 * dashboard across three domains:
 *   - Tag suggestions awaiting review
 *   - Disputes that need human attention
 *   - Payment intents that failed
 *
 * No mutations. All queries are scoped by status. Counts for the
 * summary are derived from the same query results (row-count based)
 * so the fake-db test pattern from Step 56 works unchanged.
 */

import {
  type Database,
  asc,
  desc,
  disputeCases,
  eq,
  inArray,
  paymentIntents,
  tagPromotionRules,
  tagSuggestions,
} from "@haggle/db";

const DEFAULT_RULE_CATEGORY = "default";
const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

// Active dispute statuses. `dispute_cases.status` enum in
// packages/db/src/schema/disputes.ts is:
//   OPEN | UNDER_REVIEW | WAITING_FOR_BUYER | WAITING_FOR_SELLER
//   | RESOLVED_BUYER_FAVOR | RESOLVED_SELLER_FAVOR | PARTIAL_REFUND | CLOSED
// "Active" = anything that still needs someone to act on it.
const ACTIVE_DISPUTE_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "WAITING_FOR_BUYER",
  "WAITING_FOR_SELLER",
] as const;

// ─── Public types ─────────────────────────────────────────────────────

export interface InboxSummary {
  tags: { pending: number; autoPromoteReady: number };
  disputes: { open: number; underReview: number; waiting: number };
  payments: { failed: number };
  computedAt: string;
}

export interface TagInboxItem {
  id: string;
  label: string;
  normalizedLabel: string;
  occurrenceCount: number;
  firstSeenListingId: string | null;
  createdAt: Date;
  autoPromoteEligible: boolean;
}

export interface DisputeInboxItem {
  id: string;
  orderId: string;
  status: string;
  openedAt: Date;
  // `reason_code` is the closest proxy an operator uses to triage.
  reasonCode: string;
  openedBy: string;
  updatedAt: Date;
}

export interface PaymentInboxItem {
  id: string;
  orderId: string | null;
  amountMinor: number;
  rail: string | null;
  failedAt: Date;
  // payment_intents has no dedicated error column; we best-effort read
  // `provider_context.error` (or `.failureReason`) as a string.
  providerError: string | null;
}

export type InboxDetail =
  | { type: "tag"; item: TagInboxItem; raw: unknown }
  | { type: "dispute"; item: DisputeInboxItem; raw: unknown }
  | { type: "payment"; item: PaymentInboxItem; raw: unknown };

// ─── Internal helpers ─────────────────────────────────────────────────

/**
 * Look up the default promotion rule's auto-promote threshold. Returns
 * `null` (→ treated as Infinity by callers) when no default rule exists
 * so the inbox does not throw on fresh installs.
 */
async function getDefaultAutoPromoteThreshold(
  db: Database,
): Promise<number | null> {
  const rows = await db
    .select()
    .from(tagPromotionRules)
    .where(eq(tagPromotionRules.category, DEFAULT_RULE_CATEGORY));
  const rule = rows[0];
  if (!rule) return null;
  return rule.suggestionAutoPromoteCount as number;
}

type TagSuggestionRow = {
  id: string;
  label: string;
  normalizedLabel: string;
  occurrenceCount: number;
  firstSeenListingId: string | null;
  createdAt: Date;
};

function mapTagRow(
  row: TagSuggestionRow,
  threshold: number | null,
): TagInboxItem {
  const eligible =
    threshold !== null && row.occurrenceCount >= threshold;
  return {
    id: row.id,
    label: row.label,
    normalizedLabel: row.normalizedLabel,
    occurrenceCount: row.occurrenceCount,
    firstSeenListingId: row.firstSeenListingId,
    createdAt: row.createdAt,
    autoPromoteEligible: eligible,
  };
}

type DisputeRow = {
  id: string;
  orderId: string;
  status: string;
  reasonCode: string;
  openedBy: string;
  openedAt: Date;
  updatedAt: Date;
};

function mapDisputeRow(row: DisputeRow): DisputeInboxItem {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    openedAt: row.openedAt,
    reasonCode: row.reasonCode,
    openedBy: row.openedBy,
    updatedAt: row.updatedAt,
  };
}

type PaymentRow = {
  id: string;
  orderId: string | null;
  amountMinor: string | number;
  selectedRail: string | null;
  providerContext: Record<string, unknown> | null;
  updatedAt: Date;
};

function mapPaymentRow(row: PaymentRow): PaymentInboxItem {
  const ctx = row.providerContext ?? {};
  const errVal =
    (ctx as Record<string, unknown>).error ??
    (ctx as Record<string, unknown>).failureReason ??
    null;
  const providerError =
    typeof errVal === "string"
      ? errVal
      : errVal == null
        ? null
        : JSON.stringify(errVal);
  const amount =
    typeof row.amountMinor === "number"
      ? row.amountMinor
      : // Safe for USD minor units (cents); revisit if a rail ever stores > Number.MAX_SAFE_INTEGER (~9e15).
        Number(row.amountMinor);
  return {
    id: row.id,
    orderId: row.orderId,
    amountMinor: Number.isFinite(amount) ? amount : 0,
    rail: row.selectedRail,
    failedAt: row.updatedAt,
    providerError,
  };
}

// ─── Summary ──────────────────────────────────────────────────────────

/**
 * Build the admin inbox summary snapshot.
 *
 * Aggregates pending tag suggestions, active dispute counts bucketed by
 * status, and failed payment intent counts. Returns an {@link InboxSummary}
 * with `computedAt` set to the time this snapshot was built.
 */
export async function getInboxSummary(db: Database): Promise<InboxSummary> {
  const threshold = await getDefaultAutoPromoteThreshold(db);

  const pendingTagRows = (await db
    .select()
    .from(tagSuggestions)
    .where(eq(tagSuggestions.status, "PENDING"))) as TagSuggestionRow[];

  const tagsPending = pendingTagRows.length;
  const tagsAutoPromoteReady =
    threshold === null
      ? 0
      : pendingTagRows.filter((r) => r.occurrenceCount >= threshold).length;

  const disputeRows = (await db
    .select()
    .from(disputeCases)
    .where(
      inArray(disputeCases.status, [...ACTIVE_DISPUTE_STATUSES]),
    )) as Array<{ status: string }>;

  let open = 0;
  let underReview = 0;
  let waiting = 0;
  for (const row of disputeRows) {
    if (row.status === "OPEN") open += 1;
    else if (row.status === "UNDER_REVIEW") underReview += 1;
    else if (
      row.status === "WAITING_FOR_BUYER" ||
      row.status === "WAITING_FOR_SELLER"
    ) {
      waiting += 1;
    }
  }

  const failedPaymentRows = (await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.status, "FAILED"))) as Array<{ id: string }>;

  return {
    tags: { pending: tagsPending, autoPromoteReady: tagsAutoPromoteReady },
    disputes: { open, underReview, waiting },
    payments: { failed: failedPaymentRows.length },
    computedAt: new Date().toISOString(),
  };
}

// ─── Listing queries ──────────────────────────────────────────────────

/**
 * List pending tag suggestions ordered by occurrence count (desc) then
 * creation time (asc). Each row is mapped to a {@link TagInboxItem} with
 * `autoPromoteEligible` computed against the default category's threshold.
 */
export async function listPendingTags(
  db: Database,
  opts: { limit?: number; offset?: number } = {},
): Promise<TagInboxItem[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const offset = opts.offset ?? DEFAULT_OFFSET;

  // NOTE: `tag_suggestions` has no `category` column, so the original
  // `opts.category` filter from the spec is intentionally dropped here.

  const threshold = await getDefaultAutoPromoteThreshold(db);

  const rows = (await db
    .select()
    .from(tagSuggestions)
    .where(eq(tagSuggestions.status, "PENDING"))
    .orderBy(
      desc(tagSuggestions.occurrenceCount),
      asc(tagSuggestions.createdAt),
    )
    .limit(limit)
    .offset(offset)) as TagSuggestionRow[];

  return rows.map((r) => mapTagRow(r, threshold));
}

/**
 * List disputes that still require operator attention, ordered by
 * `opened_at` descending. When `opts.status` is provided it must be one
 * of {@link ACTIVE_DISPUTE_STATUSES}; a terminal status short-circuits
 * to an empty list instead of querying. Returns {@link DisputeInboxItem}s.
 */
export async function listActiveDisputes(
  db: Database,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<DisputeInboxItem[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const offset = opts.offset ?? DEFAULT_OFFSET;

  // If caller asked for a specific status that isn't active, bail out
  // early so we don't produce a contradictory AND-clause that silently
  // returns zero rows.
  if (opts.status !== undefined) {
    const isActive = (ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(
      opts.status,
    );
    if (!isActive) return [];
  }

  // When a specific (active) status is requested, an `eq` is sufficient;
  // otherwise fall back to the full active-set `inArray`.
  const where = opts.status
    ? eq(disputeCases.status, opts.status as never)
    : inArray(disputeCases.status, [...ACTIVE_DISPUTE_STATUSES]);

  const rows = (await db
    .select()
    .from(disputeCases)
    .where(where)
    .orderBy(desc(disputeCases.openedAt))
    .limit(limit)
    .offset(offset)) as DisputeRow[];

  return rows.map(mapDisputeRow);
}

/**
 * List payment intents in `FAILED` status ordered by most-recently
 * updated. Each row is mapped to a {@link PaymentInboxItem} with the
 * provider error extracted from `provider_context` on a best-effort basis.
 */
export async function listFailedPayments(
  db: Database,
  opts: { limit?: number; offset?: number } = {},
): Promise<PaymentInboxItem[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const offset = opts.offset ?? DEFAULT_OFFSET;

  const rows = (await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.status, "FAILED"))
    .orderBy(desc(paymentIntents.updatedAt))
    .limit(limit)
    .offset(offset)) as PaymentRow[];

  return rows.map(mapPaymentRow);
}

// ─── Detail lookup ────────────────────────────────────────────────────

/**
 * Fetch a single inbox entry by type and id. Returns an {@link InboxDetail}
 * tagged union (tag | dispute | payment) including the mapped item and the
 * raw db row, or `null` when no row matches.
 */
export async function getInboxDetail(
  db: Database,
  type: "tag" | "dispute" | "payment",
  id: string,
): Promise<InboxDetail | null> {
  if (type === "tag") {
    const rows = (await db
      .select()
      .from(tagSuggestions)
      .where(eq(tagSuggestions.id, id))) as TagSuggestionRow[];
    const row = rows[0];
    if (!row) return null;
    const threshold = await getDefaultAutoPromoteThreshold(db);
    return { type: "tag", item: mapTagRow(row, threshold), raw: row };
  }

  if (type === "dispute") {
    const rows = (await db
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, id))) as DisputeRow[];
    const row = rows[0];
    if (!row) return null;
    return { type: "dispute", item: mapDisputeRow(row), raw: row };
  }

  // payment
  const rows = (await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, id))) as PaymentRow[];
  const row = rows[0];
  if (!row) return null;
  return { type: "payment", item: mapPaymentRow(row), raw: row };
}
