"use client";

import { useCallback, useEffect, useState } from "react";
import {
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
        <Tabs
          items={tabs.map((t) => ({ key: t.key, label: t.label }))}
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

      {/* Orders list */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-ink-secondary text-sm">
          <Spinner size="sm" />
          Loading orders...
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          className="bg-surface-raised/50"
          title="No orders yet."
          description="Orders will appear here once you buy or sell something."
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const snapshot = order.order_snapshot as Record<string, unknown>;
            const terms = snapshot?.terms as Record<string, unknown> | undefined;
            const itemName =
              (terms?.item_name as string) ?? (terms?.listing_id as string) ?? "Order";

            return (
              <ListRow
                key={order.id}
                href={`/orders/${order.id}`}
                title={itemName}
                badges={<StatusBadge domain="order" status={order.status} />}
                meta={
                  <span className="flex items-center gap-3">
                    <span>{formatDate(order.created_at)}</span>
                    <span className="font-mono">{order.id.slice(0, 8)}...</span>
                  </span>
                }
                trailing={
                  <p className="font-semibold text-ink text-sm">
                    {formatCurrency(order.amount_minor, order.currency)}
                  </p>
                }
              />
            );
          })}
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
