"use client";

import { CreditBalanceStrip } from "@/components/credit-balance/credit-balance-strip";
import { InsufficientCreditsAlert } from "@/components/credit-balance/insufficient-credits-alert";
import { Alert } from "@/components/ui";
import { useCreditBalance } from "@/hooks/use-credit-balance";
import { useSessionControlMode } from "@/hooks/use-session-control-mode";
import {
  CONTROL_MODE_UI_ENABLED,
  type ControlModeParty,
  type SessionControlModeFields,
} from "@/lib/control-mode";
import { ControlModeStatusStrip } from "./control-mode-status-strip";
import { ControlModeToggle } from "./control-mode-toggle";

export type SessionControlModeController = ReturnType<typeof useSessionControlMode>;

export interface ControlModePanelProps {
  sessionId: string;
  party: ControlModeParty;
  serverSession: SessionControlModeFields | null | undefined;
  localInflight: boolean;
  onApplied?: () => void | Promise<void>;
  /** When false, strip still shows modes but toggle is hidden (e.g. terminal). */
  canToggle?: boolean;
  className?: string;
  /** Optional external controller (buyer/seller pages lift the hook for loop control). */
  controller?: SessionControlModeController;
  /** Show Soft credit balance chrome (SoT credit-ledger §6). Default true. */
  showCreditBalance?: boolean;
}

function ControlModePanelView({
  ctrl,
  canToggle,
  className,
  party,
  credit,
}: {
  ctrl: SessionControlModeController;
  canToggle: boolean;
  className?: string;
  party: ControlModeParty;
  credit: ReturnType<typeof useCreditBalance> | null;
}) {
  return (
    <div
      data-testid="control-mode-panel"
      data-party={party}
      className={className ? `flex flex-col gap-2 ${className}` : "flex flex-col gap-2"}
    >
      {credit && <CreditBalanceStrip state={credit} loading={credit.loading} />}
      <ControlModeStatusStrip
        ownMode={ctrl.ownMode}
        peerMode={ctrl.peerMode}
        pendingTarget={ctrl.pendingTarget}
        syncState={ctrl.syncState}
      />
      {canToggle && (
        <ControlModeToggle
          ownMode={ctrl.ownMode}
          onToggle={ctrl.toggle}
          syncState={ctrl.syncState}
          disabled={!canToggle}
        />
      )}
      {ctrl.insufficientCredits && <InsufficientCreditsAlert info={ctrl.insufficientCredits} />}
      {ctrl.error && !ctrl.insufficientCredits && (
        <Alert tone="error" className="text-sm">
          {ctrl.error}
        </Alert>
      )}
    </div>
  );
}

/**
 * Session Soft control_mode UI: CU-ready status strip + mid-session toggle.
 * Peer mode is read only from serverSession (anti-spoof).
 * Soft credit balance chrome + insufficient Auto-ON UX (credit-ledger-sot.md §6).
 */
export function ControlModePanel({
  sessionId,
  party,
  serverSession,
  localInflight,
  onApplied,
  canToggle = true,
  className,
  controller,
  showCreditBalance = true,
}: ControlModePanelProps) {
  const internal = useSessionControlMode({
    sessionId,
    party,
    serverSession,
    localInflight,
    onApplied,
    enabled: CONTROL_MODE_UI_ENABLED && canToggle && !controller,
  });
  const ctrl = controller ?? internal;
  const credit = useCreditBalance({ enabled: showCreditBalance && CONTROL_MODE_UI_ENABLED });

  if (!CONTROL_MODE_UI_ENABLED) return null;

  return (
    <ControlModePanelView
      ctrl={ctrl}
      canToggle={canToggle}
      className={className}
      party={party}
      credit={showCreditBalance ? credit : null}
    />
  );
}
