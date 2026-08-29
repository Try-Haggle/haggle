"use client";

import { AlertCircle, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { OpenConversationButton } from "@/components/messaging/open-conversation-button";
import {
  Alert,
  BackLink,
  Badge,
  Button,
  buttonVariants,
  ChatBubble,
  Input,
  MessageList,
  StatTile,
} from "@/components/ui";
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

/**
 * Show cents only when the offer actually has them. Rounding to whole dollars made
 * the badge read "$218" above a message that said "$217.75" — one offer shown as two
 * numbers. Cents are kept rather than stripped everywhere because a cheap item is
 * genuinely negotiated in them.
 */
function formatPrice(priceMajor: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
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

type StatusTone = "gold" | "success" | "info" | "warning" | "error" | "neutral";

const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  CREATED: { label: "Created", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "gold" },
  NEAR_DEAL: { label: "Near Deal", tone: "success" },
  STALLED: { label: "Stalled", tone: "warning" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  REJECTED: { label: "Rejected", tone: "error" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
  WAITING: { label: "Waiting", tone: "warning" },
};

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

  const isTerminal = TERMINAL_STATUSES.has(session.status);
  const backHref = role === "BUYER" ? "/buy/dashboard" : "/sell/dashboard";

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

  const status = STATUS_META[session.status] ?? {
    label: session.status,
    tone: "neutral" as const,
  };

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-3xl px-4 py-6 sm:p-6">
      {/* Back */}
      <BackLink href={backHref} className="mb-6">
        Dashboard
      </BackLink>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 font-bold text-ink text-xl">Negotiation</h1>
          <p className="font-mono text-ink-muted text-xs">{session.id}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {/* Humans talk once the agents have something to talk about. */}
          <OpenConversationButton
            sessionId={session.id}
            label={role === "BUYER" ? "Message seller" : "Message buyer"}
          />
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatTile size="sm" align="center" label="Round" value={session.current_round} />
        <StatTile
          size="sm"
          align="center"
          label="Last Offer"
          value={formatMinor(session.last_offer_price_minor)}
        />
        <StatTile
          size="sm"
          align="center"
          label="Utility"
          value={
            session.last_utility !== null ? `${(session.last_utility * 100).toFixed(0)}%` : "—"
          }
        />
      </div>

      {/* Round History */}
      <div className="mb-4 overflow-hidden rounded-xl border border-line bg-surface-raised/50">
        <div className="flex items-center gap-2 border-line border-b px-4 py-3">
          <MessageSquare className="size-4 text-action-primary" aria-hidden="true" />
          <span className="font-semibold text-ink text-sm">Round History</span>
          <span className="ml-auto text-ink-muted text-xs">{rounds.length} rounds</span>
        </div>

        {rounds.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-sm">
            No rounds yet. Submit an offer to begin.
          </div>
        ) : (
          <MessageList className="max-h-[500px] gap-1 p-4">
            {rounds.map((round) => {
              const isMine = round.sender_role === role;
              // Show counterparty message if available and we're the other side
              const displayMessage = isMine
                ? round.message
                : (round.message_counterparty ?? round.message);

              return (
                <ChatBubble
                  key={round.id}
                  side={isMine ? "right" : "left"}
                  className="animate-fade-in"
                  author={
                    <span className="flex w-full items-center gap-2">
                      <span
                        className={`font-semibold ${isMine ? "text-action-primary" : "text-ink-secondary"}`}
                      >
                        {isMine
                          ? "🤖 Your AI"
                          : round.sender_role === "BUYER"
                            ? "🤖 Buyer AI"
                            : "🤖 Seller AI"}{" "}
                        · R{round.round_no}
                      </span>
                      {round.decision && (
                        <span className={`font-medium ${decisionBadge(round.decision)}`}>
                          {round.decision}
                        </span>
                      )}
                      <span className="ml-auto font-normal text-ink-muted">
                        {timeAgo(round.created_at)}
                      </span>
                    </span>
                  }
                >
                  {/* Natural language message bubble */}
                  {displayMessage && (
                    <p className="mb-2 whitespace-pre-wrap text-ink text-sm">{displayMessage}</p>
                  )}

                  {/* Price */}
                  <div className="flex flex-wrap items-center gap-3">
                    {round.price_minor !== null && (
                      <span
                        className={`font-bold text-lg ${isMine ? "text-action-primary" : "text-info"}`}
                      >
                        {formatMinor(round.price_minor)}
                      </span>
                    )}
                    {round.counter_price_minor !== null && (
                      <span className="text-ink-secondary text-sm">
                        → {formatMinor(round.counter_price_minor)}
                      </span>
                    )}
                    {round.utility !== null && (
                      <span className="ml-auto text-ink-muted text-xs">
                        {(round.utility * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {/* Skills applied badges */}
                  {round.skills_applied && round.skills_applied.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
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
                </ChatBubble>
              );
            })}
          </MessageList>
        )}
      </div>

      {/* Error */}
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Terminal state banner — bespoke centered result box (Alert is left-aligned with an
          icon; ResultState has no surrounding box), so kept custom. */}
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
            <p className="mt-1 font-bold text-2xl text-ink">
              {formatMinor(session.last_offer_price_minor)}
            </p>
          )}
          {role === "BUYER" && (
            <div className="mt-3">
              <Link
                href={`/disputes/new?orderId=${encodeURIComponent(session.id)}`}
                className={buttonVariants({ variant: "destructive", size: "sm" })}
              >
                <AlertCircle className="size-3.5" />
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
            <div className="flex-1">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Your offer price"
                value={offerInput}
                onChange={(e) => setOfferInput(e.target.value)}
                disabled={submitting}
                startAdornment="$"
              />
            </div>
            <Button type="submit" loading={submitting} disabled={!offerInput}>
              {submitting ? "Sending..." : "Send Offer"}
            </Button>
          </form>

          <div className="flex gap-2">
            <Button
              variant="success"
              className="flex-1"
              loading={accepting}
              disabled={accepting || rejecting}
              onClick={handleAccept}
            >
              {accepting ? "Accepting..." : "Accept Deal"}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              loading={rejecting}
              disabled={accepting || rejecting}
              onClick={handleReject}
            >
              {rejecting ? "Rejecting..." : "Reject"}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
