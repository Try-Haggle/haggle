import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Browse / marketplace: a lens over a grid of listings, and inside the lens
 * the thing you came for — a gold price tag.
 *
 * Haggle brand icon rules (keep new icons in this folder consistent):
 * - 48×48 grid, drawn to sit centred without a container.
 * - Outlines use the premium gradient (navy → slate → gold) through the
 *   --icon-line-* tokens; one focal shape uses the gold tile gradient.
 * - Background detail is --icon-detail and inner "paper" is --icon-paper.
 * - Theme-dependent colours go through those tokens (style={{...}} — SVG
 *   presentation attributes don't take var()), so icons hold up in dark mode.
 * - Brand icons are for large moments (48–72px: onboarding, empty states).
 *   Small UI icons stay lucide.
 * Gradient and clip ids come from useId so several icons can share a page.
 */
export function BrowseIcon({ className }: { className?: string }) {
  const id = useId();
  const outline = `${id}-outline`;
  const tile = `${id}-tile`;
  const lens = `${id}-lens`;

  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn("size-14 shrink-0", className)}
    >
      <defs>
        <linearGradient id={outline} x1="6" y1="6" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--icon-line-start)" }} />
          <stop offset="0.45" style={{ stopColor: "var(--icon-line-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--icon-line-end)" }} />
        </linearGradient>
        <linearGradient id={tile} x1="14" y1="14" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#efd3a1" />
          <stop offset="1" stopColor="#d69a4c" />
        </linearGradient>
        <clipPath id={lens}>
          <circle cx="21" cy="21" r="11.5" />
        </clipPath>
      </defs>
      {/* Nudged so the whole mark — grid, lens and handle — is optically centred. */}
      <g transform="translate(2.5 2.5)">
        <g style={{ fill: "var(--icon-detail)" }}>
          <rect x="4" y="4" width="9" height="9" rx="2" />
          <rect x="16.5" y="4" width="9" height="9" rx="2" />
          <rect x="29" y="4" width="9" height="9" rx="2" />
          <rect x="4" y="16.5" width="9" height="9" rx="2" />
          <rect x="29" y="16.5" width="9" height="9" rx="2" />
          <rect x="4" y="29" width="9" height="9" rx="2" />
          <rect x="16.5" y="29" width="9" height="9" rx="2" />
        </g>
        <g clipPath={`url(#${lens})`}>
          <circle cx="21" cy="21" r="11.5" style={{ fill: "var(--icon-paper)" }} />
          <path
            d="M14 21.4V15.5a1.5 1.5 0 0 1 1.5-1.5h5.9a1.5 1.5 0 0 1 1.1.4l6 6a1.5 1.5 0 0 1 0 2.2l-5.7 5.7a1.5 1.5 0 0 1-2.2 0l-6-6a1.5 1.5 0 0 1-.6-.9Z"
            fill={`url(#${tile})`}
          />
          <circle cx="17.8" cy="17.8" r="1.5" style={{ fill: "var(--icon-paper)" }} />
        </g>
        <circle cx="21" cy="21" r="11.5" stroke={`url(#${outline})`} strokeWidth="2.8" />
        <path
          d="m29.5 29.5 10 10"
          stroke={`url(#${outline})`}
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
