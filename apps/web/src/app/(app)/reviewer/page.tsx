"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────
interface ReviewerProfile {
  user_id: string;
  display_name: string;
  tier: string;
  stars: number;
  score: number;
  vote_weight: number;
  cases_reviewed: number;
  zone_hit_rate: number;
  participation_rate: number;
  avg_response_hours: number;
  active_slots: number;
  max_slots: number;
  qualified: boolean;
  qualified_at: string | null;
  next_tier: string | null;
  next_tier_score: number | null;
  earnings_7d: number;
  earnings_7d_cases: number;
  earnings_30d: number;
  earnings_30d_cases: number;
  earnings_all: number;
  earnings_all_cases: number;
  specializations: Specialization[];
  qualification: {
    transactions: number;
    trust_score: number;
    test_score: number | null;
  };
}

interface Specialization {
  tag: string;
  cases: number;
  hit_rate: number;
  score: number;
  tier: string;
  stars: number;
}

interface Assignment {
  id: string;
  dispute_id: string;
  status: "active" | "voted" | "decided";
  item_title: string | null;
  amount_minor: number | null;
  tier: string | null;
  deadline: string | null;
  reward_usdc: number | null;
  your_vote: number | null;
  in_majority: boolean | null;
  ds_impact: number | null;
  outcome_pct: number | null;
  outcome_label: string | null;
}

interface AssignmentsResponse {
  assignments: Assignment[];
  total: number;
}

// ─── Constants ───────────────────────────────────────────────
const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  BRONZE:   { bg: "bg-amber-900/30",   text: "text-amber-400",   border: "border-amber-500/30" },
  SILVER:   { bg: "bg-slate-600/30",    text: "text-slate-300",   border: "border-slate-500/30" },
  GOLD:     { bg: "bg-yellow-900/30",   text: "text-yellow-400",  border: "border-yellow-500/30" },
  PLATINUM: { bg: "bg-violet-900/30",   text: "text-violet-400",  border: "border-violet-500/30" },
  DIAMOND:  { bg: "bg-cyan-900/30",     text: "text-cyan-400",    border: "border-cyan-500/30" },
};

type CaseTab = "active" | "voted" | "decided";

function formatCurrency(minor: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
}

