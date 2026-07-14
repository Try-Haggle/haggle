"use client";

import { useEffect, useState } from "react";
import {
  ActivityFeed,
  Alert,
  BackLink,
  Badge,
  Button,
  EvidenceCard,
  type ActivityEvent as FeedEvent,
  Field,
  Input,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/api-client";
import { AdvisorChat } from "./_components/advisor-chat";
import type { Dispute, DisputeEvidence } from "./page";

const EVIDENCE_TYPES = [
  { value: "text", label: "Text Description" },
  { value: "image", label: "Image" },
  { value: "tracking_snapshot", label: "Tracking Snapshot" },
  { value: "payment_proof", label: "Payment Proof" },
  { value: "other", label: "Other" },
] as const;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function evidenceTimestamp(evidence: DisputeEvidence): string {
  return evidence.submitted_at ?? evidence.created_at ?? new Date().toISOString();
}

// ─── Timeline ───────────────────────────────────────────────────
const TIMELINE_STEPS = [
  { key: "opened", label: "Opened" },
  { key: "evidence", label: "Evidence" },
  { key: "review", label: "AI Review" },
  { key: "decision", label: "Decision" },
  { key: "settlement", label: "Settlement" },
] as const;

function getTimelineStep(status: string): number {
  const stepMap: Record<string, number> = {
    OPEN: 1,
    WAITING_FOR_BUYER: 1,
    WAITING_FOR_SELLER: 1,
    UNDER_REVIEW: 2,
    ESCALATED: 2,
    RESOLVED_BUYER_FAVOR: 3,
    RESOLVED_SELLER_FAVOR: 3,
    PARTIAL_REFUND: 3,
    CLOSED: 4,
  };
  return stepMap[status] ?? 0;
}

function DisputeTimeline({ status }: { status: string }) {
  const currentStep = getTimelineStep(status);
  return (
    <div className="rounded-xl border border-line bg-surface-raised/50 p-4 mb-6">
      <div className="flex items-center justify-between">
        {TIMELINE_STEPS.map((step, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                    isDone
                      ? "bg-success-soft border-success text-success"
                      : isCurrent
                        ? "bg-action-primary/20 border-action-primary text-action-primary animate-pulse"
                        : "bg-surface-sunken border-line text-ink-muted"
                  }`}
                >
                  {isDone ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`mt-1.5 text-xs font-medium ${
                    isDone ? "text-success" : isCurrent ? "text-action-primary" : "text-ink-muted"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < TIMELINE_STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 mt-[-1rem] ${
                    i < currentStep ? "bg-success/50" : "bg-line"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Cost Breakdown ─────────────────────────────────────────────
function computeTierCost(amountCents: number, tier: 1 | 2 | 3): number {
  const rates: Record<number, { pct: number; min: number }> = {
    1: { pct: 0.005, min: 300 },
    2: { pct: 0.02, min: 1200 },
    3: { pct: 0.05, min: 3000 },
  };
  const { pct, min } = rates[tier];
  return Math.max(Math.round(amountCents * pct), min);
}

function CostBreakdown({
  amountMinor,
  currentTier,
}: {
  amountMinor: number;
  currentTier: number | null;
}) {
  const tiers = [1, 2, 3] as const;
  return (
    <div className="rounded-xl border border-line bg-surface-raised/50 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-warning"
        >
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
        <span className="text-sm font-semibold text-ink">Dispute Cost Tiers</span>
        <span className="ml-auto rounded-full bg-warning-soft border border-warning/30 px-2 py-0.5 text-xs text-warning font-medium">
          Loser pays
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiers.map((tier) => {
          const cost = computeTierCost(amountMinor, tier);
          const isActive = currentTier === tier;
          return (
            <div
              key={tier}
              className={`rounded-lg border p-3 text-center ${
                isActive
                  ? "border-action-primary/50 bg-action-primary/10"
                  : "border-line bg-surface-sunken/50"
              }`}
            >
              <p
                className={`text-xs font-medium mb-1 ${isActive ? "text-action-primary" : "text-ink-secondary"}`}
              >
                Tier {tier}
              </p>
              <p className={`text-sm font-bold ${isActive ? "text-ink" : "text-ink-secondary"}`}>
                ${(cost / 100).toFixed(2)}
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                {tier === 1 ? "max(0.5%, $3)" : tier === 2 ? "max(2%, $12)" : "max(5%, $30)"}
              </p>
            </div>
          );
        })}
      </div>
      {amountMinor > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-surface-sunken/50 p-2 flex items-center justify-between">
          <span className="text-xs text-ink-secondary">Escrow amount</span>
          <span className="text-sm font-semibold text-ink">${(amountMinor / 100).toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Activity Log ───────────────────────────────────────────────
interface ActivityEvent {
  label: string;
  timestamp: string;
  icon: "open" | "evidence" | "review" | "resolve" | "close";
}

interface DisputeDeposit {
  id: string;
  disputeId: string;
  tier: number;
  amountCents: number;
  status: "PENDING" | "DEPOSITED" | "FORFEITED" | "REFUNDED";
  deadlineAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface DepositCollection {
  rail: "usdc" | "stripe" | "mock";
  status: "pending" | "completed";
  usdc_approval?: {
    spender_address: string;
    token_address: string;
    amount_wei: string;
    chain_id: number;
  };
  stripe_client_secret?: string;
  stripe_payment_intent_id?: string;
}

function buildActivityLog(dispute: Dispute): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  events.push({
    label: `Dispute opened by ${dispute.opened_by}`,
    timestamp: dispute.created_at,
    icon: "open",
  });

  for (const ev of dispute.evidence) {
    events.push({
      label: `${ev.submitted_by} submitted ${ev.type} evidence`,
      timestamp: evidenceTimestamp(ev),
      icon: "evidence",
    });
  }

  const meta = dispute.metadata as Record<string, unknown> | undefined;
  if (meta?.escalated_by) {
    events.push({
      label: `Escalated to T${meta.tier ?? "?"} by ${meta.escalated_by}`,
      timestamp: dispute.updated_at,
      icon: "review",
    });
  }

  if (
    dispute.status === "RESOLVED_BUYER_FAVOR" ||
    dispute.status === "RESOLVED_SELLER_FAVOR" ||
    dispute.status === "PARTIAL_REFUND"
  ) {
    events.push({
      label: `Resolved: ${dispute.status.replace(/_/g, " ").toLowerCase()}`,
      timestamp: dispute.updated_at,
      icon: "resolve",
    });
  }

  if (dispute.status === "CLOSED") {
    events.push({
      label: "Dispute closed",
      timestamp: dispute.updated_at,
      icon: "close",
    });
  }

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

const ACTIVITY_TONES: Record<string, FeedEvent["tone"]> = {
  open: "warning",
  evidence: "info",
  review: "info",
  resolve: "success",
  close: "default",
};

function ActivityLog({ dispute }: { dispute: Dispute }) {
  const events = buildActivityLog(dispute);
  if (events.length === 0) return null;

  const feedEvents: FeedEvent[] = events.map((event) => ({
    id: `${event.icon}-${event.timestamp}`,
    label: event.label,
    time: formatDate(event.timestamp),
    tone: ACTIVITY_TONES[event.icon] ?? "default",
  }));

  return (
    <div className="rounded-xl border border-line bg-surface-raised/50 mb-6 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-secondary"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="text-sm font-semibold text-ink">Activity</span>
      </div>
      <div className="p-4">
        <ActivityFeed events={feedEvents} />
      </div>
    </div>
  );
}

// ─── Evidence Item ──────────────────────────────────────────────
function EvidenceItem({ evidence }: { evidence: DisputeEvidence }) {
  const typeLabel = EVIDENCE_TYPES.find((t) => t.value === evidence.type)?.label ?? evidence.type;
  return (
    <EvidenceCard
      type={typeLabel}
      submittedBy={`by ${evidence.submitted_by}`}
      time={formatDate(evidenceTimestamp(evidence))}
    >
      {evidence.text && <span className="block">{evidence.text}</span>}
      {evidence.uri && (
        <a
          href={evidence.uri}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block break-all text-action-primary text-xs hover:text-action-primary-hover"
        >
          View attachment
        </a>
      )}
    </EvidenceCard>
  );
}

// ─── Main Component ─────────────────────────────────────────────
export function DisputeDetail({
  dispute: initialDispute,
  userId: _userId,
  userRole = "buyer",
  amountMinor,
}: {
  dispute: Dispute;
  userId: string;
  userRole?: "buyer" | "seller";
  amountMinor?: number | null;
}) {
  const [dispute, setDispute] = useState<Dispute>(initialDispute);
  const [evidenceType, setEvidenceType] = useState<
    "text" | "image" | "tracking_snapshot" | "payment_proof" | "other"
  >("text");
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<DisputeDeposit | null>(null);
  const [depositRail, setDepositRail] = useState<"usdc" | "stripe">("usdc");
  const [depositWallet, setDepositWallet] = useState("");
  const [depositCollection, setDepositCollection] = useState<DepositCollection | null>(null);

  const isResolved =
    dispute.status === "RESOLVED_BUYER_FAVOR" ||
    dispute.status === "RESOLVED_SELLER_FAVOR" ||
    dispute.status === "PARTIAL_REFUND" ||
    dispute.status === "CLOSED";

  const meta = dispute.metadata as Record<string, unknown> | undefined;
  const currentTier = (meta?.tier as number | undefined) ?? null;
  const effectiveAmount = amountMinor ?? 0;

  // Role-based accent (buyer → info/blue, seller → gold) for inline text + icons.
  const accentText = userRole === "buyer" ? "text-info" : "text-badge-text";

  // Determine if seller has a waiting deadline
  const isSellerWaiting =
    userRole === "seller" && (dispute.status === "WAITING_FOR_SELLER" || dispute.status === "OPEN");

  const canEscalate = !isResolved && dispute.status !== "UNDER_REVIEW";

  async function loadDeposit() {
    const result = await api
      .get<{ deposit: DisputeDeposit }>(`/disputes/${dispute.id}/deposit`)
      .catch(() => null);
    setDeposit(result?.deposit ?? null);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload deposit only when the dispute changes
  useEffect(() => {
    loadDeposit();
  }, [dispute.id]);

  async function reloadDispute() {
    const result = await api.get<{ dispute: Dispute }>(`/disputes/${dispute.id}`);
    setDispute(result.dispute);
    await loadDeposit();
  }

  async function handleSubmitEvidence(e: React.FormEvent) {
    e.preventDefault();
    if (!evidenceText && !evidenceUri) {
      setError("Provide either a text description or a URI");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await api.post<{ dispute: Dispute }>(`/disputes/${dispute.id}/evidence`, {
        submitted_by: userRole,
        type: evidenceType,
        ...(evidenceText ? { text: evidenceText } : {}),
        ...(evidenceUri ? { uri: evidenceUri } : {}),
      });
      setDispute(result.dispute);
      setEvidenceText("");
      setEvidenceUri("");
      setSuccess("Evidence submitted successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit evidence");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEscalate() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.post<{ dispute: Dispute; deposit?: DisputeDeposit }>(
        `/disputes/${dispute.id}/escalate`,
        {
          escalated_by: userRole,
        },
      );
      setDispute(result.dispute);
      setDeposit(result.deposit ?? null);
      setSuccess("Dispute escalated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to escalate dispute");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStartDeposit() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.post<{ deposit: DisputeDeposit; collection: DepositCollection }>(
        `/disputes/${dispute.id}/deposit`,
        {
          rail: depositRail,
          wallet_address: depositWallet || undefined,
        },
      );
      setDeposit(result.deposit);
      setDepositCollection(result.collection);
      setSuccess(
        result.collection.rail === "usdc"
          ? "USDC approval instructions created"
          : "Deposit session created",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start deposit");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmUsdcDeposit() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.post<{ deposit: DisputeDeposit; tx_hash?: string }>(
        `/disputes/${dispute.id}/deposit/confirm-usdc`,
        {
          wallet_address: depositWallet,
        },
      );
      setDeposit(result.deposit);
      setSuccess(result.tx_hash ? `Deposit confirmed: ${result.tx_hash}` : "Deposit confirmed");
      await reloadDispute();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm deposit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      <BackLink href="/disputes" className="mb-6">
        All Disputes
      </BackLink>

      {/* Header with role-based accent */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-ink">Dispute</h1>
            <Badge tone={userRole === "seller" ? "gold" : "info"} size="sm" className="capitalize">
              {userRole}
            </Badge>
          </div>
          <p className="text-xs text-ink-muted font-mono">{dispute.id}</p>
          {userRole === "buyer" && (
            <p className={`text-xs ${accentText} mt-1 font-medium`}>Your AI Advocate</p>
          )}
        </div>
        <StatusBadge domain="dispute" status={dispute.status} className="px-3 py-1" />
      </div>

      {/* Seller deadline warning */}
      {isSellerWaiting && (
        <Alert tone="warning" className="mb-4">
          Action required: Please respond to this dispute promptly to avoid default resolution.
        </Alert>
      )}

      {/* Timeline */}
      <DisputeTimeline status={dispute.status} />

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-xl border border-line bg-surface-raised/50 p-3">
          <p className="text-xs text-ink-muted mb-1">Order ID</p>
          <p className="text-sm text-ink font-mono truncate">{dispute.order_id}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-raised/50 p-3">
          <p className="text-xs text-ink-muted mb-1">Reason</p>
          <p className="text-sm text-ink">{dispute.reason_code.replace(/_/g, " ")}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-raised/50 p-3">
          <p className="text-xs text-ink-muted mb-1">Opened By</p>
          <p className="text-sm text-ink capitalize">{dispute.opened_by}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-raised/50 p-3">
          <p className="text-xs text-ink-muted mb-1">Created</p>
          <p className="text-sm text-ink">{formatDate(dispute.created_at)}</p>
        </div>
      </div>

      {/* Cost Breakdown */}
      {effectiveAmount > 0 && (
        <CostBreakdown amountMinor={effectiveAmount} currentTier={currentTier} />
      )}

      {!isResolved && (
        <div className="rounded-xl border border-line bg-surface-raised/50 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink">Review Escalation</span>
            {deposit && (
              <Badge tone="neutral" size="sm">
                {deposit.status}
              </Badge>
            )}
          </div>
          <div className="p-4 space-y-3">
            {canEscalate && (
              <button
                type="button"
                onClick={handleEscalate}
                disabled={submitting}
                className="w-full rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm font-semibold text-warning transition-colors hover:bg-warning-soft disabled:opacity-40"
              >
                Escalate Review
              </button>
            )}

            {deposit && (
              <div className="rounded-lg border border-line bg-surface-sunken/40 p-3 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-secondary">Seller deposit</span>
                  <span className="font-semibold text-ink">
                    ${(deposit.amountCents / 100).toFixed(2)}
                  </span>
                </div>
                {deposit.deadlineAt && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-secondary">Deadline</span>
                    <span className="text-ink-secondary">{formatDate(deposit.deadlineAt)}</span>
                  </div>
                )}

                {userRole === "seller" && deposit.status === "PENDING" && (
                  <div className="space-y-2 border-t border-line pt-3">
                    <Select
                      value={depositRail}
                      onChange={(event) => setDepositRail(event.target.value as "usdc" | "stripe")}
                    >
                      <option value="usdc">USDC</option>
                      <option value="stripe">Stripe Onramp</option>
                    </Select>
                    <Input
                      value={depositWallet}
                      onChange={(event) => setDepositWallet(event.target.value)}
                      placeholder="0x wallet address"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" loading={submitting} onClick={handleStartDeposit}>
                        Start Deposit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={submitting || !depositWallet}
                        onClick={handleConfirmUsdcDeposit}
                      >
                        Confirm USDC
                      </Button>
                    </div>
                  </div>
                )}

                {depositCollection?.usdc_approval && (
                  <Alert tone="info" hideIcon className="text-xs">
                    <div className="space-y-1">
                      <p>
                        Spender:{" "}
                        <span className="font-mono">
                          {depositCollection.usdc_approval.spender_address}
                        </span>
                      </p>
                      <p>
                        Token:{" "}
                        <span className="font-mono">
                          {depositCollection.usdc_approval.token_address}
                        </span>
                      </p>
                      <p>
                        Amount wei:{" "}
                        <span className="font-mono">
                          {depositCollection.usdc_approval.amount_wei}
                        </span>
                      </p>
                    </div>
                  </Alert>
                )}
                {depositCollection?.stripe_client_secret && (
                  <Alert tone="info" hideIcon className="text-xs">
                    Stripe deposit session created.
                  </Alert>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Evidence list */}
      <div className="rounded-xl border border-line bg-surface-raised/50 mb-6 overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={accentText}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-sm font-semibold text-ink">Evidence</span>
          <span className="ml-auto text-xs text-ink-muted">
            {dispute.evidence.length} item{dispute.evidence.length !== 1 ? "s" : ""}
          </span>
        </div>

        {dispute.evidence.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-sm">No evidence submitted yet.</div>
        ) : (
          <div className="p-3 space-y-2">
            {dispute.evidence.map((ev, i) => (
              <EvidenceItem key={ev.id ?? i} evidence={ev} />
            ))}
          </div>
        )}
      </div>

      {/* Submit evidence form */}
      {!isResolved && (
        <div className="rounded-xl border border-line bg-surface-raised/50 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-line">
            <span className="text-sm font-semibold text-ink">Submit Evidence</span>
          </div>
          <form onSubmit={handleSubmitEvidence} className="p-4">
            <Field label="Evidence Type" htmlFor="evidence-type">
              <Select
                id="evidence-type"
                value={evidenceType}
                onChange={(e) => setEvidenceType(e.target.value as typeof evidenceType)}
              >
                {EVIDENCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Description" htmlFor="evidence-description">
              <Textarea
                id="evidence-description"
                rows={3}
                placeholder="Describe the issue in detail..."
                value={evidenceText}
                onChange={(e) => setEvidenceText(e.target.value)}
                className="resize-none"
              />
            </Field>

            <Field label="Attachment URL (optional)" htmlFor="evidence-uri">
              <Input
                id="evidence-uri"
                type="url"
                placeholder="https://..."
                value={evidenceUri}
                onChange={(e) => setEvidenceUri(e.target.value)}
              />
            </Field>

            {error && (
              <Alert tone="error" className="mb-3">
                {error}
              </Alert>
            )}
            {success && (
              <Alert tone="success" className="mb-3">
                {success}
              </Alert>
            )}

            <Button type="submit" fullWidth loading={submitting}>
              {submitting ? "Submitting..." : "Submit Evidence"}
            </Button>
          </form>
        </div>
      )}

      {isResolved && (
        <Alert tone="success" className="mb-6">
          <div>
            <p className="font-medium">
              This dispute has been {dispute.status.replace(/_/g, " ").toLowerCase()}.
            </p>
            {dispute.refundAmountMinor != null && dispute.refundAmountMinor > 0 && (
              <p className="mt-1 text-ink-secondary text-xs">
                Refund: ${(dispute.refundAmountMinor / 100).toFixed(2)}
              </p>
            )}
          </div>
        </Alert>
      )}

      {/* AI Advisor Chat */}
      <div className="mb-6">
        <AdvisorChat disputeId={dispute.id} userRole={userRole} />
      </div>

      {/* Activity log */}
      <ActivityLog dispute={dispute} />
    </main>
  );
}
