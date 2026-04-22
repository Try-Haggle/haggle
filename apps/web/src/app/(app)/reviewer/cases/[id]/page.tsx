"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────
interface CaseDetail {
  dispute_id: string;
  assignment_id: string;
  status: "active" | "voted" | "decided";
  item_title: string;
  amount_minor: number;
  currency: string;
  reason_code: string;
  tier: string;
  opened_at: string;
  deadline: string | null;
  estimated_reward_usdc: number;
  slot_usage: string;
  briefing: {
    summary: string;
    buyer_position: string;
    seller_position: string;
    core_question: string;
  };
  evidence: {
    buyer: EvidenceItem[];
    seller: EvidenceItem[];
  };
  specialist_verification: {
    provider: string;
    summary: string;
    confidence: number;
    disclaimer: string;
  } | null;
  precedents: Precedent[];
  // Vote data (if voted)
  your_vote: number | null;
  your_reasoning: string | null;
  submitted_at: string | null;
  // Panel progress (if voted or decided)
  panel_voted: number | null;
  panel_total: number | null;
  your_reviewer_number: number | null;
  // Decision data (if decided)
  outcome_pct: number | null;
  outcome_label: string | null;
  panel_agreement_pct: number | null;
  in_majority: boolean | null;
  reward_usdc: number | null;
  ds_impact: number | null;
  vote_distribution: VotePoint[] | null;
  agreement_zone: { min: number; max: number } | null;
  peer_reasoning: PeerReasoning[] | null;
  settlement_hash: string | null;
}

interface EvidenceItem {
  id: string;
  type: string;
  description: string;
  submitted_at: string;
  hash: string;
  view_url: string | null;
  is_text: boolean;
  content: string | null;
}

interface Precedent {
  case_id: string;
  description: string;
  outcome: string;
  outcome_color: "buyer" | "seller" | "neutral";
}

interface VotePoint {
  pct: number;
}

interface PeerReasoning {
  vote_pct: number;
  text: string;
  outside_zone: boolean;
}

