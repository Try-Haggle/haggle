"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Play, Radio, RotateCcw } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ArenaHeader } from "./arena-header";
import { ChatTimeline } from "./chat-timeline";
import { FactorsPanel } from "./factors-panel";
import { PauseAnswer, type PauseCheck } from "./pause-answer";
import { PlaybackControls } from "./playback-controls";
import { PreFight } from "./pre-fight";
import { ProgressBar } from "./progress-bar";
import { ResultReveal } from "./result-reveal";
import type { PlaybackResponse } from "./types";
import {
  type PlaybackEngine,
  usePlaybackEngine,
  usePrefersReducedMotion,
} from "./use-playback-engine";

interface PlaybackArenaProps {
  data: PlaybackResponse;
  checkoutHref?: string;
  checkoutLabel?: string;
  mode?: "replay" | "live";
  liveTerminal?: boolean;
  connectionLabel?: string;
  liveError?: string | null;
  onLiveRetry?: () => void;
  /** Checks the round loop stopped on, waiting for this buyer to answer. */
  pauseChecks?: PauseCheck[] | null;
  onPauseAnswer?: (stances: Array<{ checkId: string; stance: string }>) => Promise<void>;
  /** Top-left back link. Defaults to the listing the buyer came from. */
  backHref?: string;
  backLabel?: string;
  /** Where a no-deal outcome sends this viewer. */
  noDealCta?: { href: string; label: string };
  /**
   * Slot in the top bar for an action that belongs to this viewer's side —
   * today, opening the human thread with the counterparty.
   */
  headerAction?: ReactNode;
}

/**
 * Root client component for the negotiation playback experience.
 * Owns the engine state machine and orchestrates the three top-level views:
 *   1. Pre-fight (before begin)
 *   2. Live arena (during playback)
 *   3. Result reveal (after completion — overlays the arena)
 */
