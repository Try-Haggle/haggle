"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
  OPEN: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  UNDER_REVIEW: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  WAITING_FOR_BUYER: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  WAITING_FOR_SELLER: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  RESOLVED_BUYER_FAVOR: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  RESOLVED_SELLER_FAVOR: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  PARTIAL_REFUND: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  CLOSED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
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

const ROLE_COLORS: Record<string, string> = {
  buyer: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  seller: "bg-violet-500/20 text-violet-400 border-violet-500/30",
};

type RoleTab = "all" | "buyer" | "seller";

function StatusBadge({ status }: { status: string }) {
  const color =
    STATUS_COLORS[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color =
    ROLE_COLORS[role] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
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

      const data = await api.get<DisputeListResponse>(
        `/disputes?${params.toString()}`,
      );
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
  useEffect(() => {
    setOffset(0);
  }, [activeTab, statusFilter]);

  // Compute tab counts (approximate from current data when on "all" tab)
  const buyerCount = activeTab === "all"
    ? disputes.filter((d) => d.user_role === "buyer").length
    : undefined;
  const sellerCount = activeTab === "all"
    ? disputes.filter((d) => d.user_role === "seller").length
    : undefined;

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
          <h1 className="text-xl font-bold text-white">Disputes</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {total} dispute{total !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Tabs + Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        {/* Role tabs */}
        <div className="flex rounded-lg border border-slate-800 overflow-hidden">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-slate-700 text-white"
                  : "bg-transparent text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1.5 text-xs text-slate-500">
                  ({tab.count})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300 outline-none focus:border-cyan-500"
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
          <div className="text-slate-400 text-sm animate-pulse">
            Loading disputes...
          </div>
        </div>
      ) : disputes.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-12 text-center">
          <p className="text-slate-400 text-sm">No disputes found.</p>
          <p className="text-slate-500 text-xs mt-1">
            Disputes will appear here when opened on your orders.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {disputes.map((dispute) => (
            <Link
              key={dispute.id}
              href={`/disputes/${dispute.id}`}
              className="block rounded-xl border border-slate-800 bg-bg-card/50 p-4 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-sm font-medium text-white truncate">
                      {dispute.item_title ?? "Dispute"}
                    </p>
                    <StatusBadge status={dispute.status} />
                    <RoleBadge role={dispute.user_role} />
                    {dispute.needs_action && (
                      <span className="inline-flex items-center rounded-full bg-red-500/20 border border-red-500/30 px-2 py-0.5 text-xs font-medium text-red-400">
                        Action needed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{dispute.reason_code.replace(/_/g, " ")}</span>
                    <span>{formatDate(dispute.opened_at)}</span>
                    {dispute.tier && (
                      <span className="font-medium text-slate-400">
                        T{dispute.tier}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {dispute.amount_minor != null && (
                    <p className="text-sm font-semibold text-white">
                      {formatCurrency(dispute.amount_minor)}
                    </p>
                  )}
                  {dispute.resolution_outcome && (
                    <p className="text-xs text-slate-500 mt-0.5 capitalize">
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
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="rounded-lg border border-slate-800 px-3 py-1.5 text-sm text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-slate-500">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={currentPage >= totalPages}
            className="rounded-lg border border-slate-800 px-3 py-1.5 text-sm text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
