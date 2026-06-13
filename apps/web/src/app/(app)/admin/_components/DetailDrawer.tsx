"use client";

import { useEffect, useState } from "react";
import { type AdminInboxDetail, adminApi, type InboxType } from "@/lib/admin-api";
import { ActionButtons } from "./ActionButtons";

interface Props {
  type: InboxType;
  id: string | null;
  onClose: () => void;
  /** Called by ActionButtons after a successful mutation. */
  onDone?: (removedId: string) => void;
  /** Optional injected fetcher for tests. */
  fetchDetail?: (type: InboxType, id: string) => Promise<AdminInboxDetail>;
}

export function DetailDrawer({ type, id, onClose, onDone, fetchDetail }: Props) {
  const [detail, setDetail] = useState<AdminInboxDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = id !== null;

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const load = fetchDetail ?? ((t: InboxType, i: string) => adminApi.inbox.detail(t, i));

    setLoading(true);
    setError(null);
    load(type, id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load detail");
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, id, fetchDetail]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label={`${type} detail`}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; dialog has aria-label + close button for keyboard */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss; dialog has aria-label + close button for keyboard */}
      <div data-testid="drawer-backdrop" className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-lg overflow-y-auto border-l border-line bg-surface-raised p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-muted">{type}</div>
            <div className="font-mono text-sm text-ink">{id}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded border border-line bg-surface-raised px-3 py-1 text-sm hover:bg-surface-sunken"
          >
            Close
          </button>
        </div>

        {loading && <div className="text-sm text-ink-muted">Loading…</div>}
        {error && (
          <div className="text-sm text-error" role="alert">
            {error}
          </div>
        )}
        {!loading && !error && detail && (
          <>
            <pre
              data-testid="drawer-detail"
              className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-sunken p-3 text-xs text-ink"
            >
              {JSON.stringify(detail, null, 2)}
            </pre>

            <ActionButtons detail={detail} onDone={(removedId) => onDone?.(removedId)} />
          </>
        )}
      </aside>
    </div>
  );
}
