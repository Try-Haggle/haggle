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

type Status = "ACCEPTED" | "REJECTED" | "NEAR_DEAL" | "ESCALATED";

function formatPrice(minor: number | null): string | null {
  if (typeof minor !== "number" || !isFinite(minor) || minor <= 0) return null;
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
  const href = `/sign-up?next=${encodeURIComponent(
    `/claim/buyer?session_id=${sessionId}`,
  )}`;

  return (
    <div
      className={
        dealClosed
          ? "border-b border-emerald-500/30 bg-emerald-500/10"
          : "border-b border-slate-700 bg-slate-800/60"
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">
            {dealClosed && price
              ? `Sign up to buy at ${price}`
              : dealClosed
                ? "Sign up to lock in this deal"
                : "Sign up to save this negotiation"}
          </p>
          <p className="text-[12px] text-slate-300">
            Without an account, this session expires in 2 days and we can't
            tie it to a future purchase.
          </p>
        </div>
        <Link
          href={href}
          className={
            dealClosed
              ? "shrink-0 rounded-md bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600"
              : "shrink-0 rounded-md border border-slate-500 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
          }
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
