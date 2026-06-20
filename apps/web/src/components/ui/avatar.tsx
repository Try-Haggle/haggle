"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export interface AvatarProps {
  src?: string | null;
  /** Used for the alt text and the initial-letter fallback. */
  name?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = { sm: "size-7 text-xs", md: "size-10 text-sm", lg: "size-16 text-xl" } as const;

export function Avatar({ src, name, size = "md", className }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  const dim = sizes[size];
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();

  if (src && !errored) {
    return (
      // biome-ignore lint/performance/noImgElement: avatar needs runtime error fallback; matches repo convention
      <img
        src={src}
        alt={name ?? ""}
        onError={() => setErrored(true)}
        className={cn("rounded-full object-cover", dim, className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-badge font-semibold text-badge-text",
        dim,
        className,
      )}
    >
      {initial}
    </span>
  );
}
