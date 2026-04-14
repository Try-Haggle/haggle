"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import type { ListingDetail } from "./page";
import { useAmplitude } from "@/providers/amplitude-provider";
import { api } from "@/lib/api-client";
import { AttestationWizard } from "./attestation-wizard";

interface AttestationStatus {
  listingId: string;
  committed: boolean;
  imei?: string;
  batteryHealthPct?: number;
  findMyOff?: boolean;
  createdAt?: string;
}

interface NegotiationSession {
  id: string;
  listing_id: string;
  status: string;
  current_round: number;
  last_offer_price_minor: number | null;
  created_at: string;
  updated_at: string;
}

function formatMinorPrice(priceMinor: number | null): string {
  if (priceMinor === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceMinor / 100);
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "text-cyan-400 bg-cyan-500/10",
    NEAR_DEAL: "text-emerald-400 bg-emerald-500/10",
    ACCEPTED: "text-emerald-400 bg-emerald-500/15",
    REJECTED: "text-red-400 bg-red-500/10",
    STALLED: "text-amber-400 bg-amber-500/10",
    EXPIRED: "text-slate-500 bg-slate-800",
    WAITING: "text-amber-400 bg-amber-500/10",
  };
  return map[status] ?? "text-slate-400 bg-slate-800";
}

function negoTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DetailContent({ listing, sellerId }: { listing: ListingDetail; sellerId?: string }) {
  const [copied, setCopied] = useState(false);
  const [sessions, setSessions] = useState<NegotiationSession[]>([]);
  const [attestation, setAttestation] = useState<AttestationStatus | null>(null);
  const [attestationLoading, setAttestationLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!sellerId) return;
    api
      .get<{ sessions: NegotiationSession[] }>(
        `/negotiations/sessions?user_id=${sellerId}&role=SELLER`,
      )
      .then((data) => {
        const filtered = (data.sessions ?? []).filter(
          (s) => s.listing_id === listing.id,
        );
        setSessions(filtered);
      })
      .catch(() => {
        // API down — no sessions shown
      });
  }, [sellerId, listing.id]);

  useEffect(() => {
    setAttestationLoading(true);
    api
      .get<AttestationStatus>(`/api/attestation/${listing.id}`)
      .then((data) => setAttestation(data))
      .catch(() => setAttestation(null))
      .finally(() => setAttestationLoading(false));
  }, [listing.id]);

  const shareUrl = `${origin}/l/${listing.publicId}`;
  const price = listing.targetPrice
    ? `$${Number(listing.targetPrice).toLocaleString()}`
    : "\u2014";

  const agentPreset = listing.strategyConfig?.preset as string | undefined;
  const agentLabel = agentPreset
    ? agentPreset.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  const timeLeft = useTimeLeft(listing.sellingDeadline);

  const { track } = useAmplitude();

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    track("Share Link Copied", { public_id: listing.publicId, source: "listing_detail" });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-6xl mx-auto">
      {/* Back link */}
      <Link
        href="/sell/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400 shrink-0">
              <rect x="3" y="3" width="6" height="18" rx="1" />
              <rect x="9" y="9" width="6" height="12" rx="1" />
              <rect x="15" y="6" width="6" height="15" rx="1" />
            </svg>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{listing.title ?? "Untitled"}</h1>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
              {listing.status === "published" ? "active" : listing.status}
            </span>
          </div>
          <p className="text-sm text-slate-400">
            Asking <span className="font-semibold text-white">{price}</span>
            {agentLabel && (
              <>
                {" \u00b7 Agent: "}
                <span className="text-cyan-400">{agentLabel}</span>
              </>
            )}
          </p>
        </div>

        {/* Share URL */}
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 rounded-full border border-slate-700 bg-bg-card px-4 py-2 text-sm text-slate-300 hover:border-slate-600 transition-colors shrink-0 self-start cursor-pointer"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span className="max-w-32 sm:max-w-50 truncate">{shareUrl}</span>
          {copied ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 shrink-0">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* KPI Cards */}
      {(() => {
        const totalCount = sessions.length;
        const withOffers = sessions.filter((s) => s.last_offer_price_minor !== null);
        const avgOffer = withOffers.length > 0
          ? Math.round(withOffers.reduce((acc, s) => acc + (s.last_offer_price_minor ?? 0), 0) / withOffers.length)
          : null;
        const bestOffer = withOffers.length > 0
          ? Math.max(...withOffers.map((s) => s.last_offer_price_minor ?? 0))
          : null;
        return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          iconColor="text-cyan-400"
          iconBg="bg-cyan-500/10"
          value={String(totalCount)}
          label="Total Negotiations"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          value={avgOffer !== null ? formatMinorPrice(avgOffer) : "\u2014"}
          label="Avg. Offer Price"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          }
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          value={bestOffer !== null ? formatMinorPrice(bestOffer) : "\u2014"}
          label="Best Offer"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          iconColor={timeLeft.expired ? "text-red-400" : "text-amber-400"}
          iconBg={timeLeft.expired ? "bg-red-500/10" : "bg-amber-500/10"}
          value={timeLeft.label}
          label="Time Left"
        />
      </div>
        );
      })()}

      {/* Attestation Status */}
      <div className="mb-8">
        <h2 className="text-lg font-bold text-white mb-4">Verification</h2>
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-4 flex items-center gap-4">
          {attestationLoading ? (
            <p className="text-sm text-slate-500">Checking verification status...</p>
          ) : attestation?.committed ? (
            <>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-400">Verified</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  IMEI verified · Battery {attestation.batteryHealthPct}% · Find My off
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">Not Verified</p>
                <p className="text-xs text-slate-400 mt-0.5">Complete attestation to increase buyer confidence</p>
              </div>
              <button
                type="button"
                onClick={() => setShowWizard(true)}
                className="shrink-0 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-600 transition-colors"
              >
                Complete Attestation
              </button>
            </>
          )}
        </div>
      </div>

      {/* Negotiation History */}
      <h2 className="text-lg font-bold text-white mb-4">Negotiation History</h2>
      {sessions.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-300 mb-1">No negotiations yet</h3>
          <p className="text-sm text-slate-500">
            Share your link to start receiving offers from buyers&apos; AI agents
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((neg) => (
            <Link
              key={neg.id}
              href={`/sell/negotiations/${neg.id}`}
              className="flex items-center gap-3 sm:gap-4 rounded-xl border border-slate-800 bg-bg-card/50 p-3 sm:p-4 hover:border-slate-700 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-sm font-semibold text-white truncate font-mono">
                    {neg.id.slice(0, 8)}...
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(neg.status)}`}>
                    {neg.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Round {neg.current_round} · Last offer: {formatMinorPrice(neg.last_offer_price_minor)}
                </p>
              </div>
              <div className="shrink-0 text-right mr-1">
                <p className="text-xs text-slate-500">{negoTimeAgo(neg.updated_at)}</p>
              </div>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {showWizard && (
        <AttestationWizard
          listingId={listing.id}
          onComplete={() => {
            setShowWizard(false);
            setAttestation({ listingId: listing.id, committed: true });
          }}
          onCancel={() => setShowWizard(false)}
        />
      )}
    </main>
  );
}

function computeTimeLeft(deadline: string | null): { label: string; expired: boolean } {
  if (!deadline) return { label: "\u2014", expired: false };

  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { label: "Expired", expired: true };

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return { label: `${days}d ${hours}h`, expired: false };
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return { label: `${hours}h ${mins}m`, expired: false };
}

function useTimeLeft(deadline: string | null) {
  const [timeLeft, setTimeLeft] = useState(() => computeTimeLeft(deadline));

  useEffect(() => {
    if (!deadline) return;

    const update = () => setTimeLeft(computeTimeLeft(deadline));
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [deadline]);

  return timeLeft;
}

function KpiCard({
  icon,
  iconColor,
  iconBg,
  value,
  label,
}: {
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-4">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}
