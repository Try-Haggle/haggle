"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNegotiationWs } from "@/hooks/use-negotiation-ws";
import { api } from "@/lib/api-client";

export interface NegotiationSession {
  id: string;
  listing_id: string;
  role: "BUYER" | "SELLER";
  status: string;
  current_round: number;
  last_offer_price_minor: number | null;
  last_utility: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface SkillBadge {
  id: string;
  name: string;
  type: string;
  badge: string;
  verification_status: string;
}

export interface Round {
  id: string;
  round_no: number;
  sender_role: "BUYER" | "SELLER";
  message_type: string;
  price_minor: number | null;
  counter_price_minor: number | null;
  utility: number | null;
  decision: string | null;
  created_at: string;
  /** AI-generated natural language message */
  message?: string;
  /** Message for the other party (different locale) */
  message_counterparty?: string;
  /** Skills that participated in this round */
  skills_applied?: SkillBadge[];
  /** Response locale */
  locale?: string;
}

export interface SessionDetailData {
  session: NegotiationSession;
  rounds: Round[];
}

function formatPrice(priceMajor: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceMajor);
}

function formatMinor(priceMinor: number | null): string {
  if (priceMinor === null) return "—";
  return formatPrice(priceMinor / 100);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

function statusBadge(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    CREATED: { label: "Created", color: "text-ink-secondary bg-surface-sunken" },
    ACTIVE: { label: "Active", color: "text-action-primary bg-badge" },
    NEAR_DEAL: { label: "Near Deal", color: "text-success bg-success-soft" },
    STALLED: { label: "Stalled", color: "text-warning bg-warning-soft" },
    ACCEPTED: { label: "Accepted", color: "text-success bg-success-soft font-semibold" },
    REJECTED: { label: "Rejected", color: "text-error bg-error-soft" },
    EXPIRED: { label: "Expired", color: "text-ink-muted bg-surface-sunken" },
    SUPERSEDED: { label: "Superseded", color: "text-ink-muted bg-surface-sunken" },
    WAITING: { label: "Waiting", color: "text-warning bg-warning-soft" },
  };
  return map[status] ?? { label: status, color: "text-ink-secondary bg-surface-sunken" };
}

function decisionBadge(decision: string | null): string {
  if (!decision) return "";
  const map: Record<string, string> = {
    ACCEPT: "text-success",
    REJECT: "text-error",
    COUNTER: "text-action-primary",
    NEAR_DEAL: "text-warning",
    ESCALATE: "text-info",
  };
  return map[decision] ?? "text-ink-secondary";
}

const TERMINAL_STATUSES = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"]);

