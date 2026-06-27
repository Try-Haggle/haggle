"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface MessageListProps {
  children: ReactNode;
  /** Scroll to the bottom whenever content updates (default true). */
  autoScroll?: boolean;
  className?: string;
}

/**
 * Scrollable column for ChatBubbles: owns spacing + auto-scroll-to-bottom.
 * Give it a height/max-height via className. ChatBubble handles a single message.
 */
export function MessageList({ children, autoScroll = true, className }: MessageListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (autoScroll && el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className={cn("flex flex-col gap-2 overflow-y-auto", className)}
    >
      {children}
    </div>
  );
}
