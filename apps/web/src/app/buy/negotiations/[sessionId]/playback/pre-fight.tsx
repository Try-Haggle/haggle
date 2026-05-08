"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { PlaybackResponse } from "./types";
import { AgentIcon } from "./agent-icon";
import { formatPrice } from "./format";

interface PreFightProps {
  data: PlaybackResponse;
  onBegin: () => void;
}

/** Seconds before onBegin auto-fires. The visible countdown matches this. */
const AUTO_START_SECONDS = 4;
/** Delay before the countdown begins (after the button finishes fading in). */
const COUNTDOWN_START_DELAY = 0.95;

export function PreFight({ data, onBegin }: PreFightProps) {
  const { session } = data;
  const { listing, buyerAgent, sellerAgent } = session;
  const triggeredRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_START_SECONDS);

  const handleStart = () => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    onBegin();
  };

  useEffect(() => {
    // Auto-trigger after the full countdown (delay + duration).
    const triggerTimeout = setTimeout(
      handleStart,
      (COUNTDOWN_START_DELAY + AUTO_START_SECONDS) * 1000,
    );

    // Visible countdown ticker.
    const intervalRef: { current: ReturnType<typeof setInterval> | null } = {
      current: null,
    };
    const tickerStart = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        setSecondsLeft((prev) => Math.max(prev - 1, 0));
      }, 1000);
    }, COUNTDOWN_START_DELAY * 1000);

    return () => {
      clearTimeout(triggerTimeout);
      clearTimeout(tickerStart);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="relative flex flex-col items-center justify-center min-h-[70vh] px-4 sm:px-6 py-10"
    >
      <div className="flex w-full max-w-md flex-col items-center">
        {/* Listing summary */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="flex w-full flex-col items-center gap-1 text-center"
        >
          <div
            className="text-[11px] font-bold tracking-[0.2em]"
            style={{ color: "#64748b" }}
          >
            NEGOTIATION ARENA
          </div>
          <div
            className="text-[18px] sm:text-[22px] font-semibold mt-1.5"
            style={{ color: "#f1f5f9" }}
          >
            {listing.title}
          </div>
          <div
            className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1"
            style={{
              background: "rgba(15,23,42,0.6)",
              border: "1px solid #1e293b",
            }}
          >
            <span
              className="text-[10px] font-bold tracking-[0.18em]"
              style={{ color: "#64748b" }}
            >
              ASKING
            </span>
            <span
              className="text-[12px] font-bold tabular-nums pb-0.5"
              style={{ color: "#f8fafc" }}
            >
              {formatPrice(listing.askingPrice, listing.currency)}
            </span>
          </div>
        </motion.div>

        {/* VS layout */}
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3 mt-7 sm:mt-8">
          <PreFightAgent
            agent={sellerAgent}
            role="SELLER"
            delay={0.15}
            side="left"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center justify-center"
          >
            <motion.div
              className="text-[24px] sm:text-[32px] font-black tracking-[0.16em]"
              style={{
                color: "#475569",
                textShadow: "0 0 24px rgba(148,163,184,0.2)",
              }}
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              VS
            </motion.div>
          </motion.div>
          <PreFightAgent
            agent={buyerAgent}
            role="BUYER"
            delay={0.25}
            side="right"
          />
        </div>

        {/* Begin button — auto-fills over AUTO_START_SECONDS, click to skip wait. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.55 }}
          className="relative mt-10 w-full"
        >
          <motion.span
            aria-hidden
            className="absolute -inset-1 -z-10 rounded-2xl blur-xl"
            style={{ background: "rgba(16,185,129,0.4)" }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.button
            type="button"
            onClick={handleStart}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="group cursor-pointer relative flex w-full items-center justify-center gap-2.5 rounded-xl px-6 py-4 text-[15px] sm:text-[16px] font-semibold text-white transition-colors hover:bg-emerald-600"
            style={{
              background: "linear-gradient(135deg, #10b981, #059669)",
              boxShadow:
                "0 0 0 1px rgba(16,185,129,0.4), 0 18px 36px -12px rgba(16,185,129,0.5)",
            }}
          >
            Begin Negotiation
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform group-hover:translate-x-0.5"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </motion.button>
          {secondsLeft > 0 && (
            <div
              className="mt-2.5 text-center text-[11px] tabular-nums"
              style={{ color: "#64748b" }}
            >
              Auto-starts in {secondsLeft}s
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

function PreFightAgent({
  agent,
  role,
  delay,
  side,
}: {
  agent: PlaybackResponse["session"]["buyerAgent"];
  role: "BUYER" | "SELLER";
  delay: number;
  side: "left" | "right";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: side === "left" ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center gap-3 text-center"
    >
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{
          duration: 3.2,
          delay: delay + 0.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="relative flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-2xl"
        style={{
          background: `linear-gradient(135deg, ${agent.accentColor}26, ${agent.accentColor}0a)`,
          border: `1px solid ${agent.accentColor}55`,
          boxShadow: `0 0 0 1px ${agent.accentColor}22, 0 20px 40px -16px ${agent.accentColor}66`,
          color: agent.accentColor,
        }}
      >
        <AgentIcon agent={agent} size={36} />
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-2xl"
          style={{ border: `1px solid ${agent.accentColor}` }}
          animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.08, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
      <div className="flex flex-col gap-0.5">
        <div
          className="text-[10px] font-bold tracking-[0.18em]"
          style={{ color: "#475569" }}
        >
          {role}
        </div>
        <div
          className="text-[15px] sm:text-[16px] font-semibold"
          style={{ color: "#f1f5f9" }}
        >
          {agent.name}
        </div>
        {role === "BUYER" && (
          <div
            className="text-[11px] sm:text-[12px]"
            style={{ color: agent.accentColor }}
          >
            {agent.tagline}
          </div>
        )}
      </div>
    </motion.div>
  );
}
