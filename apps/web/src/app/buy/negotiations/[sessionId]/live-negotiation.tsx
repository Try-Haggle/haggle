"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OpenConversationButton } from "@/components/messaging/open-conversation-button";
import { useNegotiationWs } from "@/hooks/use-negotiation-ws";
import { ApiError, api } from "@/lib/api-client";
import {
  clearNegotiationRunToken,
  getNegotiationRunToken,
} from "@/lib/negotiation-auto-play-token";
import {
  isTerminalNegotiationStatus,
  type SessionResponse,
  transformNegotiationPlayback,
} from "./negotiation-session-data";
import type { PauseCheck } from "./playback/pause-answer";
import { PlaybackArena } from "./playback/playback-arena";

/**
 * How long a live negotiation may show no new round before we call it stuck.
 *
 * A single DeepSeek call is capped server-side at 45s and a round can make more than
 * one, so this sits well clear of a legitimately slow round. The point is not to be
 * precise — it is that the UI must never sit on an animated "thinking" indicator
 * forever. Whatever went wrong on the server, the user gets told and gets a Retry.
 */
const STALL_AFTER_MS = 120_000;
const STALL_CHECK_INTERVAL_MS = 5_000;
// The server bounds an individual DeepSeek decision at 45s. Leave room for DB
// preparation/persistence, but do not let a wedged API request keep the live screen
// on round zero forever.
const ROUND_REQUEST_TIMEOUT_MS = 75_000;

interface AutoPlayNextResponse {
  complete: boolean;
  session_status: string;
  current_round: number;
  /** Set when the round loop stopped to ask the buyer about a seller requirement. */
  paused_for_buyer?: boolean;
  /** Each blocked check with its canonical answers. */
  pause_checks?: PauseCheck[];
  pause_questions?: string[];
  pause_check_ids?: string[];
}

/**
 * A seller-criteria PAUSE waiting on the buyer.
 *
 * The negotiation halts because the seller marked something non-negotiable that this
 * buyer never took a stance on — the safety net that stops someone buying a salvage-title
 * car without knowing. It only works if the buyer can actually answer, so the questions
 * are held here until they do.
 */
export interface PauseState {
  checks: PauseCheck[];
}

/**
 * Older servers answer with parallel `pause_questions` / `pause_check_ids` arrays and no
 * options. Rebuild the richer shape from them so a client ahead of the API still renders
 * something answerable (free text) rather than nothing.
 */
function toPauseChecks(next: AutoPlayNextResponse): PauseCheck[] {
  if (next.pause_checks?.length) return next.pause_checks;
  const ids = next.pause_check_ids ?? [];
  return (next.pause_questions ?? []).map((ask, index) => ({
    checkId: ids[index] ?? ask,
    ask,
    options: [],
  }));
}

