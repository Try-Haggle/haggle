"use client";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  type ControlMode,
  type ControlModeSyncState,
  counterpartModeLabel,
  ownModeLabel,
} from "@/lib/control-mode";

export interface ControlModeStatusStripProps {
  ownMode: ControlMode;
  /** Must come from server session fields only (anti-spoof). */
  peerMode: ControlMode;
  pendingTarget?: ControlMode | null;
  syncState?: ControlModeSyncState;
  className?: string;
}

/**
 * CU-ready Soft control_mode status strip (SoT §6).
 * Shows own + counterpart modes with short unambiguous labels.
 */
export function ControlModeStatusStrip({
  ownMode,
  peerMode,
  pendingTarget = null,
  syncState = "idle",
  className,
}: ControlModeStatusStripProps) {
  const handoff =
    syncState === "handoff" || (pendingTarget != null && pendingTarget !== ownMode);
  const stubbed = syncState === "stubbed";

  return (
    <div
      data-testid="control-mode-status-strip"
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 text-xs sm:text-[13px]",
        className,
      )}
    >
      <span className="font-semibold text-ink-secondary tracking-wide uppercase text-[10px]">
        Soft control
      </span>
      <Badge
        tone={ownMode === "auto" ? "info" : "warning"}
        size="sm"
        data-testid="control-mode-own"
        aria-label={ownModeLabel(ownMode)}
      >
        {ownModeLabel(ownMode)}
      </Badge>
      <Badge
        tone={peerMode === "auto" ? "neutral" : "warning"}
        size="sm"
        data-testid="control-mode-peer"
        data-source="server"
        aria-label={counterpartModeLabel(peerMode)}
      >
        {counterpartModeLabel(peerMode)}
      </Badge>
      {handoff && pendingTarget && (
        <span className="text-ink-muted" data-testid="control-mode-handoff">
          Switching to {pendingTarget === "auto" ? "Auto" : "Manual"} after current turn…
        </span>
      )}
      {stubbed && (
        <span className="text-ink-muted" data-testid="control-mode-stub">
          Local preview — server sync when M1 lands
        </span>
      )}
    </div>
  );
}
