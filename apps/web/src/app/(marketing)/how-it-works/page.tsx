"use client";

import Link from "next/link";
import { useState } from "react";

// ─── Flow Steps ───────────────────────────────────────────────────────

const FLOW_STEPS = [
  {
    id: "list",
    num: "01",
    title: "List Your Item",
    subtitle: "Seller posts item — no wallet needed yet",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    details: [
      "Post via web app or ChatGPT (MCP)",
      "AI extracts tags: model, storage, condition",
      "HFMI shows market reference price",
      "Set your target & floor price",
      "No wallet required until payment",
    ],
    demo: {
      label: "iPhone 15 Pro 256GB · Excellent",
      tags: ["electronics", "iphone_15_pro", "256gb", "grade_a"],
      hfmi: "$527 market reference (35 recent sales)",
      seller: "Target: $600 · Floor: $500",
    },
  },
  {
    id: "match",
    num: "02",
    title: "Buyer Discovers",
    subtitle: "AI matches buyers with listings",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    details: [
      "Browse listings or set WaitingIntent",
      "AI notifies when matching item appears",
      "See market price & savings potential",
      "Start negotiation with one click",
    ],
    demo: {
      label: "Buyer sees listing",
      savings: "Potential savings: $50-80 vs eBay",
      fee: "eBay 13.25% → Haggle 1.5%",
    },
  },
  {
    id: "negotiate",
    num: "03",
    title: "AI Negotiates",
    subtitle: "6-Stage pipeline — both sides have AI agents",
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/20",
    details: [
      "UNDERSTAND → parse offer intent",
      "CONTEXT → market data + skill knowledge + briefing",
      "DECIDE → LLM decides (Grok-fast) with Faratin curve",
      "VALIDATE → 7 referee rules, floor protection",
      "RESPOND → natural language in buyer's language",
      "PERSIST → hash chain, round facts, checkpoint",
    ],
    demo: {
      rounds: [
        { r: 1, buyer: "$520", seller: "$620", phase: "OPENING" },
        { r: 2, buyer: "$550", seller: "$595", phase: "BARGAINING" },
        { r: 3, buyer: "$570", seller: "$585", phase: "BARGAINING" },
        { r: 4, buyer: "ACCEPT $585", seller: "—", phase: "CLOSING" },
      ],
    },
  },
  {
    id: "skills",
    num: "04",
    title: "Skills Working",
    subtitle: "Verified skills augment every round",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    details: [
      "✅ Haggle Engine — 4D utility + Faratin curves (free)",
      "✅ Electronics Knowledge — domain expertise",
      "✅ HFMI Market Data — fee-adjusted market prices",
      "✅ Faratin Coaching — BuddyDNA-based price advisor",
      "🛡️ Prompt Guard — 3-layer injection defense",
      "Skills show verification badges to users",
    ],
    demo: {
      skills: [
        { name: "Haggle Engine", badge: "✅", info: "4D utility: 0.72 · Faratin: $573" },
        { name: "Electronics Knowledge", badge: "✅", info: "iPhone Pro valuation rules" },
        { name: "HFMI Market", badge: "✅", info: "Median $527 (35 sales, L2 confidence)" },
      ],
    },
  },
  {
    id: "pay",
    num: "05",
    title: "Payment",
    subtitle: "Card or USDC — seller gets the same",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/20",
    details: [
      "💳 Card: Stripe Onramp → USDC on Base (3% total)",
      "🔗 USDC: Direct from wallet (1.5% total)",
      "Seller receives same amount either way",
      "Gas paid by Haggle (~$0.001)",
      "Smart contract escrow — non-custodial",
    ],
    demo: {
      card: { label: "Pay with Card", total: "$602.78", fee: "Stripe 1.5% + Haggle 1.5%" },
      usdc: { label: "Pay with USDC", total: "$585.00", fee: "Haggle 1.5% only", recommended: true },
    },
  },
  {
    id: "settle",
    num: "06",
    title: "Settlement",
    subtitle: "Smart contract releases funds",
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/20",
    details: [
      "EIP-712 signed settlement on Base L2",
      "HaggleSettlementRouter.sol — USDC routing",
      "Seller: connect wallet or create with Coinbase (email)",
      "Offramp: USDC → bank account (0% via Coinbase)",
      "Dispute? → HaggleDisputeRegistry.sol",
    ],
    demo: {
      seller: "$576.23 received (after 1.5% fee)",
      buyer: "Saved $41 vs eBay price",
      platform: "Haggle earned $8.78",
    },
  },
];

