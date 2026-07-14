"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  EmptyState,
  ListRow,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
} from "@/components/ui";
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

type RoleTab = "all" | "buyer" | "seller";

// Role tags kept visually distinct: buyer → info (blue), seller → gold.
function RoleBadge({ role }: { role: string }) {
  return (
    <Badge tone={role === "seller" ? "gold" : "info"} size="sm" className="capitalize">
      {role}
    </Badge>
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
        <Tabs
          items={tabs.map((t) => ({ key: t.key, label: t.label, count: t.count }))}
          value={activeTab}
          onValueChange={(k) => setActiveTab(k as RoleTab)}
        />

        {/* Status filter */}
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 w-auto py-0 text-sm"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </div>

      {/* Disputes list */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-ink-secondary text-sm">
          <Spinner size="sm" />
          Loading disputes...
        </div>
      ) : disputes.length === 0 ? (
        <EmptyState
          className="bg-surface-raised/50"
          title="No disputes found."
          description="Disputes will appear here when opened on your orders."
        />
      ) : (
        <div className="space-y-3">
          {disputes.map((dispute) => (
            <ListRow
              key={dispute.id}
              href={`/disputes/${dispute.id}`}
              title={dispute.item_title ?? "Dispute"}
              badges={
                <>
                  <StatusBadge domain="dispute" status={dispute.status} />
                  <RoleBadge role={dispute.user_role} />
                  {dispute.needs_action && (
                    <Badge tone="error" size="sm">
                      Action needed
                    </Badge>
                  )}
                </>
              }
              meta={
                <span className="flex items-center gap-3">
                  <span>{dispute.reason_code.replace(/_/g, " ")}</span>
                  <span>{formatDate(dispute.opened_at)}</span>
                  {dispute.tier && (
                    <span className="font-medium text-ink-secondary">T{dispute.tier}</span>
                  )}
                </span>
              }
              trailing={
                <>
                  {dispute.amount_minor != null && (
                    <p className="font-semibold text-ink text-sm">
                      {formatCurrency(dispute.amount_minor)}
                    </p>
                  )}
                  {dispute.resolution_outcome && (
                    <p className="mt-0.5 text-ink-muted text-xs capitalize">
                      {dispute.resolution_outcome.replace(/_/g, " ")}
                    </p>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}

      <Pagination
        page={currentPage}
        totalPages={totalPages}
        onPageChange={(p) => setOffset((p - 1) * limit)}
        className="mt-6"
      />
    </main>
  );
}
