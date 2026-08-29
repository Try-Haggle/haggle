"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface ComposerProps {
  onSend: (body: string) => void;
  disabled?: boolean;
}

const MAX_HEIGHT_PX = 128;

/** Auto-growing input. Enter sends, Shift+Enter starts a new line. */
export function Composer({ onSend, disabled }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
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
      className="flex items-end gap-2 p-3 md:p-4"
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
          "max-h-32 min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink text-sm outline-none",
          "placeholder:text-ink-muted focus:border-action-primary disabled:opacity-60",
        )}
      />
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        title="Send message"
        aria-label="Send message"
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
