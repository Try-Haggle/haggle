"use client";

import {
  BarChart3,
  Check,
  DollarSign,
  ImageOff,
  MessageSquare,
  Pencil,
  Plus,
  Share2,
  Tag,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  buttonVariants,
  EmptyState,
  IconButton,
  ListRow,
  PageHeader,
  StatTile,
} from "@/components/ui";
import { formatCondition, formatPrice, formatTimeAgo } from "@/lib/format";
import { useAmplitude } from "@/providers/amplitude-provider";
import type { DraftSummary, ListingSummary } from "./page";

export function DashboardContent({
  claimResult,
  listings,
  drafts = [],
}: {
  claimResult: { ok: boolean; error?: string } | null;
  listings: ListingSummary[];
  drafts?: DraftSummary[];
}) {
  const { track } = useAmplitude();
  const activeCount = listings.filter((l) => l.status === "published").length;

  // Claim Token Used (1회)
  const claimTracked = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: track once on mount
  useEffect(() => {
    if (claimTracked.current) return;
    claimTracked.current = true;
    if (claimResult?.ok) {
      track("Claim Token Used", { source: "chatgpt_mcp" });
    }
  }, []);

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-4 py-6 sm:p-6">
      {/* Claim Result Banner */}
      {claimResult && (
        <Alert tone={claimResult.ok ? "success" : "error"} className="mb-6">
          {claimResult.ok
            ? "Listing claimed successfully! It's now linked to your account."
            : claimResult.error === "expired"
              ? "This claim link has expired. Listings must be claimed within 24 hours."
              : claimResult.error === "already_claimed"
                ? "This listing has already been claimed."
                : claimResult.error === "invalid_token"
                  ? "Invalid claim link. Please check your link and try again."
                  : "Failed to process claim. Please try again."}
        </Alert>
      )}

      {/* Header */}
      <PageHeader
        className="mb-8"
        icon={<BarChart3 className="size-6" />}
        title="Seller Dashboard"
        subtitle="Manage your listings and track AI negotiations"
        actions={
          <Link href="/sell/listings/new" className={buttonVariants({ variant: "primary" })}>
            <Plus className="size-4" />
            New Listing
          </Link>
        }
      />

      {/* KPI Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          icon={<Tag className="size-5" />}
          iconTone="accent"
          value={String(activeCount)}
          label="Active Listings"
        />
        <StatTile
          icon={<MessageSquare className="size-5" />}
          iconTone="info"
          value="0"
          label="Total Negotiations"
        />
        <StatTile
          icon={<TrendingUp className="size-5" />}
          iconTone="success"
          value="0"
          label="Deals Closed"
        />
        <StatTile
          icon={<DollarSign className="size-5" />}
          iconTone="warning"
          value="$0"
          label="Revenue"
        />
      </div>

      {/* Drafts Section */}
      {drafts.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 font-bold text-ink text-lg">Drafts</h2>
          <div className="space-y-3">
            {drafts.map((draft) => (
              <DraftCard key={draft.id} draft={draft} />
            ))}
          </div>
        </div>
      )}

      {/* Listings Section */}
      <h2 className="mb-4 font-bold text-ink text-lg">Your Listings</h2>

      {listings.length === 0 ? (
        <EmptyState
          className="bg-surface-raised/50"
          icon={<Tag className="size-6" />}
          title="No listings yet"
          description={
            <>
              Create one with <span className="font-mono text-action-primary">/haggle</span> in
              ChatGPT, then claim it to see it here.
            </>
          }
        />
      ) : (
        <div className="space-y-3">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </main>
  );
}

function ListingCard({ listing }: { listing: ListingSummary }) {
  const price = listing.targetPrice ? formatPrice(Number(listing.targetPrice)) : "—";
  const conditionLabel = listing.condition ? formatCondition(listing.condition) : null;
  const meta = [conditionLabel, listing.category].filter(Boolean).join(" · ");

  return (
    <ListRow
      href={`/sell/listings/${listing.id}`}
      showChevron
      leading={
        <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken sm:size-14">
          {listing.photoUrl ? (
            // biome-ignore lint/performance/noImgElement: remote listing photo
            <img
              src={listing.photoUrl}
              alt={listing.title ?? "Listing"}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageOff className="size-6 text-ink-muted" />
          )}
        </div>
      }
      title={listing.title ?? "Untitled"}
      badges={
        <Badge tone="success" size="sm">
          {listing.status === "published" ? "active" : listing.status}
        </Badge>
      }
      meta={meta || undefined}
      trailing={
        <div className="flex items-center gap-3">
          <div>
            <p className="font-semibold text-ink text-sm sm:text-base">{price}</p>
            <p className="text-ink-secondary text-xs sm:text-sm">0 negotiations</p>
          </div>
          <span className="hidden sm:inline-flex">
            <ShareButton publicId={listing.publicId} />
          </span>
        </div>
      }
    />
  );
}

function DraftCard({ draft }: { draft: DraftSummary }) {
  const updatedAgo = formatTimeAgo(draft.updatedAt);

  return (
    <ListRow
      href={`/sell/listings/new?draftId=${draft.id}`}
      showChevron
      className="border-dashed bg-surface-raised/30"
      leading={
        <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken sm:size-14">
          {draft.photoUrl ? (
            // biome-ignore lint/performance/noImgElement: remote draft photo
            <img
              src={draft.photoUrl}
              alt={draft.title ?? "Draft"}
              className="h-full w-full object-cover"
            />
          ) : (
            <Pencil className="size-6 text-ink-muted" />
          )}
        </div>
      }
      title={draft.draftName || draft.title || "Untitled Draft"}
      badges={
        <Badge tone="warning" size="sm">
          draft
        </Badge>
      }
      meta={draft.title ? `${draft.title} · ${updatedAgo}` : updatedAgo}
      trailing={
        <span className="hidden font-medium text-action-primary text-xs sm:inline">Resume</span>
      }
    />
  );
}

function ShareButton({ publicId }: { publicId: string }) {
  const [copied, setCopied] = useState(false);
  const { track } = useAmplitude();

  return (
    <IconButton
      variant="ghost"
      aria-label="Copy share link"
      title="Copy share link"
      className="size-8"
      onClick={(e) => {
        e.preventDefault();
        const url = `${window.location.origin}/l/${publicId}`;
        navigator.clipboard.writeText(url);
        track("Share Link Copied", { public_id: publicId, source: "dashboard" });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-4 text-success" /> : <Share2 className="size-4" />}
    </IconButton>
  );
}