export function LiveNegotiation({
  initialPayload,
  checkoutHref,
  checkoutLabel,
  canMessageSeller = false,
}: {
  initialPayload: SessionResponse;
  checkoutHref?: string;
  checkoutLabel?: string;
  /** Guests have no account to hold a conversation, so they get no button. */
  canMessageSeller?: boolean;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState(initialPayload);
  const [updateError, setUpdateError] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [pause, setPause] = useState<PauseState | null>(null);
  const [runnerAttempt, setRunnerAttempt] = useState(0);
  const isTerminal = isTerminalNegotiationStatus(payload.session.status);

  // Progress = a new round landed, or the session changed state. Tracked in a ref so
  // the watchdog can read it without restarting its interval on every poll.
  const progressKey = `${payload.rounds.length}:${payload.session.status}`;
  const progressRef = useRef({ key: progressKey, at: Date.now() });
  useEffect(() => {
    if (progressRef.current.key === progressKey) return;
    progressRef.current = { key: progressKey, at: Date.now() };
    setStalled(false);
  }, [progressKey]);

  useEffect(() => {
    if (isTerminal) return;
    const timer = window.setInterval(() => {
      if (Date.now() - progressRef.current.at >= STALL_AFTER_MS) setStalled(true);
    }, STALL_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isTerminal]);

  const reload = useCallback(async () => {
    try {
      const next = await api.get<SessionResponse>(
        `/negotiations/sessions/${initialPayload.session.id}`,
      );
      setPayload(next);
      setUpdateError(false);
    } catch {
      setUpdateError(true);
    }
  }, [initialPayload.session.id]);

  const { connectionMode } = useNegotiationWs({
    sessionId: payload.session.id,
    onUpdate: reload,
    isTerminal,
    pollIntervalMs: 1_500,
  });

  useEffect(() => {
    if (isTerminalNegotiationStatus(initialPayload.session.status)) return;
    if (runnerAttempt > 0) setUpdateError(false);
    let cancelled = false;
    let activeRoundController: AbortController | null = null;
    const sessionId = initialPayload.session.id;

    async function loadSession(): Promise<SessionResponse> {
      const next = await api.get<SessionResponse>(`/negotiations/sessions/${sessionId}`);
      if (!cancelled) {
        setPayload(next);
        setUpdateError(false);
      }
      return next;
    }

    async function driveRounds() {
      setRoundError(null);
      try {
        let current = await loadSession();
        while (!cancelled && !isTerminalNegotiationStatus(current.session.status)) {
          const runToken = getNegotiationRunToken(sessionId);
          try {
            activeRoundController = new AbortController();
            const requestTimeout = window.setTimeout(
              () => activeRoundController?.abort(),
              ROUND_REQUEST_TIMEOUT_MS,
            );
            let next: AutoPlayNextResponse;
            try {
              next = await api.post<AutoPlayNextResponse>(
                `/negotiations/sessions/${sessionId}/auto-play/next`,
                runToken ? { run_token: runToken } : {},
                { signal: activeRoundController.signal },
              );
            } finally {
              window.clearTimeout(requestTimeout);
              activeRoundController = null;
            }
            // A seller-criteria PAUSE answers 200 with no new round, and WAITING is not a
            // terminal status — so ignoring the body span the loop forever: POST → 200 →
            // reload → still WAITING → POST … with nothing to show for it. Hand the
            // questions to the answer UI and stop driving until the buyer replies.
            if (next.paused_for_buyer) {
              if (!cancelled) {
                setPause({ checks: toPauseChecks(next) });
              }
              await loadSession();
              return;
            }
            if (!cancelled) setPause(null);
          } catch (err) {
            if (err instanceof ApiError && err.code === "CONCURRENT_MODIFICATION") {
              await new Promise((resolve) => window.setTimeout(resolve, 500));
              current = await loadSession();
              continue;
            }
            throw err;
          }

          current = await loadSession();
        }

        if (isTerminalNegotiationStatus(current.session.status)) {
          clearNegotiationRunToken(sessionId);
        }
      } catch (err) {
        if (cancelled) return;
        const apiError = err instanceof ApiError ? err : null;
        setRoundError(
          apiError?.code === "AUTO_PLAY_TOKEN_INVALID"
            ? "This live negotiation link is no longer authorized in this tab."
            : apiError?.code === "SESSION_TERMINAL"
              ? "This negotiation has ended. Refresh to see its final status."
              : "The next round could not be generated. Your completed rounds are saved.",
        );
      }
    }

    void driveRounds();
    return () => {
      cancelled = true;
      activeRoundController?.abort();
    };
  }, [initialPayload.session.id, initialPayload.session.status, runnerAttempt]);

  useEffect(() => {
    if (!isTerminal) return;
    const timer = window.setTimeout(() => router.refresh(), 900);
    return () => window.clearTimeout(timer);
  }, [isTerminal, router]);

  /**
   * Record the buyer's answer to the paused requirement and let the rounds run on.
   *
   * The answer is written onto the buyer's criteria server-side, so once it lands the
   * unresolved set empties and `/auto-play/next` stops blocking. Bumping `runnerAttempt`
   * restarts the drive loop, which is what actually resumes the negotiation.
   */
  const submitPauseAnswer = useCallback(
    async (stances: Array<{ checkId: string; stance: string }>) => {
      const sessionId = initialPayload.session.id;
      const runToken = getNegotiationRunToken(sessionId);
      // Per-check stances, not one shared string: the API applies a bare `answer` to
      // every unresolved check, which silently records the same reply for questions the
      // buyer answered differently.
      await api.post(`/negotiations/sessions/${sessionId}/pause/answer`, {
        stances,
        ...(runToken ? { run_token: runToken } : {}),
      });
      setPause(null);
      setRoundError(null);
      setStalled(false);
      progressRef.current = { key: progressKey, at: Date.now() };
      setRunnerAttempt((attempt) => attempt + 1);
    },
    [initialPayload.session.id, progressKey],
  );

  const data = useMemo(() => transformNegotiationPlayback(payload), [payload]);
  const connectionLabel = updateError
    ? "Reconnecting"
    : connectionMode === "ws"
      ? "Live WebSocket"
      : "Live updates";

  // A reported failure wins over the watchdog: it says what actually happened. The
  // watchdog only speaks when nothing was reported at all — the silent case.
  const liveError =
    roundError ??
    (stalled ? "This round is taking longer than expected. Nothing has been lost." : null);

  return (
    <PlaybackArena
      data={data}
      checkoutHref={checkoutHref}
      checkoutLabel={checkoutLabel}
      mode="live"
      liveTerminal={isTerminal}
      connectionLabel={connectionLabel}
      liveError={liveError}
      pauseChecks={pause?.checks ?? null}
      onPauseAnswer={submitPauseAnswer}
      headerAction={
        // Only once the agents are done. While rounds are still running, an
        // invitation to message the other side asks the buyer to intervene in
        // the middle of the thing they delegated.
        canMessageSeller && isTerminal ? (
          <OpenConversationButton
            sessionId={payload.session.id}
            label="Message seller"
            className="animate-rise-in"
          />
        ) : undefined
      }
      onLiveRetry={() => {
        setStalled(false);
        progressRef.current = { key: progressKey, at: Date.now() };
        setRunnerAttempt((attempt) => attempt + 1);
      }}
    />
  );
}
