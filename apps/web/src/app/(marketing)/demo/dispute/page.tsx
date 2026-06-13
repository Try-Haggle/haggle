"use client";

import Link from "next/link";
import { DisputeNav } from "./_components/dispute-nav";

const views = [
  {
    href: "/demo/dispute/buyer",
    label: "Buyer View",
    sub: "Dispute opener",
    description:
      "AI Advocate builds your case, evidence submission with on-chain anchoring, cost transparency, and case tracking timeline.",
    icon: "🛡",
    color: "cyan" as const,
    tier: "T1 · AI Review",
  },
  {
    href: "/demo/dispute/seller",
    label: "Seller View",
    sub: "Dispute responder",
    description:
      "48-hour response deadline, defense AI Advocate with EXIF analysis, counter-evidence upload, and deposit requirements.",
    icon: "⚔️",
    color: "violet" as const,
    tier: "T1 · AI Review",
  },
  {
    href: "/demo/dispute/disputes",
    label: "Disputes List",
    sub: "Inbox view",
    description:
      "All your disputes in one place — role tabs, status filters, stat cards, countdown timers, and on-chain anchoring badges.",
    icon: "📋",
    color: "amber" as const,
    tier: "All tiers",
  },
  {
    href: "/demo/dispute/reviewer-dashboard",
    label: "Reviewer Dashboard",
    sub: "DS profile & cases",
    description:
      "DS tier progression, earnings history, tag specializations, active/voted/decided case management, and qualification status.",
    icon: "👤",
    color: "emerald" as const,
    tier: "Reviewer",
  },
  {
    href: "/demo/dispute/reviewer",
    label: "Reviewer Vote",
    sub: "Individual case voting",
    description:
      "Evidence gallery, 0-100% vote slider, specialist verification, precedent cases, and post-decision reward view.",
    icon: "⚖️",
    color: "emerald" as const,
    tier: "T2 · Panel Review",
  },
];

const cm = {
  cyan: {
    bg: "bg-info-soft",
    border: "border-info/30",
    text: "text-info",
    pill: "bg-info-soft text-info border-info/30",
    hover: "hover:border-info/40 hover:shadow-md",
  },
  violet: {
    bg: "bg-badge",
    border: "border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)]",
    text: "text-badge-text",
    pill: "bg-badge text-badge-text border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)]",
    hover: "hover:border-[color-mix(in_srgb,var(--badge-text)_40%,transparent)] hover:shadow-md",
  },
  amber: {
    bg: "bg-warning-soft",
    border: "border-warning/30",
    text: "text-warning",
    pill: "bg-warning-soft text-warning border-warning/30",
    hover: "hover:border-warning/40 hover:shadow-md",
  },
  emerald: {
    bg: "bg-success-soft",
    border: "border-success/30",
    text: "text-success",
    pill: "bg-success-soft text-success border-success/30",
    hover: "hover:border-success/40 hover:shadow-md",
  },
};

export default function DisputeDemoHub() {
  return (
    <div className="min-h-screen bg-surface text-ink">
      <DisputeNav />

      <main className="mx-auto max-w-[1180px] px-7 py-7">
        {/* Hero */}
        <div className="rounded-2xl border border-line bg-surface-raised p-8 shadow-sm mb-7">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted mb-3">
            Haggle Resolution Center · Demo
          </div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">
            3-Tier Dispute Resolution
          </h1>
          <p className="mt-3 text-[15px] text-ink-secondary max-w-2xl leading-relaxed">
            Explore how Haggle resolves disputes from every participant&apos;s perspective. Each
            view shows the same case{" "}
            <span className="font-mono text-[13px] text-ink-muted">#DSP-2847</span> — an iPhone 14
            Pro battery discrepancy dispute.
          </p>

          {/* Flow diagram */}
          <div className="mt-6 flex items-center gap-3 text-[12px] font-mono text-ink-muted">
            <span className="rounded-md border border-info/30 bg-info-soft px-2.5 py-1 text-info font-semibold">
              T1 · AI Arbiter
            </span>
            <span className="text-ink-muted">→</span>
            <span className="rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1 text-warning font-semibold">
              T2 · Community Panel
            </span>
            <span className="text-ink-muted">→</span>
            <span className="rounded-md border border-line bg-surface-sunken px-2.5 py-1 text-ink-muted font-semibold">
              T3 · Grand Panel
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 max-w-lg">
            <div className="rounded-lg border border-line bg-surface-sunken p-3 text-center">
              <div className="text-[20px] font-bold font-mono">$3</div>
              <div className="text-[10px] text-ink-muted mt-1">T1 cost</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-sunken p-3 text-center">
              <div className="text-[20px] font-bold font-mono">$12</div>
              <div className="text-[10px] text-ink-muted mt-1">T2 cost</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-sunken p-3 text-center">
              <div className="text-[20px] font-bold font-mono">$30</div>
              <div className="text-[10px] text-ink-muted mt-1">T3 cost</div>
            </div>
          </div>
        </div>

        {/* Principles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
          {[
            { icon: "⚖️", label: "Loser pays", desc: "Deters frivolous disputes" },
            { icon: "🛡", label: "Both sides get AI", desc: "Fair advocacy for buyer & seller" },
            { icon: "⛓", label: "On-chain evidence", desc: "Tamper-proof records" },
            { icon: "👥", label: "Community decides", desc: "Qualified reviewers vote" },
          ].map((p) => (
            <div
              key={p.label}
              className="rounded-xl border border-line bg-surface-raised p-4 shadow-sm"
            >
              <div className="text-[20px] mb-2">{p.icon}</div>
              <div className="text-[13px] font-semibold">{p.label}</div>
              <div className="text-[12px] text-ink-muted mt-1">{p.desc}</div>
            </div>
          ))}
        </div>

        {/* View cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {views.map((v) => {
            const c = cm[v.color];
            return (
              <Link
                key={v.href}
                href={v.href}
                className={`group rounded-xl border ${c.border} bg-surface-raised p-5 shadow-sm transition-all ${c.hover}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[24px]">{v.icon}</span>
                    <div>
                      <h2 className={`text-[15px] font-semibold ${c.text}`}>{v.label}</h2>
                      <div className="text-[11px] text-ink-muted">{v.sub}</div>
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${c.pill}`}
                  >
                    {v.tier}
                  </span>
                </div>
                <p className="text-[13px] text-ink-secondary leading-relaxed">{v.description}</p>
                <div className={`mt-3 text-[12px] font-medium ${c.text} group-hover:underline`}>
                  Open view &rarr;
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footer */}
        <footer className="mt-10 pt-5 border-t border-line flex justify-between text-[12px] text-ink-muted font-mono">
          <span>Haggle Resolution Center · Demo v2026.4</span>
          <Link href="/demo/developer" className="hover:text-ink transition-colors">
            &larr; Back to developer demo
          </Link>
        </footer>
      </main>
    </div>
  );
}
