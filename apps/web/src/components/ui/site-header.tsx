import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Logo } from "./logo";

export interface SiteHeaderProps {
  /** Where the wordmark goes: the landing page when signed out, the current
   *  side's dashboard when signed in. */
  logoHref: string;
  /** Content right after the logo — the signed-in nav puts its tabs here. */
  start?: ReactNode;
  /** Content pinned to the right — mode switch, bell, account menu, a CTA. */
  end?: ReactNode;
  /** Applied to the bar itself, e.g. `hidden md:block` where a bottom nav
   *  takes over on small screens. */
  className?: string;
}

/**
 * The one fixed top bar. Every surface that has a header — the signed-out
 * account pages and the signed-in app — renders this, so the bar's height,
 * width, border and wordmark are identical on both sides of signing in and
 * the logo does not move when the session starts.
 *
 * Height is the `--spacing-header` token; page content offsets with
 * `pt-header` / `top-header` / `calc(100dvh - var(--spacing-header))`.
 */
export function SiteHeader({ logoHref, start, end, className }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-line border-b bg-surface/80 backdrop-blur-md",
        className,
      )}
    >
      <div className="mx-auto flex h-header max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <div className="flex h-full min-w-0 items-center gap-8">
          <Link
            href={logoHref}
            aria-label="Haggle — home"
            className="flex shrink-0 items-center text-ink transition-opacity hover:opacity-75"
          >
            {/* 28px against 15px tabs keeps the wordmark about twice the tab
                cap height — the primary mark without shouting. Below 20px the
                gold ligature between the two g's muddies.

                Lifted 2px because the artboard includes the descenders of the
                two g's — its baseline sits at 113.55 of 127, so centring the
                BOX drops the baseline below the tabs'. Type is aligned on
                baselines, not bounding boxes. */}
            <Logo className="-translate-y-[2px] h-7" />
          </Link>
          {start}
        </div>
        {end && <div className="flex shrink-0 items-center gap-5">{end}</div>}
      </div>
    </header>
  );
}
