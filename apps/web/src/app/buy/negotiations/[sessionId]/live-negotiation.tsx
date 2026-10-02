"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlModePanel } from "@/components/control-mode/control-mode-panel";
import { OpenConversationButton } from "@/components/messaging/open-conversation-button";
import { Alert, Button, Input } from "@/components/ui";
import { useNegotiationWs } from "@/hooks/use-negotiation-ws";
import { useSessionControlMode } from "@/hooks/use-session-control-mode";
import { ApiError, api } from "@/lib/api-client";
import {
  clearNegotiationRunToken,
  getNegotiationRunToken,
} from "@/lib/negotiation-auto-play-token";
import { useLocale } from "@/providers/locale-provider";
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
 * A single Decide call is capped server-side at 180s (DEEPSEEK_TIMEOUT_MS, max 300s).
 * The UI must never sit on "thinking" forever, but it must not abort before the
 * server deadline. Retry is the last resort.
 */
const STALL_AFTER_MS = 210_000;
const STALL_CHECK_INTERVAL_MS = 5_000;
const ROUND_REQUEST_TIMEOUT_MS = 200_000;

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
function pauseStateFromSession(payload: SessionResponse): PauseState | null {
  if (payload.pause_checks?.length) return { checks: payload.pause_checks };
  if (!payload.paused_for_buyer) return null;
  const ids = payload.pause_check_ids ?? [];
  const checks = (payload.pause_questions ?? []).map((ask, index) => ({
    checkId: ids[index] ?? ask,
    ask,
    options: [],
  }));
  return checks.length > 0 ? { checks } : null;
}

function toPauseChecks(next: AutoPlayNextResponse): PauseCheck[] {
  if (next.pause_checks?.length) return next.pause_checks;
  const ids = next.pause_check_ids ?? [];
  return (next.pause_questions ?? []).map((ask, index) => ({
    checkId: ids[index] ?? ask,
    ask,
    options: [],
  }));
}

/**
 * True when the current round is already on the transcript.
 *
 * The stall watchdog keys off "no new round for 210s", so an ACTIVE session that
 * already has R1/R2 can still raise the Retry banner while waiting on a later
 * round (tester a9626ebf). Hide that false stall; keep it when this round is
 * actually missing or has no message yet.
 */
function currentRoundAlreadyExists(payload: SessionResponse): boolean {
  const current = payload.session.current_round;
  if (current <= 0) return false;
  return payload.rounds.some(
    (round) => round.round_no === current && Boolean(round.message?.trim()),
  );
}

