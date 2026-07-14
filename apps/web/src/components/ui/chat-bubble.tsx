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
          mine ? "bg-action-primary/10" : "border border-line bg-surface-sunken",
        )}
      >
        {author && <div className="mb-1 font-medium text-ink-secondary text-xs">{author}</div>}
        <div className="break-words text-ink">{children}</div>
        {footer && <div className="mt-1.5 text-ink-muted text-xs">{footer}</div>}
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
