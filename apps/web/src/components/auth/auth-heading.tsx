import type { ReactNode } from "react";

/**
 * Title (and optional one-line description) at the top of an auth page. One
 * component so every auth page keeps the same type and the same 12px gap —
 * 8px read as the two lines touching.
 */
export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="space-y-3 text-center">
      <h1 className="font-bold text-3xl text-ink tracking-tight">{title}</h1>
      {description && <p className="text-base text-ink-secondary">{description}</p>}
    </div>
  );
}
