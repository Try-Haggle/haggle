"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────
interface DisputeListItem {
  id: string;
  order_id: string;
  reason_code: string;
  status: string;
  tier: number | null;
  opened_by: string;
  opened_at: string;
  user_role: "buyer" | "seller";
  counterparty_name: string | null;
  item_title: string | null;
  amount_minor: number | null;
  needs_action: boolean;
  resolution_outcome: string | null;
  refund_amount_minor: number | null;
}

interface DisputeListResponse {
  disputes: DisputeListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Status config ───────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-warning-soft text-warning border-warning/30",
  UNDER_REVIEW: "bg-info-soft text-info border-info/30",
  WAITING_FOR_BUYER: "bg-info-soft text-info border-info/30",
  WAITING_FOR_SELLER: "bg-info-soft text-info border-info/30",
  RESOLVED_BUYER_FAVOR: "bg-success-soft text-success border-success/30",
  RESOLVED_SELLER_FAVOR: "bg-success-soft text-success border-success/30",
  PARTIAL_REFUND: "bg-info-soft text-info border-info/30",
  CLOSED: "bg-surface-sunken text-ink-secondary border-line",
};

const ALL_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "WAITING_FOR_BUYER",
  "WAITING_FOR_SELLER",
  "RESOLVED_BUYER_FAVOR",
  "RESOLVED_SELLER_FAVOR",
  "PARTIAL_REFUND",
  "CLOSED",
];

// Role tags kept visually distinct: buyer → info (blue), seller → badge (gold).
const ROLE_COLORS: Record<string, string> = {
  buyer: "bg-info-soft text-info border-info/30",
  seller: "bg-badge text-badge-text border-badge-text/30",
};

type RoleTab = "all" | "buyer" | "seller";

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-surface-sunken text-ink-secondary border-line";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? "bg-surface-sunken text-ink-secondary border-line";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${color}`}
    >
      {role}
    </span>
  );
}

function formatCurrency(minor: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Main Page ───────────────────────────────────────────────
export default function DisputesListPage() {
  const [disputes, setDisputes] = useState<DisputeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<RoleTab>("all");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("role", activeTab);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (statusFilter) {
        params.set("status", statusFilter);
      }

      const data = await api.get<DisputeListResponse>(`/disputes?${params.toString()}`);
      setDisputes(data.disputes);
      setTotal(data.total);
    } catch {
      setDisputes([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeTab, statusFilter, offset]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  // Reset offset when tab or filter changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset pagination when tab/filter changes
  useEffect(() => {
    setOffset(0);
  }, [activeTab, statusFilter]);

  // Compute tab counts (approximate from current data when on "all" tab)
  const buyerCount =
    activeTab === "all" ? disputes.filter((d) => d.user_role === "buyer").length : undefined;
  const sellerCount =
    activeTab === "all" ? disputes.filter((d) => d.user_role === "seller").length : undefined;

  const tabs: { key: RoleTab; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    { key: "buyer", label: "Buyer", count: buyerCount },
    { key: "seller", label: "Seller", count: sellerCount },
  ];

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Disputes</h1>
          <p className="text-sm text-ink-secondary mt-0.5">
            {total} dispute{total !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Tabs + Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        {/* Role tabs */}
        <div className="flex rounded-lg border border-line overflow-hidden">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-surface-overlay text-ink"
                  : "bg-transparent text-ink-secondary hover:text-ink"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1.5 text-xs text-ink-muted">({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-secondary outline-none focus:border-focus"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {/* Disputes list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-ink-secondary text-sm animate-pulse">Loading disputes...</div>
        </div>
      ) : disputes.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface-raised/50 p-12 text-center">
          <p className="text-ink-secondary text-sm">No disputes found.</p>
          <p className="text-ink-muted text-xs mt-1">
            Disputes will appear here when opened on your orders.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {disputes.map((dispute) => (
            <Link
              key={dispute.id}
              href={`/disputes/${dispute.id}`}
              className="block rounded-xl border border-line bg-surface-raised/50 p-4 hover:border-line-strong transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-sm font-medium text-ink truncate">
                      {dispute.item_title ?? "Dispute"}
                    </p>
                    <StatusBadge status={dispute.status} />
                    <RoleBadge role={dispute.user_role} />
                    {dispute.needs_action && (
                      <span className="inline-flex items-center rounded-full bg-error-soft border border-error/30 px-2 py-0.5 text-xs font-medium text-error">
                        Action needed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ink-muted">
                    <span>{dispute.reason_code.replace(/_/g, " ")}</span>
                    <span>{formatDate(dispute.opened_at)}</span>
                    {dispute.tier && (
                      <span className="font-medium text-ink-secondary">T{dispute.tier}</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {dispute.amount_minor != null && (
                    <p className="text-sm font-semibold text-ink">
                      {formatCurrency(dispute.amount_minor)}
                    </p>
                  )}
                  {dispute.resolution_outcome && (
                    <p className="text-xs text-ink-muted mt-0.5 capitalize">
                      {dispute.resolution_outcome.replace(/_/g, " ")}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-ink-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setOffset(offset + limit)}
            disabled={currentPage >= totalPages}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
