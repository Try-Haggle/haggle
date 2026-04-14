"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useNegotiationWs } from "@/hooks/use-negotiation-ws";
import type { NegotiationSession } from "./page";

interface SkillBadge {
  id: string;
  name: string;
  type: string;
  badge: string;
  verification_status: string;
}

interface Round {
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

interface SessionState {
  status: string;
  current_round: number;
  last_offer_price_minor: number | null;
  last_utility: number | null;
  version: number;
  updated_at: string;
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
    CREATED: { label: "Created", color: "text-slate-400 bg-slate-800" },
    ACTIVE: { label: "Active", color: "text-cyan-400 bg-cyan-500/10" },
    NEAR_DEAL: { label: "Near Deal", color: "text-emerald-400 bg-emerald-500/10" },
    STALLED: { label: "Stalled", color: "text-amber-400 bg-amber-500/10" },
    ACCEPTED: { label: "Accepted", color: "text-emerald-400 bg-emerald-500/15 font-semibold" },
    REJECTED: { label: "Rejected", color: "text-red-400 bg-red-500/10" },
    EXPIRED: { label: "Expired", color: "text-slate-500 bg-slate-800" },
    SUPERSEDED: { label: "Superseded", color: "text-slate-500 bg-slate-800" },
    WAITING: { label: "Waiting", color: "text-amber-400 bg-amber-500/10" },
  };
  return map[status] ?? { label: status, color: "text-slate-400 bg-slate-800" };
}

function decisionBadge(decision: string | null): string {
  if (!decision) return "";
  const map: Record<string, string> = {
    ACCEPT: "text-emerald-400",
    REJECT: "text-red-400",
    COUNTER: "text-cyan-400",
    NEAR_DEAL: "text-amber-400",
    ESCALATE: "text-purple-400",
  };
  return map[decision] ?? "text-slate-400";
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
  const { connectionMode } = useNegotiationWs({
    sessionId: session.id,
    onUpdate: reloadSession,
    isTerminal,
  });

  async function handleSubmitOffer(e: React.FormEvent) {
    e.preventDefault();
    const priceUsd = parseFloat(offerInput);
    if (isNaN(priceUsd) || priceUsd <= 0) {
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
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white mb-1">Negotiation</h1>
          <p className="text-xs text-slate-500 font-mono">{session.id}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.color}`}>
          {badge.label}
        </span>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-3 text-center">
          <p className="text-lg font-bold text-white">{session.current_round}</p>
          <p className="text-xs text-slate-500">Round</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-3 text-center">
          <p className="text-lg font-bold text-white">{formatMinor(session.last_offer_price_minor)}</p>
          <p className="text-xs text-slate-500">Last Offer</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-3 text-center">
          <p className="text-lg font-bold text-white">
            {session.last_utility !== null ? (session.last_utility * 100).toFixed(0) + "%" : "—"}
          </p>
          <p className="text-xs text-slate-500">Utility</p>
        </div>
      </div>

      {/* Round History */}
      <div className="rounded-xl border border-slate-800 bg-bg-card/50 mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-sm font-semibold text-white">Round History</span>
          <span className="ml-auto text-xs text-slate-500">{rounds.length} rounds</span>
        </div>

        {rounds.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No rounds yet. Submit an offer to begin.
          </div>
        ) : (
          <div className="space-y-1 max-h-[500px] overflow-y-auto p-4">
            {rounds.map((round) => {
              const isMine = round.sender_role === role;
              // Show counterparty message if available and we're the other side
              const displayMessage = isMine
                ? round.message
                : round.message_counterparty ?? round.message;

              return (
                <div
                  key={round.id}
                  className={`flex ${isMine ? "justify-end" : "justify-start"} animate-fade-in`}
                >
                  <div
                    className={`rounded-xl px-4 py-3 max-w-sm sm:max-w-md ${
                      isMine
                        ? "bg-cyan-500/10 border border-cyan-500/20"
                        : "bg-slate-800 border border-slate-700"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold ${isMine ? "text-cyan-400" : "text-slate-400"}`}>
                        {isMine ? "🤖 Your AI" : round.sender_role === "BUYER" ? "🤖 Buyer AI" : "🤖 Seller AI"} · R{round.round_no}
                      </span>
                      {round.decision && (
                        <span className={`text-xs font-medium ${decisionBadge(round.decision)}`}>
                          {round.decision}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-slate-600">{timeAgo(round.created_at)}</span>
                    </div>

                    {/* Natural language message bubble */}
                    {displayMessage && (
                      <p className="text-sm text-slate-200 whitespace-pre-wrap mb-2">
                        {displayMessage}
                      </p>
                    )}

                    {/* Price */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {round.price_minor !== null && (
                        <span className={`text-lg font-bold ${isMine ? "text-cyan-400" : "text-blue-400"}`}>
                          {formatMinor(round.price_minor)}
                        </span>
                      )}
                      {round.counter_price_minor !== null && (
                        <span className="text-sm text-slate-400">
                          → {formatMinor(round.counter_price_minor)}
                        </span>
                      )}
                      {round.utility !== null && (
                        <span className="text-xs text-slate-500 ml-auto">
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
                            className="inline-flex items-center gap-0.5 rounded-full bg-slate-700/50 px-2 py-0.5 text-[10px] text-slate-400"
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
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Terminal state banner */}
      {isTerminal && (
        <div className={`mb-4 rounded-xl border p-4 text-center ${
          session.status === "ACCEPTED"
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-slate-700 bg-slate-800/50"
        }`}>
          <p className={`font-semibold ${session.status === "ACCEPTED" ? "text-emerald-400" : "text-slate-400"}`}>
            {session.status === "ACCEPTED" && "Deal accepted!"}
            {session.status === "REJECTED" && "Negotiation rejected"}
            {session.status === "EXPIRED" && "Session expired"}
            {session.status === "SUPERSEDED" && "Session superseded"}
          </p>
          {session.status === "ACCEPTED" && session.last_offer_price_minor && (
            <p className="text-2xl font-bold text-white mt-1">
              {formatMinor(session.last_offer_price_minor)}
            </p>
          )}
          {role === "BUYER" && (
            <div className="mt-3">
              <Link
                href={`/disputes/new?orderId=${encodeURIComponent(session.id)}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Your offer price"
                value={offerInput}
                onChange={(e) => setOfferInput(e.target.value)}
                disabled={submitting}
                className="w-full rounded-xl border border-slate-700 bg-bg-card pl-7 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !offerInput}
              className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              {submitting ? "Sending..." : "Send Offer"}
            </button>
          </form>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={accepting || rejecting}
              onClick={handleAccept}
              className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
            >
              {accepting ? "Accepting..." : "Accept Deal"}
            </button>
            <button
              type="button"
              disabled={accepting || rejecting}
              onClick={handleReject}
              className="flex-1 rounded-xl border border-red-500/20 bg-red-500/5 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
            >
              {rejecting ? "Rejecting..." : "Reject"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
