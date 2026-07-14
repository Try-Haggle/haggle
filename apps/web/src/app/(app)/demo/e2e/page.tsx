"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

const DEMO_ITEMS = [
  { title: "iPhone 14 Pro 128GB Space Black", amount: 45000, emoji: "phone" },
  { title: "iPhone 15 Pro 256GB Natural Titanium", amount: 72000, emoji: "phone" },
  { title: "iPhone 13 Pro 128GB Sierra Blue", amount: 32000, emoji: "phone" },
  { title: "MacBook Air M2 256GB Midnight", amount: 85000, emoji: "laptop" },
  { title: "AirPods Pro 2nd Gen", amount: 15000, emoji: "headphones" },
] as const;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export default function DemoE2EPage() {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [customAmount, setCustomAmount] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);

    const item = DEMO_ITEMS[selected];
    const amount = customAmount ? Math.round(parseFloat(customAmount) * 100) : item.amount;

    try {
      const result = await api.post<{
        order: { id: string; status: string; amountMinor: number; item_title: string };
        settlement_approval_id: string;
      }>("/demo/e2e/create-order", {
        amount_minor: amount,
        currency: "USD",
        item_title: item.title,
      });

      router.push(`/orders/${result.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create demo order");
      setCreating(false);
    }
  }

  function formatPrice(minor: number) {
    return `$${(minor / 100).toFixed(2)}`;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-xl mx-auto">
      <Link
        href="/staging"
        className="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink transition-colors mb-6"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Staging
      </Link>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink mb-1">E2E Demo</h1>
        <p className="text-sm text-ink-secondary">
          Test the full flow: Payment &rarr; Shipping &rarr; Delivery &rarr; Dispute
        </p>
      </div>

      {IS_PRODUCTION && (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning mb-6">
          Demo order creation is disabled in production.
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-line bg-surface-raised/50 p-5 mb-6">
        <h2 className="text-sm font-semibold text-ink mb-3">How it works</h2>
        <div className="space-y-2">
          {[
            {
              step: "1",
              label: "Create Order",
              desc: "Mock negotiation completed, settlement approved",
            },
            {
              step: "2",
              label: "Pay",
              desc: "Walk through payment prepare -> quote -> authorize -> settle",
            },
            { step: "3", label: "Ship", desc: "Create label -> mark shipped -> mark delivered" },
            {
              step: "4",
              label: "Dispute (optional)",
              desc: "Open a dispute, add evidence, resolve",
            },
          ].map((s) => (
            <div key={s.step} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-action-primary/20 text-action-primary text-xs font-bold flex items-center justify-center">
                {s.step}
              </span>
              <div>
                <p className="text-sm text-ink font-medium">{s.label}</p>
                <p className="text-xs text-ink-muted">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Item picker */}
      <div className="rounded-xl border border-line bg-surface-raised/50 overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Pick a demo item</h2>
        </div>
        <div className="p-3 space-y-1">
          {DEMO_ITEMS.map((item, i) => (
            <button
              key={item.title}
              type="button"
              onClick={() => {
                setSelected(i);
                setCustomAmount("");
              }}
              className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                selected === i
                  ? "bg-action-primary/10 border border-action-primary/30"
                  : "hover:bg-surface-sunken/50 border border-transparent"
              }`}
            >
              <span className={`text-sm ${selected === i ? "text-ink" : "text-ink-secondary"}`}>
                {item.title}
              </span>
              <span
                className={`text-sm font-medium ${selected === i ? "text-action-primary" : "text-ink-muted"}`}
              >
                {formatPrice(item.amount)}
              </span>
            </button>
          ))}
        </div>

        {/* Custom price override */}
        <div className="px-5 py-3 border-t border-line">
          <label htmlFor="demo-custom-price" className="block text-xs text-ink-muted mb-1">
            Custom price (optional)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-muted">$</span>
            <input
              id="demo-custom-price"
              type="number"
              step="0.01"
              min="1"
              placeholder={`${(DEMO_ITEMS[selected].amount / 100).toFixed(2)}`}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="flex-1 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-focus focus:outline-none"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error-soft px-3 py-2 text-sm text-error mb-4">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={creating || IS_PRODUCTION}
        className="w-full rounded-xl bg-cta px-4 py-3 text-sm font-semibold text-on-cta hover:bg-cta-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {creating ? "Creating order..." : "Start E2E Demo"}
      </button>

      <p className="text-xs text-ink-muted text-center mt-4">
        Uses mock payment rail. No real money involved.
      </p>
    </main>
  );
}
