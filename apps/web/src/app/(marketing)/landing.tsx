"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WaitlistForm } from "@/components/waitlist-form";

const PLATFORMS = [
  { name: "eBay", fee: "15.6%", color: "bg-red-500" },
  { name: "Poshmark", fee: "20%", color: "bg-red-700" },
  { name: "Mercari", fee: "10%", color: "bg-red-600" },
  { name: "StockX", fee: "12%", color: "bg-emerald-600" },
  { name: "Depop", fee: "3.8%", color: "bg-orange-500" },
  { name: "Haggle", fee: "1.5%", color: "bg-cyan-500" },
];

const STEPS = [
  {
    num: "01",
    title: "List your item",
    desc: "Take a photo, set your target price. AI suggests optimal pricing based on market data.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    ),
  },
  {
    num: "02",
    title: "AI negotiates for you",
    desc: "Your AI agent handles price negotiation, shipping terms, and payment — in seconds, not hours.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
        <path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z" />
        <path d="m18 8 2-2m0 0 2-2m-2 2-2-2m2 2 2 2" />
      </svg>
    ),
  },
  {
    num: "03",
    title: "Get paid instantly",
    desc: "USDC settlement via smart contract. Non-custodial — your funds are never held by Haggle.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
];

export function Landing() {
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/waitlist")
      .then((r) => r.json())
      .then((d) => setWaitlistCount(d.count))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 sm:pt-24 pb-20">
        <div className="text-center max-w-3xl mx-auto">
          <p className="text-cyan-400 text-sm font-medium tracking-widest uppercase mb-4">
            AI-Powered Negotiation Protocol
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
            AI negotiates.{" "}
            <span className="text-cyan-400">You save.</span>
          </h1>
          <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
            The P2P marketplace where AI agents handle price negotiation for both
            buyer and seller. 1.5% total fee. Non-custodial payments. Portable trust.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Link
              href="/demo"
              className="w-full sm:w-auto rounded-xl bg-cyan-600 px-8 py-3.5 text-base font-medium text-white hover:bg-cyan-500 transition-colors text-center"
            >
              Try AI Negotiation
            </Link>
            <Link
              href="/calculator"
              className="w-full sm:w-auto rounded-xl border border-slate-700 px-8 py-3.5 text-base font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors text-center"
            >
              Calculate Your Savings
            </Link>
          </div>

          {waitlistCount !== null && waitlistCount > 0 && (
            <p className="text-sm text-slate-500">
              {waitlistCount.toLocaleString()} people on the waitlist
            </p>
          )}
        </div>
      </section>

      {/* Value Props */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              title: "1.5% Total Fee",
              desc: "eBay charges 15%+. Poshmark takes 20%. Haggle takes 1.5% flat — everything included.",
              accent: "text-emerald-400",
              border: "border-emerald-500/20",
            },
            {
              title: "AI Negotiation",
              desc: "Each side gets their own AI agent. Fair, data-driven price discovery in seconds.",
              accent: "text-cyan-400",
              border: "border-cyan-500/20",
            },
            {
              title: "Safe Payments",
              desc: "USDC via smart contract. Non-custodial — Haggle never holds your money.",
              accent: "text-violet-400",
              border: "border-violet-500/20",
            },
          ].map((card) => (
            <div
              key={card.title}
              className={`rounded-2xl border ${card.border} bg-bg-card p-6 sm:p-8`}
            >
              <h3 className={`text-lg font-semibold ${card.accent} mb-2`}>{card.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Fee Comparison */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Stop overpaying platform fees
          </h2>
          <p className="text-slate-400">
            Sell a $500 item. Here&apos;s what each platform takes:
          </p>
        </div>

        <div className="max-w-2xl mx-auto space-y-3">
          {PLATFORMS.map((p) => {
            const feeNum = parseFloat(p.fee);
            const widthPercent = (feeNum / 20) * 100; // 20% max
            const isHaggle = p.name === "Haggle";
            return (
              <div key={p.name} className="flex items-center gap-4">
                <span className={`w-20 text-sm text-right ${isHaggle ? "text-cyan-400 font-semibold" : "text-slate-400"}`}>
                  {p.name}
                </span>
                <div className="flex-1 h-8 rounded-lg bg-slate-800/50 overflow-hidden relative">
                  <div
                    className={`h-full ${p.color} rounded-lg transition-all duration-700`}
                    style={{ width: `${widthPercent}%` }}
                  />
                  <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${isHaggle ? "text-white" : "text-slate-300"}`}>
                    {p.fee}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center mt-8">
          <Link
            href="/calculator"
            className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            See your exact savings with the fee calculator &rarr;
          </Link>
        </div>
      </section>

      {/* How it Works */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-12">
          How it works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {STEPS.map((step) => (
            <div key={step.num} className="text-center sm:text-left">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/10 text-cyan-400 mb-4">
                {step.icon}
              </div>
              <p className="text-xs text-cyan-400 font-medium mb-1">{step.num}</p>
              <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Waitlist CTA */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
        <div className="rounded-2xl border border-slate-800 bg-bg-card p-8 sm:p-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Join the waitlist
          </h2>
          <p className="text-slate-400 mb-8 max-w-lg mx-auto">
            Be the first to try AI-powered negotiation. Early members get fee-free trades.
          </p>
          <div className="max-w-md mx-auto">
            <WaitlistForm source="landing" />
          </div>
        </div>
      </section>
    </div>
  );
}
