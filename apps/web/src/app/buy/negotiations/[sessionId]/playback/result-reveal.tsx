"use client";

import confetti from "canvas-confetti";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect } from "react";
import type { PlaybackResponse } from "./types";
import { formatPrice, formatSignedPct } from "./format";

interface ResultRevealProps {
  data: PlaybackResponse;
  onAccept?: () => void;
  onReplay?: () => void;
}

/**
 * Result reveal — single horizontal layout for every outcome:
 *   icon | status + headline + listing + price meta | inline CTA
 * Replay is omitted; it's already accessible from the playback header.
 */
export function ResultReveal({ data, onAccept, onReplay: _onReplay }: ResultRevealProps) {
  const { session, rounds } = data;
  const { finalStatus, finalPrice, listing } = session;

  const isAccepted = finalStatus === "ACCEPTED";
  const isRejected = finalStatus === "REJECTED";
  const baseline = listing.askingPrice;
  const settlementPrice = finalPrice ?? rounds[rounds.length - 1]?.offerPrice ?? baseline;
  const savedAbs = baseline - settlementPrice;
  const savedPct = (settlementPrice - baseline) / baseline;
  const accent = isAccepted ? "#10b981" : isRejected ? "#ef4444" : "#f59e0b";
  const headline = isAccepted ? "Deal closed" : isRejected ? "No deal" : "Negotiation paused";
  const Icon = isAccepted ? CheckIcon : isRejected ? CrossIcon : PauseIcon;
  const priceLabel = isAccepted ? "Final price" : "Last offer";

  // Screen-wide confetti when ACCEPTED reveal mounts — single dual-cannon burst.
  useEffect(() => {
    if (!isAccepted) return;
    const palette = ["#10b981", "#34d399", "#6ee7b7", "#facc15", "#fbbf24", "#06b6d4", "#a855f7", "#f472b6"];
    const t = setTimeout(() => {
      const shared = {
        particleCount: 350,
        spread: 90,
        startVelocity: 75,
        ticks: 280,
        scalar: 1.1,
        colors: palette,
        zIndex: 9999,
      };
      confetti({ ...shared, origin: { x: 0.05, y: 0.9 }, angle: 60 });
      confetti({ ...shared, origin: { x: 0.95, y: 0.9 }, angle: 120 });
    }, 180);
    return () => clearTimeout(t);
  }, [isAccepted]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl p-5 sm:p-7"
      style={{
        background: `linear-gradient(135deg, ${accent}1a, transparent 60%), #0f172a`,
        border: `1px solid ${accent}55`,
        boxShadow: `0 0 0 1px ${accent}22, 0 24px 48px -16px ${accent}33`,
      }}
    >
      {isAccepted && (
        <motion.div
          aria-hidden
          className="absolute -inset-4 -z-10 rounded-3xl blur-3xl"
          style={{ background: `${accent}33` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.6, 0.3] }}
          transition={{ duration: 1.6, ease: "easeOut" }}
        />
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-full"
            style={{ background: `${accent}1f`, border: `1px solid ${accent}55`, color: accent }}
          >
            <Icon />
          </motion.div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="text-[10px] font-bold tracking-[0.18em]" style={{ color: accent }}>
              {finalStatus.replace(/_/g, " ")}
            </div>
            {isAccepted ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span
                  className="text-[26px] sm:text-[32px] font-bold tabular-nums leading-[1.1]"
                  style={{ color: "#f8fafc", letterSpacing: "-0.02em" }}
                >
                  {formatPrice(settlementPrice, listing.currency)}
                </span>
                {savedAbs > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.75 text-[11px] font-semibold tabular-nums leading-none"
                      style={{ background: `${accent}1f`, border: `1px solid ${accent}55`, color: accent }}
                    >
                      {formatSignedPct(savedPct, 1)}
                    </span>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.75 text-[11px] font-semibold leading-none"
                      style={{ background: `${accent}1f`, border: `1px solid ${accent}55`, color: accent }}
                    >
                      saved&nbsp;<span className="tabular-nums">{formatPrice(savedAbs, listing.currency)}</span>
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="text-[22px] sm:text-[26px] font-semibold leading-tight truncate"
                style={{ color: "#f8fafc" }}
              >
                {headline}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "#64748b" }}>
              {!isAccepted && (
                <>
                  <span>{priceLabel}</span>
                  <span className="tabular-nums font-semibold" style={{ color: "#cbd5e1" }}>
                    {formatPrice(settlementPrice, listing.currency)}
                  </span>
                  <span style={{ color: "#334155" }}>·</span>
                </>
              )}
              <span>asking</span>
              <span className="tabular-nums" style={{ color: "#94a3b8" }}>
                {formatPrice(baseline, listing.currency)}
              </span>
              {!isAccepted && Math.abs(savedPct) >= 0.001 && (
                <>
                  <span style={{ color: "#334155" }}>·</span>
                  <span className="tabular-nums" style={{ color: savedPct < 0 ? "#10b981" : "#ef4444" }}>
                    {formatSignedPct(savedPct, 1)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="shrink-0 sm:self-center"
        >
          {isAccepted && onAccept ? (
            <button
              type="button"
              onClick={onAccept}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-[13px] sm:text-[14px] font-semibold text-white transition-colors hover:bg-emerald-600 sm:w-auto"
            >
              Continue to checkout
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          ) : !isAccepted ? (
            <Link
              href="/browse"
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-3 text-[13px] sm:text-[14px] font-semibold transition-colors hover:bg-slate-700 sm:w-auto"
              style={{ background: "#1e293b", border: "1px solid #334155", color: "#f8fafc" }}
            >
              Browse other listings
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </Link>
          ) : null}
        </motion.div>
      </div>
    </motion.div>
  );
}

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function CrossIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
