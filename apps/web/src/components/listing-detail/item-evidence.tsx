"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Expand, ImageOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ListingHoldBadge } from "@/components/listing-hold-badge";
import { Badge } from "@/components/ui";
import { formatCondition } from "@/lib/format";
import { DURATION, EASE, riseIn, staggerGroup } from "./motion";
import type { ListingDetail } from "./types";

/**
 * The evidence: photo, specs, description.
 *
 * Supporting material, deliberately not the hero. A marketplace page makes the
 * photo enormous because you are buying an object sight-unseen; here the photo
 * only has to confirm "yes, that is the thing" so the decision column can carry
 * the weight.
 *
 * Split into two exports because the reading order differs by breakpoint: on
 * desktop the photo sits above the facts in the left column, on mobile the
 * facts drop below the decision column while the photo stays on top. Two
 * components let the grid place them independently while DOM order still
 * matches visual order in both cases — which an `order-*` trick would break for
 * keyboard and screen-reader users.
 */

/* ─── Photo (+ lightbox) ──────────────────────────────────── */

export function ItemPhoto({ listing, className }: { listing: ListingDetail; className?: string }) {
  const [zoomed, setZoomed] = useState(false);

  // Escape closes the lightbox; body scroll is locked while it is open.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [zoomed]);

  if (!listing.photoUrl) {
    return (
      <div
        className={`relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-line border-dashed bg-surface-sunken text-ink-muted ${className ?? ""}`}
      >
        <ListingHoldBadge holdState={listing.holdState} className="absolute top-3 left-3" />
        <ImageOff className="size-7" aria-hidden="true" />
        <span className="text-[12px]">No photo provided</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label="Expand photo"
        className="group relative block w-full overflow-hidden rounded-2xl border border-line bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
      >
        {/* The shared layout id lives on the wrapper, not the <img>: framer
            animates the box, and the image just fills it. */}
        <motion.span
          layoutId="listing-photo"
          className="block"
          transition={{ duration: DURATION.slow, ease: EASE.standard }}
        >
          {/* 4:3 up to a ceiling. The ratio alone ties the photo's height to
              the column's width, so a wide column made it tall enough to push
              the title off a laptop screen — on a page whose subject is the
              negotiation, not the picture. 520px lands the photo near 3:2 at
              the current column width: a real photographic ratio rather than
              an arbitrary crop. A phone never reaches the cap, so mobile keeps
              a clean 4:3. */}
          {/* biome-ignore lint/performance/noImgElement: remote listing photo */}
          <img
            src={listing.photoUrl}
            alt={listing.title}
            className="aspect-[4/3] max-h-[520px] w-full object-cover"
          />
        </motion.span>
        <ListingHoldBadge
          holdState={listing.holdState}
          className="pointer-events-none absolute top-3 left-3 shadow-sm"
        />
        <span className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-1.5 rounded-lg bg-surface-overlay/85 px-2.5 py-1.5 font-medium text-[11px] text-ink opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Expand className="size-3" aria-hidden="true" />
          Expand
        </span>
      </button>

      <AnimatePresence>
        {zoomed && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.quick }}
          >
            <div
              className="absolute inset-0 bg-ink-strong/70 backdrop-blur-sm"
              onClick={() => setZoomed(false)}
              aria-hidden="true"
            />
            <motion.span
              layoutId="listing-photo"
              className="relative block max-h-full"
              transition={{ duration: DURATION.slow, ease: EASE.standard }}
            >
              {/* biome-ignore lint/performance/noImgElement: remote listing photo */}
              <img
                src={listing.photoUrl}
                alt={listing.title}
                className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-card"
              />
            </motion.span>
            <button
              type="button"
              onClick={() => setZoomed(false)}
              aria-label="Close photo"
              className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-surface-overlay/90 text-ink backdrop-blur-sm transition-colors hover:bg-surface-overlay"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Facts (tags, specs, description) ────────────────────── */

export function ItemFacts({ listing, className }: { listing: ListingDetail; className?: string }) {
  /**
   * `specs` is the only source now. It used to fall back to the phone-only
   * `attributes` record, but the phone question flow that filled it was
   * removed, so that branch could never produce a row again.
   */
  const specs: Array<{ key: string; label: string; value: string }> =
    listing.specs?.map((s) => ({ key: s.checkId, label: s.label, value: s.value })) ?? [];
  const hasChips = !!(listing.condition || listing.category || listing.tags?.length);

  if (!hasChips && specs.length === 0 && !listing.description) {
    return null;
  }

  return (
    <motion.div className={className} variants={staggerGroup()} initial="hidden" animate="visible">
      {hasChips && (
        <motion.div variants={riseIn} className="flex flex-wrap gap-1.5">
          {listing.condition && <Badge tone="neutral">{formatCondition(listing.condition)}</Badge>}
          {listing.category && <Badge tone="neutral">{listing.category.replace(/_/g, " ")}</Badge>}
          {listing.tags?.map((tag) => (
            <Badge key={tag} tone="neutral">
              {tag}
            </Badge>
          ))}
        </motion.div>
      )}

      {specs.length > 0 && (
        <motion.dl
          variants={riseIn}
          className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${hasChips ? "mt-4" : ""}`}
        >
          {specs.map((spec) => (
            <div
              key={spec.key}
              className="rounded-xl border border-line-subtle bg-surface-raised p-3"
            >
              <dt className="text-[10px] text-ink-muted uppercase tracking-wider">{spec.label}</dt>
              <dd className="mt-1 font-semibold text-[13px] text-ink">{spec.value}</dd>
            </div>
          ))}
        </motion.dl>
      )}

      {listing.description && (
        <motion.div variants={riseIn} className="mt-5">
          <p className="text-label text-ink-muted">From the seller</p>
          <p className="mt-2 whitespace-pre-line text-[14px] text-ink-secondary leading-relaxed">
            {listing.description}
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