// ─── Main Page ───────────────────────────────────────────────
export default function ReviewerDashboardPage() {
  const [profile, setProfile] = useState<ReviewerProfile | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caseTab, setCaseTab] = useState<CaseTab>("active");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileData, assignmentsData] = await Promise.all([
        api.get<ReviewerProfile>("/reviewer/profile"),
        api.get<AssignmentsResponse>("/reviewer/assignments?status=all"),
      ]);
      setProfile(profileData);
      setAssignments(assignmentsData.assignments);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load reviewer data";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Loading state ──────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-center py-20">
          <div className="text-slate-400 text-sm animate-pulse">Loading reviewer dashboard...</div>
        </div>
      </main>
    );
  }

  // ─── Error / not qualified ──────────────────────────────
  if (error || !profile) {
    return (
      <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-5xl mx-auto">
        <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-12 text-center">
          <p className="text-slate-400 text-sm">{error ?? "Unable to load profile."}</p>
        </div>
      </main>
    );
  }

  // ─── Not qualified: show CTA ────────────────────────────
  if (!profile.qualified) {
    return (
      <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-10 text-center">
          <div className="text-5xl mb-4">&#x2696;&#xFE0F;</div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Become a Dispute Reviewer</h1>
          <p className="mt-3 text-slate-400 max-w-md mx-auto leading-relaxed">
            Earn USDC by reviewing disputes. Complete the qualification test to join the reviewer panel.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-4 max-w-sm mx-auto">
            <QualReqCard
              label="Transactions"
              value={`${profile.qualification.transactions}`}
              required="5+"
              met={profile.qualification.transactions >= 5}
            />
            <QualReqCard
              label="Trust Score"
              value={`${profile.qualification.trust_score}`}
              required="50+"
              met={profile.qualification.trust_score >= 50}
            />
            <QualReqCard
              label="Test Score"
              value={profile.qualification.test_score != null ? `${profile.qualification.test_score}%` : "N/A"}
              required="70%+"
              met={(profile.qualification.test_score ?? 0) >= 70}
            />
          </div>

          <Link
            href="/reviewer/qualify"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-600 transition-colors"
          >
            Take Qualification Test
          </Link>
        </div>
      </main>
    );
  }

  // ─── Qualified: full dashboard ──────────────────────────
  const tc = TIER_COLORS[profile.tier] ?? TIER_COLORS.BRONZE;

  const activeCases = assignments.filter((a) => a.status === "active");
  const votedCases = assignments.filter((a) => a.status === "voted");
  const decidedCases = assignments.filter((a) => a.status === "decided");

  const tabCases: Record<CaseTab, Assignment[]> = {
    active: activeCases,
    voted: votedCases,
    decided: decidedCases,
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Reviewer Dashboard</h1>
        <p className="text-sm text-slate-400 mt-0.5">Dispute Specialist Panel</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* LEFT column */}
        <div className="space-y-5">
          {/* Profile Card */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-cyan-500/30 to-violet-500/30 text-lg font-bold text-white">
                  {(profile.display_name ?? "R").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">{profile.display_name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${tc.bg} ${tc.text} ${tc.border}`}>
                      {"*".repeat(profile.stars)} {profile.tier}
                    </span>
                    <span className="font-mono text-xs text-slate-400">Score {profile.score}/100</span>
                    <span className="font-mono text-xs text-slate-400">Weight {profile.vote_weight}x</span>
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-400">
                Qualified
              </span>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox label="Cases reviewed" value={String(profile.cases_reviewed)} />
              <StatBox label="Zone hit rate" value={`${Math.round(profile.zone_hit_rate * 100)}%`} accent />
              <StatBox label="Participation" value={`${Math.round(profile.participation_rate * 100)}%`} />
              <StatBox label="Avg response" value={`${profile.avg_response_hours}h`} />
            </div>

            {/* Tier progress */}
            {profile.next_tier && profile.next_tier_score && (
              <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-400">
                    Progress to <span className="font-semibold text-violet-400">{profile.next_tier}</span>
                  </span>
                  <span className="font-mono font-semibold text-white">{profile.score} / {profile.next_tier_score}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-violet-500"
                    style={{ width: `${Math.min(100, (profile.score / profile.next_tier_score) * 100)}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  {profile.next_tier_score - profile.score} more points needed
                </div>
              </div>
            )}
          </section>

          {/* Case Tabs */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <h2 className="text-sm font-semibold text-white">My Reviews</h2>
              <div className="inline-flex gap-0.5 rounded-lg border border-slate-700 bg-slate-900/50 p-[3px]">
                {(["active", "voted", "decided"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setCaseTab(tab)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      caseTab === tab
                        ? "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-white"
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
              {tabCases[caseTab].length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  {caseTab === "active" ? "No active reviews" : caseTab === "voted" ? "No pending results" : "No past decisions"}
                </div>
              ) : (
                <div className="space-y-3">
                  {tabCases[caseTab].map((assignment) => (
                    <AssignmentRow key={assignment.id} assignment={assignment} />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Specializations */}
          {profile.specializations.length > 0 && (
            <section className="rounded-xl border border-slate-700 bg-slate-800/50">
              <div className="border-b border-slate-700 px-5 py-4">
                <h2 className="text-sm font-semibold text-white">Tag Specializations</h2>
              </div>
              <div className="p-5 space-y-3">
                {profile.specializations.map((s) => {
                  const stc = TIER_COLORS[s.tier] ?? TIER_COLORS.BRONZE;
                  return (
                    <div key={s.tag} className="flex items-center gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{s.tag}</span>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stc.bg} ${stc.text} ${stc.border}`}>
                            {"*".repeat(s.stars)} {s.tier}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {s.cases} cases · {Math.round(s.hit_rate * 100)}% hit rate · score {s.score}
                        </div>
                      </div>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                          style={{ width: `${s.hit_rate * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT sidebar */}
        <aside className="sticky top-[60px] space-y-4">
          {/* Slot status */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 mb-3">Active Slots</div>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="font-mono text-3xl font-bold text-white">{profile.active_slots}</span>
              <span className="text-sm text-slate-400">/ {profile.max_slots} used</span>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: profile.max_slots }, (_, i) => (
                <div
                  key={i}
                  className={`h-3 flex-1 rounded-full ${i < profile.active_slots ? "bg-cyan-500" : "bg-slate-700"}`}
                />
              ))}
            </div>
            <div className="mt-3 text-[11px] text-slate-500">
              {profile.max_slots - profile.active_slots} slot{profile.max_slots - profile.active_slots !== 1 ? "s" : ""} available
            </div>
          </section>

          {/* Earnings */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 mb-3">Earnings</div>
            <div className="space-y-2.5">
              <EarningRow label="Last 7 days" amount={profile.earnings_7d} cases={profile.earnings_7d_cases} />
              <EarningRow label="Last 30 days" amount={profile.earnings_30d} cases={profile.earnings_30d_cases} />
              <div className="my-2 h-px bg-slate-700" />
              <EarningRow label="All time" amount={profile.earnings_all} cases={profile.earnings_all_cases} bold />
            </div>
          </section>

          {/* Qualification */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 mb-3">Qualification</div>
            <div className="space-y-2">
              <QualRow label="Transactions" value={`${profile.qualification.transactions} completed`} pass={profile.qualification.transactions >= 5} />
              <QualRow label="Trust Score" value={`${profile.qualification.trust_score}`} pass={profile.qualification.trust_score >= 50} />
              <QualRow
                label="Qualify Test"
                value={profile.qualification.test_score != null ? `${profile.qualification.test_score}% (passed)` : "N/A"}
                pass={(profile.qualification.test_score ?? 0) >= 70}
              />
              {profile.qualified_at && (
                <QualRow label="Qualified since" value={new Date(profile.qualified_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
              )}
            </div>
          </section>

          {/* Quick actions */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 mb-3">Quick Actions</div>
            <div className="space-y-2">
              {activeCases.length > 0 && (
                <Link
                  href={`/reviewer/cases/${activeCases[0].dispute_id}`}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-white hover:border-cyan-500/50 transition-all"
                >
                  Vote on active case
                </Link>
              )}
              <Link
                href="/reviewer/qualify"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-slate-400 hover:border-slate-600 hover:text-white transition-all"
              >
                Retake qualification test
              </Link>
            </div>
          </section>

          {/* Tier info */}
          <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <div className="text-[11px] text-slate-500 leading-relaxed">
              <strong className="text-slate-300">DS Tiers.</strong> Your Dispute Specialist score (0-100) determines tier, vote weight, and assignment priority. Higher tiers = more influence + higher priority. Minority votes reduce your score.
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1 text-center font-mono text-[9px]">
              {(["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"] as const).map((t) => {
                const tc2 = TIER_COLORS[t];
                const active = t === profile.tier;
                return (
                  <div
                    key={t}
                    className={`rounded-md border p-1.5 ${
                      active
                        ? `${tc2.bg} ${tc2.border} ${tc2.text} font-bold`
                        : "border-slate-700 text-slate-600"
                    }`}
                  >
                    {t.slice(0, 3)}
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
      <div className={`font-mono text-xl font-bold tracking-tight ${accent ? "text-emerald-400" : "text-white"}`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function AssignmentRow({ assignment }: { assignment: Assignment }) {
  const a = assignment;
  const href = a.status === "active"
    ? `/reviewer/cases/${a.dispute_id}`
    : a.status === "voted"
      ? `/reviewer/cases/${a.dispute_id}`
      : undefined;

  const content = (
    <div
      className={`flex items-center gap-4 rounded-xl border p-4 transition-all ${
        a.status === "active"
          ? "border-cyan-500/30 bg-cyan-500/5 hover:border-cyan-500/50"
          : "border-slate-700 bg-slate-900/50 hover:border-slate-600"
      } ${href ? "cursor-pointer hover:-translate-y-px" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white truncate">
            {a.item_title ?? "Dispute Case"}
          </span>
          {a.tier && (
            <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-400">
              {a.tier}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
          <span className="font-mono">{a.dispute_id.slice(0, 12)}...</span>
          {a.status === "active" && a.deadline && (
            <>
              <span className="h-[3px] w-[3px] rounded-full bg-slate-600" />
              <span className="text-amber-400 font-medium">
                Ends {new Date(a.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </>
          )}
          {a.status === "voted" && (
            <>
              <span className="h-[3px] w-[3px] rounded-full bg-slate-600" />
              <span>Awaiting results</span>
            </>
          )}
          {a.status === "decided" && a.outcome_label && (
            <>
              <span className="h-[3px] w-[3px] rounded-full bg-slate-600" />
              <span>{a.outcome_label}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {a.amount_minor != null && (
          <span className="font-mono text-sm font-semibold text-white">{formatCurrency(a.amount_minor)}</span>
        )}
        {a.status === "active" && (
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-400">
            Vote now
          </span>
        )}
        {a.status === "voted" && (
          <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-400">
            Sealed
          </span>
        )}
        {a.status === "decided" && (
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
              a.in_majority
                ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                : "border-red-500/30 bg-red-500/20 text-red-400"
            }`}
          >
            {a.in_majority ? "+" : ""}{a.reward_usdc != null ? `$${a.reward_usdc.toFixed(2)}` : "$0.00"}
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }

  // Decided cases show result inline (no navigation needed, but make clickable for detail)
  return (
    <Link href={`/reviewer/cases/${a.dispute_id}`} className="block">
      {content}
    </Link>
  );
}

function EarningRow({ label, amount, cases, bold }: { label: string; amount: number; cases: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${bold ? "font-semibold text-white" : "text-slate-400"}`}>{label}</span>
      <div className="text-right">
        <span className={`font-mono text-sm ${bold ? "font-bold" : "font-semibold"} text-emerald-400`}>
          ${amount.toFixed(2)}
        </span>
        <span className="ml-2 font-mono text-[11px] text-slate-600">{cases} cases</span>
      </div>
    </div>
  );
}

function QualRow({ label, value, pass }: { label: string; value: string; pass?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="flex items-center gap-1.5 font-medium text-white">
        {pass && <span className="text-emerald-400">&#10003;</span>}
        {value}
      </span>
    </div>
  );
}

function QualReqCard({ label, value, required, met }: { label: string; value: string; required: string; met: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${met ? "border-emerald-500/30 bg-emerald-500/10" : "border-slate-700 bg-slate-800/50"}`}>
      <div className={`font-mono text-xl font-bold ${met ? "text-emerald-400" : "text-white"}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{label}</div>
      <div className="text-[10px] text-slate-600 mt-0.5">req: {required}</div>
    </div>
  );
}
