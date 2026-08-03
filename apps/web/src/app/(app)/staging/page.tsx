"use client";

import { CheckCircle2, CircleEllipsis, FlaskConical, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

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

interface TestModeReadiness {
  settlement_asset: string;
  network: string;
  integration_manual: {
    ready: boolean;
    staging_husdc: boolean;
    test_api_key_configured: boolean;
    missing: string[];
  };
  physical_live: {
    ready: boolean;
    staging_husdc: boolean;
    live_shipping_enabled: boolean;
    live_api_key_configured: boolean;
    live_webhook_configured: boolean;
    live_label_max_minor: number;
    live_label_funding_source: "haggle_staging_fiat_subsidy";
    missing: string[];
  };
}

function TestModeCard({
  kind,
  ready,
  title,
  description,
  steps,
  missing = [],
}: {
  kind: "integration" | "physical";
  ready?: boolean;
  title: string;
  description: string;
  steps: string[];
  missing?: string[];
}) {
  const Icon = kind === "integration" ? FlaskConical : Truck;
  return (
    <div className="border border-line bg-surface-sunken/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-action-primary" aria-hidden="true" />
          <div>
            <h3 className="font-semibold text-ink">{title}</h3>
            <p className="mt-1 text-sm text-ink-secondary">{description}</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${ready === true ? "text-success" : "text-warning"}`}
        >
          {ready === undefined ? (
            <CircleEllipsis className="h-4 w-4" />
          ) : ready ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {ready === undefined ? "Checking" : ready ? "Ready" : "Setup needed"}
        </span>
      </div>
      <ol className="mt-4 space-y-2 text-sm text-ink-secondary">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2">
            <span className="font-mono text-xs text-ink-muted">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {missing.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs font-medium text-warning">Missing configuration</p>
          <p className="mt-1 text-xs text-ink-muted">{missing.join(" · ")}</p>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Link
          href="/orders"
          className="inline-flex h-9 items-center justify-center bg-ink px-3 text-sm font-medium text-surface"
        >
          Open orders
        </Link>
        <Link
          href="/sell/dashboard"
          className="inline-flex h-9 items-center justify-center border border-line px-3 text-sm font-medium text-ink"
        >
          Seller dashboard
        </Link>
      </div>
    </div>
  );
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
    num: "D0",
    title: "E2E Demo (Quick Start)",
    description: "Skip negotiation — start from payment and walk through shipping + dispute",
    href: "/demo/e2e",
    status: "ready",
    features: ["Mock X402 payment", "Shipment events", "Dispute flow", "Activity log"],
  },
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
  ready: { label: "Ready", color: "bg-success-soft text-success" },
  needs_data: { label: "Needs Data", color: "bg-warning-soft text-warning" },
  needs_deploy: { label: "Needs Deploy", color: "bg-error-soft text-error" },
};

function FlowCard({ step }: { step: FlowStep }) {
  const badge = STATUS_BADGE[step.status];
  return (
    <Link
      href={step.href}
      className="group block rounded-xl border border-line bg-surface-sunken/50 p-5 hover:border-line-strong transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xs font-mono text-ink-muted">{step.num}</span>
          <h3 className="text-base font-semibold text-ink group-hover:text-action-primary transition-colors">
            {step.title}
          </h3>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.color}`}>
          {badge.label}
        </span>
      </div>
      <p className="text-sm text-ink-secondary mb-3">{step.description}</p>
      <div className="flex flex-wrap gap-1">
        {step.features.map((f) => (
          <span
            key={f}
            className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-ink-muted"
          >
            {f}
          </span>
        ))}
      </div>
    </Link>
  );
}

