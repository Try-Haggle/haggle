"use client";

import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (targetTagId: string) => void | Promise<void>;
}

export function MergeDialog({ open, onClose, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    // capture phase so we run before DetailDrawer's bubble-phase listener
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Target tag id is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setValue("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Merge tag"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-surface-raised p-5 shadow-xl"
      >
        <h2 className="mb-3 text-lg font-semibold text-ink">Merge into existing tag</h2>
        <label
          htmlFor="merge-target-input"
          className="mb-1 block text-xs uppercase tracking-wide text-ink-muted"
        >
          Target tag id
        </label>
        <input
          id="merge-target-input"
          type="text"
          data-testid="merge-target-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="tag_…"
          className="mb-2 w-full rounded border border-line px-3 py-2 text-sm focus:border-focus focus:outline-none"
        />
        {error && (
          <div className="mb-2 text-xs text-error" role="alert">
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded border border-line bg-surface-raised px-3 py-1.5 text-sm hover:bg-surface-sunken disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="merge-submit"
            disabled={submitting}
            className="rounded bg-cta px-3 py-1.5 text-sm text-on-cta hover:bg-cta-hover disabled:opacity-50"
          >
            {submitting ? "Merging…" : "Merge"}
          </button>
        </div>
      </form>
    </div>
  );
}