export function PlaybackArena({
  data,
  checkoutHref,
  checkoutLabel,
  mode = "replay",
  liveTerminal = false,
  connectionLabel = "Live updates",
  liveError = null,
  onLiveRetry,
  pauseChecks = null,
  onPauseAnswer,
  backHref,
  backLabel = "Back to listing",
  noDealCta,
  headerAction,
}: PlaybackArenaProps) {
  const { session, rounds } = data;
  const isLive = mode === "live";
  const reduceMotion = usePrefersReducedMotion();
  const replayEngine = usePlaybackEngine({
    rounds: data.rounds,
    reduceMotion,
  });
  const liveEngine = useMemo<PlaybackEngine>(
    () => ({
      status: liveTerminal ? "COMPLETE" : "PLAYING",
      phase: "settled",
      currentRoundIndex: Math.max(rounds.length - 1, 0),
      visibleCount: rounds.length,
      typingChars: 0,
      speed: 1,
      begin: () => undefined,
      skip: () => undefined,
      replay: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      setSpeed: () => undefined,
    }),
    [liveTerminal, rounds.length],
  );
  const engine = isLive ? liveEngine : replayEngine;
  // Paused means the rounds have stopped ON PURPOSE, waiting on this buyer. It must
  // silence the "thinking" dots — otherwise the screen claims work is in flight while it
  // is really waiting for a human, which is exactly how the pause read as a hang.
  const isPaused = isLive && !liveTerminal && (pauseChecks?.length ?? 0) > 0;

  const [showPreFight, setShowPreFight] = useState(!isLive);
  const [focusedRoundIndex, setFocusedRoundIndex] = useState<number | null>(null);

  // Right-column drives the chat panel height: chat matches it exactly and
  // scrolls internally when content exceeds. Callback ref binds the observer
  // whenever the side column mounts (i.e. when leaving PreFight) and cleans
  // up on unmount — avoids brittle useEffect-deps tracking with HMR.
  const [sideHeight, setSideHeight] = useState(0);
  const sideColRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      setSideHeight(0);
      return;
    }
    const update = () => setSideHeight(node.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") {
      update();
      return;
    }
    const ro = new ResizeObserver(update);
    ro.observe(node);
    update();
    return () => ro.disconnect();
  }, []);

  // Latest visible offer drives the price ticker.
  const lastVisibleRound = rounds[engine.visibleCount - 1] ?? null;
  const prevVisibleRound = rounds[engine.visibleCount - 2] ?? null;
  const currentPrice = lastVisibleRound?.offerPrice ?? null;
  const previousPrice = prevVisibleRound?.offerPrice ?? null;

  // Active speaker for the header glow.
  const lastLiveSender = rounds.at(-1)?.sender;
  const activeRole = isLive
    ? liveTerminal
      ? null
      : lastLiveSender === "BUYER"
        ? "SELLER"
        : "BUYER"
    : engine.status === "PLAYING" && engine.currentRoundIndex < rounds.length
      ? (rounds[engine.currentRoundIndex]?.sender ?? null)
      : null;

  // Focused round (FactorsPanel target). Defaults to last visible settled round.
  const focusedRound = useMemo(() => {
    if (focusedRoundIndex !== null) {
      return rounds.find((r) => r.roundIndex === focusedRoundIndex) ?? null;
    }
    return lastVisibleRound;
  }, [focusedRoundIndex, lastVisibleRound, rounds]);
  const focusedAgent = focusedRound
    ? focusedRound.sender === "BUYER"
      ? session.buyerAgent
      : session.sellerAgent
    : null;

  function handleBegin() {
    setShowPreFight(false);
    // Slight delay so PreFight exit animation can settle.
    setTimeout(() => engine.begin(), 280);
  }

  function handleReplay() {
    setFocusedRoundIndex(null);
    engine.replay();
  }

  // When complete, scroll the result into view (improves mobile UX).
  useEffect(() => {
    if (engine.status === "COMPLETE") {
      const t = setTimeout(() => {
        document.getElementById("playback-result")?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        });
      }, 300);
      return () => clearTimeout(t);
    }
  }, [engine.status]);

  return (
    <div className="min-h-[calc(100vh-4rem)]" style={{ background: "var(--bg-primary)" }}>
      {/* Subtle ambient backdrop */}
      <BackgroundOrbs />

      <div className="relative mx-auto max-w-6xl px-3 sm:px-6 py-4 sm:py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <Link
            href={backHref ?? (session.listing.id ? `/l/${session.listing.id}` : "/buy/dashboard")}
            className="flex items-center gap-1.5 text-[12px] sm:text-[13px] transition-colors hover:text-ink"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            <span>{backLabel}</span>
          </Link>
          <div className="flex items-center gap-3">
            {headerAction}
            {isLive && liveTerminal && (
              <Link
                href="?replay=1"
                className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-ink-secondary transition-colors hover:text-ink"
              >
                <Play className="size-3.5" aria-hidden="true" />
                Watch replay
              </Link>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {showPreFight ? (
            <motion.div
              key="prefight"
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25 }}
            >
              <PreFight data={data} onBegin={handleBegin} />
            </motion.div>
          ) : (
            <motion.div
              key="arena"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col gap-4 sm:gap-5"
            >
              {/* Compact arena header — single row */}
              <div
                className="rounded-2xl px-4 py-3 sm:px-5 sm:py-4"
                style={{
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-default)",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <ArenaHeader
                  buyerAgent={session.buyerAgent}
                  sellerAgent={session.sellerAgent}
                  activeRole={activeRole}
                  currentRound={Math.min(engine.currentRoundIndex + 1, session.roundsTotal)}
                  currentPrice={currentPrice}
                  previousPrice={previousPrice}
                  askingPrice={session.listing.askingPrice}
                  currency={session.listing.currency}
                  pulseKey={engine.visibleCount}
                />
              </div>

              {/* Two-column main stage — chat as hero, supporting info on the side */}
              <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                {/* Chat panel (hero) — height matches the side column on lg+
                    so both columns bottom-align; chat scrolls internally when
                    rounds exceed available height. On mobile (no side column)
                    falls back to a sensible minHeight. */}
                <div
                  className="flex flex-col rounded-2xl overflow-hidden"
                  style={{
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-default)",
                    height: sideHeight > 0 ? `${sideHeight}px` : undefined,
                    minHeight: sideHeight > 0 ? undefined : "520px",
                  }}
                >
                  <div
                    className="flex items-center justify-end px-4 py-3"
                    style={{ borderBottom: "1px solid var(--border-default)" }}
                  >
                    {isLive ? (
                      liveError ? (
                        <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold text-error">
                          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{liveError}</span>
                          {onLiveRetry && (
                            <button
                              type="button"
                              onClick={onLiveRetry}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-ink transition-colors hover:bg-surface-overlay"
                              style={{ border: "1px solid var(--border-default)" }}
                            >
                              <RotateCcw className="size-3" aria-hidden="true" />
                              Retry
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-success">
                          <Radio className="size-3.5" aria-hidden="true" />
                          {liveTerminal ? "Negotiation complete" : connectionLabel}
                        </div>
                      )
                    ) : (
                      <PlaybackControls engine={engine} />
                    )}
                  </div>
                  <ChatTimeline
                    rounds={rounds}
                    buyerAgent={session.buyerAgent}
                    sellerAgent={session.sellerAgent}
                    engine={engine}
                    currency={session.listing.currency}
                    focusedRoundIndex={focusedRoundIndex}
                    onFocusRound={setFocusedRoundIndex}
                    // The "thinking" dots animate purely on "live and not finished", so a
                    // failed round left them spinning forever next to an error banner —
                    // which reads as a hang, not a failure. Stop them once we know.
                    waitingRole={
                      isLive && !liveTerminal && !liveError && !isPaused ? activeRole : null
                    }
                  />
                  {isPaused && onPauseAnswer && (
                    <PauseAnswer checks={pauseChecks ?? []} onSubmit={onPauseAnswer} />
                  )}
                </div>

                {/* Side column: concession curve + factors panel (desktop) */}
                <div className="hidden lg:block">
                  <div ref={sideColRef} className="flex flex-col gap-4">
                    <ProgressBar
                      rounds={rounds}
                      visibleCount={engine.visibleCount}
                      askingPrice={session.listing.askingPrice}
                      currency={session.listing.currency}
                    />
                    <AnimatePresence mode="wait">
                      <FactorsPanel
                        key={focusedRound?.roundIndex ?? "empty"}
                        round={focusedRound}
                        agent={focusedAgent}
                      />
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Mobile: side panel content stacks below chat */}
              <div className="flex flex-col gap-4 lg:hidden">
                <ProgressBar
                  rounds={rounds}
                  visibleCount={engine.visibleCount}
                  askingPrice={session.listing.askingPrice}
                />
                <FactorsPanel round={focusedRound} agent={focusedAgent} />
              </div>

              {/* Result reveal */}
              <AnimatePresence>
                {engine.status === "COMPLETE" && (
                  <div id="playback-result">
                    <ResultReveal
                      data={data}
                      onReplay={handleReplay}
                      checkoutHref={checkoutHref}
                      checkoutLabel={checkoutLabel}
                      {...(noDealCta ? { noDealCta } : {})}
                    />
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function BackgroundOrbs() {
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed -top-32 -left-32 h-[480px] w-[480px] rounded-full bg-action-primary/15 blur-3xl"
        animate={{ scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none fixed -bottom-40 -right-32 h-[520px] w-[520px] rounded-full bg-info/12 blur-3xl"
        animate={{ scale: [1.05, 1, 1.05], opacity: [0.6, 0.9, 0.6] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
    </>
  );
}
