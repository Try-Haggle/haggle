"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { messagingApi } from "@/lib/messaging-api";

interface OpenConversationButtonProps {
  /** The negotiation session this thread hangs off. */
  sessionId: string;
  label?: string;
  className?: string;
}

/**
 * Opens (or reopens) the human thread for a negotiation.
 *
 * The server derives both participants from the session, so this never says who
 * the counterparty is — and a thread cannot be opened before the agents have a
 * negotiation to talk about.
 */
export function OpenConversationButton({
  sessionId,
  label = "Message",
  className,
}: OpenConversationButtonProps) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);

  async function open() {
    setOpening(true);
    setError(false);
    try {
      const { conversation } = await messagingApi.open({
        type: "negotiation_session",
        id: sessionId,
      });
      router.push(`/messages?c=${conversation.id}`);
    } catch {
      setError(true);
      setOpening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={opening}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-semibold text-ink text-xs transition-colors hover:bg-surface-sunken disabled:opacity-60",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      {error ? "Try again" : opening ? "Opening…" : label}
    </button>
  );
}
