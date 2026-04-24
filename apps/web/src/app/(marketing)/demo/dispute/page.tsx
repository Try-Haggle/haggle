"use client";

import Link from "next/link";
import { DisputeNav } from "./_components/dispute-nav";

const views = [
  {
    href: "/demo/dispute/buyer",
    label: "Buyer View",
    sub: "Dispute opener",
    description: "AI Advocate builds your case, evidence submission with on-chain anchoring, cost transparency, and case tracking timeline.",
    icon: "🛡",
    color: "cyan" as const,
    tier: "T1 · AI Review",
  },
  {
    href: "/demo/dispute/seller",
    label: "Seller View",
    sub: "Dispute responder",
    description: "48-hour response deadline, defense AI Advocate with EXIF analysis, counter-evidence upload, and deposit requirements.",
    icon: "⚔️",
    color: "violet" as const,
    tier: "T1 · AI Review",
  },
  {
    href: "/demo/dispute/disputes",
    label: "Disputes List",
    sub: "Inbox view",
    description: "All your disputes in one place — role tabs, status filters, stat cards, countdown timers, and on-chain anchoring badges.",
    icon: "📋",
    color: "amber" as const,
    tier: "All tiers",
  },
  {
    href: "/demo/dispute/reviewer-dashboard",
    label: "Reviewer Dashboard",
    sub: "DS profile & cases",
    description: "DS tier progression, earnings history, tag specializations, active/voted/decided case management, and qualification status.",
    icon: "👤",
    color: "emerald" as const,
    tier: "Reviewer",
  },
  {
    href: "/demo/dispute/reviewer",
    label: "Reviewer Vote",
    sub: "Individual case voting",
    description: "Evidence gallery, 0-100% vote slider, specialist verification, precedent cases, and post-decision reward view.",
    icon: "⚖️",
    color: "emerald" as const,
    tier: "T2 · Panel Review",
  },
];

const cm = {
  cyan:    { bg: "bg-[#ecfeff]", border: "border-[#cffafe]", text: "text-[#0891b2]", pill: "bg-[#ecfeff] text-[#0891b2] border-[#cffafe]", hover: "hover:border-[#0891b2]/40 hover:shadow-md" },
  violet:  { bg: "bg-[#f5f3ff]", border: "border-[#ede9fe]", text: "text-[#7c3aed]", pill: "bg-[#f5f3ff] text-[#7c3aed] border-[#ede9fe]", hover: "hover:border-[#7c3aed]/40 hover:shadow-md" },
  amber:   { bg: "bg-[#fef3c7]", border: "border-[#fde68a]", text: "text-[#b45309]", pill: "bg-[#fef3c7] text-[#b45309] border-[#fde68a]", hover: "hover:border-[#b45309]/40 hover:shadow-md" },
  emerald: { bg: "bg-[#ecfdf5]", border: "border-[#bbf7d0]", text: "text-[#059669]", pill: "bg-[#ecfdf5] text-[#059669] border-[#bbf7d0]", hover: "hover:border-[#059669]/40 hover:shadow-md" },
};

export default function DisputeDemoHub() {
  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#111113]">
      <DisputeNav />

      <main className="mx-auto max-w-[1180px] px-7 py-7">
        {/* Hero */}
        <div className="rounded-2xl border border-[#eae7df] bg-white p-8 shadow-sm mb-7">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#6b6b75] mb-3">
            Haggle Resolution Center · Demo
          </div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">
            3-Tier Dispute Resolution
          </h1>
          <p className="mt-3 text-[15px] text-[#3d3d45] max-w-2xl leading-relaxed">
            Explore how Haggle resolves disputes from every participant&apos;s perspective.
            Each view shows the same case <span className="font-mono text-[13px] text-[#6b6b75]">#DSP-2847</span> — an iPhone 14 Pro battery discrepancy dispute.
          </p>

          {/* Flow diagram */}
          <div className="mt-6 flex items-center gap-3 text-[12px] font-mono text-[#6b6b75]">
            <span className="rounded-md border border-[#cffafe] bg-[#ecfeff] px-2.5 py-1 text-[#0891b2] font-semibold">T1 · AI Arbiter</span>
            <span className="text-[#9a9aa3]">→</span>
            <span className="rounded-md border border-[#fde68a] bg-[#fef3c7] px-2.5 py-1 text-[#b45309] font-semibold">T2 · Community Panel</span>
            <span className="text-[#9a9aa3]">→</span>
            <span className="rounded-md border border-[#eae7df] bg-[#f0ede5] px-2.5 py-1 text-[#6b6b75] font-semibold">T3 · Grand Panel</span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 max-w-lg">
            <div className="rounded-lg border border-[#eae7df] bg-[#fbfaf7] p-3 text-center">
              <div className="text-[20px] font-bold font-mono">$3</div>
              <div className="text-[10px] text-[#6b6b75] mt-1">T1 cost</div>
            </div>
            <div className="rounded-lg border border-[#eae7df] bg-[#fbfaf7] p-3 text-center">
              <div className="text-[20px] font-bold font-mono">$12</div>
              <div className="text-[10px] text-[#6b6b75] mt-1">T2 cost</div>
            </div>
            <div className="rounded-lg border border-[#eae7df] bg-[#fbfaf7] p-3 text-center">
              <div className="text-[20px] font-bold font-mono">$30</div>
              <div className="text-[10px] text-[#6b6b75] mt-1">T3 cost</div>
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
            <div key={p.label} className="rounded-xl border border-[#eae7df] bg-white p-4 shadow-sm">
              <div className="text-[20px] mb-2">{p.icon}</div>
              <div className="text-[13px] font-semibold">{p.label}</div>
              <div className="text-[12px] text-[#6b6b75] mt-1">{p.desc}</div>
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
                className={`group rounded-xl border ${c.border} bg-white p-5 shadow-sm transition-all ${c.hover}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[24px]">{v.icon}</span>
                    <div>
                      <h2 className={`text-[15px] font-semibold ${c.text}`}>{v.label}</h2>
                      <div className="text-[11px] text-[#6b6b75]">{v.sub}</div>
                    </div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${c.pill}`}>
                    {v.tier}
                  </span>
                </div>
                <p className="text-[13px] text-[#3d3d45] leading-relaxed">
                  {v.description}
                </p>
                <div className={`mt-3 text-[12px] font-medium ${c.text} group-hover:underline`}>
                  Open view &rarr;
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footer */}
        <footer className="mt-10 pt-5 border-t border-[#eae7df] flex justify-between text-[12px] text-[#6b6b75] font-mono">
          <span>Haggle Resolution Center · Demo v2026.4</span>
          <Link href="/demo/developer" className="hover:text-[#111113] transition-colors">
            &larr; Back to developer demo
          </Link>
        </footer>
      </main>
    </div>
  );
}
