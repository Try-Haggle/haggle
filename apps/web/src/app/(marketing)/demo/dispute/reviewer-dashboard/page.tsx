"use client";

import Link from "next/link";
import { useState } from "react";
import { DisputeNav } from "../_components/dispute-nav";

/* ── Static Data ──────────────────────── */

const profile = {
  name: "Alex Kim",
  initials: "AK",
  tier: "GOLD" as const,
  stars: 3,
  score: 67,
  voteWeight: 1.1,
  casesReviewed: 43,
  zoneHitRate: 0.78,
  participationRate: 0.92,
  avgResponseHours: 6.2,
  activeSlots: 1,
  maxSlots: 3,
  qualified: true,
  qualifiedAt: "Mar 12, 2026",
  nextTier: "PLATINUM" as const,
  nextTierScore: 71,
};

const earnings = {
  last7d: { amount: 18.6, cases: 4 },
  last30d: { amount: 62.4, cases: 14 },
  allTime: { amount: 186.2, cases: 43 },
};

const specializations = [
  {
    tag: "Electronics",
    emoji: "📱",
    cases: 22,
    hitRate: 0.89,
    score: 82,
    tier: "PLATINUM" as const,
    stars: 4,
  },
  {
    tag: "Luxury Goods",
    emoji: "👜",
    cases: 11,
    hitRate: 0.71,
    score: 58,
    tier: "GOLD" as const,
    stars: 3,
  },
  {
    tag: "Sneakers",
    emoji: "👟",
    cases: 7,
    hitRate: 0.82,
    score: 44,
    tier: "SILVER" as const,
    stars: 2,
  },
];

type CaseStatus = "voting" | "voted" | "decided";

interface ReviewCase {
  id: string;
  caseId: string;
  item: string;
  emoji: string;
  amount: string;
  tier: string;
  status: CaseStatus;
  deadline?: string;
  remaining?: string;
  reward?: string;
  outcome?: string;
  yourVote?: number;
  inMajority?: boolean;
  dsImpact?: string;
}

const activeCases: ReviewCase[] = [
  {
    id: "1",
    caseId: "#DSP-2847",
    item: "iPhone 14 Pro 128GB",
    emoji: "📱",
    amount: "$500.00",
    tier: "T2",
    status: "voting",
    deadline: "Apr 22 · 14:32 UTC",
    remaining: "36h remaining",
  },
];

const votedCases: ReviewCase[] = [
  {
    id: "2",
    caseId: "#DSP-2839",
    item: "Galaxy S23 Ultra",
    emoji: "📱",
    amount: "$720.00",
    tier: "T2",
    status: "voted",
    deadline: "Apr 23 · 09:00 UTC",
    remaining: "Awaiting results",
  },
];

const decidedCases: ReviewCase[] = [
  {
    id: "3",
    caseId: "#DSP-2821",
    item: "Louis Vuitton Neverfull MM",
    emoji: "👜",
    amount: "$450.00",
    tier: "T2",
    status: "decided",
    reward: "+$2.80",
    outcome: "Buyer favor · 78%",
    yourVote: 82,
    inMajority: true,
    dsImpact: "+0.8",
  },
  {
    id: "4",
    caseId: "#DSP-2802",
    item: "Nike Dunk Low",
    emoji: "👟",
    amount: "$130.00",
    tier: "T2",
    status: "decided",
    reward: "$0.00",
    outcome: "Seller favor · 35%",
    yourVote: 60,
    inMajority: false,
    dsImpact: "-0.5",
  },
  {
    id: "5",
    caseId: "#DSP-2798",
    item: "iPad Mini 6",
    emoji: "📱",
    amount: "$340.00",
    tier: "T2",
    status: "decided",
    reward: "+$2.80",
    outcome: "Partial · 55%",
    yourVote: 50,
    inMajority: true,
    dsImpact: "+0.6",
  },
];

const tierColors: Record<string, { bg: string; text: string; border: string }> = {
  BRONZE: { bg: "bg-warning-soft", text: "text-warning", border: "border-warning/30" },
  SILVER: { bg: "bg-surface-sunken", text: "text-ink-secondary", border: "border-line" },
  GOLD: { bg: "bg-warning-soft", text: "text-warning", border: "border-warning/30" },
  PLATINUM: {
    bg: "bg-badge",
    text: "text-badge-text",
    border: "border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)]",
  },
  DIAMOND: { bg: "bg-info-soft", text: "text-info", border: "border-info/30" },
};