export default function StagingPage() {
  const [readiness, setReadiness] = useState<TestModeReadiness | null>();

  useEffect(() => {
    api
      .get<TestModeReadiness>("/shipments/test-modes/readiness")
      .then(setReadiness)
      .catch(() => setReadiness(null));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-ink">Staging Hub</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Full Haggle flow — test everything end-to-end
        </p>
      </div>

      <section className="mb-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Fulfillment test cases</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Both cases use hUSDC on Base Sepolia. Live postage is paid separately from the Haggle
              staging fiat budget.
            </p>
          </div>
          <span className="text-xs text-ink-muted">hUSDC · Base Sepolia</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TestModeCard
            kind="integration"
            ready={readiness === null ? false : readiness?.integration_manual.ready}
            title="Integration test"
            description="EasyPost test label with delivery states controlled by the team."
            steps={[
              "Complete negotiation and fund the order with hUSDC.",
              "Seller selects Integration before requesting rates.",
              "Buy a test label, then advance carrier states from the order page.",
              "Finish buyer review, release, or open a dispute.",
            ]}
            missing={
              readiness === null
                ? ["Readiness endpoint unavailable"]
                : readiness?.integration_manual.missing
            }
          />
          <TestModeCard
            kind="physical"
            ready={readiness === null ? false : readiness?.physical_live.ready}
            title="Physical shipping rehearsal"
            description={`Real addresses, actual carrier scans, and Haggle-funded live postage capped at $${((readiness?.physical_live.live_label_max_minor ?? 5000) / 100).toFixed(2)}.`}
            steps={[
              "Complete negotiation and fund the order with hUSDC.",
              "Seller selects Physical shipping before requesting rates.",
              "Confirm the live label charge, print the label, and hand the parcel to the carrier.",
              "Wait for verified webhook delivery, then review, release, or dispute.",
            ]}
            missing={
              readiness === null
                ? ["Readiness endpoint unavailable"]
                : readiness?.physical_live.missing
            }
          />
        </div>
      </section>

      {/* Seller Flow */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
          <span className="rounded bg-action-primary/20 px-2 py-0.5 text-xs text-action-primary">
            Seller
          </span>
          Flow
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {SELLER_FLOW.map((s) => (
            <FlowCard key={s.num} step={s} />
          ))}
        </div>
      </section>

      {/* Buyer Flow */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
          <span className="rounded bg-info-soft px-2 py-0.5 text-xs text-info">Buyer</span>
          Flow
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {BUYER_FLOW.map((s) => (
            <FlowCard key={s.num} step={s} />
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
          <span className="rounded bg-info-soft px-2 py-0.5 text-xs text-info">Features</span>
          Common
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {COMMON_FEATURES.map((s) => (
            <FlowCard key={s.num} step={s} />
          ))}
        </div>
      </section>

      {/* Demo Pages */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
          <span className="rounded bg-warning-soft px-2 py-0.5 text-xs text-warning">Demo</span>
          Public Pages
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {DEMO_PAGES.map((s) => (
            <FlowCard key={s.num} step={s} />
          ))}
        </div>
      </section>

      {/* API Health */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-ink mb-4">API Endpoints</h2>
        <div className="rounded-xl border border-line bg-surface-sunken/50 p-5 font-mono text-xs space-y-1 text-ink-secondary">
          <div>GET /health — API health check</div>
          <div>GET /payments/onramp/status — Stripe onramp availability</div>
          <div>GET /hfmi/:model/median — Market price query</div>
          <div>GET /me/level — Agent level & XP</div>
          <div>GET /buddies — User's buddy list</div>
          <div>GET /leaderboard — Global rankings</div>
          <div>POST /negotiations/sessions — Create session</div>
          <div>POST /negotiations/sessions/:id/offers — Submit offer</div>
          <div>WS /ws/negotiations/:sessionId — Real-time updates</div>
        </div>
      </section>

      {/* Quick Stats */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-4">System Stats</h2>
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
    <div className="rounded-lg border border-line bg-surface-sunken/50 p-3 text-center">
      <div className="text-lg font-bold text-ink">{value}</div>
      <div className="text-[10px] text-ink-muted">{label}</div>
    </div>
  );
}
