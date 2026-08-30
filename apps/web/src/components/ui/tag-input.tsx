"use client";

import { type KeyboardEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { isImeComposing } from "@/lib/keyboard";
import { Chip } from "./chip";

export interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  max?: number;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  className?: string;
}

export function TagInput({
  value,
  onChange,
  placeholder,
  max,
  disabled = false,
  id,
  invalid = false,
  className,
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    if (disabled) return;
    const tag = raw.trim();
    if (!tag || value.includes(tag) || (max != null && value.length >= max)) return;
    onChange([...value, tag]);
    setDraft("");
  };

  const remove = (tag: string) => {
    if (disabled) return;
    onChange(value.filter((t) => t !== tag));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (isImeComposing(e)) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-[10px] border bg-surface-overlay px-2.5 py-2 focus-within:border-focus focus-within:ring-4 focus-within:ring-action-primary/20",
        invalid ? "border-error" : "border-line",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {value.map((tag) => (
        <Chip key={tag} size="sm" onRemove={() => remove(tag)}>
          {tag}
        </Chip>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[6rem] flex-1 bg-transparent text-ink text-sm outline-none placeholder:text-ink-muted"
      />
    </div>
  );
}
