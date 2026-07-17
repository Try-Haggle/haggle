"use client";

/**
 * Sign-up prompt for guests viewing their negotiation result.
 *
 * /negotiations/start lets anonymous buyers run a full session, but the
 * resulting `negotiation_sessions` row holds a randomly minted UUID for
 * buyer_id. To preserve ownership, we surface a CTA on the result page that
 * routes the user through sign-up → /claim/buyer → POST /claim/negotiation-sessions.
 */

import Link from "next/link";

type Status = "IN_PROGRESS" | "ACCEPTED" | "REJECTED" | "NEAR_DEAL" | "ESCALATED";

function formatPrice(minor: number | null): string | null {
  if (typeof minor !== "number" || !Number.isFinite(minor) || minor <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export function GuestClaimBanner({
  sessionId,
  status,
  finalPriceMinor,
}: {
  sessionId: string;
  status: Status;
  finalPriceMinor: number | null;
}) {
  const dealClosed = status === "ACCEPTED";
  const price = formatPrice(finalPriceMinor);
  const href = `/sign-up?next=${encodeURIComponent(`/claim/buyer?session_id=${sessionId}`)}`;

  return (
    <div
      className={
        dealClosed
          ? "border-b border-success/30 bg-success-soft"
          : "border-b border-line bg-surface-raised"
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex-1">
          <p className="text-sm font-semibold text-ink">
            {dealClosed && price
              ? `Sign up to buy at ${price}`
              : dealClosed
                ? "Sign up to lock in this deal"
                : "Sign up to save this negotiation"}
          </p>
          <p className="text-[12px] text-ink-secondary">
            Without an account, this session expires in 2 days and we can't tie it to a future
            purchase.
          </p>
        </div>
        <Link
          href={href}
          className={
            dealClosed
              ? "shrink-0 rounded-md bg-success px-4 py-2 text-sm font-bold text-on-accent hover:bg-success/90"
              : "shrink-0 rounded-md border border-line px-4 py-2 text-sm font-bold text-ink hover:bg-surface-sunken"
          }
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
