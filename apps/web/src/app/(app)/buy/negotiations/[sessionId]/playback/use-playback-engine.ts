"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { PlaybackRound } from "./types";

/**
 * Playback state machine. Drives the per-round phase progression:
 *
 *   IDLE → READY → (PLAYING ⇄ PAUSED) → COMPLETE
 *
 * Each round walks through three phases:
 *   thinking → typing → settled
 *
 * Phase durations adapt to message length and respect a global speed multiplier
 * (1x / 2x / 4x). Skip jumps to COMPLETE and reveals all rounds at once.
 */

export type PlaybackStatus = "READY" | "PLAYING" | "PAUSED" | "COMPLETE";
export type RoundPhase = "thinking" | "typing" | "settled";
export type PlaybackSpeed = 1 | 2 | 4;

interface PlaybackState {
  status: PlaybackStatus;
  currentRoundIndex: number; // 0-based pointer into rounds array (round being animated)
  phase: RoundPhase;
  visibleCount: number;       // how many rounds are fully visible (settled)
  typingChars: number;        // chars revealed in current typing phase
  speed: PlaybackSpeed;
}

type Action =
  | { type: "BEGIN" }
  | { type: "ENTER_THINKING" }
  | { type: "ENTER_TYPING" }
  | { type: "TYPING_TICK"; chars: number }
  | { type: "SETTLE" }
  | { type: "NEXT_ROUND" }
  | { type: "COMPLETE" }
  | { type: "SKIP" }
  | { type: "REPLAY" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "SET_SPEED"; speed: PlaybackSpeed };

const INITIAL: PlaybackState = {
  status: "READY",
  currentRoundIndex: 0,
  phase: "thinking",
  visibleCount: 0,
  typingChars: 0,
  speed: 1,
};

function reducer(state: PlaybackState, action: Action): PlaybackState {
  switch (action.type) {
    case "BEGIN":
      return { ...state, status: "PLAYING", phase: "thinking", currentRoundIndex: 0, visibleCount: 0, typingChars: 0 };
    case "ENTER_THINKING":
      return { ...state, phase: "thinking", typingChars: 0 };
    case "ENTER_TYPING":
      return { ...state, phase: "typing", typingChars: 0 };
    case "TYPING_TICK":
      return { ...state, typingChars: action.chars };
    case "SETTLE":
      return { ...state, phase: "settled", visibleCount: state.currentRoundIndex + 1 };
    case "NEXT_ROUND":
      return { ...state, currentRoundIndex: state.currentRoundIndex + 1, phase: "thinking", typingChars: 0 };
    case "COMPLETE":
      return { ...state, status: "COMPLETE", phase: "settled" };
    case "SKIP":
      return { ...state, status: "COMPLETE", phase: "settled", visibleCount: Number.MAX_SAFE_INTEGER };
    case "REPLAY":
      return { ...INITIAL, speed: state.speed, status: "PLAYING" };
    case "PAUSE":
      return state.status === "PLAYING" ? { ...state, status: "PAUSED" } : state;
    case "RESUME":
      return state.status === "PAUSED" ? { ...state, status: "PLAYING" } : state;
    case "SET_SPEED":
      return { ...state, speed: action.speed };
    default:
      return state;
  }
}

export interface UsePlaybackEngineOptions {
  rounds: PlaybackRound[];
  /** ms per character during typing phase at 1x speed. Default 24. */
  msPerChar?: number;
  /** Default thinking duration if a round doesn't supply one. */
  defaultThinkingMs?: number;
  /** Pause between settling a round and starting the next. Default 350ms. */
  interRoundPauseMs?: number;
  /** Honour prefers-reduced-motion: shortens thinking, disables typing animation. */
  reduceMotion?: boolean;
}

export interface PlaybackEngine {
  status: PlaybackStatus;
  phase: RoundPhase;
  currentRoundIndex: number;
  visibleCount: number;
  typingChars: number;
  speed: PlaybackSpeed;
  begin: () => void;
  skip: () => void;
  replay: () => void;
  pause: () => void;
  resume: () => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

export function usePlaybackEngine(options: UsePlaybackEngineOptions): PlaybackEngine {
  const {
    rounds,
    msPerChar = 24,
    defaultThinkingMs = 1100,
    interRoundPauseMs = 350,
    reduceMotion = false,
  } = options;

  const [state, dispatch] = useReducer(reducer, INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Active timeouts/intervals so pause/skip can clear them.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>>(
    new Set(),
  );
  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((t) => {
      clearTimeout(t as ReturnType<typeof setTimeout>);
      clearInterval(t as ReturnType<typeof setInterval>);
    });
    timersRef.current.clear();
  }, []);
  const addTimer = useCallback(<T extends ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>(t: T): T => {
    timersRef.current.add(t);
    return t;
  }, []);

