"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { PlaybackArena } from "./playback/playback-arena";

export function LiveNegotiation({
  initialPayload,
  checkoutHref,
  checkoutLabel,
}: {
  initialPayload: SessionResponse;
  checkoutHref?: string;
  checkoutLabel?: string;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState(initialPayload);
  const [updateError, setUpdateError] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);
  const [runnerAttempt, setRunnerAttempt] = useState(0);
  const isTerminal = isTerminalNegotiationStatus(payload.session.status);

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
            await api.post<{
              complete: boolean;
              session_status: string;
              current_round: number;
            }>(
              `/negotiations/sessions/${sessionId}/auto-play/next`,
              runToken ? { run_token: runToken } : {},
            );
          } catch (err) {
            if (
              err instanceof ApiError &&
              ["CONCURRENT_MODIFICATION", "SESSION_TERMINAL"].includes(err.code)
            ) {
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
            : "The next round could not be generated. Your completed rounds are saved.",
        );
      }
    }

    void driveRounds();
    return () => {
      cancelled = true;
    };
  }, [initialPayload.session.id, initialPayload.session.status, runnerAttempt]);

  useEffect(() => {
    if (!isTerminal) return;
    const timer = window.setTimeout(() => router.refresh(), 900);
    return () => window.clearTimeout(timer);
  }, [isTerminal, router]);

  const data = useMemo(() => transformNegotiationPlayback(payload), [payload]);
  const connectionLabel = updateError
    ? "Reconnecting"
    : connectionMode === "ws"
      ? "Live WebSocket"
      : "Live updates";

  return (
    <PlaybackArena
      data={data}
      checkoutHref={checkoutHref}
      checkoutLabel={checkoutLabel}
      mode="live"
      liveTerminal={isTerminal}
      connectionLabel={connectionLabel}
      liveError={roundError}
      onLiveRetry={() => setRunnerAttempt((attempt) => attempt + 1)}
    />
  );
}
