"use client";

/**
 * The deal's required questions — a first-class rail section.
 *
 * Framing took three tries. "Non-negotiable" reads as "firm price / won't
 * haggle" — the one thing a buyer must not conclude on a negotiation
 * platform. "The seller is firm on X" still frames it as attitude. What the
 * mechanism actually is: a REQUIRED check is a prerequisite of the deal that
 * BOTH sides answer — the seller already wrote their side, the buyer hasn't
 * yet, and that missing answer is what pauses the rounds. The section label
 * says why it matters ("Before a deal closes") rather than what the data is
 * called.
 *
 * Each `ask` string is the exact question the briefing chat's forced
 * mirroring will put to the buyer (`pickSellerMirrorQuestion` returns these
 * strings), so this list is a verbatim preview of that conversation — and the
 * buyer must answer them before starting. That is also why it is always
 * expanded, never a disclosure: collapsing would hide the safety net behind
 * a click on every listing, to save the height of 1–3 rows.
 *
 * Presented as a sibling of the other rail sections (same text-label header,
 * no icon, separated by the same divider) instead of nested inside the
 * opponent card — it is a fact about the deal, not about the opponent.
 * Container style chosen from a three-variant exploration: one raised card,
 * hairline-divided rows, sunken footer band.
 */

interface RequiredQuestionsProps {
  /** Buyer-framed ask strings (seller-set, seller-answered). */
  criteria: Array<{ checkId: string; ask: string }>;
  /**
   * Owner viewing their own listing. The questions are the same either way —
   * only the footer changes, since the owner is the one who set them and has
   * no answer left to give.
   */
  isOwner?: boolean;
  className?: string;
}

export function RequiredQuestions({
  criteria,
  isOwner = false,
  className,
}: RequiredQuestionsProps) {
  if (criteria.length === 0) return null;

  return (
    <section className={className}>
      {/* Same header grammar as every other rail section — no icon, no indent. */}
      <p className="text-label text-ink-muted">Before a deal closes</p>

      <div className="mt-2.5 overflow-hidden rounded-xl border border-line-subtle bg-surface-raised">
        <ul className="divide-y divide-line-subtle">
          {criteria.map((criterion, index) => (
            <li key={criterion.checkId} className="flex items-start gap-2.5 px-3.5 py-2.5">
              <span
                className="mt-px shrink-0 font-mono text-[11px] text-ink-muted tabular-nums"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="min-w-0 text-[12.5px] text-ink leading-snug">{criterion.ask}</span>
            </li>
          ))}
        </ul>
        {/* Precise about the mechanics: start is blocked until these are
            answered — not "if it comes up" in conversation. */}
        <p className="border-line-subtle border-t bg-surface-sunken/60 px-3.5 py-2 text-[11px] text-ink-muted leading-relaxed">
          {isOwner
            ? "You set these when listing. Every buyer answers them before a deal can close."
            : "The seller answered these when listing. Give your agent your answers before you start."}
        </p>
      </div>
    </section>
  );
}
