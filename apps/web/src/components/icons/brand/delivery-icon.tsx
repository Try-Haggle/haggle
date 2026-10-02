import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Delivery address: a faceted parcel (the same cream facets and gradient edge
 * as AgentIcon's mask) with a gold location pin planted on its lid — the
 * parcel, and where it goes. Same rules as BrowseIcon.
 *
 * The parcel's facets stay cream in both themes (it is the object drawn);
 * the outline follows the theme through --icon-line-*.
 */
export function DeliveryIcon({ className }: { className?: string }) {
  const id = useId();
  const outline = `${id}-outline`;
  const gold = `${id}-gold`;

  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn("size-14 shrink-0", className)}
    >
      <defs>
        <linearGradient id={outline} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--icon-line-start)" }} />
          <stop offset="0.45" style={{ stopColor: "var(--icon-line-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--icon-line-end)" }} />
        </linearGradient>
        <linearGradient id={gold} x1="10" y1="4" x2="34" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#efd3a1" />
          <stop offset="1" stopColor="#d69a4c" />
        </linearGradient>
      </defs>

      {/* Parcel, scaled down and dropped to leave room for the pin. */}
      <g transform="translate(0 4) scale(.9) translate(2.7 2)">
        <polygon points="24,6 42,14.5 24,23 6,14.5" fill="#fffdf9" />
        <polygon points="6,14.5 24,23 24,43 6,34.5" fill="#ebe5d8" />
        <polygon points="42,14.5 24,23 24,43 42,34.5" fill="#ddd5c4" />
        {/* Packing tape */}
        <polygon
          points="14.5,10.2 32.5,18.7 32.5,27 29,28.6 29,20.4 11,11.9"
          fill={`url(#${gold})`}
        />
        <polygon
          points="24,6 42,14.5 42,34.5 24,43 6,34.5 6,14.5"
          stroke={`url(#${outline})`}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path
          d="M6 14.5 24 23l18-8.5M24 23v20"
          stroke={`url(#${outline})`}
          strokeWidth="1.6"
          strokeLinejoin="round"
          opacity=".7"
        />
      </g>

      {/* Where the pin meets the lid */}
      <ellipse cx="24" cy="18.2" rx="4.2" ry="1.6" fill="#1b2a4a" opacity=".18" />
      <g transform="translate(24 17.5)">
        <path
          d="M0 -14a7 7 0 0 1 7 7C7 -1.8 0 4.5 0 4.5S-7 -1.8-7 -7a7 7 0 0 1 7-7Z"
          fill={`url(#${gold})`}
          stroke={`url(#${outline})`}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle cx="0" cy="-7" r="2.4" fill="#fffdf9" />
      </g>
    </svg>
  );
}
