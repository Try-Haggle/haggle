"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { AgentCard, PlaybackRound } from "./types";
import { ChatBubble } from "./chat-bubble";
import { ThinkingDots } from "./thinking-dots";
import type { PlaybackEngine } from "./use-playback-engine";

interface ChatTimelineProps {
  rounds: PlaybackRound[];
  buyerAgent: AgentCard;
  sellerAgent: AgentCard;
  engine: PlaybackEngine;
  currency: string;
  focusedRoundIndex: number | null;
  onFocusRound: (index: number | null) => void;
}

export function ChatTimeline({
  rounds,
  buyerAgent,
  sellerAgent,
  engine,
  currency,
  focusedRoundIndex,
  onFocusRound,
}: ChatTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrollKey = useRef<string>("");

  // Auto-scroll to bottom whenever a new round becomes visible.
  useEffect(() => {
    const key = `${engine.visibleCount}-${engine.phase}-${engine.currentRoundIndex}`;
    if (lastScrollKey.current === key) return;
    lastScrollKey.current = key;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [engine.visibleCount, engine.phase, engine.currentRoundIndex]);

  const visibleRounds = rounds.slice(0, engine.visibleCount);
  const inFlight =
    engine.status === "PLAYING" &&
    engine.currentRoundIndex < rounds.length &&
    (engine.phase === "thinking" || engine.phase === "typing")
      ? rounds[engine.currentRoundIndex]
      : null;

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 overflow-y-auto px-3 sm:px-5 py-4 sm:py-5"
      style={{
        background: "linear-gradient(180deg, rgba(15,23,42,0.4), rgba(15,23,42,0.0))",
        scrollbarWidth: "thin",
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {visibleRounds.map((round) => {
          const agent = round.sender === "BUYER" ? buyerAgent : sellerAgent;
          const isInFlightTyping = inFlight?.roundIndex === round.roundIndex && engine.phase === "typing";
          // Settled rounds: show full message. Typing in-flight: show partial.
          const partial = isInFlightTyping
            ? round.message.slice(0, engine.typingChars)
            : round.message;
          const state: "typing" | "settled" = isInFlightTyping ? "typing" : "settled";
          return (
            <ChatBubble
              key={round.roundIndex}
              round={round}
              agent={agent}
              state={state}
              typedText={partial}
              currency={currency}
              isFocused={focusedRoundIndex === round.roundIndex}
              onSelect={() =>
                onFocusRound(focusedRoundIndex === round.roundIndex ? null : round.roundIndex)
              }
            />
          );
        })}

        {/* In-flight typing bubble (round becomes visible during typing) */}
        {inFlight && engine.phase === "typing" && engine.visibleCount < inFlight.roundIndex && (
          <ChatBubble
            key={`inflight-${inFlight.roundIndex}`}
            round={inFlight}
            agent={inFlight.sender === "BUYER" ? buyerAgent : sellerAgent}
            state="typing"
            typedText={inFlight.message.slice(0, engine.typingChars)}
            currency={currency}
          />
        )}

        {/* Thinking phase: dots only */}
        {inFlight && engine.phase === "thinking" && (
          <motion.div
            key={`thinking-${inFlight.roundIndex}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className={`flex ${inFlight.sender === "BUYER" ? "justify-end" : "justify-start"}`}
          >
            <ThinkingDots
              color={(inFlight.sender === "BUYER" ? buyerAgent : sellerAgent).accentColor}
              label={`${(inFlight.sender === "BUYER" ? buyerAgent : sellerAgent).name} is thinking`}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
