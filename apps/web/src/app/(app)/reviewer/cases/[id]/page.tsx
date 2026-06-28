"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  buttonVariants,
  Disclosure,
  PositionPanel,
  Spinner,
  Textarea,
  VoteSlider,
} from "@/components/ui";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";

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
        <div className="flex items-center justify-center gap-2 py-20 text-ink-secondary text-sm">
          <Spinner size="sm" />
          Loading case...
        </div>
      </main>
    );
  }

  if (error || !caseData) {
    return (
      <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-line bg-surface-sunken/50 p-12 text-center">
          <p className="text-ink-secondary text-sm">{error ?? "Case not found."}</p>
          <Link
            href="/reviewer"
            className="mt-4 inline-block text-sm text-action-primary hover:text-action-primary-hover"
          >
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const amount = caseData.amount_minor / 100;

  // Determine view mode from status
  const isActive = caseData.status === "active";
  const isVoted = caseData.status === "voted";
  const isDecided = caseData.status === "decided";

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      {/* Breadcrumbs */}
      <div className="mb-5 flex items-center gap-2 font-mono text-xs text-ink-muted">
        <Link href="/reviewer" className="hover:text-ink transition-colors">
          Reviewer Dashboard
        </Link>
        <span className="text-ink-muted">/</span>
        <span className="text-ink-secondary">{disputeId.slice(0, 12)}...</span>
      </div>

      {/* ── ACTIVE: Cast Vote ── */}
      {isActive && (
        <div className="space-y-5">
          {/* Assignment header */}
          <section className="rounded-xl border border-line bg-surface-sunken/50 p-6">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex gap-2">
                <StatusPill variant="active">Review assignment</StatusPill>
                <StatusPill variant="tier">{caseData.tier} Panel</StatusPill>
              </div>
              <span className="font-mono text-xs text-ink-muted">
                Case <strong className="text-ink">{disputeId.slice(0, 12)}</strong>
              </span>
            </div>
            <h1 className="mt-1.5 flex flex-wrap items-baseline gap-3 text-xl font-semibold text-ink tracking-tight">
              {caseData.item_title}
              <span className="font-mono font-medium">${amount.toFixed(2)}</span>
            </h1>
            <div className="mt-1 text-sm text-ink-secondary">
              Reason:{" "}
              <strong className="text-ink-secondary">
                {caseData.reason_code.replace(/_/g, " ")}
              </strong>{" "}
              Opened{" "}
              {new Date(caseData.opened_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                  Voting deadline
                </span>
                {caseData.deadline && (
                  <span className="font-mono text-sm font-semibold text-warning">
                    {new Date(caseData.deadline).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                  Est. reward
                </span>
                <span className="font-mono text-sm font-semibold text-success">
                  {caseData.estimated_reward_usdc.toFixed(2)} USDC
                </span>
                <span className="text-[11px] text-ink-muted">if within majority zone</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                  Slot usage
                </span>
                <span className="font-mono text-sm font-semibold text-ink">
                  {caseData.slot_usage}
                </span>
              </div>
            </div>
          </section>

          {/* Case briefing */}
          <section className="rounded-xl border border-line bg-surface-sunken/50">
            <div className="border-b border-line px-6 py-4">
              <div className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                Neutral briefing
              </div>
              <h2 className="mt-1 text-sm font-semibold text-ink">Case dossier</h2>
            </div>
            <div className="p-6">
              <div className="text-sm leading-relaxed text-ink-secondary">
                <strong className="text-ink">Summary.</strong> {caseData.briefing.summary}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PositionPanel side="buyer" label="Buyer position">
                  {caseData.briefing.buyer_position}
                </PositionPanel>
                <PositionPanel side="seller" label="Seller position">
                  {caseData.briefing.seller_position}
                </PositionPanel>
              </div>
              <div className="mt-4 rounded-xl border-l-[3px] border-l-white bg-surface-sunken/50 p-5 text-base font-medium leading-relaxed text-ink">
                Core question: <em>{caseData.briefing.core_question}</em>
              </div>
            </div>
          </section>

          {/* Evidence gallery */}
          <section className="rounded-xl border border-line bg-surface-sunken/50">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                  Evidence
                </div>
                <h2 className="mt-1 text-sm font-semibold text-ink">
                  {caseData.evidence.buyer.length + caseData.evidence.seller.length} items
                </h2>
              </div>
              <span className="font-mono text-[11px] text-ink-muted">Hashes anchored on-chain</span>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <EvidenceColumn label="Buyer" side="buyer" items={caseData.evidence.buyer} />
                <EvidenceColumn label="Seller" side="seller" items={caseData.evidence.seller} />
              </div>
            </div>
          </section>

          {/* Specialist verification */}
          {caseData.specialist_verification && (
            <section className="rounded-xl border border-line bg-surface-sunken/50 p-5">
              <div className="mb-2.5 flex items-center gap-2.5 font-mono text-xs uppercase tracking-widest text-ink-muted">
                <span className="h-[7px] w-[7px] rounded-full bg-success" />
                Specialist Verification:{" "}
                <strong className="text-ink-secondary">
                  {caseData.specialist_verification.provider}
                </strong>
              </div>
              <div className="mb-3 text-sm leading-relaxed text-ink-secondary">
                {caseData.specialist_verification.summary}
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <span className="min-w-[80px] font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                  Confidence
                </span>
                <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-action-primary to-success"
                    style={{ width: `${caseData.specialist_verification.confidence}%` }}
                  />
                </div>
                <span className="min-w-[50px] text-right font-mono font-semibold text-ink">
                  {caseData.specialist_verification.confidence}%
                </span>
              </div>
              <div className="mt-2.5 text-xs text-ink-muted leading-relaxed">
                {caseData.specialist_verification.disclaimer}
              </div>
            </section>
          )}

          {/* Vote box */}
          <section className="rounded-xl border-2 border-line-strong bg-surface-sunken/50 p-6">
            <div className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
              Your ballot
            </div>
            <h2 className="mt-1.5 text-lg font-semibold text-ink">Cast your vote</h2>
            <div className="mt-1 text-sm text-ink-secondary">
              What percentage of the ${amount.toFixed(2)} escrow should go to the buyer?
            </div>

            {/* Slider + presets + split readout */}
            <VoteSlider
              className="mt-5"
              value={voteValue}
              onChange={setVoteValue}
              amount={amount}
              buyerLabel="Buyer"
              sellerLabel="Seller"
            />

            {/* Reasoning */}
            <label
              htmlFor="vote-reasoning"
              className="mt-5 block font-mono text-xs uppercase tracking-widest text-ink-muted"
            >
              Optional reasoning (anonymized)
            </label>
            <Textarea
              id="vote-reasoning"
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              className="mt-2 min-h-[80px] resize-y"
              placeholder="Share your reasoning for this vote..."
            />

            {/* Warning */}
            <Alert tone="warning" className="mt-4">
              <span>
                <strong>Vote is final and cannot be changed.</strong> Voting within the agreement
                zone earns your reward. Votes outside the zone receive 0 USDC.
              </span>
            </Alert>

            {/* Submit error */}
            {submitError && (
              <Alert tone="error" className="mt-3">
                {submitError}
              </Alert>
            )}

            {/* CTA */}
            <div className="mt-5 flex items-center gap-3">
              <div className="flex-1 text-sm text-ink-muted">
                Current vote: <strong className="text-ink">{voteValue}% to buyer</strong>
              </div>
              <Button loading={submitting} onClick={handleSubmitVote}>
                {submitting ? "Submitting..." : "Submit vote"}
              </Button>
            </div>
          </section>

          {/* Precedents (collapsible) */}
          {caseData.precedents.length > 0 && (
            <Disclosure
              open={precedentOpen}
              onOpenChange={setPrecedentOpen}
              title={
                <span>
                  <span className="block font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                    Precedent
                  </span>
                  <span className="mt-1 block text-sm font-semibold text-ink">
                    Similar past cases ({caseData.precedents.length})
                  </span>
                </span>
              }
            >
              <div className="space-y-3">
                {caseData.precedents.map((p) => (
                  <div key={p.case_id} className="flex items-center gap-4 text-sm">
                    <span className="font-mono text-xs text-ink-muted min-w-[100px]">
                      {p.case_id}
                    </span>
                    <span className="flex-1 text-ink-secondary leading-relaxed">
                      {p.description}
                    </span>
                    <span
                      className={`font-mono text-xs font-semibold ${
                        p.outcome_color === "buyer"
                          ? "text-info"
                          : p.outcome_color === "seller"
                            ? "text-badge-text"
                            : "text-ink-secondary"
                      }`}
                    >
                      {p.outcome}
                    </span>
                  </div>
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      )}

      {/* ── VOTED: Post-submission ── */}
      {isVoted && (
        <section className="rounded-xl border border-line bg-surface-sunken/50 p-8">
          <div className="font-mono text-[11px] uppercase tracking-widest text-success mb-2">
            Vote submitted
          </div>
          <h2 className="text-2xl font-semibold text-ink tracking-tight">
            Your vote is sealed. Thanks for serving on this panel.
          </h2>
          <div className="mt-2 text-sm text-ink-secondary leading-relaxed">
            Panel results will be revealed once the voting window closes. Your ballot is committed
            on-chain and cannot be altered.
          </div>

          <div className="mt-5 grid grid-cols-3 gap-4">
            <InfoCard
              label="Your vote"
              value={`${caseData.your_vote ?? 0}%`}
              sub={`$${((amount * (caseData.your_vote ?? 0)) / 100).toFixed(2)} to buyer`}
            />
            <InfoCard
              label="Submitted"
              value={
                caseData.submitted_at
                  ? new Date(caseData.submitted_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : "N/A"
              }
              sub="Sealed on-chain"
              small
            />
            <InfoCard
              label="Decision ETA"
              value={
                caseData.deadline
                  ? new Date(caseData.deadline).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : "TBD"
              }
              sub="Voting deadline"
              small
            />
          </div>

          {/* Panel progress */}
          {caseData.panel_voted != null && caseData.panel_total != null && (
            <>
              <div className="my-5 h-px bg-line" />
              <div className="flex items-center justify-between mb-2.5">
                <span className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                  Panel voting progress
                </span>
                <span className="font-mono text-sm text-ink-secondary">
                  {caseData.panel_voted} / {caseData.panel_total} reviewers voted
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-action-primary to-action-primary-hover"
                  style={{ width: `${(caseData.panel_voted / caseData.panel_total) * 100}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {Array.from({ length: caseData.panel_total }, (_, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length panel slot indicators
                    key={i}
                    className={`grid h-[22px] w-[22px] place-items-center rounded-full font-mono text-[9px] font-semibold ${
                      i < caseData.panel_voted!
                        ? i + 1 === caseData.your_reviewer_number
                          ? "border border-action-primary bg-action-primary text-on-accent outline outline-2 outline-offset-2 outline-ink"
                          : "border border-action-primary bg-action-primary text-on-accent"
                        : "border border-line bg-surface-sunken text-ink-muted"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </div>
                ))}
              </div>
              {caseData.your_reviewer_number && (
                <div className="mt-2 font-mono text-[11px] text-ink-muted">
                  You are reviewer R-{String(caseData.your_reviewer_number).padStart(2, "0")}
                </div>
              )}
            </>
          )}

          <div className="mt-5 flex gap-3">
            <Link href="/reviewer" className={cn(buttonVariants({ variant: "secondary" }))}>
              Reviewer dashboard
            </Link>
          </div>
        </section>
      )}

      {/* ── DECIDED: Post-decision ── */}
      {isDecided && (
        <section className="rounded-xl border border-line bg-surface-sunken/50 p-8">
          <div className="flex items-center gap-2.5 mb-2">
            <StatusPill variant="decided">Decision reached</StatusPill>
            <span className="font-mono text-xs text-ink-muted">{disputeId.slice(0, 12)}</span>
          </div>
          <h2 className="text-2xl font-semibold text-ink tracking-tight">
            Panel ruled: {caseData.outcome_pct}% refund to buyer.
          </h2>
          <div className="mt-2 max-w-lg text-sm text-ink-secondary leading-relaxed">
            {caseData.panel_agreement_pct != null && (
              <>Panel reached {caseData.panel_agreement_pct}% agreement. </>
            )}
            {caseData.settlement_hash && <>Settlement hash committed on-chain.</>}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-4">
            <InfoCard
              label="Outcome"
              value={`${caseData.outcome_pct}%`}
              sub={caseData.outcome_label ?? ""}
              valueColor="text-action-primary"
            />
            <InfoCard
              label="Your vote"
              value={`${caseData.your_vote ?? 0}%`}
              sub={caseData.in_majority ? "In majority" : "Outside majority"}
              subColor={caseData.in_majority ? "text-success" : "text-error"}
            />
            <InfoCard
              label="Your reward"
              value={`${(caseData.reward_usdc ?? 0) > 0 ? "+" : ""}${(caseData.reward_usdc ?? 0).toFixed(2)} USDC`}
              sub={`DS impact ${(caseData.ds_impact ?? 0) > 0 ? "+" : ""}${caseData.ds_impact ?? 0}`}
              valueColor="text-success"
            />
          </div>

          {/* Vote distribution */}
          {caseData.vote_distribution && caseData.agreement_zone && (
            <>
              <div className="my-5 h-px bg-line" />
              <div className="mb-2.5 font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                Vote distribution (anonymized)
              </div>
              <div className="relative mt-3 rounded-xl bg-surface-sunken/50 px-6 pb-4 pt-14">
                <div className="relative h-[60px]">
                  {/* Agreement zone */}
                  <div
                    className="absolute bottom-[18px] top-0 rounded bg-success-soft border-l border-r border-dashed border-success/30"
                    style={{
                      left: `${caseData.agreement_zone.min}%`,
                      right: `${100 - caseData.agreement_zone.max}%`,
                    }}
                  />
                  {/* Axis */}
                  <div className="absolute bottom-[18px] left-0 right-0 h-[2px] bg-line" />
                  {/* Vote ticks */}
                  {caseData.vote_distribution.map((v, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: vote ticks may share pct, position-indexed
                      key={i}
                      className="absolute bottom-[14px] w-[2px] rounded bg-ink-muted"
                      style={{ left: `${v.pct}%`, height: "30px", transform: "translateX(-50%)" }}
                    />
                  ))}
                  {/* Your vote */}
                  {caseData.your_vote != null && (
                    <div
                      className="absolute bottom-[14px] z-[2] w-[3px] rounded bg-action-primary"
                      style={{
                        left: `${caseData.your_vote}%`,
                        height: "44px",
                        transform: "translateX(-50%)",
                      }}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded border border-action-primary/30 bg-surface-sunken px-1.5 py-[2px] font-mono text-[10px] font-semibold text-action-primary">
                        you {caseData.your_vote}%
                      </div>
                    </div>
                  )}
                  {/* Median */}
                  {caseData.outcome_pct != null && (
                    <div
                      className="absolute bottom-[14px] z-[2] w-[3px] rounded bg-ink"
                      style={{
                        left: `${caseData.outcome_pct}%`,
                        height: "44px",
                        transform: "translateX(-50%)",
                      }}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded border border-line bg-surface-sunken px-1.5 py-[2px] font-mono text-[10px] font-semibold text-ink">
                        median {caseData.outcome_pct}%
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex justify-between font-mono text-[10px] text-ink-muted mt-1">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-4 font-mono text-xs text-ink-muted">
                <span>
                  <span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-success" />
                  Agreement zone
                </span>
                <span>
                  <span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-ink" />
                  Median
                </span>
                <span>
                  <span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-action-primary" />
                  Your vote
                </span>
              </div>
            </>
          )}

          {/* Peer reasoning */}
          {caseData.peer_reasoning && caseData.peer_reasoning.length > 0 && (
            <>
              <div className="my-5 h-px bg-line" />
              <div className="mb-2.5 font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                Peer reasoning (anonymized)
              </div>
              <div className="space-y-2">
                {caseData.peer_reasoning.map((p) => (
                  <div
                    key={`${p.vote_pct}-${p.text.slice(0, 24)}`}
                    className="flex gap-2.5 rounded-xl border border-line bg-surface-sunken/50 p-3 text-sm leading-relaxed"
                  >
                    <span className="min-w-[44px] font-mono font-semibold text-ink-muted">
                      {p.vote_pct}%
                    </span>
                    <span className={p.outside_zone ? "text-ink-muted" : "text-ink-secondary"}>
                      {p.text}
                      {p.outside_zone && (
                        <>
                          {" "}
                          &middot; <em>outside zone</em>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mt-5 flex gap-3">
            <Link href="/reviewer" className={cn(buttonVariants({ variant: "secondary" }))}>
              Back to dashboard
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StatusPill({
  variant,
  children,
}: {
  variant: "active" | "tier" | "decided";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    active: "bg-info-soft text-info border-info/30",
    tier: "bg-badge text-badge-text border-badge-text/30",
    decided: "bg-success-soft text-success border-success/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

function InfoCard({
  label,
  value,
  sub,
  valueColor,
  subColor,
  small,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  subColor?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-sunken/50 p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">{label}</div>
      <div
        className={`mt-1 font-mono font-semibold ${small ? "text-sm" : "text-xl"} ${valueColor ?? "text-ink"}`}
      >
        {value}
      </div>
      <div className={`mt-1 text-xs ${subColor ?? "text-ink-muted"}`}>{sub}</div>
    </div>
  );
}

function EvidenceColumn({
  label,
  side,
  items,
}: {
  label: string;
  side: "buyer" | "seller";
  items: EvidenceItem[];
}) {
  const dotColor = side === "buyer" ? "bg-info" : "bg-badge-text";
  const hashColor =
    side === "buyer"
      ? "text-info border-info/30 bg-info-soft"
      : "text-badge-text border-badge-text/30 bg-badge";

  return (
    <div>
      <h4 className="mb-2.5 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        {label} ({items.length})
      </h4>
      <div className="space-y-2.5">
        {items.map((ev) => (
          <div
            key={ev.id}
            className="overflow-hidden rounded-xl border border-line bg-surface-sunken/50 transition-all hover:border-line-strong"
          >
            <div
              className={`grid h-[80px] place-items-center border-b border-line p-2 text-center font-mono text-[10px] ${
                ev.is_text
                  ? "items-start bg-surface-sunken p-3 text-left text-[11px] leading-relaxed text-ink-secondary"
                  : "bg-surface-sunken text-ink-muted"
              }`}
            >
              {ev.is_text ? (ev.content ?? ev.description) : `[ ${ev.description} ]`}
            </div>
            <div className="p-3">
              <div className="text-sm font-medium text-ink-secondary">{ev.type}</div>
              <div className="font-mono text-[10px] text-ink-muted">
                {new Date(ev.submitted_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </div>
              <div
                className={`mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] font-mono text-[9px] font-semibold ${hashColor}`}
              >
                Anchored {ev.hash.slice(0, 10)}...
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-4 text-center text-xs text-ink-muted">No evidence submitted</div>
        )}
      </div>
    </div>
  );
}
