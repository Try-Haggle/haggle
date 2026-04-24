"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Staging
      </Link>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-white mb-1">E2E Demo</h1>
        <p className="text-sm text-slate-400">
          Test the full flow: Payment &rarr; Shipping &rarr; Delivery &rarr; Dispute
        </p>
      </div>

      {IS_PRODUCTION && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300 mb-6">
          Demo order creation is disabled in production.
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-3">How it works</h2>
        <div className="space-y-2">
          {[
            { step: "1", label: "Create Order", desc: "Mock negotiation completed, settlement approved" },
            { step: "2", label: "Pay", desc: "Walk through payment prepare -> quote -> authorize -> settle" },
            { step: "3", label: "Ship", desc: "Create label -> mark shipped -> mark delivered" },
            { step: "4", label: "Dispute (optional)", desc: "Open a dispute, add evidence, resolve" },
          ].map((s) => (
            <div key={s.step} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center">
                {s.step}
              </span>
              <div>
                <p className="text-sm text-white font-medium">{s.label}</p>
                <p className="text-xs text-slate-500">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Item picker */}
      <div className="rounded-xl border border-slate-800 bg-bg-card/50 overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">Pick a demo item</h2>
        </div>
        <div className="p-3 space-y-1">
          {DEMO_ITEMS.map((item, i) => (
            <button
              key={i}
              onClick={() => { setSelected(i); setCustomAmount(""); }}
              className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                selected === i
                  ? "bg-cyan-500/10 border border-cyan-500/30"
                  : "hover:bg-slate-800/50 border border-transparent"
              }`}
            >
              <span className={`text-sm ${selected === i ? "text-white" : "text-slate-300"}`}>
                {item.title}
              </span>
              <span className={`text-sm font-medium ${selected === i ? "text-cyan-400" : "text-slate-500"}`}>
                {formatPrice(item.amount)}
              </span>
            </button>
          ))}
        </div>

        {/* Custom price override */}
        <div className="px-5 py-3 border-t border-slate-800">
          <label className="block text-xs text-slate-500 mb-1">Custom price (optional)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">$</span>
            <input
              type="number"
              step="0.01"
              min="1"
              placeholder={`${(DEMO_ITEMS[selected].amount / 100).toFixed(2)}`}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="flex-1 rounded-lg border border-slate-700 bg-bg-card px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400 mb-4">
          {error}
        </div>
      )}

      <button
        onClick={handleCreate}
        disabled={creating || IS_PRODUCTION}
        className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {creating ? "Creating order..." : "Start E2E Demo"}
      </button>

      <p className="text-xs text-slate-500 text-center mt-4">
        Uses mock payment rail. No real money involved.
      </p>
    </main>
  );
}