export function NegotiationChat({
  initialSession,
  initialRounds,
  userId: _userId,
  role,
}: {
  initialSession: NegotiationSession;
  initialRounds: Round[];
  userId: string;
  role: "BUYER" | "SELLER";
}) {
  const [session, setSession] = useState<NegotiationSession>(initialSession);
  const [rounds, setRounds] = useState<Round[]>(initialRounds);
  const [offerInput, setOfferInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isTerminal = TERMINAL_STATUSES.has(session.status);
  const backHref = role === "BUYER" ? "/buy/dashboard" : "/sell/dashboard";

  // Scroll to bottom on new rounds
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll when a new round arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [rounds.length]);

  // Reload session + rounds data
  const reloadSession = useCallback(async () => {
    try {
      const fullData = await api.get<{
        session: NegotiationSession & { version: number };
        rounds: Round[];
      }>(`/negotiations/sessions/${session.id}`);
      setSession(fullData.session);
      setRounds(fullData.rounds);
    } catch {
      // Silent — update failure doesn't break UI
    }
  }, [session.id]);

  // Real-time updates via WebSocket (falls back to 5s polling)
  useNegotiationWs({
    sessionId: session.id,
    onUpdate: reloadSession,
    isTerminal,
  });

  async function handleSubmitOffer(e: React.FormEvent) {
    e.preventDefault();
    const priceUsd = parseFloat(offerInput);
    if (Number.isNaN(priceUsd) || priceUsd <= 0) {
      setError("Enter a valid price");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/negotiations/sessions/${session.id}/offers`, {
        price_minor: Math.round(priceUsd * 100),
        sender_role: role,
        idempotency_key: `manual_${session.id}_${Date.now()}`,
      });
      setOfferInput("");
      // Reload full data after submit
      const fullData = await api.get<{
        session: NegotiationSession & { version: number };
        rounds: Round[];
      }>(`/negotiations/sessions/${session.id}`);
      setSession(fullData.session);
      setRounds(fullData.rounds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit offer");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      await api.patch(`/negotiations/sessions/${session.id}/accept`);
      setSession((prev) => ({ ...prev, status: "ACCEPTED" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept");
    } finally {
      setAccepting(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    setError(null);
    try {
      await api.patch(`/negotiations/sessions/${session.id}/reject`);
      setSession((prev) => ({ ...prev, status: "REJECTED" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setRejecting(false);
    }
  }

  const badge = statusBadge(session.status);

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      {/* Back */}
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink transition-colors mb-6"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1">Negotiation</h1>
          <p className="text-xs text-ink-muted font-mono">{session.id}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.color}`}>
          {badge.label}
        </span>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border border-line bg-surface-raised/50 p-3 text-center">
          <p className="text-lg font-bold text-ink">{session.current_round}</p>
          <p className="text-xs text-ink-muted">Round</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-raised/50 p-3 text-center">
          <p className="text-lg font-bold text-ink">
            {formatMinor(session.last_offer_price_minor)}
          </p>
          <p className="text-xs text-ink-muted">Last Offer</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-raised/50 p-3 text-center">
          <p className="text-lg font-bold text-ink">
            {session.last_utility !== null ? (session.last_utility * 100).toFixed(0) + "%" : "—"}
          </p>
          <p className="text-xs text-ink-muted">Utility</p>
        </div>
      </div>

      {/* Round History */}
      <div className="rounded-xl border border-line bg-surface-raised/50 mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-action-primary"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-sm font-semibold text-ink">Round History</span>
          <span className="ml-auto text-xs text-ink-muted">{rounds.length} rounds</span>
        </div>

        {rounds.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-sm">
            No rounds yet. Submit an offer to begin.
          </div>
        ) : (
          <div className="space-y-1 max-h-[500px] overflow-y-auto p-4">
            {rounds.map((round) => {
              const isMine = round.sender_role === role;
              // Show counterparty message if available and we're the other side
              const displayMessage = isMine
                ? round.message
                : (round.message_counterparty ?? round.message);

              return (
                <div
                  key={round.id}
                  className={`flex ${isMine ? "justify-end" : "justify-start"} animate-fade-in`}
                >
                  <div
                    className={`rounded-xl px-4 py-3 max-w-sm sm:max-w-md ${
                      isMine
                        ? "bg-badge border border-line"
                        : "bg-surface-sunken border border-line"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs font-semibold ${isMine ? "text-action-primary" : "text-ink-secondary"}`}
                      >
                        {isMine
                          ? "🤖 Your AI"
                          : round.sender_role === "BUYER"
                            ? "🤖 Buyer AI"
                            : "🤖 Seller AI"}{" "}
                        · R{round.round_no}
                      </span>
                      {round.decision && (
                        <span className={`text-xs font-medium ${decisionBadge(round.decision)}`}>
                          {round.decision}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-ink-muted">
                        {timeAgo(round.created_at)}
                      </span>
                    </div>

                    {/* Natural language message bubble */}
                    {displayMessage && (
                      <p className="text-sm text-ink whitespace-pre-wrap mb-2">{displayMessage}</p>
                    )}

                    {/* Price */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {round.price_minor !== null && (
                        <span
                          className={`text-lg font-bold ${isMine ? "text-action-primary" : "text-info"}`}
                        >
                          {formatMinor(round.price_minor)}
                        </span>
                      )}
                      {round.counter_price_minor !== null && (
                        <span className="text-sm text-ink-secondary">
                          → {formatMinor(round.counter_price_minor)}
                        </span>
                      )}
                      {round.utility !== null && (
                        <span className="text-xs text-ink-muted ml-auto">
                          {(round.utility * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    {/* Skills applied badges */}
                    {round.skills_applied && round.skills_applied.length > 0 && (
                      <div className="flex items-center gap-1 mt-2 flex-wrap">
                        {round.skills_applied.map((skill) => (
                          <span
                            key={skill.id}
                            className="inline-flex items-center gap-0.5 rounded-full bg-surface-sunken/50 px-2 py-0.5 text-[10px] text-ink-secondary"
                            title={`${skill.name} (${skill.verification_status})`}
                          >
                            {skill.badge} {skill.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-error/20 bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Terminal state banner */}
      {isTerminal && (
        <div
          className={`mb-4 rounded-xl border p-4 text-center ${
            session.status === "ACCEPTED"
              ? "border-success/30 bg-success-soft"
              : "border-line bg-surface-sunken/50"
          }`}
        >
          <p
            className={`font-semibold ${session.status === "ACCEPTED" ? "text-success" : "text-ink-secondary"}`}
          >
            {session.status === "ACCEPTED" && "Deal accepted!"}
            {session.status === "REJECTED" && "Negotiation rejected"}
            {session.status === "EXPIRED" && "Session expired"}
            {session.status === "SUPERSEDED" && "Session superseded"}
          </p>
          {session.status === "ACCEPTED" && session.last_offer_price_minor && (
            <p className="text-2xl font-bold text-ink mt-1">
              {formatMinor(session.last_offer_price_minor)}
            </p>
          )}
          {role === "BUYER" && (
            <div className="mt-3">
              <Link
                href={`/disputes/new?orderId=${encodeURIComponent(session.id)}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-error/20 bg-error-soft px-3 py-1.5 text-xs font-medium text-error hover:bg-error-soft transition-colors"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                Report Issue
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Offer input + action buttons (only when not terminal) */}
      {!isTerminal && (
        <div className="space-y-3">
          <form onSubmit={handleSubmitOffer} className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary text-sm">
                $
              </span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Your offer price"
                value={offerInput}
                onChange={(e) => setOfferInput(e.target.value)}
                disabled={submitting}
                className="w-full rounded-xl border border-line bg-surface-raised pl-7 pr-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-focus focus:outline-none disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !offerInput}
              className="rounded-xl bg-action-primary px-5 py-3 text-sm font-semibold text-on-accent hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              {submitting ? "Sending..." : "Send Offer"}
            </button>
          </form>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={accepting || rejecting}
              onClick={handleAccept}
              className="flex-1 rounded-xl border border-success/30 bg-success-soft py-2.5 text-sm font-medium text-success hover:bg-success-soft disabled:opacity-40 transition-colors"
            >
              {accepting ? "Accepting..." : "Accept Deal"}
            </button>
            <button
              type="button"
              disabled={accepting || rejecting}
              onClick={handleReject}
              className="flex-1 rounded-xl border border-error/20 bg-error-soft py-2.5 text-sm font-medium text-error hover:bg-error-soft disabled:opacity-40 transition-colors"
            >
              {rejecting ? "Rejecting..." : "Reject"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
