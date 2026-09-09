"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Switch } from "@/components/ui";
import {
  type ControlMode,
  DEFAULT_CONTROL_MODE,
  readDefaultControlModePreference,
  subscribeDefaultControlModePreference,
  writeDefaultControlModePreference,
} from "@/lib/control-mode";

/**
 * Account default Soft control_mode preference (SoT §2).
 * Applied at next session create via withDefaultControlModePreference on start.
 * Dual-persisted (localStorage + cookie) so Manual/Auto survive reload/re-entry.
 */
export function ControlModeSettings() {
  const mode = useSyncExternalStore(
    subscribeDefaultControlModePreference,
    readDefaultControlModePreference,
    () => DEFAULT_CONTROL_MODE,
  );
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function update(next: ControlMode) {
    setSaveError(false);
    const ok = writeDefaultControlModePreference(next);
    if (!ok) {
      setSaveError(true);
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  const autoOn = mode === "auto";

  return (
    <section
      data-testid="control-mode-settings"
      className="rounded-xl border border-line bg-surface-raised p-4 sm:p-6 mb-6"
    >
      <h2 className="text-base sm:text-lg font-semibold text-ink mb-1">Negotiation control mode</h2>
      <p className="text-sm text-ink-muted mb-4">
        Default Soft Auto/Manual for future sessions. New negotiations start with this preference
        (default Auto ON) — you are never forced to choose at start. You can still toggle
        mid-session.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {autoOn ? "Auto (Haggle AI Soft turns)" : "Manual (you drive Soft turns)"}
          </p>
          <p className="text-xs text-ink-muted">
            Hard Authority, fees, and settlement are unchanged.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-semibold ${autoOn ? "text-info" : "text-ink-muted"}`}>
            Auto
          </span>
          <Switch
            checked={autoOn}
            disabled={!hydrated}
            onCheckedChange={(checked) => update(checked ? "auto" : "manual")}
            aria-label="Default Soft control mode Auto"
          />
          <span className={`text-xs font-semibold ${!autoOn ? "text-warning" : "text-ink-muted"}`}>
            Manual
          </span>
        </div>
      </div>

      {saved && (
        <Alert tone="success" className="mt-3 text-sm">
          Default saved. It applies to new sessions only.
        </Alert>
      )}
      {saveError && (
        <Alert tone="error" className="mt-3 text-sm">
          Could not save default. Check browser storage and try again.
        </Alert>
      )}
    </section>
  );
}
