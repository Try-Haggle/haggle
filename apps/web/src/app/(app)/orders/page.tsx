"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────
interface Order {
  id: string;
  seller_id: string;
  buyer_id: string;
  status: string;
  currency: string;
  amount_minor: number;
  order_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface OrderListResponse {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Status config ───────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  APPROVED: "bg-info-soft text-info border-info/30",
  PAYMENT_PENDING: "bg-warning-soft text-warning border-warning/30",
  PAID: "bg-success-soft text-success border-success/30",
  FULFILLMENT_PENDING: "bg-warning-soft text-warning border-warning/30",
  FULFILLMENT_ACTIVE: "bg-info-soft text-info border-info/30",
  DELIVERED: "bg-success-soft text-success border-success/30",
  IN_DISPUTE: "bg-error-soft text-error border-error/30",
  REFUNDED: "bg-info-soft text-info border-info/30",
  CLOSED: "bg-surface-sunken text-ink-secondary border-line",
  CANCELED: "bg-surface-sunken text-ink-secondary border-line",
};

const ALL_STATUSES = [
  "APPROVED",
  "PAYMENT_PENDING",
  "PAID",
  "FULFILLMENT_PENDING",
  "FULFILLMENT_ACTIVE",
  "DELIVERED",
  "IN_DISPUTE",
  "REFUNDED",
  "CLOSED",
  "CANCELED",
];

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
export default function OrdersListPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<RoleTab>("all");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("role", activeTab);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (statusFilter) {
        params.set("status", statusFilter);
      }

      const data = await api.get<OrderListResponse>(`/orders?${params.toString()}`);
      setOrders(data.orders);
      setTotal(data.total);
    } catch {
      // Silently handle — user may not be logged in
      setOrders([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeTab, statusFilter, offset]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Reset offset when tab or filter changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset pagination when tab/filter changes
  useEffect(() => {
    setOffset(0);
  }, [activeTab, statusFilter]);

  const tabs: { key: RoleTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "buyer", label: "Buying" },
    { key: "seller", label: "Selling" },
  ];

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Orders</h1>
          <p className="text-sm text-ink-secondary mt-0.5">
            {total} order{total !== 1 ? "s" : ""}
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

      {/* Orders list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-ink-secondary text-sm animate-pulse">Loading orders...</div>
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface-raised/50 p-12 text-center">
          <p className="text-ink-secondary text-sm">No orders yet.</p>
          <p className="text-ink-muted text-xs mt-1">
            Orders will appear here once you buy or sell something.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const snapshot = order.order_snapshot as Record<string, unknown>;
            const terms = snapshot?.terms as Record<string, unknown> | undefined;
            const itemName =
              (terms?.item_name as string) ?? (terms?.listing_id as string) ?? "Order";

            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block rounded-xl border border-line bg-surface-raised/50 p-4 hover:border-line-strong transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-ink truncate">{itemName}</p>
                      <StatusBadge status={order.status} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ink-muted">
                      <span>{formatDate(order.created_at)}</span>
                      <span className="font-mono">{order.id.slice(0, 8)}...</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-ink">
                      {formatCurrency(order.amount_minor, order.currency)}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
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