  // Schedule a single round's lifecycle. Re-runs whenever the round pointer
  // changes or playback resumes. Returns a cleanup that aborts pending timers.
  useEffect(() => {
    if (state.status !== "PLAYING") return;
    const round = rounds[state.currentRoundIndex];
    if (!round) {
      dispatch({ type: "COMPLETE" });
      return;
    }

    const speed = state.speed;
    const thinkingMs = (round.thinkingMs ?? defaultThinkingMs) / speed;
    const charDelay = msPerChar / speed;
    const totalChars = round.message.length;

    let cancelled = false;

    // Phase 1: thinking
    dispatch({ type: "ENTER_THINKING" });
    const thinkTimer = addTimer(
      setTimeout(() => {
        if (cancelled) return;
        // Phase 2: typing
        dispatch({ type: "ENTER_TYPING" });

        if (reduceMotion) {
          dispatch({ type: "TYPING_TICK", chars: totalChars });
          const settleNow = addTimer(
            setTimeout(() => {
              if (cancelled) return;
              dispatch({ type: "SETTLE" });
              const isLast = state.currentRoundIndex >= rounds.length - 1;
              const nextTimer = addTimer(
                setTimeout(() => {
                  if (cancelled) return;
                  if (isLast) dispatch({ type: "COMPLETE" });
                  else dispatch({ type: "NEXT_ROUND" });
                }, interRoundPauseMs / speed),
              );
              timersRef.current.add(nextTimer);
            }, 120),
          );
          timersRef.current.add(settleNow);
          return;
        }

        let chars = 0;
        const typingInterval = addTimer(
          setInterval(() => {
            if (cancelled) return;
            chars = Math.min(chars + 1, totalChars);
            dispatch({ type: "TYPING_TICK", chars });
            if (chars >= totalChars) {
              clearInterval(typingInterval);
              timersRef.current.delete(typingInterval);
              // Phase 3: settled — short pause before next round
              const settleTimer = addTimer(
                setTimeout(() => {
                  if (cancelled) return;
                  dispatch({ type: "SETTLE" });
                  const isLast = stateRef.current.currentRoundIndex >= rounds.length - 1;
                  const nextTimer = addTimer(
                    setTimeout(() => {
                      if (cancelled) return;
                      if (isLast) dispatch({ type: "COMPLETE" });
                      else dispatch({ type: "NEXT_ROUND" });
                    }, interRoundPauseMs / speed),
                  );
                  timersRef.current.add(nextTimer);
                }, 200),
              );
              timersRef.current.add(settleTimer);
            }
          }, charDelay),
        );
      }, thinkingMs),
    );
    timersRef.current.add(thinkTimer);

    return () => {
      cancelled = true;
      clearAllTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentRoundIndex, state.status, state.speed, rounds, msPerChar, defaultThinkingMs, interRoundPauseMs, reduceMotion]);

  // Cleanup on unmount
  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  const api = useMemo<PlaybackEngine>(() => ({
    status: state.status,
    phase: state.phase,
    currentRoundIndex: state.currentRoundIndex,
    visibleCount: Math.min(state.visibleCount, rounds.length),
    typingChars: state.typingChars,
    speed: state.speed,
    begin: () => dispatch({ type: "BEGIN" }),
    skip: () => { clearAllTimers(); dispatch({ type: "SKIP" }); },
    replay: () => { clearAllTimers(); dispatch({ type: "REPLAY" }); },
    pause: () => { clearAllTimers(); dispatch({ type: "PAUSE" }); },
    resume: () => dispatch({ type: "RESUME" }),
    setSpeed: (speed) => dispatch({ type: "SET_SPEED", speed }),
  }), [state, rounds.length, clearAllTimers]);

  return api;
}

/** Hook returning prefers-reduced-motion preference. */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useReducer((_: boolean, next: boolean) => next, false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}