export function LiveNegotiation({
  initialPayload,
  checkoutHref,
  checkoutLabel,
  demoCheckout,
  canMessageSeller = false,
}: {
  initialPayload: SessionResponse;
  checkoutHref?: string;
  checkoutLabel?: string;
  demoCheckout?: boolean;
  /** Guests have no account to hold a conversation, so they get no button. */
  canMessageSeller?: boolean;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState(initialPayload);
  const [updateError, setUpdateError] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [pause, setPause] = useState<PauseState | null>(() =>
    pauseStateFromSession(initialPayload),
  );
  const [runnerAttempt, setRunnerAttempt] = useState(0);
  const [localInflight, setLocalInflight] = useState(false);
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
      setPause(pauseStateFromSession(next));
      setUpdateError(false);
    } catch {
      setUpdateError(true);
    }
  }, [initialPayload.session.id]);

  const control = useSessionControlMode({
    sessionId: payload.session.id,
    party: "buyer",
    serverSession: payload.session,
    localInflight,
    onApplied: reload,
    enabled: !isTerminal,
  });

  const { connectionMode } = useNegotiationWs({
    sessionId: payload.session.id,
    onUpdate: reload,
    isTerminal,
    pollIntervalMs: 1_500,
  });

  const isSpectator = initialPayload.session.driver === "mcp";
  const buyerIsManual = control.isManual;
  // Prefer Manual stop *after* in-flight Soft API completes — never abort mid-call (SoT §3).
  const preferManualRef = useRef(buyerIsManual);
  preferManualRef.current = buyerIsManual;
  // Queued or applying Manual is visible here before `isManual` flips. The drive
  // loop reads this ref so it does not have to restart.
  const pendingManualRef = useRef(control.pendingTarget === "manual");
  pendingManualRef.current = control.pendingTarget === "manual";
  // Failed Manual PATCH: stay stopped until the buyer clicks Retry or Continue Auto.
  const manualSwitchFailedRef = useRef(control.manualSwitchFailed);
  manualSwitchFailedRef.current = control.manualSwitchFailed;
  const wasManualRef = useRef(buyerIsManual);
  useEffect(() => {
    const wasManual = wasManualRef.current;
    wasManualRef.current = buyerIsManual;
    // Manual → Auto: restart Soft AI drive loop.
    // A failed Manual PATCH must not auto-resume, even if optimistic mode flickers.
    if (manualSwitchFailedRef.current) return;
    if (wasManual && !buyerIsManual && !isTerminal && !isSpectator) {
      setRunnerAttempt((n) => n + 1);
    }
  }, [buyerIsManual, isTerminal, isSpectator]);

  useEffect(() => {
    if (isSpectator) return;
    if (isTerminalNegotiationStatus(initialPayload.session.status)) return;
    // Soft Manual with nothing in flight: do not start Soft AI turns (SoT §1).
    // A queued Manual switch, or a failed Manual PATCH, is the same stop.
    if (preferManualRef.current || pendingManualRef.current || manualSwitchFailedRef.current) {
      return;
    }
    if (runnerAttempt > 0) setUpdateError(false);
    let cancelled = false;
    let activeRoundController: AbortController | null = null;
    const sessionId = initialPayload.session.id;

    // Do not read payload.session here. That ref would stay manual until
    // setPayload re-renders, and a Manual → Auto restart would bail before POST.
    // Fresh server mode is `current.session.buyer_control_mode` after each GET.
    const manualHandoffRequested = () =>
      pendingManualRef.current || preferManualRef.current || manualSwitchFailedRef.current;

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
          // Before every auto-play POST, including the iteration after a
          // CONCURRENT_MODIFICATION retry: pending Manual, preferred Manual,
          // a failed Manual switch, or this GET's buyer_control_mode.
          if (cancelled) return;
          if (manualHandoffRequested() || current.session.buyer_control_mode === "manual") {
            return;
          }
          const runToken = getNegotiationRunToken(sessionId);
          // Snapshot before the next await. A render during loadSession can
          // clear the live refs; this captured flag still stops the loop.
          let manualHandoff = false;
          try {
            activeRoundController = new AbortController();
            setLocalInflight(true);
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
              setLocalInflight(false);
            }
            manualHandoff = manualHandoffRequested();
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
            setLocalInflight(false);
            if (err instanceof ApiError && err.code === "CONCURRENT_MODIFICATION") {
              await new Promise((resolve) => window.setTimeout(resolve, 500));
              current = await loadSession();
              continue;
            }
            throw err;
          }

          current = await loadSession();
          // Handoff: after in-flight Soft API finishes, stop if Manual is preferred.
          if (
            manualHandoff ||
            manualHandoffRequested() ||
            current.session.buyer_control_mode === "manual"
          ) {
            return;
          }
        }

        if (isTerminalNegotiationStatus(current.session.status)) {
          clearNegotiationRunToken(sessionId);
        }
      } catch (err) {
        if (cancelled) return;
        setLocalInflight(false);
        const apiError = err instanceof ApiError ? err : null;
        // 409 after Auto was switched off. The server is already Manual; reload so
        // the offer bar shows. Not a failed round, so no error banner.
        if (apiError?.code === "SOFT_MANUAL_WAITING") {
          try {
            await loadSession();
          } catch {
            if (!cancelled) setUpdateError(true);
          }
          return;
        }
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
      setLocalInflight(false);
    };
  }, [
    initialPayload.session.id,
    initialPayload.session.status,
    runnerAttempt,
    isSpectator,
    // Intentionally omit buyerIsManual: flipping Manual must not abort in-flight Soft API.
  ]);

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
  // ACTIVE + current round already on the transcript is not a stall (a9626ebf).
  const hideActiveStall = payload.session.status === "ACTIVE" && currentRoundAlreadyExists(payload);
  const liveError =
    roundError ??
    (stalled && !hideActiveStall
      ? "This round is taking longer than expected. Nothing has been lost."
      : null);

  return (
    <>
      <div className="mx-auto max-w-6xl px-3 pt-3 sm:px-6">
        <ControlModePanel
          sessionId={payload.session.id}
          party="buyer"
          serverSession={payload.session}
          localInflight={localInflight}
          canToggle={!isTerminal && !isSpectator}
          controller={control}
        />
      </div>
      {control.manualSwitchFailed && (
        <div className="mx-auto max-w-6xl px-3 pt-3 sm:px-6">
          <ManualSwitchFailedNotice
            onRetry={() => control.requestMode("manual")}
            onContinueAuto={() => {
              control.clearFailure();
              setRunnerAttempt((n) => n + 1);
            }}
          />
        </div>
      )}
      <PlaybackArena
        data={data}
        checkoutHref={checkoutHref}
        checkoutLabel={checkoutLabel}
        demoCheckout={demoCheckout}
        mode="live"
        liveTerminal={isTerminal}
        connectionLabel={isSpectator ? "Watching MCP" : connectionLabel}
        liveError={liveError}
        pauseChecks={pause?.checks ?? null}
        onPauseAnswer={submitPauseAnswer}
        headerAction={
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
      {!isTerminal && !isSpectator && buyerIsManual && (
        <BuyerManualActionBar sessionId={payload.session.id} onDone={reload} />
      )}
    </>
  );
}

