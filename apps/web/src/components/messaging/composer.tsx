"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { isSubmitEnter } from "@/lib/keyboard";

interface ComposerProps {
  onSend: (body: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Heights of the textarea itself, not of the box around it: the wrapper adds a
 * 1px border and 8px of padding above and below, so its own rest height lands
 * at the 40px the send button uses, and its cap at the 128px the rail allows.
 */
const LINE_HEIGHT_PX = 20;
const WRAPPER_CHROME_PX = 18;
const REST_HEIGHT_PX = LINE_HEIGHT_PX;
const MAX_HEIGHT_PX = 128 - WRAPPER_CHROME_PX;

/** Auto-growing input. Enter sends, Shift+Enter starts a new line. */
export function Composer({ onSend, disabled, className }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Collapse first so scrollHeight reports the content, not the current box.
    textarea.style.height = "0";
    // The textarea has no border of its own now, so scrollHeight is the whole
    // content box.
    const content = textarea.scrollHeight;
    const next = Math.min(Math.max(content, REST_HEIGHT_PX), MAX_HEIGHT_PX);
    textarea.style.height = `${next}px`;
    // While the box still grows there is nothing to scroll, so a scrollbar is
    // just a bar sitting inside the input. It appears only once the input has
    // stopped growing and text is genuinely hidden — the same rule the
    // negotiation transcript follows.
    textarea.style.overflowY = content > MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  function submit() {
    const body = value.trim();
    if (!body || disabled) return;
    onSend(body);
    setValue("");
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "";
        textarea.style.overflowY = "hidden";
      }
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
      {/* The border lives on this wrapper, not on the textarea.
          A scrollbar is painted at the inner edge of its own element's border,
          which padding cannot move — on the textarea it sat on top of the
          rounded corner. Inside a wrapper it lands on the textarea's edge,
          inset from the visible border by this padding. */}
      <div
        className={cn(
          "flex max-h-32 min-h-10 flex-1 items-center rounded-2xl border border-line bg-surface py-2 pr-1 pl-3.5",
          "focus-within:border-action-primary",
          disabled && "opacity-60",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          // Thin rather than the platform default, matching the transcript.
          style={{ scrollbarWidth: "thin" }}
          placeholder="Type a message..."
          aria-label="Message"
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            // While an IME is composing, Enter confirms the syllable — sending
            // here would post the message mid-word and leave the last character
            // behind to be sent on its own.
            if (isSubmitEnter(event)) {
              event.preventDefault();
              submit();
            }
          }}
          className={cn(
            "h-5 w-full resize-none overflow-y-hidden bg-transparent pr-2.5 text-ink text-sm leading-5 outline-none",
            "placeholder:text-ink-muted",
          )}
        />
      </div>
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
