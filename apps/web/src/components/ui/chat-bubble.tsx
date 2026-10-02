import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ChatBubbleProps {
  /** "right" = the current user's message. */
  side?: "left" | "right";
  author?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * One message. Mine = the primary fill (navy in light, gold in dark — the
 * same adaptive colour as the primary button), theirs = the sunken surface.
 * Each has a "tail" corner on its own side. The 1:1 messaging thread uses
 * the same pair so every chat in the app reads the same way.
 */
export function ChatBubble({
  side = "left",
  author,
  footer,
  children,
  className,
}: ChatBubbleProps) {
  const mine = side === "right";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start", className)}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
          mine
            ? "rounded-br-sm bg-cta text-on-cta"
            : "rounded-bl-sm border border-line bg-surface-sunken text-ink",
        )}
      >
        {author && (
          <div
            className={cn(
              "mb-1 font-medium text-xs",
              mine ? "text-on-cta/75" : "text-ink-secondary",
            )}
          >
            {author}
          </div>
        )}
        <div className="break-words">{children}</div>
        {footer && (
          <div className={cn("mt-1.5 text-xs", mine ? "text-on-cta/70" : "text-ink-muted")}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      role="status"
      aria-label="Typing"
    >
      {["d0", "d1", "d2"].map((k, i) => (
        <span
          key={k}
          className="size-1.5 animate-bounce rounded-full bg-ink-muted"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
