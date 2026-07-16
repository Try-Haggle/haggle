"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNegotiationWs } from "@/hooks/use-negotiation-ws";
import { api } from "@/lib/api-client";
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
    />
  );
}
