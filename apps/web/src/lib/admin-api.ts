import { api } from "./api-client";

export type InboxType = "tag" | "dispute" | "payment";

export interface InboxSummary {
  tags: { pending: number; autoPromoteReady: number };
  disputes: { open: number; underReview: number; waiting: number };
  payments: { failed: number };
  computedAt: string;
}

/**
 * Per-type inbox row shapes. These mirror the API service types in
 * `apps/api/src/services/admin-inbox.service.ts`. Dates come over the
 * wire as ISO strings.
 */
export interface TagInboxItem {
  id: string;
  label: string;
  normalizedLabel: string;
  occurrenceCount: number;
  firstSeenListingId: string | null;
  createdAt: string;
  autoPromoteEligible: boolean;
}

export interface DisputeInboxItem {
  id: string;
  orderId: string;
  status: string;
  openedAt: string;
  reasonCode: string;
  openedBy: string;
  updatedAt: string;
}

export interface PaymentInboxItem {
  id: string;
  orderId: string | null;
  amountMinor: number;
  rail: string | null;
  failedAt: string;
  providerError: string | null;
}

/**
 * Map from inbox type discriminator to row type.
 * Used to type the generic `InboxTable<T>` and the discriminated detail union.
 */
export type InboxItemByType = {
  tag: TagInboxItem;
  dispute: DisputeInboxItem;
  payment: PaymentInboxItem;
};

/** Loose item type for callers that don't need discrimination. */
export type InboxItem = TagInboxItem | DisputeInboxItem | PaymentInboxItem;

export interface InboxListResponse<T = InboxItem> {
  items: T[];
}

export interface ListParams {
  limit?: number;
  offset?: number;
  status?: string;
}

/**
 * Discriminated union returned from `/admin/inbox/:type/:id`.
 * Mirrors `InboxDetail` in `admin-inbox.service.ts`.
 */
export type AdminInboxDetail =
  | { type: "tag"; item: TagInboxItem; raw: unknown }
  | { type: "dispute"; item: DisputeInboxItem; raw: unknown }
  | { type: "payment"; item: PaymentInboxItem; raw: unknown };

export interface PromotionRule {
  category: string;
  candidateMinUse: number;
  emergingMinUse: number;
  candidateMinAgeDays: number;
  emergingMinAgeDays: number;
  suggestionAutoPromoteCount: number;
  enabled: boolean;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PromotionRulesResponse {
  rules: PromotionRule[];
}

export interface LastRunResponse {
  lastRun: Record<string, unknown> | null;
}

/** Map UI inbox type -> API segment (tag -> tags, dispute -> disputes, payment -> payments) */
function typeToSegment(type: InboxType): string {
  return type === "tag" ? "tags" : type === "dispute" ? "disputes" : "payments";
}

/**
 * Pure helper used by the admin layout guard + unit tests.
 * Reads Supabase role from either app_metadata or user_metadata and
 * returns true only when it strictly equals "admin".
 */
export function isAdminRole(user: {
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
} | null | undefined): boolean {
  if (!user) return false;
  const appRole = (user.app_metadata as { role?: unknown } | null | undefined)?.role;
  const userRole = (user.user_metadata as { role?: unknown } | null | undefined)?.role;
  const role = appRole ?? userRole;
  return role === "admin";
}

/** Typed list overloads so `list('tag', …)` returns `TagInboxItem[]`, etc. */
function listOverload<K extends InboxType>(
  type: K,
  p: ListParams = {},
): Promise<InboxListResponse<InboxItemByType[K]>> {
  const qs = new URLSearchParams();
  if (p.limit != null) qs.set("limit", String(p.limit));
  if (p.offset != null) qs.set("offset", String(p.offset));
  if (p.status) qs.set("status", p.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return api.get<InboxListResponse<InboxItemByType[K]>>(
    `/admin/inbox/${typeToSegment(type)}${suffix}`,
  );
}

export const adminApi = {
  inbox: {
    summary: () => api.get<InboxSummary>("/admin/inbox/summary"),

    list: listOverload,

    detail: (type: InboxType, id: string) =>
      api.get<AdminInboxDetail>(`/admin/inbox/${type}/${id}`),
  },

  actions: {
    tagApprove: (params: {
      suggestionId: string;
      category?: string;
      initialStatus?: "CANDIDATE" | "EMERGING" | "OFFICIAL";
    }) => api.post<{ result: unknown }>("/admin/actions/tag-approve", params),

    tagReject: (params: { suggestionId: string; reason?: string }) =>
      api.post<{ result: unknown }>("/admin/actions/tag-reject", params),

    tagMerge: (params: { suggestionId: string; targetTagId: string }) =>
      api.post<{ result: unknown }>("/admin/actions/tag-merge", params),

    disputeEscalate: (params: {
      disputeId: string;
      toTier: number;
      reason?: string;
    }) =>
      api.post<{ disputeId: string; previousTier: number; newTier: number }>(
        "/admin/actions/dispute-escalate",
        params,
      ),

    disputeResolve: (params: {
      disputeId: string;
      outcome: "buyer_favor" | "seller_favor" | "partial_refund";
      summary?: string;
      refundAmountMinor?: number;
    }) =>
      api.post<{ dispute: unknown }>(
        "/admin/actions/dispute-resolve",
        params,
      ),

    paymentMarkReview: (params: { paymentIntentId: string; note: string }) =>
      api.post<{ paymentIntentId: string }>(
        "/admin/actions/payment-mark-review",
        params,
      ),
  },

  promotionRules: {
    list: () => api.get<PromotionRulesResponse>("/admin/promotion-rules"),
    get: (category: string) =>
      api.get<{ rule: PromotionRule }>(`/admin/promotion-rules/${category}`),
    put: (category: string, body: Omit<PromotionRule, "category" | "updatedAt">) =>
      api.put<{ rule: PromotionRule }>(`/admin/promotion-rules/${category}`, body),
    delete: (category: string) =>
      api.delete(`/admin/promotion-rules/${category}`),
  },

  jobs: {
    runTagPromote: () =>
      api.post<{ report: Record<string, unknown> }>("/admin/jobs/tag-promote"),
    lastTagPromote: () => api.get<LastRunResponse>("/admin/jobs/tag-promote/last"),
  },
};
