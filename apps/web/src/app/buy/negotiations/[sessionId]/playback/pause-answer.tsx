"use client";

import { AlertCircle } from "lucide-react";
import { useState } from "react";

export interface PauseCheck {
  checkId: string;
  ask: string;
  /** Canonical answers for this check — the same ones Quick Setup offers. */
  options: Array<{ label: string; stance: string }>;
}

/**
 * The buyer's reply to a paused negotiation.
 *
 * The round loop stops when the seller marked something non-negotiable that this buyer
 * never took a stance on — the safety net that keeps someone from buying a salvage-title
 * car without knowing. The server has always sent the questions and always accepted an
 * answer; there was simply nowhere to type one, so a paused session could never resume.
 *
 * Each blocked check gets its OWN answer. A pause can name several requirements at once,
 * and a single shared text box cannot answer three separate yes/no questions — whatever
 * you type ends up recorded as the stance for all of them. Tapping also produces the
 * exact canonical stance the taxonomy defines, so the answer matches what the same check
 * would have recorded during setup. Checks with no canonical options fall back to text.
 */
export function PauseAnswer({
  checks,
  onSubmit,
}: {
  checks: PauseCheck[];
  onSubmit: (stances: Array<{ checkId: string; stance: string }>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = checks.filter((check) => (answers[check.checkId] ?? "").trim().length > 0);
  const allAnswered = answered.length === checks.length && checks.length > 0;

  const send = async () => {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(
        checks.map((check) => ({
          checkId: check.checkId,
          stance: (answers[check.checkId] ?? "").trim(),
        })),
      );
    } catch {
      // Keep what they chose — answering twice is the thing this panel exists to avoid.
      setError("That didn't go through. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3 border-t px-4 py-3"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-sunken)" }}
    >
      <div className="flex items-center gap-1.5">
        <AlertCircle className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span className="font-semibold text-[10px] text-ink-muted tracking-wider">
          YOUR AGENT NEEDS AN ANSWER
        </span>
        {checks.length > 1 && (
          <span className="text-[10px] text-ink-muted">
            {answered.length} of {checks.length}
          </span>
        )}
      </div>

      {checks.map((check) => {
        const value = answers[check.checkId] ?? "";
        return (
          <div key={check.checkId} className="flex flex-col gap-1.5">
            <span className="text-[13px] text-ink-secondary leading-snug">{check.ask}</span>
            {check.options.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {check.options.map((option) => {
                  const selected = value === option.stance;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={submitting}
                      aria-pressed={selected}
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [check.checkId]: option.stance }))
                      }
                      className={`rounded-full border px-3 py-1 text-[12px] transition-colors disabled:opacity-60 ${
                        selected
                          ? "border-transparent bg-action-primary text-white"
                          : "border-line bg-surface-raised text-ink-secondary hover:bg-surface-sunken"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                type="text"
                value={value}
                disabled={submitting}
                onChange={(event) =>
                  setAnswers((prev) => ({ ...prev, [check.checkId]: event.target.value }))
                }
                aria-label={check.ask}
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-[13px] text-ink disabled:opacity-60"
              />
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void send()}
          disabled={submitting || !allAnswered}
          className="rounded-lg bg-action-primary px-3 py-2 font-semibold text-[12px] text-white transition-opacity disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Answer & resume"}
        </button>
        {error && <span className="text-[11px] text-error">{error}</span>}
      </div>
    </div>
  );
}
