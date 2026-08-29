"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { messagingApi, type SubjectListing } from "@/lib/messaging-api";

interface SubjectPanelProps {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  /** Desktop renders the panel inline; mobile gets a bottom sheet. */
  variant: "panel" | "sheet";
}

/** Context card for the thread's subject — today, the negotiated listing. */
export function SubjectPanel({ conversationId, open, onClose, variant }: SubjectPanelProps) {
  const [listing, setListing] = useState<SubjectListing | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Lazy: the panel's data is only worth fetching once someone opens it.
    if (!open || loaded) return;
    let cancelled = false;
    messagingApi
      .subject(conversationId)
      .then((response) => {
        if (!cancelled) {
          setListing(response.listing);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded, conversationId]);

  useEffect(() => {
    setLoaded(false);
    setListing(null);
  }, []);

  const body = (
    <div className="flex flex-col gap-4">
      {listing?.photoUrl && (
        // biome-ignore lint/performance/noImgElement: matches repo convention for remote listing photos
        <img
          src={listing.photoUrl}
          alt={listing.title ?? "Listing"}
          className="h-48 w-full rounded-xl object-cover"
        />
      )}

      <div>
        <h3 className="font-semibold text-ink text-lg leading-snug">
          {listing?.title ?? (loaded ? "Listing unavailable" : "Loading…")}
        </h3>
        {listing?.category && <p className="mt-1 text-ink-muted text-sm">{listing.category}</p>}
      </div>

      {listing?.targetPrice && (
        <div className="flex flex-col gap-1 rounded-xl bg-surface-sunken p-4">
          <span className="text-ink-muted text-sm">Asking price</span>
          <span className="font-semibold text-ink text-xl">{formatPrice(listing.targetPrice)}</span>
        </div>
      )}

      {listing?.publicId && (
        <a
          href={`/l/${listing.publicId}`}
          className="font-semibold text-action-primary text-sm hover:opacity-80"
        >
          View listing →
        </a>
      )}
    </div>
  );

  if (variant === "sheet") {
    return (
      <Drawer open={open} onClose={onClose} side="bottom" title="Listing details">
        {body}
      </Drawer>
    );
  }

  if (!open) return null;

  return (
    <aside className="hidden h-full w-[360px] shrink-0 flex-col overflow-hidden border-line border-l md:flex lg:w-[420px]">
      <div className="flex shrink-0 items-center justify-between border-line border-b px-5 py-4">
        <h3 className="font-semibold text-ink">Listing details</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="flex size-9 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken"
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
    </aside>
  );
}

function formatPrice(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
