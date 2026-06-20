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

  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  });

  return (
    <div ref={ref} className={cn("flex flex-col gap-2 overflow-y-auto", className)}>
      {children}
    </div>
  );
}
