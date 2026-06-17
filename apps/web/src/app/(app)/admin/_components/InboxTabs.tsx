"use client";

import { useMemo, useState } from "react";
import type { DisputeInboxItem, InboxType, PaymentInboxItem, TagInboxItem } from "@/lib/admin-api";
import { DetailDrawer } from "./DetailDrawer";
import { type ColumnDef, InboxTable } from "./InboxTable";

const TABS: { key: InboxType; label: string }[] = [
  { key: "tag", label: "Tags" },
  { key: "dispute", label: "Disputes" },
  { key: "payment", label: "Payments" },
];

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

const tagColumns: ColumnDef<TagInboxItem>[] = [
  {
    key: "label",
    label: "Label",
    render: (r) => <span className="font-medium text-ink">{r.label}</span>,
  },
  {
    key: "count",
    label: "Count",
    render: (r) => <span className="text-ink-secondary">{r.occurrenceCount}</span>,
  },
  {
    key: "eligible",
    label: "Auto-promote",
    render: (r) =>
      r.autoPromoteEligible ? (
        <span className="rounded bg-success-soft px-2 py-0.5 text-xs text-success">eligible</span>
      ) : (
        <span className="text-xs text-ink-muted">—</span>
      ),
  },
  {
    key: "createdAt",
    label: "Created",
    render: (r) => <span className="text-ink-muted">{fmt(r.createdAt)}</span>,
  },
];

const disputeColumns: ColumnDef<DisputeInboxItem>[] = [
  {
    key: "orderId",
    label: "Order",
    render: (r) => <span className="font-mono text-xs text-ink-secondary">{r.orderId}</span>,
  },
  {
    key: "status",
    label: "Status",
    render: (r) => <span className="text-ink-secondary">{r.status}</span>,
  },
  {
    key: "reason",
    label: "Reason",
    render: (r) => <span className="text-ink-secondary">{r.reasonCode}</span>,
  },
  {
    key: "openedAt",
    label: "Opened",
    render: (r) => <span className="text-ink-muted">{fmt(r.openedAt)}</span>,
  },
];

const paymentColumns: ColumnDef<PaymentInboxItem>[] = [
  {
    key: "orderId",
    label: "Order",
    render: (r) => <span className="font-mono text-xs text-ink-secondary">{r.orderId ?? "—"}</span>,
  },
  {
    key: "amount",
    label: "Amount",
    render: (r) => <span className="text-ink">{(r.amountMinor / 100).toFixed(2)}</span>,
  },
  {
    key: "rail",
    label: "Rail",
    render: (r) => <span className="text-ink-secondary">{r.rail ?? "—"}</span>,
  },
  {
    key: "error",
    label: "Error",
    render: (r) => <span className="truncate text-xs text-error">{r.providerError ?? "—"}</span>,
  },
  {
    key: "failedAt",
    label: "Failed",
    render: (r) => <span className="text-ink-muted">{fmt(r.failedAt)}</span>,
  },
];

export function InboxTabs() {
  const [activeTab, setActiveTab] = useState<InboxType>("tag");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDone = useMemo(
    () => () => {
      setSelectedId(null);
      setRefreshKey((k) => k + 1);
    },
    [],
  );

  return (
    <section className="mt-6">
      <div
        role="tablist"
        aria-label="Inbox categories"
        className="mb-4 flex gap-1 border-b border-line"
      >
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`tab-${tab.key}`}
              onClick={() => {
                setActiveTab(tab.key);
                setSelectedId(null);
              }}
              className={
                "px-4 py-2 text-sm font-medium transition-colors " +
                (active
                  ? "border-b-2 border-action-primary text-ink"
                  : "text-ink-muted hover:text-ink")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "tag" && (
        <InboxTable
          type="tag"
          columns={tagColumns}
          refreshKey={refreshKey}
          onSelect={(item) => setSelectedId(item.id)}
        />
      )}
      {activeTab === "dispute" && (
        <InboxTable
          type="dispute"
          columns={disputeColumns}
          refreshKey={refreshKey}
          onSelect={(item) => setSelectedId(item.id)}
        />
      )}
      {activeTab === "payment" && (
        <InboxTable
          type="payment"
          columns={paymentColumns}
          refreshKey={refreshKey}
          onSelect={(item) => setSelectedId(item.id)}
        />
      )}

      <DetailDrawer
        type={activeTab}
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onDone={handleDone}
      />
    </section>
  );
}
