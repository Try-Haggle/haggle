"use client";

import { motion } from "framer-motion";
import { ArrowLeftRight } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { DURATION, EASE } from "./motion";

/**
 * The seller's asking price.
 *
 * An earlier iteration drew a market-comparison envelope here (median tick,
 * negotiating-room band, sample counts) fed by HFMI. It was removed as a
 * product call: HFMI's crawl coverage is a fixed electronics catalogue with an
 * unverified cron, and a confident-looking market comparison built on shaky
 * data undercuts the exact trust this page runs on.
 *
 * What survived the removal matters more than what went: the page's whole
 * premise is that this number is an opening position rather than a fact, and
 * stripping the envelope briefly stripped that claim too — leaving a bare
 * marketplace price tag that says the opposite of what we mean. So the claim
 * is stated in words instead of drawn in data. No number here is inferred;
 * "negotiable" is a property of the product, not an estimate.
 */

interface AskingPriceProps {
  amount: number;
  currency?: string;
  /** Owner viewing their own listing — "not what you pay" is not their read. */
  isOwner?: boolean;
  className?: string;
}

export function AskingPrice({
  amount,
  currency = "$",
  isOwner = false,
  className,
}: AskingPriceProps) {
  return (
    <div className={className}>
      <p className="text-label text-ink-muted">Asking price</p>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span className="block overflow-hidden pb-1">
          <motion.span
            className="block font-bold text-4xl text-ink tabular-nums tracking-tight sm:text-[2.75rem]"
            initial={{ y: "0.4em", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: DURATION.slow, ease: EASE.decelerate }}
          >
            {formatPrice(amount, { currency })}
          </motion.span>
        </span>

        {/* Arrives after the price settles — it qualifies the number, so it
            should read as a second beat rather than compete with it. */}
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: DURATION.base, ease: EASE.decelerate, delay: 0.35 }}
          className="inline-flex items-center gap-1 rounded-full bg-badge px-2.5 py-1 font-semibold text-[11px] text-badge-text"
        >
          <ArrowLeftRight className="size-3" aria-hidden="true" />
          Negotiable
        </motion.span>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DURATION.base, delay: 0.45 }}
        className="mt-2 text-[12.5px] text-ink-secondary leading-relaxed"
      >
        {isOwner
          ? "Where your agent opens. Buyers negotiate down from here."
          : "Where the seller starts, not what you pay. Your agent negotiates from here."}
      </motion.p>
    </div>
  );
}
