"use client";

import Link from "next/link";

/**
 * Staging Hub — Full flow walkthrough for testing.
 *
 * Every feature accessible from one page.
 * Use this to test the entire Haggle experience end-to-end.
 */

interface FlowStep {
  num: string;
  title: string;
  description: string;
  href: string;
  status: "ready" | "needs_data" | "needs_deploy";
  features: string[];
}

const SELLER_FLOW: FlowStep[] = [
  {
    num: "S1",
    title: "Create Listing",
    description: "Post an item for sale with price, condition, photos",
    href: "/sell/listings/new",
    status: "ready",
    features: ["Tag garden auto-extraction", "HFMI market reference", "Target/floor price"],
  },
  {
    num: "S2",
    title: "Seller Dashboard",
    description: "View your listings, active negotiations, sales",
    href: "/sell/dashboard",
    status: "ready",
    features: ["Active listings", "Negotiation status", "Revenue tracking"],
  },
  {
    num: "S3",
    title: "Seller Negotiation",
    description: "Watch AI negotiate on your behalf, intervene if needed",
    href: "/sell/negotiations/demo",
    status: "needs_data",
    features: ["Chat bubbles (7 languages)", "Real-time WebSocket", "Skill badges"],
  },
];

const BUYER_FLOW: FlowStep[] = [
  {
    num: "B1",
    title: "Browse & Discover",
    description: "Find items, see market prices, start negotiation",
    href: "/buy/dashboard",
    status: "ready",
    features: ["HFMI price reference", "Savings potential", "WaitingIntent matching"],
  },
  {
    num: "B2",
    title: "Buyer Negotiation",
    description: "AI negotiates the best price for you",
    href: "/buy/negotiations/demo",
    status: "needs_data",
    features: ["6-stage pipeline", "Faratin concession curves", "Floor protection"],
  },
  {
    num: "B3",
    title: "Payment",
    description: "Pay with card or USDC — seller gets the same",
    href: "/buy/negotiations/demo",
    status: "needs_deploy",
    features: ["💳 Stripe Onramp (3%)", "🔗 USDC Direct (1.5%)", "Gas paid by Haggle"],
  },
];

const COMMON_FEATURES: FlowStep[] = [
  {
    num: "F1",
    title: "Wallet Settings",
    description: "Connect wallet for payments. Coinbase Smart Wallet supported.",
    href: "/settings",
    status: "ready",
    features: ["Coinbase Smart Wallet", "MetaMask", "Rainbow", "WalletConnect"],
  },
  {
    num: "F2",
    title: "Level & XP",
    description: "Your agent level, XP progress, trade stats",
    href: "/profile/level",
    status: "ready",
    features: ["XP progress bar", "Trade stats", "Consecutive deals"],
  },
  {
    num: "F3",
    title: "Buddies",
    description: "Companion creatures earned through trades",
    href: "/profile/buddies",
    status: "ready",
    features: ["8 species", "6 rarity tiers", "Trade history per buddy"],
  },
  {
    num: "F4",
    title: "Leaderboard",
    description: "Global rankings by level, deals, volume, savings",
    href: "/leaderboard",
    status: "ready",
    features: ["4 ranking categories", "Top 50", "Medal badges"],
  },
  {
    num: "F5",
    title: "Disputes",
    description: "Open a dispute if something goes wrong",
    href: "/disputes/new",
    status: "ready",
    features: ["Evidence submission", "DS panel escalation", "ARP window"],
  },
  {
    num: "F6",
    title: "Admin Panel",
    description: "Tag management, dispute review, payment monitoring",
    href: "/admin",
    status: "ready",
    features: ["Inbox (tags/disputes/payments)", "Promotion rules", "Mutation actions"],
  },
];

const DEMO_PAGES: FlowStep[] = [
  {
    num: "D1",
    title: "Try Demo (User)",
    description: "Interactive negotiation demo — no sign-up needed",
    href: "/demo/try",
    status: "ready",
    features: ["5 languages", "Price chart", "Savings calculation", "Celebration animation"],
  },
  {
    num: "D2",
    title: "Developer Demo",
    description: "Pipeline inspector — see every stage in detail",
    href: "/demo/developer",
    status: "ready",
    features: ["Stage-by-stage view", "Utility bars", "Cost tracking", "DB state"],
  },
  {
    num: "D3",
    title: "How It Works",
    description: "Visual overview of the entire Haggle architecture",
    href: "/how-it-works",
    status: "ready",
    features: ["6-step flow", "Architecture diagram", "Stats dashboard"],
  },
];

const STATUS_BADGE = {
  ready: { label: "Ready", color: "bg-emerald-500/20 text-emerald-400" },
  needs_data: { label: "Needs Data", color: "bg-amber-500/20 text-amber-400" },
  needs_deploy: { label: "Needs Deploy", color: "bg-red-500/20 text-red-400" },
};

function FlowCard({ step }: { step: FlowStep }) {
  const badge = STATUS_BADGE[step.status];
  return (
    <Link
      href={step.href}
      className="group block rounded-xl border border-slate-800 bg-slate-900/50 p-5 hover:border-slate-600 transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xs font-mono text-slate-600">{step.num}</span>
          <h3 className="text-base font-semibold text-white group-hover:text-cyan-400 transition-colors">
            {step.title}
          </h3>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.color}`}>
          {badge.label}
        </span>
      </div>
      <p className="text-sm text-slate-400 mb-3">{step.description}</p>
      <div className="flex flex-wrap gap-1">
        {step.features.map((f) => (
          <span key={f} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
            {f}
          </span>
        ))}
      </div>
    </Link>
  );
}

export default function StagingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Staging Hub</h1>
        <p className="text-sm text-slate-400 mt-1">
          Full Haggle flow — test everything end-to-end
        </p>
      </div>

      {/* Seller Flow */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400">Seller</span>
          Flow
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {SELLER_FLOW.map((s) => <FlowCard key={s.num} step={s} />)}
        </div>
      </section>

      {/* Buyer Flow */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">Buyer</span>
          Flow
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {BUYER_FLOW.map((s) => <FlowCard key={s.num} step={s} />)}
        </div>
      </section>

      {/* Features */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">Features</span>
          Common
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {COMMON_FEATURES.map((s) => <FlowCard key={s.num} step={s} />)}
        </div>
      </section>

      {/* Demo Pages */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">Demo</span>
          Public Pages
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {DEMO_PAGES.map((s) => <FlowCard key={s.num} step={s} />)}
        </div>
      </section>

      {/* API Health */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-4">API Endpoints</h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 font-mono text-xs space-y-1 text-slate-400">
          <div>GET  /health — API health check</div>
          <div>GET  /payments/onramp/status — Stripe onramp availability</div>
          <div>GET  /hfmi/:model/median — Market price query</div>
          <div>GET  /me/level — Agent level & XP</div>
          <div>GET  /buddies — User's buddy list</div>
          <div>GET  /leaderboard — Global rankings</div>
          <div>POST /negotiations/sessions — Create session</div>
          <div>POST /negotiations/sessions/:id/offers — Submit offer</div>
          <div>WS   /ws/negotiations/:sessionId — Real-time updates</div>
        </div>
      </section>

      {/* Quick Stats */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">System Stats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="DB Tables" value="57" />
          <Stat label="HFMI Observations" value="1,881" />
          <Stat label="API Routes" value="34+" />
          <Stat label="Tests" value="800+" />
          <Stat label="Skills" value="4" />
          <Stat label="Languages" value="7" />
          <Stat label="Migrations" value="13" />
          <Stat label="Platform Fee" value="1.5%" />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}