// ─── Main Page ───────────────────────────────────────────────
export default function ReviewerCasePage() {
  const params = useParams();
  const router = useRouter();
  const disputeId = params.id as string;

  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Vote state
  const [voteValue, setVoteValue] = useState(50);
  const [reasoning, setReasoning] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Collapsibles
  const [profileOpen, setProfileOpen] = useState(false);
  const [precedentOpen, setPrecedentOpen] = useState(false);

  const fetchCase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<CaseDetail>(`/reviewer/assignments/${disputeId}`);
      setCaseData(data);
      if (data.your_vote != null) {
        setVoteValue(data.your_vote);
      }
      if (data.your_reasoning) {
        setReasoning(data.your_reasoning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load case");
    } finally {
      setLoading(false);
    }
  }, [disputeId]);

  useEffect(() => {
    fetchCase();
  }, [fetchCase]);

  async function handleSubmitVote() {
    if (!caseData) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post(`/reviewer/assignments/${disputeId}/vote`, {
        vote_pct: voteValue,
        reasoning: reasoning || undefined,
      });
      // Refetch to get updated status
      await fetchCase();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit vote");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Loading / error ───────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-center py-20">
          <div className="text-slate-400 text-sm animate-pulse">Loading case...</div>
        </div>
      </main>
    );
  }

  if (error || !caseData) {
    return (
      <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-12 text-center">
          <p className="text-slate-400 text-sm">{error ?? "Case not found."}</p>
          <Link href="/reviewer" className="mt-4 inline-block text-sm text-cyan-400 hover:text-cyan-300">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const amount = caseData.amount_minor / 100;
  const buyerAmt = (amount * voteValue / 100).toFixed(2);
  const sellerAmt = (amount * (100 - voteValue) / 100).toFixed(2);

  // Determine view mode from status
  const isActive = caseData.status === "active";
  const isVoted = caseData.status === "voted";
  const isDecided = caseData.status === "decided";

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      {/* Breadcrumbs */}
      <div className="mb-5 flex items-center gap-2 font-mono text-xs text-slate-500">
        <Link href="/reviewer" className="hover:text-white transition-colors">Reviewer Dashboard</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-400">{disputeId.slice(0, 12)}...</span>
      </div>

      {/* ── ACTIVE: Cast Vote ── */}
      {isActive && (
        <div className="space-y-5">
          {/* Assignment header */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex gap-2">
                <StatusPill variant="active">Review assignment</StatusPill>
                <StatusPill variant="tier">{caseData.tier} Panel</StatusPill>
              </div>
              <span className="font-mono text-xs text-slate-500">
                Case <strong className="text-white">{disputeId.slice(0, 12)}</strong>
              </span>
            </div>
            <h1 className="mt-1.5 flex flex-wrap items-baseline gap-3 text-xl font-semibold text-white tracking-tight">
              {caseData.item_title}
              <span className="font-mono font-medium">${amount.toFixed(2)}</span>
            </h1>
            <div className="mt-1 text-sm text-slate-400">
              Reason: <strong className="text-slate-300">{caseData.reason_code.replace(/_/g, " ")}</strong>
              {" "} Opened {new Date(caseData.opened_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-700 pt-4">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Voting deadline</span>
                {caseData.deadline && (
                  <span className="font-mono text-sm font-semibold text-amber-400">
                    {new Date(caseData.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Est. reward</span>
                <span className="font-mono text-sm font-semibold text-emerald-400">
                  {caseData.estimated_reward_usdc.toFixed(2)} USDC
                </span>
                <span className="text-[11px] text-slate-600">if within majority zone</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Slot usage</span>
                <span className="font-mono text-sm font-semibold text-white">{caseData.slot_usage}</span>
              </div>
            </div>
          </section>

          {/* Case briefing */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50">
            <div className="border-b border-slate-700 px-6 py-4">
              <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Neutral briefing</div>
              <h2 className="mt-1 text-sm font-semibold text-white">Case dossier</h2>
            </div>
            <div className="p-6">
              <div className="text-sm leading-relaxed text-slate-300">
                <strong className="text-white">Summary.</strong> {caseData.briefing.summary}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-cyan-500/20 border-l-[3px] border-l-cyan-500 bg-cyan-500/5 p-4 text-sm leading-relaxed text-slate-300">
                  <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-cyan-400">Buyer position</h4>
                  <p>{caseData.briefing.buyer_position}</p>
                </div>
                <div className="rounded-xl border border-violet-500/20 border-l-[3px] border-l-violet-500 bg-violet-500/5 p-4 text-sm leading-relaxed text-slate-300">
                  <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-violet-400">Seller position</h4>
                  <p>{caseData.briefing.seller_position}</p>
                </div>
              </div>
              <div className="mt-4 rounded-xl border-l-[3px] border-l-white bg-slate-900/50 p-5 text-base font-medium leading-relaxed text-slate-200">
                Core question: <em>{caseData.briefing.core_question}</em>
              </div>
            </div>
          </section>

          {/* Evidence gallery */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50">
            <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Evidence</div>
                <h2 className="mt-1 text-sm font-semibold text-white">
                  {caseData.evidence.buyer.length + caseData.evidence.seller.length} items
                </h2>
              </div>
              <span className="font-mono text-[11px] text-slate-600">Hashes anchored on-chain</span>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <EvidenceColumn label="Buyer" color="cyan" items={caseData.evidence.buyer} />
                <EvidenceColumn label="Seller" color="violet" items={caseData.evidence.seller} />
              </div>
            </div>
          </section>

          {/* Specialist verification */}
          {caseData.specialist_verification && (
            <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
              <div className="mb-2.5 flex items-center gap-2.5 font-mono text-xs uppercase tracking-widest text-slate-500">
                <span className="h-[7px] w-[7px] rounded-full bg-emerald-500" />
                Specialist Verification: <strong className="text-slate-300">{caseData.specialist_verification.provider}</strong>
              </div>
              <div className="mb-3 text-sm leading-relaxed text-slate-300">
                {caseData.specialist_verification.summary}
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <span className="min-w-[80px] font-mono text-[11px] uppercase tracking-widest text-slate-500">Confidence</span>
                <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                    style={{ width: `${caseData.specialist_verification.confidence}%` }}
                  />
                </div>
                <span className="min-w-[50px] text-right font-mono font-semibold text-white">
                  {caseData.specialist_verification.confidence}%
                </span>
              </div>
              <div className="mt-2.5 text-xs text-slate-600 leading-relaxed">
                {caseData.specialist_verification.disclaimer}
              </div>
            </section>
          )}

          {/* Vote box */}
          <section className="rounded-xl border-2 border-slate-600 bg-slate-800/50 p-6">
            <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Your ballot</div>
            <h2 className="mt-1.5 text-lg font-semibold text-white">Cast your vote</h2>
            <div className="mt-1 text-sm text-slate-400">
              What percentage of the ${amount.toFixed(2)} escrow should go to the buyer?
            </div>

            {/* Slider */}
            <div className="mt-5">
              <div className="flex justify-between font-mono text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                <span><span className="font-semibold text-violet-400">0%</span> Seller wins</span>
                <span className="font-semibold text-slate-400">50% Split</span>
                <span><span className="font-semibold text-cyan-400">100%</span> Buyer wins</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={voteValue}
                onChange={(e) => setVoteValue(Number(e.target.value))}
                className="mt-4 w-full accent-cyan-500"
                aria-label="Refund percentage to buyer"
              />
            </div>

            {/* Quick buttons */}
            <div className="mt-4 grid grid-cols-5 gap-1.5">
              {[0, 25, 50, 75, 100].map((q) => (
                <button
                  key={q}
                  onClick={() => setVoteValue(q)}
                  className={`rounded-lg border px-1.5 py-2 font-mono text-xs font-semibold transition-all ${
                    voteValue === q
                      ? "border-cyan-500 bg-cyan-500 text-white"
                      : "border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600 hover:text-white"
                  }`}
                >
                  {q}%
                </button>
              ))}
            </div>

            {/* Summary */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900/50 p-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 mb-0.5">Your vote</div>
                <div className="font-mono text-xl font-semibold text-white">{voteValue}% to buyer</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500 mb-0.5">Buyer receives</div>
                <div className="font-mono text-xl font-semibold text-cyan-400">${buyerAmt}</div>
                <div className="mt-1 text-[11px] text-slate-500">Seller receives ${sellerAmt}</div>
              </div>
            </div>

            {/* Reasoning */}
            <label className="mt-5 block font-mono text-xs uppercase tracking-widest text-slate-500">
              Optional reasoning (anonymized)
            </label>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              className="mt-2 w-full min-h-[80px] resize-y rounded-xl border border-slate-700 bg-slate-900/50 p-3 text-sm leading-relaxed text-slate-300 outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
              placeholder="Share your reasoning for this vote..."
            />

            {/* Warning */}
            <div className="mt-4 flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-slate-400">
              <span className="text-amber-400">!</span>
              <span>
                <strong className="text-amber-400">Vote is final and cannot be changed.</strong>{" "}
                Voting within the agreement zone earns your reward. Votes outside the zone receive 0 USDC.
              </span>
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                {submitError}
              </div>
            )}

            {/* CTA */}
            <div className="mt-5 flex items-center gap-3">
              <div className="flex-1 text-sm text-slate-500">
                Current vote: <strong className="text-white">{voteValue}% to buyer</strong>
              </div>
              <button
                onClick={handleSubmitVote}
                disabled={submitting}
                className="rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Submitting..." : "Submit vote"}
              </button>
            </div>
          </section>

          {/* Precedents (collapsible) */}
          {caseData.precedents.length > 0 && (
            <section className="rounded-xl border border-slate-700 bg-slate-800/50">
              <button
                onClick={() => setPrecedentOpen(!precedentOpen)}
                className="flex w-full items-center justify-between px-6 py-4 text-left"
              >
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Precedent</div>
                  <h2 className="mt-1 text-sm font-semibold text-white">Similar past cases ({caseData.precedents.length})</h2>
                </div>
                <span className={`text-xs text-slate-500 transition-transform ${precedentOpen ? "rotate-90" : ""}`}>&#x25B6;</span>
              </button>
              {precedentOpen && (
                <div className="border-t border-slate-700 p-6 space-y-3">
                  {caseData.precedents.map((p, i) => (
                    <div key={i} className="flex items-center gap-4 text-sm">
                      <span className="font-mono text-xs text-slate-500 min-w-[100px]">{p.case_id}</span>
                      <span className="flex-1 text-slate-400 leading-relaxed">{p.description}</span>
                      <span className={`font-mono text-xs font-semibold ${
                        p.outcome_color === "buyer" ? "text-cyan-400" : p.outcome_color === "seller" ? "text-violet-400" : "text-slate-400"
                      }`}>
                        {p.outcome}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ── VOTED: Post-submission ── */}
      {isVoted && (
        <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-8">
          <div className="font-mono text-[11px] uppercase tracking-widest text-emerald-400 mb-2">Vote submitted</div>
          <h2 className="text-2xl font-semibold text-white tracking-tight">
            Your vote is sealed. Thanks for serving on this panel.
          </h2>
          <div className="mt-2 text-sm text-slate-400 leading-relaxed">
            Panel results will be revealed once the voting window closes. Your ballot is committed on-chain and cannot be altered.
          </div>

          <div className="mt-5 grid grid-cols-3 gap-4">
            <InfoCard label="Your vote" value={`${caseData.your_vote ?? 0}%`} sub={`$${(amount * (caseData.your_vote ?? 0) / 100).toFixed(2)} to buyer`} />
            <InfoCard
              label="Submitted"
              value={caseData.submitted_at ? new Date(caseData.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "N/A"}
              sub="Sealed on-chain"
              small
            />
            <InfoCard
              label="Decision ETA"
              value={caseData.deadline ? new Date(caseData.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBD"}
              sub="Voting deadline"
              small
            />
          </div>

          {/* Panel progress */}
          {caseData.panel_voted != null && caseData.panel_total != null && (
            <>
              <div className="my-5 h-px bg-slate-700" />
              <div className="flex items-center justify-between mb-2.5">
                <span className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Panel voting progress</span>
                <span className="font-mono text-sm text-slate-400">{caseData.panel_voted} / {caseData.panel_total} reviewers voted</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400"
                  style={{ width: `${(caseData.panel_voted / caseData.panel_total) * 100}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {Array.from({ length: caseData.panel_total }, (_, i) => (
                  <div
                    key={i}
                    className={`grid h-[22px] w-[22px] place-items-center rounded-full font-mono text-[9px] font-semibold ${
                      i < caseData.panel_voted!
                        ? i + 1 === caseData.your_reviewer_number
                          ? "border border-white bg-white text-slate-900 outline outline-2 outline-offset-2 outline-cyan-500"
                          : "border border-white bg-white text-slate-900"
                        : "border border-slate-700 bg-slate-800 text-slate-600"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </div>
                ))}
              </div>
              {caseData.your_reviewer_number && (
                <div className="mt-2 font-mono text-[11px] text-slate-500">
                  You are reviewer R-{String(caseData.your_reviewer_number).padStart(2, "0")}
                </div>
              )}
            </>
          )}

          <div className="mt-5 flex gap-3">
            <Link
              href="/reviewer"
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Reviewer dashboard
            </Link>
          </div>
        </section>
      )}

      {/* ── DECIDED: Post-decision ── */}
      {isDecided && (
        <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-8">
          <div className="flex items-center gap-2.5 mb-2">
            <StatusPill variant="decided">Decision reached</StatusPill>
            <span className="font-mono text-xs text-slate-500">{disputeId.slice(0, 12)}</span>
          </div>
          <h2 className="text-2xl font-semibold text-white tracking-tight">
            Panel ruled: {caseData.outcome_pct}% refund to buyer.
          </h2>
          <div className="mt-2 max-w-lg text-sm text-slate-400 leading-relaxed">
            {caseData.panel_agreement_pct != null && (
              <>Panel reached {caseData.panel_agreement_pct}% agreement. </>
            )}
            {caseData.settlement_hash && (
              <>Settlement hash committed on-chain.</>
            )}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-4">
            <InfoCard
              label="Outcome"
              value={`${caseData.outcome_pct}%`}
              sub={caseData.outcome_label ?? ""}
              valueColor="text-cyan-400"
            />
            <InfoCard
              label="Your vote"
              value={`${caseData.your_vote ?? 0}%`}
              sub={caseData.in_majority ? "In majority" : "Outside majority"}
              subColor={caseData.in_majority ? "text-emerald-400" : "text-red-400"}
            />
            <InfoCard
              label="Your reward"
              value={`${(caseData.reward_usdc ?? 0) > 0 ? "+" : ""}${(caseData.reward_usdc ?? 0).toFixed(2)} USDC`}
              sub={`DS impact ${(caseData.ds_impact ?? 0) > 0 ? "+" : ""}${caseData.ds_impact ?? 0}`}
              valueColor="text-emerald-400"
            />
          </div>

          {/* Vote distribution */}
          {caseData.vote_distribution && caseData.agreement_zone && (
            <>
              <div className="my-5 h-px bg-slate-700" />
              <div className="mb-2.5 font-mono text-[11px] uppercase tracking-widest text-slate-500">
                Vote distribution (anonymized)
              </div>
              <div className="relative mt-3 rounded-xl bg-slate-900/50 px-6 pb-4 pt-14">
                <div className="relative h-[60px]">
                  {/* Agreement zone */}
                  <div
                    className="absolute bottom-[18px] top-0 rounded bg-emerald-500/10 border-l border-r border-dashed border-emerald-500/30"
                    style={{ left: `${caseData.agreement_zone.min}%`, right: `${100 - caseData.agreement_zone.max}%` }}
                  />
                  {/* Axis */}
                  <div className="absolute bottom-[18px] left-0 right-0 h-[2px] bg-slate-700" />
                  {/* Vote ticks */}
                  {caseData.vote_distribution.map((v, i) => (
                    <div
                      key={i}
                      className="absolute bottom-[14px] w-[2px] rounded bg-slate-500"
                      style={{ left: `${v.pct}%`, height: "30px", transform: "translateX(-50%)" }}
                    />
                  ))}
                  {/* Your vote */}
                  {caseData.your_vote != null && (
                    <div
                      className="absolute bottom-[14px] z-[2] w-[3px] rounded bg-cyan-400"
                      style={{ left: `${caseData.your_vote}%`, height: "44px", transform: "translateX(-50%)" }}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded border border-cyan-500/30 bg-slate-800 px-1.5 py-[2px] font-mono text-[10px] font-semibold text-cyan-400">
                        you {caseData.your_vote}%
                      </div>
                    </div>
                  )}
                  {/* Median */}
                  {caseData.outcome_pct != null && (
                    <div
                      className="absolute bottom-[14px] z-[2] w-[3px] rounded bg-white"
                      style={{ left: `${caseData.outcome_pct}%`, height: "44px", transform: "translateX(-50%)" }}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded border border-slate-700 bg-slate-800 px-1.5 py-[2px] font-mono text-[10px] font-semibold text-white">
                        median {caseData.outcome_pct}%
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex justify-between font-mono text-[10px] text-slate-600 mt-1">
                  <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-4 font-mono text-xs text-slate-500">
                <span><span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-emerald-500" />Agreement zone</span>
                <span><span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-white" />Median</span>
                <span><span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-cyan-400" />Your vote</span>
              </div>
            </>
          )}

          {/* Peer reasoning */}
          {caseData.peer_reasoning && caseData.peer_reasoning.length > 0 && (
            <>
              <div className="my-5 h-px bg-slate-700" />
              <div className="mb-2.5 font-mono text-[11px] uppercase tracking-widest text-slate-500">
                Peer reasoning (anonymized)
              </div>
              <div className="space-y-2">
                {caseData.peer_reasoning.map((p, i) => (
                  <div key={i} className="flex gap-2.5 rounded-xl border border-slate-700 bg-slate-900/50 p-3 text-sm leading-relaxed">
                    <span className="min-w-[44px] font-mono font-semibold text-slate-500">{p.vote_pct}%</span>
                    <span className={p.outside_zone ? "text-slate-600" : "text-slate-400"}>
                      {p.text}
                      {p.outside_zone && <> &middot; <em>outside zone</em></>}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mt-5 flex gap-3">
            <Link
              href="/reviewer"
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Back to dashboard
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StatusPill({ variant, children }: { variant: "active" | "tier" | "decided"; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    active: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    tier: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    decided: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide ${styles[variant]}`}>
      {children}
    </span>
  );
}

function InfoCard({ label, value, sub, valueColor, subColor, small }: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  subColor?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 font-mono font-semibold ${small ? "text-sm" : "text-xl"} ${valueColor ?? "text-white"}`}>
        {value}
      </div>
      <div className={`mt-1 text-xs ${subColor ?? "text-slate-500"}`}>{sub}</div>
    </div>
  );
}

function EvidenceColumn({ label, color, items }: { label: string; color: "cyan" | "violet"; items: EvidenceItem[] }) {
  const dotColor = color === "cyan" ? "bg-cyan-500" : "bg-violet-500";
  const hashColor = color === "cyan" ? "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" : "text-violet-400 border-violet-500/30 bg-violet-500/10";

  return (
    <div>
      <h4 className="mb-2.5 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        {label} ({items.length})
      </h4>
      <div className="space-y-2.5">
        {items.map((ev) => (
          <div key={ev.id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/50 transition-all hover:border-slate-600">
            <div className={`grid h-[80px] place-items-center border-b border-slate-700 p-2 text-center font-mono text-[10px] ${
              ev.is_text
                ? "items-start bg-slate-900 p-3 text-left text-[11px] leading-relaxed text-slate-400"
                : "bg-slate-800 text-slate-500"
            }`}>
              {ev.is_text ? (ev.content ?? ev.description) : `[ ${ev.description} ]`}
            </div>
            <div className="p-3">
              <div className="text-sm font-medium text-slate-300">{ev.type}</div>
              <div className="font-mono text-[10px] text-slate-600">
                {new Date(ev.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
              <div className={`mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] font-mono text-[9px] font-semibold ${hashColor}`}>
                Anchored {ev.hash.slice(0, 10)}...
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-4 text-center text-xs text-slate-600">No evidence submitted</div>
        )}
      </div>
    </div>
  );
}
