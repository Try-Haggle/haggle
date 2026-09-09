"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ControlMode,
  type ControlModeParty,
  type ControlModeSyncState,
  modesFromServerSession,
  patchSessionControlMode,
  type SessionControlModeFields,
} from "@/lib/control-mode";
import {
  formatInsufficientCreditsMessage,
  type InsufficientCreditsInfo,
  parseInsufficientCredits,
} from "@/lib/credit-balance";

/**
 * Mid-session Soft control_mode toggle with SoT handoff semantics.
 *
 * - Peer mode is always derived from **server** session fields (anti-spoof).
 * - If a Soft AI / auto-play call is in-flight for this party, the requested
 *   mode is queued and applied only after that call completes (client + server
 *   pending_* fields when present).
 * - Does not invent credit math.
 */
export function useSessionControlMode(opts: {
  sessionId: string;
  party: ControlModeParty;
  /** Latest GET session control_mode fields (server SoT). */
  serverSession: SessionControlModeFields | null | undefined;
  /**
   * True while this tab has an in-flight Soft turn API for this party
   * (e.g. buyer auto-play/next). Combined with server soft_ai_inflight_party.
   */
  localInflight: boolean;
  /** Called after a successful (or stub) apply so parent can reload session. */
  onApplied?: () => void | Promise<void>;
  enabled?: boolean;
}) {
  const { sessionId, party, serverSession, localInflight, onApplied, enabled = true } = opts;

  const server = modesFromServerSession(serverSession, party);
  const [optimisticOwn, setOptimisticOwn] = useState<ControlMode | null>(null);
  const [queuedMode, setQueuedMode] = useState<ControlMode | null>(null);
  const [syncState, setSyncState] = useState<ControlModeSyncState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [insufficientCredits, setInsufficientCredits] = useState<InsufficientCreditsInfo | null>(
    null,
  );
  const applyingRef = useRef(false);

  // Server truth wins when it moves (handoff commit / peer update / reload).
  const serverOwn = server.own;
  const serverOwnPending = server.ownPending;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear optimistic own when server mode/handoff/session changes
  useEffect(() => {
    setOptimisticOwn(null);
  }, [serverOwn, serverOwnPending, sessionId]);

  const ownDisplayed = optimisticOwn ?? server.own;
  const peerDisplayed = server.peer; // never optimistic / never client-claimed
  const inflight = localInflight || server.inflight;
  const pendingTarget = queuedMode ?? server.ownPending;

  const applyMode = useCallback(
    async (next: ControlMode) => {
      if (applyingRef.current) return;
      applyingRef.current = true;
      setSyncState("saving");
      setError(null);
      setInsufficientCredits(null);
      try {
        const result = await patchSessionControlMode(sessionId, next);
        if (!result.ok && result.stub) {
          // M1 not merged: keep SoT UX; do not invent peer mode or credits.
          setOptimisticOwn(next);
          setQueuedMode(null);
          setSyncState("stubbed");
          await onApplied?.();
          return;
        }
        if (result.ok) {
          const pending =
            result.data.pending_handoff === true ||
            result.data.pending === true ||
            (party === "buyer"
              ? Boolean(result.data.buyer_pending_control_mode)
              : Boolean(result.data.seller_pending_control_mode));
          if (pending) {
            setQueuedMode(next);
            setSyncState("handoff");
          } else {
            setOptimisticOwn(next);
            setQueuedMode(null);
            setSyncState("idle");
          }
          await onApplied?.();
        }
      } catch (err) {
        setSyncState("error");
        const insufficient = parseInsufficientCredits(err);
        if (insufficient) {
          setInsufficientCredits(insufficient);
          setError(formatInsufficientCreditsMessage(insufficient));
        } else {
          setInsufficientCredits(null);
          setError(err instanceof Error ? err.message : "Could not update control mode.");
        }
      } finally {
        applyingRef.current = false;
      }
    },
    [sessionId, party, onApplied],
  );

  // Flush queued handoff once local Soft API inflight clears (SoT §3).
  useEffect(() => {
    if (!enabled) return;
    if (!queuedMode) return;
    if (inflight) {
      setSyncState((s) => (s === "saving" ? s : "handoff"));
      return;
    }
    const next = queuedMode;
    setQueuedMode(null);
    void applyMode(next);
  }, [enabled, queuedMode, inflight, applyMode]);

  const requestMode = useCallback(
    (next: ControlMode) => {
      if (!enabled) return;
      if (next === ownDisplayed && !pendingTarget) return;
      setError(null);
      setInsufficientCredits(null);
      if (inflight) {
        // Do not cancel/abort the in-flight call — queue for after (SoT §3).
        setQueuedMode(next);
        setSyncState("handoff");
        return;
      }
      void applyMode(next);
    },
    [enabled, ownDisplayed, pendingTarget, inflight, applyMode],
  );

  const toggle = useCallback(() => {
    requestMode(ownDisplayed === "auto" ? "manual" : "auto");
  }, [ownDisplayed, requestMode]);

  return {
    enabled,
    party,
    ownMode: ownDisplayed,
    peerMode: peerDisplayed,
    pendingTarget,
    inflight,
    syncState,
    error,
    /** Set when Auto ON / Soft charge is refused for insufficient Soft credits (SoT §6). */
    insufficientCredits,
    isManual: ownDisplayed === "manual",
    isAuto: ownDisplayed === "auto",
    requestMode,
    toggle,
  };
}
