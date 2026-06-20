"use client";

import { type KeyboardEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { Chip } from "./chip";

export interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  max?: number;
  className?: string;
}

export function TagInput({ value, onChange, placeholder, max, className }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag || value.includes(tag) || (max != null && value.length >= max)) return;
    onChange([...value, tag]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
        "flex flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-surface-overlay px-2.5 py-2 focus-within:border-focus focus-within:ring-4 focus-within:ring-action-primary/20",
        className,
      )}
    >
      {value.map((tag) => (
        <Chip key={tag} size="sm" onRemove={() => onChange(value.filter((t) => t !== tag))}>
          {tag}
        </Chip>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[6rem] flex-1 bg-transparent text-ink text-sm outline-none placeholder:text-ink-muted"
      />
    </div>
  );
}
