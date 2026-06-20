import { cn } from "@/lib/cn";

export interface SkeletonProps {
  className?: string;
}

/** Loading placeholder. Set size/shape via className (e.g. `h-4 w-32`, `size-10 rounded-full`). */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-sunken", className)}
    />
  );
}
