import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface BackLinkProps {
  href: string;
  children?: ReactNode;
  className?: string;
}

export function BackLink({ href, children = "Back", className }: BackLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded text-ink-secondary text-sm transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
        className,
      )}
    >
      <ChevronLeft className="size-4" />
      {children}
    </Link>
  );
}
