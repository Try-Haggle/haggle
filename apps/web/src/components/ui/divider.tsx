import { cn } from "@/lib/cn";

/** A horizontal rule, optionally with a short label in the middle ("or"). */
export function Divider({ label, className }: { label?: string; className?: string }) {
  if (!label) return <hr className={cn("border-line border-t", className)} />;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="text-ink-secondary text-sm">{label}</span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}
