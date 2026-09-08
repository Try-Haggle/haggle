"use client";

import { Switch } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ControlMode, ControlModeSyncState } from "@/lib/control-mode";

export interface ControlModeToggleProps {
  ownMode: ControlMode;
  onToggle: () => void;
  disabled?: boolean;
  syncState?: ControlModeSyncState;
  className?: string;
}

/**
 * Session Soft Auto ↔ Manual toggle (buyer and seller). Default Auto ON;
 * no forced start chooser (SoT §2–§4).
 */
export function ControlModeToggle({
  ownMode,
  onToggle,
  disabled = false,
  syncState = "idle",
  className,
}: ControlModeToggleProps) {
  const autoOn = ownMode === "auto";
  const busy = syncState === "saving" || syncState === "handoff";

  return (
    <div
      data-testid="control-mode-toggle"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2.5",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">Haggle AI Soft turns</p>
        <p className="text-xs text-ink-muted">
          {autoOn
            ? "Auto — Haggle AI negotiates Soft Preference turns for you."
            : "Manual — you drive Soft turns; Haggle AI pauses for your side."}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn("text-xs font-semibold", autoOn ? "text-info" : "text-ink-muted")}
          data-testid="control-mode-toggle-auto-label"
        >
          Auto
        </span>
        <Switch
          checked={autoOn}
          disabled={disabled || busy}
          onCheckedChange={() => onToggle()}
          aria-label={autoOn ? "Turn Auto off (switch to Manual)" : "Turn Auto on"}
          size="md"
        />
        <span
          className={cn("text-xs font-semibold", !autoOn ? "text-warning" : "text-ink-muted")}
          data-testid="control-mode-toggle-manual-label"
        >
          Manual
        </span>
      </div>
    </div>
  );
}
