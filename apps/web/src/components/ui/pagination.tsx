import { cn } from "@/lib/cn";

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  totalPages: number;
  /** Called with the requested 1-based page. */
  onPageChange: (page: number) => void;
  /** Hide entirely when there is a single page (default true). */
  hideOnSinglePage?: boolean;
  className?: string;
}

const navButton =
  "rounded-lg border border-line px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

export function Pagination({
  page,
  totalPages,
  onPageChange,
  hideOnSinglePage = true,
  className,
}: PaginationProps) {
  if (hideOnSinglePage && totalPages <= 1) return null;
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className={navButton}
      >
        Previous
      </button>
      <span className="text-ink-muted text-sm">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className={navButton}
      >
        Next
      </button>
    </div>
  );
}
