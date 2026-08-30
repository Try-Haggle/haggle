"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface ComposerProps {
  onSend: (body: string) => void;
  disabled?: boolean;
  className?: string;
}

const MAX_HEIGHT_PX = 128;
/** One line — matches the h-10 class and the send button. */
const REST_HEIGHT_PX = 40;

/** Auto-growing input. Enter sends, Shift+Enter starts a new line. */
export function Composer({ onSend, disabled, className }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Collapse first so scrollHeight reports the content, not the current box.
    textarea.style.height = "0";
    const next = Math.min(Math.max(textarea.scrollHeight, REST_HEIGHT_PX), MAX_HEIGHT_PX);
    textarea.style.height = `${next}px`;
  }

  function submit() {
    const body = value.trim();
    if (!body || disabled) return;
    onSend(body);
    setValue("");
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) textarea.style.height = "";
    });
  }

  return (
    <form
      // Padding chosen so one line of input plus this padding stays inside the
      // rail height the wrapper sets (64px mobile / 72px desktop) — the rail,
      // not the controls, is what lines this bar up with the listing panel's
      // footer on the other side of the divider.
      className={cn("flex items-end gap-2 px-3 py-2.5 md:px-4 md:py-3.5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        placeholder="Type a message..."
        aria-label="Message"
        disabled={disabled}
        onChange={(event) => {
          setValue(event.target.value);
          resize();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        className={cn(
          // 40px tall with a 20px line and 8px padding: two pixels of slack, so
          // a single line never overflows its own box. Without that slack the
          // browser rounded scrollHeight above clientHeight and drew a
          // scrollbar in an empty input.
          "h-10 max-h-32 min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl border border-line bg-surface px-3.5 py-2 text-ink text-sm leading-5 outline-none",
          "placeholder:text-ink-muted focus:border-action-primary disabled:opacity-60",
        )}
      />
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        title="Send message"
        aria-label="Send message"
        // Exactly the input's height. The row is bottom-aligned so the button
        // stays beside the last line as the input grows; at one line, equal
        // heights make bottom-aligned and centred the same thing — unequal
        // heights are what made the button look like it had slipped down.
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-action-primary text-on-ink transition-colors hover:bg-action-primary-hover disabled:opacity-40"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  );
}