/* ── Component ────────────────────────── */

export default function ReviewerDashboardPage() {
  const [caseTab, setCaseTab] = useState<"active" | "voted" | "decided">("active");
  const tc = tierColors[profile.tier];

  return (
    <div className="min-h-screen bg-surface text-ink">
      <DisputeNav />

      <main className="mx-auto max-w-[1280px] px-7 py-7">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-2 font-mono text-[12px] text-ink-muted">
          <Link href="/demo/dispute" className="hover:text-ink">
            Resolution Center
          </Link>
          <span className="text-ink-muted">/</span>
          <span>Reviewer Dashboard</span>
        </div>

        <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* LEFT column */}
          <div className="space-y-5">
            {/* Profile Card */}
            <section className="rounded-[14px] border border-line bg-surface-raised p-6 shadow-sm">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-4">
                  <div
                    className="grid h-14 w-14 place-items-center rounded-full text-[20px] font-bold"
                    style={{ background: "var(--bg-sunken)", color: "var(--text-primary)" }}
                  >
                    {profile.initials}
                  </div>
                  <div>
                    <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{profile.name}</h1>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${tc.bg} ${tc.text} ${tc.border}`}
                      >
                        {"⭐".repeat(profile.stars)} {profile.tier}
                      </span>
                      <span className="font-mono text-[12px] text-ink-muted">
                        Score {profile.score}/100
                      </span>
                      <span className="font-mono text-[12px] text-ink-muted">
                        · Weight {profile.voteWeight}x
                      </span>
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft px-2.5 py-1 font-mono text-[10px] font-semibold text-success">
                  ✓ Qualified
                </span>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatBox label="Cases reviewed" value={String(profile.casesReviewed)} />
                <StatBox
                  label="Zone hit rate"
                  value={`${Math.round(profile.zoneHitRate * 100)}%`}
                  valueColor="var(--fb-success-fg)"
                />
                <StatBox
                  label="Participation"
                  value={`${Math.round(profile.participationRate * 100)}%`}
                />
                <StatBox label="Avg response" value={`${profile.avgResponseHours}h`} />
              </div>

              {/* Tier progress */}
              <div className="mt-5 rounded-xl border border-line bg-surface-sunken p-4">
                <div className="flex items-center justify-between text-[12px] mb-2">
                  <span className="text-ink-muted">
                    Progress to{" "}
                    <span className="font-semibold text-badge-text">{profile.nextTier}</span>
                  </span>
                  <span className="font-mono font-semibold">
                    {profile.score} / {profile.nextTierScore}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line-subtle">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-warning to-badge-text"
                    style={{ width: `${(profile.score / profile.nextTierScore) * 100}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-ink-muted">
                  {profile.nextTierScore - profile.score} more points needed · vote weight rises to
                  1.45x
                </div>
              </div>
            </section>

            {/* Case Tabs */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="text-[14px] font-semibold">My Reviews</h2>
                <div className="inline-flex gap-0.5 rounded-[10px] border border-line bg-surface-sunken p-[3px]">
                  {(["active", "voted", "decided"] as const).map((tab) => (
                    <button
                      type="button"
                      key={tab}
                      onClick={() => setCaseTab(tab)}
                      className={`rounded-[7px] px-3 py-[6px] text-[13px] font-medium transition-all ${
                        caseTab === tab
                          ? "bg-surface-raised text-ink shadow-sm"
                          : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {tab === "active"
                        ? `Active (${activeCases.length})`
                        : tab === "voted"
                          ? `Voted (${votedCases.length})`
                          : `Decided (${decidedCases.length})`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-5">
                {caseTab === "active" && (
                  <div className="space-y-3">
                    {activeCases.map((c) => (
                      <Link key={c.id} href="/demo/dispute/reviewer" className="block">
                        <CaseRow c={c} />
                      </Link>
                    ))}
                    {activeCases.length === 0 && <Empty text="No active reviews" />}
                  </div>
                )}
                {caseTab === "voted" && (
                  <div className="space-y-3">
                    {votedCases.map((c) => (
                      <Link key={c.id} href="/demo/dispute/reviewer" className="block">
                        <CaseRow c={c} />
                      </Link>
                    ))}
                    {votedCases.length === 0 && <Empty text="No pending results" />}
                  </div>
                )}
                {caseTab === "decided" && (
                  <div className="space-y-3">
                    {decidedCases.map((c) => (
                      <Link key={c.id} href="/demo/dispute/reviewer" className="block">
                        <CaseRow c={c} />
                      </Link>
                    ))}
                    {decidedCases.length === 0 && <Empty text="No past decisions" />}
                  </div>
                )}
              </div>
            </section>

            {/* Specializations */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="border-b border-line px-5 py-4">
                <h2 className="text-[14px] font-semibold">Tag Specializations</h2>
              </div>
              <div className="p-5 space-y-3">
                {specializations.map((s) => {
                  const stc = tierColors[s.tier];
                  return (
                    <div
                      key={s.tag}
                      className="flex items-center gap-4 rounded-xl border border-line bg-surface-sunken p-4"
                    >
                      <span className="text-[24px]">{s.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold">{s.tag}</span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stc.bg} ${stc.text} ${stc.border}`}
                          >
                            {"⭐".repeat(s.stars)} {s.tier}
                          </span>
                        </div>
                        <div className="text-[12px] text-ink-muted mt-1">
                          {s.cases} cases · {Math.round(s.hitRate * 100)}% hit rate · score{" "}
                          {s.score}
                        </div>
                      </div>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line-subtle">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-info to-success"
                          style={{ width: `${s.hitRate * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* RIGHT sidebar */}
          <aside className="sticky top-[60px] space-y-4">
            {/* Slot status */}
            <section className="rounded-[14px] border border-line bg-surface-raised p-5 shadow-sm">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-3">
                Active Slots
              </div>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="font-mono text-[32px] font-bold">{profile.activeSlots}</span>
                <span className="text-[14px] text-ink-muted">/ {profile.maxSlots} used</span>
              </div>
              <div className="flex gap-2">
                {Array.from({ length: profile.maxSlots }, (_, i) => `slot-${i}`).map(
                  (slotKey, i) => (
                    <div
                      key={slotKey}
                      className={`h-3 flex-1 rounded-full ${i < profile.activeSlots ? "bg-info" : "bg-line-subtle"}`}
                    />
                  ),
                )}
              </div>
              <div className="mt-3 text-[11px] text-ink-muted">
                {profile.maxSlots - profile.activeSlots} slot
                {profile.maxSlots - profile.activeSlots !== 1 ? "s" : ""} available for new
                assignments
              </div>
            </section>

            {/* Earnings */}
            <section className="rounded-[14px] border border-line bg-surface-raised p-5 shadow-sm">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-3">
                Earnings
              </div>
              <div className="space-y-2.5">
                <EarningRow
                  label="Last 7 days"
                  amount={earnings.last7d.amount}
                  cases={earnings.last7d.cases}
                />
                <EarningRow
                  label="Last 30 days"
                  amount={earnings.last30d.amount}
                  cases={earnings.last30d.cases}
                />
                <div className="my-2 h-px bg-line" />
                <EarningRow
                  label="All time"
                  amount={earnings.allTime.amount}
                  cases={earnings.allTime.cases}
                  bold
                />
              </div>
            </section>

            {/* Qualification */}
            <section className="rounded-[14px] border border-line bg-surface-raised p-5 shadow-sm">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-3">
                Qualification
              </div>
              <div className="space-y-2">
                <QualRow label="Transactions" value="47 completed" pass />
                <QualRow label="Trust Score" value="88" pass />
                <QualRow label="Qualify Test" value="80% (passed)" pass />
                <QualRow label="Qualified since" value={profile.qualifiedAt} />
              </div>
            </section>

            {/* Quick actions */}
            <section className="rounded-[14px] border border-line bg-surface-raised p-5 shadow-sm">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-3">
                Quick Actions
              </div>
              <div className="space-y-2">
                <Link
                  href="/demo/dispute/reviewer"
                  className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-surface-raised px-4 py-2.5 text-[14px] font-medium hover:border-ink hover:bg-surface-sunken transition-all"
                >
                  Vote on active case →
                </Link>
                <Link
                  href="/demo/dispute/reviewer-qualify"
                  className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-surface-raised px-4 py-2.5 text-[14px] font-medium text-ink-muted hover:border-ink hover:text-ink transition-all"
                >
                  Retake qualification test
                </Link>
              </div>
            </section>

            {/* DS tier info */}
            <section className="rounded-[14px] border border-line bg-surface-sunken p-4">
              <div className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink">DS Tiers explained.</strong> Your Dispute Specialist
                score (0-100) determines your tier, vote weight, and assignment probability. Higher
                tiers = more influence per vote + higher priority for assignments. Accuracy matters
                — minority votes reduce your score proportional to your vote weight.
              </div>
              <div className="mt-3 grid grid-cols-5 gap-1 text-center font-mono text-[9px]">
                {(["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"] as const).map((t) => {
                  const tc2 = tierColors[t];
                  const active = t === profile.tier;
                  return (
                    <div
                      key={t}
                      className={`rounded-md border p-1.5 ${active ? `${tc2.bg} ${tc2.border} ${tc2.text} font-bold` : "border-line text-ink-muted"}`}
                    >
                      {t.slice(0, 3)}
                    </div>
                  );
                })}
              </div>
            </section>
          </aside>
        </div>

        {/* Footer */}
        <footer className="mt-10 pt-5 border-t border-line flex justify-between text-[12px] text-ink-muted font-mono">
          <span>Haggle Resolution Center · Reviewer Dashboard</span>
          <Link href="/demo/dispute" className="hover:text-ink transition-colors">
            &larr; Back to overview
          </Link>
        </footer>
      </main>
    </div>
  );
}

/* ── Sub-components ──────────────────── */

function StatBox({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken p-3">
      <div
        className="font-mono text-[22px] font-bold tracking-[-0.02em]"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      <div className="text-[11px] text-ink-muted mt-1">{label}</div>
    </div>
  );
}

function CaseRow({ c }: { c: ReviewCase }) {
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border p-4 transition-all hover:shadow-sm hover:-translate-y-px cursor-pointer ${
        c.status === "voting"
          ? "border-info/30 bg-gradient-to-r from-info-soft to-surface-raised"
          : c.status === "voted"
            ? "border-line bg-surface-raised"
            : "border-line bg-surface-raised"
      }`}
    >
      {/* Thumb */}
      <div
        className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl border border-line text-[20px]"
        style={{
          background:
            "repeating-linear-gradient(45deg, var(--bg-sunken), var(--bg-sunken) 6px, var(--bg-sunken) 6px, var(--bg-sunken) 12px)",
        }}
      >
        {c.emoji}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold truncate">{c.item}</span>
          <span className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[9px] font-bold text-ink-muted">
            {c.tier}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-muted">
          <span className="font-mono">{c.caseId}</span>
          {c.status === "voting" && (
            <>
              <span className="h-[3px] w-[3px] rounded-full bg-ink-muted" />
              <span className="text-warning font-medium">{c.remaining}</span>
            </>
          )}
          {c.status === "voted" && (
            <>
              <span className="h-[3px] w-[3px] rounded-full bg-ink-muted" />
              <span>{c.remaining}</span>
            </>
          )}
          {c.status === "decided" && c.outcome && (
            <>
              <span className="h-[3px] w-[3px] rounded-full bg-ink-muted" />
              <span>{c.outcome}</span>
            </>
          )}
        </div>
      </div>

      {/* Right */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="font-mono text-[15px] font-semibold">{c.amount}</span>
        {c.status === "voting" && (
          <span className="rounded-full border border-info/30 bg-info-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-info">
            Vote now
          </span>
        )}
        {c.status === "voted" && (
          <span className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-muted">
            Sealed
          </span>
        )}
        {c.status === "decided" && (
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
              c.inMajority
                ? "border-success/30 bg-success-soft text-success"
                : "border-error/30 bg-error-soft text-error"
            }`}
          >
            {c.inMajority ? `✓ ${c.reward}` : `✗ ${c.reward}`}
          </span>
        )}
      </div>
    </div>
  );
}

function EarningRow({
  label,
  amount,
  cases,
  bold,
}: {
  label: string;
  amount: number;
  cases: number;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[13px] ${bold ? "font-semibold text-ink" : "text-ink-muted"}`}>
        {label}
      </span>
      <div className="text-right">
        <span
          className={`font-mono text-[14px] ${bold ? "font-bold" : "font-semibold"} text-success`}
        >
          ${amount.toFixed(2)}
        </span>
        <span className="ml-2 font-mono text-[11px] text-ink-muted">{cases} cases</span>
      </div>
    </div>
  );
}

function QualRow({ label, value, pass }: { label: string; value: string; pass?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-ink-muted">{label}</span>
      <span className="flex items-center gap-1.5 font-medium">
        {pass && <span className="text-success">✓</span>}
        {value}
      </span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-10 text-center text-[13px] text-ink-muted">{text}</div>;
}
