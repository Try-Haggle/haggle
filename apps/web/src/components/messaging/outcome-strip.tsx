import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import type {
  ConversationOutcome,
  ConversationOutcomeStatus,
  ConversationSide,
} from "@/lib/messaging-api";

interface OutcomeStripProps {
  outcome: ConversationOutcome;
  side: ConversationSide | null;
  /** The negotiation session this thread hangs off — the CTA target. */
  sessionId: string | null;
}

/**
 * The negotiation result, pinned under the thread header.
 *
 * This conversation exists because a negotiation ended, so the result is the
 * frame for everything said in it — not something to go looking for behind the
 * detail panel. It is a row in the layout rather than an overlay: floating it
 * above the thread would put the first messages underneath it on every scroll.
 */
export function OutcomeStrip({ outcome, side, sessionId }: OutcomeStripProps) {
  const tone = TONES[outcome.status];
  const price = outcome.priceMinor;

  const href =
    sessionId && side ? `/${side === "selling" ? "sell" : "buy"}/negotiations/${sessionId}` : null;

  return (
    <div className="flex h-10 shrink-0 items-center gap-2.5 bg-ink px-3 md:px-5">
      {/* Result and price, nothing else. The asking price, the discount and the
          item's photo all live one click away in the listing panel; on a line
          that is on screen the whole time they read as clutter rather than as
          context.

          Inverted, because on the page's own beige this line landed at exactly
          the weight of the selected conversation row and the details button,
          and disappeared between them. Ink rather than the gold accent: the
          thread below is full of gold bubbles, and a gold band would compete
          with every message in it. */}
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 font-semibold text-[11px] leading-4",
          tone.chip,
        )}
      >
        {tone.label}
      </span>

      {price !== null && (
        <span className="min-w-0 truncate font-semibold text-sm text-surface tabular-nums">
          {/* The qualifier steps back so the number is what the eye lands on. */}
          {outcome.status !== "DEAL" && <span className="text-surface/65">last offer </span>}
          {formatPrice(price, { minor: true })}
        </span>
      )}

      <span className="flex-1" />

      {href && (
        // An arrow, because this one leaves the page — the details button beside
        // it opens a panel and stays put.
        <Link
          href={href}
          // No hover pill: its padding pushed the label off the 20px rail the
          // header button above sits on, and the two right edges have to line up.
          className="group flex shrink-0 items-center gap-1.5 py-1 font-semibold text-surface/75 text-xs transition-colors hover:text-surface"
        >
          View negotiation
          <ArrowRight
            className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      )}
    </div>
  );
}

/**
 * On the inverted band the feedback tokens are the wrong tool — they flip with
 * the theme, so each would need its contrast checked against ink in one theme
 * and cream in the other. Only a closed deal is worth a color of its own, and
 * it takes the fixed pair off the raw scale so it holds on either band. The
 * rest read as what they are: not a deal, and not an error either.
 */
const TONES: Record<ConversationOutcomeStatus, { label: string; chip: string }> = {
  DEAL: { label: "Deal", chip: "bg-success-100 text-success-700" },
  NEAR_DEAL: { label: "Near deal", chip: "bg-surface/20 text-surface" },
  NO_DEAL: { label: "No deal", chip: "bg-surface/20 text-surface" },
  EXPIRED: { label: "Expired", chip: "bg-surface/20 text-surface" },
};