/**
 * Manual PATCH failed. Auto-play stays stopped until the buyer picks Retry or Continue Auto.
 */
function ManualSwitchFailedNotice({
  onRetry,
  onContinueAuto,
}: {
  onRetry: () => void;
  onContinueAuto: () => void;
}) {
  const { t } = useLocale();
  return (
    <div data-testid="manual-switch-failed">
      <Alert tone="error" title={t("negotiation.live.manualSwitchFailed.title")}>
        <p>{t("negotiation.live.manualSwitchFailed.body")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onRetry}>
            {t("negotiation.live.manualSwitchFailed.retry")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onContinueAuto}>
            {t("negotiation.live.manualSwitchFailed.continueAuto")}
          </Button>
        </div>
      </Alert>
    </div>
  );
}

/**
 * Minimal Soft Manual offer entry for the buyer (SoT: Manual = party drives Soft turns).
 */
function BuyerManualActionBar({
  sessionId,
  onDone,
}: {
  sessionId: string;
  onDone: () => void | Promise<void>;
}) {
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    const priceUsd = Number.parseFloat(offer);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      setError("Enter a valid price.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/negotiations/sessions/${sessionId}/offers`, {
        price_minor: Math.round(priceUsd * 100),
        sender_role: "BUYER",
        idempotency_key: `manual_buyer_${sessionId}_${Date.now()}`,
      });
      setOffer("");
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the offer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="buyer-manual-action-bar"
      className="sticky bottom-16 z-30 border-line border-t bg-surface/95 backdrop-blur md:bottom-0"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-3 py-3 sm:px-6">
        {error && (
          <Alert tone="error" className="text-sm">
            {error}
          </Alert>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            inputMode="decimal"
            placeholder="Your offer (Manual)"
            aria-label="Manual offer price"
            className="min-w-40 flex-1"
          />
          <Button type="submit" disabled={busy || offer.trim() === ""}>
            {busy ? "Sending…" : "Send offer"}
          </Button>
        </form>
      </div>
    </div>
  );
}
