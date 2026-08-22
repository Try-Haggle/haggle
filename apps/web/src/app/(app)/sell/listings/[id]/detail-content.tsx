"use client";

import {
  AlertCircle,
  BarChart3,
  Check,
  Clock,
  DollarSign,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  BackLink,
  Badge,
  Button,
  CopyButton,
  EmptyState,
  ListRow,
  PageHeader,
  StatTile,
} from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatTimeAgo } from "@/lib/format";
import { useAmplitude } from "@/providers/amplitude-provider";
import { AttestationWizard } from "./attestation-wizard";
import type { ListingDetail } from "./page";

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

type StatusTone = "gold" | "success" | "info" | "warning" | "error" | "neutral";

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "gold",
  NEAR_DEAL: "success",
  ACCEPTED: "success",
  REJECTED: "error",
  STALLED: "warning",
  WAITING: "warning",
  EXPIRED: "neutral",
};

function formatMinorPrice(priceMinor: number | null): string {
  if (priceMinor === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceMinor / 100);
}

export function DetailContent({
  listing,
  sellerId,
}: {
  listing: ListingDetail;
  sellerId?: string;
}) {
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
        const filtered = (data.sessions ?? []).filter((s) => s.listing_id === listing.id);
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
  const price = listing.targetPrice ? `$${Number(listing.targetPrice).toLocaleString()}` : "—";

  const agentPreset = listing.negotiationAgentSnapshot?.preset as string | undefined;
  const agentLabel = agentPreset
    ? agentPreset.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  const timeLeft = useTimeLeft(listing.sellingDeadline);

  const { track } = useAmplitude();

  const totalCount = sessions.length;
  const withOffers = sessions.filter((s) => s.last_offer_price_minor !== null);
  const avgOffer =
    withOffers.length > 0
      ? Math.round(
          withOffers.reduce((acc, s) => acc + (s.last_offer_price_minor ?? 0), 0) /
            withOffers.length,
        )
      : null;
  const bestOffer =
    withOffers.length > 0
      ? Math.max(...withOffers.map((s) => s.last_offer_price_minor ?? 0))
      : null;

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-4 py-6 sm:p-6">
      <BackLink href="/sell/dashboard" className="mb-6">
        Dashboard
      </BackLink>

      {/* Header */}
      <PageHeader
        className="mb-8"
        icon={<BarChart3 className="size-6" />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {listing.title ?? "Untitled"}
            <Badge tone="success" size="sm">
              {listing.status === "published" ? "active" : listing.status}
            </Badge>
          </span>
        }
        subtitle={
          <>
            Asking <span className="font-semibold text-ink">{price}</span>
            {agentLabel && (
              <>
                {" · Agent: "}
                <span className="text-action-primary">{agentLabel}</span>
              </>
            )}
          </>
        }
        actions={
          <CopyButton
            value={shareUrl}
            onCopy={() =>
              track("Share Link Copied", { public_id: listing.publicId, source: "listing_detail" })
            }
            className="rounded-full"
            label={<span className="max-w-32 truncate sm:max-w-[12.5rem]">{shareUrl}</span>}
          />
        }
      />

      {/* KPI Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          icon={<MessageSquare className="size-5" />}
          iconTone="accent"
          value={String(totalCount)}
          label="Total Negotiations"
        />
        <StatTile
          icon={<DollarSign className="size-5" />}
          iconTone="success"
          value={avgOffer !== null ? formatMinorPrice(avgOffer) : "—"}
          label="Avg. Offer Price"
        />
        <StatTile
          icon={<TrendingUp className="size-5" />}
          iconTone="info"
          value={bestOffer !== null ? formatMinorPrice(bestOffer) : "—"}
          label="Best Offer"
        />
        <StatTile
          icon={<Clock className="size-5" />}
          iconTone={timeLeft.expired ? "error" : "warning"}
          value={timeLeft.label}
          label="Time Left"
        />
      </div>

      {/* Attestation Status */}
      <div className="mb-8">
        <h2 className="mb-4 font-bold text-ink text-lg">Verification</h2>
        <div className="flex items-center gap-4 rounded-xl border border-line bg-surface-raised/50 p-4">
          {attestationLoading ? (
            <p className="text-ink-muted text-sm">Checking verification status...</p>
          ) : attestation?.committed ? (
            <>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                <Check className="size-[18px]" strokeWidth={2.5} />
              </div>
              <div>
                <p className="font-semibold text-sm text-success">Verified</p>
                <p className="mt-0.5 text-ink-secondary text-xs">
                  IMEI verified · Battery {attestation.batteryHealthPct}% · Find My off
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
                <AlertCircle className="size-[18px]" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-ink text-sm">Not Verified</p>
                <p className="mt-0.5 text-ink-secondary text-xs">
                  Complete attestation to increase buyer confidence
                </p>
              </div>
              <Button size="sm" className="shrink-0" onClick={() => setShowWizard(true)}>
                Complete Attestation
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Negotiation History */}
      <h2 className="mb-4 font-bold text-ink text-lg">Negotiation History</h2>
      {sessions.length === 0 ? (
        <EmptyState
          className="bg-surface-raised/50"
          icon={<Clock className="size-6" />}
          title="No negotiations yet"
          description="Share your link to start receiving offers from buyers' AI agents"
        />
      ) : (
        <div className="space-y-3">
          {sessions.map((neg) => (
            <ListRow
              key={neg.id}
              href={`/sell/negotiations/${neg.id}`}
              showChevron
              title={<span className="font-mono">{neg.id.slice(0, 8)}...</span>}
              badges={
                <Badge tone={STATUS_TONE[neg.status] ?? "neutral"} size="sm">
                  {neg.status}
                </Badge>
              }
              meta={`Round ${neg.current_round} · Last offer: ${formatMinorPrice(neg.last_offer_price_minor)}`}
              trailing={
                <span className="text-ink-muted text-xs">{formatTimeAgo(neg.updated_at)}</span>
              }
            />
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
  if (!deadline) return { label: "—", expired: false };

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
