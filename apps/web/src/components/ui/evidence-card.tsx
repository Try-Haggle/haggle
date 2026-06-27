import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const sideAccent = {
  buyer: "border-l-[3px] border-l-info/40",
  seller: "border-l-[3px] border-l-badge-text/40",
} as const;

export interface EvidenceCardProps {
  type: ReactNode;
  submittedBy?: ReactNode;
  time?: ReactNode;
  previewUrl?: string;
  /** Alt text for the preview image. */
  previewAlt?: string;
  /** On-chain anchor hash, shown as a mono chip. */
  hash?: string;
  side?: "buyer" | "seller";
  children?: ReactNode;
  className?: string;
}

export function EvidenceCard({
  type,
  submittedBy,
  time,
  previewUrl,
  previewAlt,
  hash,
  side,
  children,
  className,
}: EvidenceCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface-raised p-4",
        side && sideAccent[side],
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink text-sm">{type}</span>
        {time && <span className="shrink-0 text-ink-muted text-xs">{time}</span>}
      </div>
      {submittedBy && <div className="mt-0.5 text-ink-muted text-xs">{submittedBy}</div>}
      {previewUrl && (
        // biome-ignore lint/performance/noImgElement: evidence preview is a user-uploaded image
        <img
          src={previewUrl}
          alt={previewAlt ?? "제출된 증거"}
          className="mt-3 max-h-40 w-full rounded-lg object-cover"
        />
      )}
      {children && <p className="mt-2 text-ink-secondary text-sm">{children}</p>}
      {hash && (
        <div className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-surface-sunken px-2.5 py-1 font-mono text-[11px] text-ink-muted">
          ⛓ Anchored {hash}
        </div>
      )}
    </div>
  );
}