// ─── Stats ────────────────────────────────────────────────────────────

const STATS = [
  { label: "Platform Fee", value: "1.5%", sub: "vs eBay 13.25%" },
  { label: "AI Cost/Session", value: "$0.003", sub: "Grok-fast" },
  { label: "Gas/Transaction", value: "$0.001", sub: "Haggle pays" },
  { label: "Languages", value: "7", sub: "auto-detect" },
  { label: "Market Data", value: "1,881", sub: "price observations" },
  { label: "Skill Tests", value: "56", sub: "passing" },
];

// ─── Component ────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  const [activeStep, setActiveStep] = useState("negotiate");

  const active = FLOW_STEPS.find((s) => s.id === activeStep) ?? FLOW_STEPS[2];

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <div className="mx-auto max-w-5xl px-4 pt-12 pb-8">
        <Link href="/" className="text-sm text-slate-500 hover:text-white">
          &larr; Home
        </Link>
        <h1 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
          How Haggle Works
        </h1>
        <p className="mt-2 text-lg text-slate-400">
          AI negotiates. Smart contracts settle. 1.5% fee.
        </p>
      </div>

      {/* Stats bar */}
      <div className="mx-auto max-w-5xl px-4 mb-10">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center">
              <div className="text-lg font-bold text-white">{s.value}</div>
              <div className="text-[10px] text-slate-500">{s.label}</div>
              <div className="text-[10px] text-slate-600">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Flow timeline */}
      <div className="mx-auto max-w-5xl px-4">
        {/* Step selector */}
        <div className="flex gap-1 overflow-x-auto pb-4 mb-6">
          {FLOW_STEPS.map((step) => (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              className={`shrink-0 rounded-lg px-4 py-3 text-left transition-all ${
                activeStep === step.id
                  ? `${step.bg} border`
                  : "border border-transparent hover:border-slate-700"
              }`}
            >
              <div className={`text-xs font-mono ${activeStep === step.id ? step.color : "text-slate-600"}`}>
                {step.num}
              </div>
              <div className={`text-sm font-medium ${activeStep === step.id ? "text-white" : "text-slate-400"}`}>
                {step.title}
              </div>
            </button>
          ))}
        </div>

        {/* Active step detail */}
        <div className={`rounded-xl border ${active.bg} p-6 sm:p-8 mb-8`}>
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <div className={`text-xs font-mono ${active.color}`}>{active.num}</div>
              <h2 className="text-2xl font-bold text-white">{active.title}</h2>
              <p className="text-sm text-slate-400 mt-1">{active.subtitle}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Left: details */}
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">What happens</h3>
              <ul className="space-y-2">
                {active.details.map((d, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-300">
                    <span className="text-slate-600 shrink-0">•</span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: demo visualization */}
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Preview</h3>
              <div className="rounded-lg bg-black/30 border border-slate-800 p-4">
                {active.id === "list" && active.demo && "label" in active.demo && (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-white">{active.demo.label}</div>
                    <div className="flex flex-wrap gap-1">
                      {(active.demo as { tags: string[] }).tags.map((t: string) => (
                        <span key={t} className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{t}</span>
                      ))}
                    </div>
                    <div className="text-xs text-emerald-400">{(active.demo as { hfmi: string }).hfmi}</div>
                    <div className="text-xs text-slate-500">{(active.demo as { seller: string }).seller}</div>
                  </div>
                )}

                {active.id === "match" && active.demo && "savings" in active.demo && (
                  <div className="space-y-2">
                    <div className="text-sm text-white">{(active.demo as { label: string }).label}</div>
                    <div className="text-xs text-emerald-400">{(active.demo as { savings: string }).savings}</div>
                    <div className="text-xs text-amber-400">{(active.demo as { fee: string }).fee}</div>
                  </div>
                )}

                {active.id === "negotiate" && active.demo && "rounds" in active.demo && (
                  <div className="space-y-2">
                    {(active.demo as { rounds: Array<{ r: number; buyer: string; seller: string; phase: string }> }).rounds.map((round) => (
                      <div key={round.r} className="flex items-center gap-3 text-xs">
                        <span className="text-slate-600 w-6">R{round.r}</span>
                        <span className="text-blue-400 w-20">B: {round.buyer}</span>
                        <span className="text-cyan-400 w-20">S: {round.seller}</span>
                        <span className="text-slate-600 text-[10px]">{round.phase}</span>
                      </div>
                    ))}
                    <div className="text-emerald-400 text-xs mt-2">Deal at $585</div>
                  </div>
                )}

                {active.id === "skills" && active.demo && "skills" in active.demo && (
                  <div className="space-y-2">
                    {(active.demo as { skills: Array<{ name: string; badge: string; info: string }> }).skills.map((skill) => (
                      <div key={skill.name} className="flex items-center gap-2 text-xs">
                        <span>{skill.badge}</span>
                        <span className="text-white font-medium">{skill.name}</span>
                        <span className="text-slate-500 ml-auto">{skill.info}</span>
                      </div>
                    ))}
                  </div>
                )}

                {active.id === "pay" && active.demo && "card" in active.demo && (
                  <div className="space-y-3">
                    {[
                      { ...(active.demo as { card: { label: string; total: string; fee: string } }).card, icon: "💳" },
                      { ...(active.demo as { usdc: { label: string; total: string; fee: string; recommended: boolean } }).usdc, icon: "🔗" },
                    ].map((opt) => (
                      <div
                        key={opt.label}
                        className={`flex items-center gap-3 rounded-lg border p-3 ${
                          "recommended" in opt && opt.recommended
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-slate-700"
                        }`}
                      >
                        <span className="text-lg">{opt.icon}</span>
                        <div className="flex-1">
                          <div className="text-xs text-white font-medium">{opt.label}</div>
                          <div className="text-[10px] text-slate-500">{opt.fee}</div>
                        </div>
                        <div className="text-sm font-bold text-white">{opt.total}</div>
                        {"recommended" in opt && opt.recommended && (
                          <span className="text-[10px] text-emerald-400">추천</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {active.id === "settle" && active.demo && "seller" in active.demo && (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Seller receives</span>
                      <span className="text-emerald-400 font-semibold">{(active.demo as { seller: string }).seller}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Buyer saved</span>
                      <span className="text-blue-400">{(active.demo as { buyer: string }).buyer}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Haggle earned</span>
                      <span className="text-amber-400">{(active.demo as { platform: string }).platform}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Architecture summary */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 mb-8">
          <h3 className="text-lg font-bold text-white mb-4">Architecture</h3>
          <pre className="text-xs text-slate-400 overflow-x-auto whitespace-pre font-mono">
{`Buyer                    Haggle Protocol                    Seller
  │                            │                               │
  ├─ Offer ──────────────────► │ ◄──────────────── Listing ────┤
  │                            │                               │
  │              ┌─────────────┴─────────────┐                 │
  │              │  6-Stage Pipeline          │                 │
  │              │  UNDERSTAND → CONTEXT      │                 │
  │              │  → DECIDE → VALIDATE       │                 │
  │              │  → RESPOND → PERSIST       │                 │
  │              │                            │                 │
  │              │  Skills: Engine│Knowledge  │                 │
  │              │  │HFMI│Faratin│Guard       │                 │
  │              └─────────────┬─────────────┘                 │
  │                            │                               │
  │  ◄── Response (7 langs) ── │ ── Response (7 langs) ──────► │
  │                            │                               │
  ├─ 💳 Card / 🔗 USDC ──────► │ ── Settlement Router ────────► │
  │   (Stripe)   (Base L2)     │   (Smart Contract)    USDC    │
  │                            │   Gas: Haggle pays             │
  │                            │                               │
  │              ┌─────────────┴─────────────┐                 │
  │              │  Data Moat (HFMI)         │                 │
  │              │  haggle_internal 2x weight │                 │
  │              │  Fee-adjusted prices       │                 │
  │              │  → Intelligence API        │                 │
  │              └───────────────────────────┘                 │`}
          </pre>
        </div>

        {/* CTA */}
        <div className="text-center py-12">
          <Link
            href="/demo/try"
            className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-8 py-3 font-semibold text-white hover:bg-cyan-400 transition-colors"
          >
            Try Demo Negotiation →
          </Link>
          <p className="mt-3 text-sm text-slate-500">
            No sign-up required. Negotiate with AI in 30 seconds.
          </p>
        </div>
      </div>
    </div>
  );
}
