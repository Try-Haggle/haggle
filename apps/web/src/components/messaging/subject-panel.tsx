"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AskingPrice,
  Countdown,
  ItemFacts,
  ItemPhoto,
  OpponentCard,
  RequiredQuestions,
} from "@/components/listing-detail";
import { buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { formatPrice, formatTimeAgo } from "@/lib/format";
import { type ConversationOutcome, messagingApi, type SubjectListing } from "@/lib/messaging-api";

interface SubjectPanelProps {
  conversationId: string;
  currentUserId: string;
  open: boolean;
  onClose: () => void;
  /** Desktop renders the panel inline; mobile gets a bottom sheet. */
  variant: "panel" | "sheet";
  /**
   * Already loaded with the conversation, so it is passed down rather than
   * fetched again. The strip above the thread carries the result; this is the
   * detail behind it — how long the negotiation ran and when it stopped.
   */
  outcome: ConversationOutcome | null;
}

/**
 * What the two of you are talking about.
 *
 * Built from the listing page's own components against the same buyer-safe
 * payload, so the panel says exactly what the listing says — including the
 * seller's agent, the checks they require, and the facts they published. A
 * second, thinner description of the same listing would drift within a week.
 */
export function SubjectPanel({
  conversationId,
  currentUserId,
  open,
  onClose,
  variant,
  outcome,
}: SubjectPanelProps) {
  const [listing, setListing] = useState<SubjectListing | null>(null);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const fetchedForRef = useRef<string | null>(null);

  // A different conversation means a different listing. Declared first so the
  // reset lands before the fetch effect below re-runs for the new id.
  // biome-ignore lint/correctness/useExhaustiveDependencies: conversationId is the reset trigger — the effect only writes
  useEffect(() => {
    fetchedForRef.current = null;
    setState("idle");
    setListing(null);
    setSellerId(null);
  }, [conversationId]);

  useEffect(() => {
    // Lazy: only worth fetching once someone opens the panel, and only once per
    // conversation. The "already fetched" mark is a ref, not state: keeping it
    // in the dependency list made the effect cancel its own in-flight request
    // the moment it set "loading", and the panel span forever.
    if (!open || fetchedForRef.current === conversationId) return;
    fetchedForRef.current = conversationId;

    let cancelled = false;
    setState("loading");
    messagingApi
      .subject(conversationId)
      .then((response) => {
        if (cancelled) return;
        setListing(response.listing);
        setSellerId(response.sellerId);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  const isOwner = Boolean(sellerId && sellerId === currentUserId);
  const askingPrice = listing?.targetPrice === null ? null : Number(listing?.targetPrice);

  const body = (
    <div className="flex flex-col gap-5">
      {state === "loading" && (
        <div className="flex justify-center py-10 text-action-primary">
          <Spinner />
        </div>
      )}

      {state === "failed" && (
        <p className="py-10 text-center text-ink-muted text-sm">
          Couldn't load the listing. Close and reopen to try again.
        </p>
      )}

      {state === "ready" && !listing && (
        <p className="py-10 text-center text-ink-muted text-sm">
          This listing is no longer available.
        </p>
      )}

      {listing && (
        <>
          <ItemPhoto listing={listing} />

          <header>
            <h3 className="font-bold text-ink text-lg leading-snug tracking-tight">
              {listing.title}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
              <span>Listed {formatTimeAgo(listing.publishedAt)}</span>
              {listing.sellingDeadline && (
                <>
                  <span aria-hidden="true">·</span>
                  <Countdown deadline={listing.sellingDeadline} />
                </>
              )}
            </div>
          </header>

          {outcome && (
            <>
              <Divider />
              <NegotiationSummary outcome={outcome} />
            </>
          )}

          {askingPrice !== null && Number.isFinite(askingPrice) && (
            <>
              <Divider />
              <AskingPrice amount={askingPrice} isOwner={isOwner} />
            </>
          )}

          {/* Condition, category, tags, published specs, and the seller's note. */}
          <Divider />
          <ItemFacts listing={listing} />

          {listing.sellerAgentPreset && (
            <>
              <Divider />
              <OpponentCard presetId={listing.sellerAgentPreset} isOwner={isOwner} />
            </>
          )}

          {(listing.sellerRequiredCriteria?.length ?? 0) > 0 && (
            <>
              <Divider />
              <RequiredQuestions
                criteria={listing.sellerRequiredCriteria ?? []}
                isOwner={isOwner}
              />
            </>
          )}
        </>
      )}
    </div>
  );

  // Pinned, not scrolled to: opening the listing is the panel's one action, and
  // a short listing must not leave it floating in the middle of empty space.
  // Full-width and filled, so it reads as the action it is — a bare link at this
  // size looked like leftover text. Navy rather than the accent: the gold send
  // button sits on the same line in the next column, and two golds would make
  // the eye pick between them.
  const footer = listing ? (
    <Link
      href={`/l/${listing.publicId}`}
      className={cn(buttonVariants({ variant: "ink", fullWidth: true }), "group gap-2")}
    >
      View full listing
      <ArrowRight
        className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  ) : null;

  if (variant === "sheet") {
    return (
      <Drawer open={open} onClose={onClose} side="bottom" title="Listing details" footer={footer}>
        {body}
      </Drawer>
    );
  }

  if (!open) return null;

  return (
    <aside className="hidden h-full w-[320px] shrink-0 flex-col overflow-hidden border-line border-l md:flex min-[1240px]:w-[380px]">
      {/* Same h-14 rail as the chat header, so the two headers sit on one line. */}
      <div className="flex h-14 shrink-0 items-center justify-between border-line border-b px-5">
        <h3 className="font-semibold text-ink">Listing details</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{body}</div>
      {footer && (
        // Matches the composer's rail on the other side of the divider.
        <div className="flex min-h-16 shrink-0 items-center border-line border-t px-4 md:min-h-18 md:px-5">
          {footer}
        </div>
      )}
    </aside>
  );
}

/** Matches the rail dividers on the listing page. */
function Divider() {
  return <div className="h-px w-full bg-line-subtle" aria-hidden="true" />;
}

/**
 * How the negotiation went, in the detail the pinned strip has no room for.
 * The strip answers "what was the result"; this answers "how did it get there".
 */
function NegotiationSummary({ outcome }: { outcome: ConversationOutcome }) {
  const settled = outcome.settledAt
    ? new Date(outcome.settledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <section>
      <h4 className="font-semibold text-[11px] text-ink-muted uppercase tracking-wider">
        Negotiation
      </h4>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-semibold text-ink text-sm">{OUTCOME_LABELS[outcome.status]}</span>
        {outcome.priceMinor !== null && (
          <span className="font-bold text-ink text-lg tabular-nums">
            {formatPrice(outcome.priceMinor, { minor: true })}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        {outcome.rounds > 0 && `${outcome.rounds} round${outcome.rounds === 1 ? "" : "s"}`}
        {outcome.rounds > 0 && settled && " · "}
        {settled && `ended ${settled}`}
      </p>
    </section>
  );
}

const OUTCOME_LABELS: Record<ConversationOutcome["status"], string> = {
  DEAL: "Deal",
  NEAR_DEAL: "Near deal",
  NO_DEAL: "No deal",
  EXPIRED: "Expired",
};
