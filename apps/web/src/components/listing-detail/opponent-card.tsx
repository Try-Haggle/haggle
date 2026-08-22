"use client";

import { getNegotiationAgentPreset } from "@haggle/shared";
import { motion } from "framer-motion";
import { DURATION, EASE, riseIn, staggerGroup } from "./motion";

/**
 * The seller's agent — the opponent a buyer's agent will negotiate against,
 * and the same agent the seller themselves is represented by. Owners get the
 * second framing ("Your negotiator"); telling a seller they are "up against"
 * their own agent is the one reading that is simply false.
 *
 * Deliberately spare: name and archetype only. Earlier versions also showed
 * the preset's tagline and description, but both are hardcoded marketing copy
 * written for the SELLER choosing that preset ("Waits for the right buyer"),
 * and nothing per-agent is stored that could describe actual behaviour — the
 * `description` column exists on negotiation_agents but no create path writes
 * it, and sellers who ran the briefing chat have usually diverged from the
 * preset's numbers anyway. A confident behaviour blurb with no data behind it
 * reads as a prediction we can't stand by, so it goes. The archetype name
 * (Patient Lister / Quick Closer / …) already carries the honest signal.
 *
 * The deal's required questions used to live inside this card; they moved to
 * their own rail section ({@link ../required-questions}) — they are a fact
 * about the deal, not about the opponent.
 */

interface OpponentCardProps {
  presetId: string | null;
  /**
   * Owner viewing their own listing. The same agent is the buyer's opponent
   * and the seller's representative — only the framing differs, so this card
   * flips its labels rather than being swapped for a separate component.
   */
  isOwner?: boolean;
  className?: string;
}

export function OpponentCard({ presetId, isOwner = false, className }: OpponentCardProps) {
  const preset = presetId ? getNegotiationAgentPreset(presetId) : undefined;
  const copy = preset?.copy.seller;
  const accent = preset?.accentColor ?? "var(--action-secondary)";

  return (
    <motion.section
      className={className}
      variants={staggerGroup()}
      initial="hidden"
      animate="visible"
    >
      <motion.p variants={riseIn} className="text-label text-ink-muted">
        {isOwner ? "Your negotiator" : <>You&apos;re up against</>}
      </motion.p>

      <motion.div variants={riseIn} className="mt-2.5 flex items-center gap-3">
        <motion.span
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-xl"
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
          }}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: DURATION.base, ease: EASE.select, delay: 0.05 }}
          aria-hidden="true"
        >
          {preset?.emoji ?? "🤝"}
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[15px] text-ink">{copy?.name ?? "Default agent"}</p>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            {isOwner
              ? preset
                ? "Negotiating on your behalf"
                : "A balanced default handles your side"
              : preset
                ? "The seller's AI negotiator"
                : "A balanced default handles the seller's side"}
          </p>
        </div>
      </motion.div>
    </motion.section>
  );
}
