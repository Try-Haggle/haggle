"use client";

import { CornerDownRight } from "lucide-react";

/**
 * The buyer's reply to a round that paused to ask them something.
 *
 * Rendered as a comment under the question rather than as its own bubble: it is not a
 * negotiation move, it is the answer to the one directly above it, and a separate bubble
 * would read as another offer in the ladder. Persisted on the round, so it is still here
 * after a reload — the transcript is where people check what they agreed to.
 */
export function PauseAnswerReply({
  answers,
  side,
}: {
  answers: Array<{ checkId: string; ask: string; stance: string; label?: string }>;
  side: "BUYER" | "SELLER";
}) {
  return (
    <div className={`flex ${side === "BUYER" ? "justify-end" : "justify-start"} mt-1`}>
      <div className="flex max-w-[80%] flex-col gap-0.5">
        {answers.map((answer) => (
          <div
            key={answer.checkId}
            className="flex items-start gap-1.5 text-[11px]"
            style={{ color: "var(--text-secondary)" }}
          >
            <CornerDownRight className="mt-[2px] size-3 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold">You answered</span>
              {/* The label the buyer actually tapped; the stance is the stored wording. */}
              <span className="text-ink"> {answer.label ?? answer.stance}</span>
              <span className="opacity-70"> — {answer.ask}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
