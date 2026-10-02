import { useId } from "react";
import { cn } from "@/lib/cn";

/** Outer silhouette: ears, cheeks, chin. */
const OUTLINE = "8,5 17,15 24,13 31,15 40,5 42,24 36,31 24,44 12,31 6,24";

/**
 * Facets of the mask, light to shade. The mask stays cream in both themes on
 * purpose — it is the object being drawn, like a white mask on any wall —
 * while the outline follows the theme through --icon-line-*.
 */
const FACETS: Array<[points: string, fill: string]> = [
  ["8,5 12,19 6,24", "#e6dfd1"], // left ear, outer
  ["8,5 17,15 12,19", "url(#EAR)"], // left ear, inner
  ["40,5 42,24 36,19", "#e6dfd1"], // right ear, outer
  ["40,5 31,15 36,19", "url(#EAR)"], // right ear, inner
  ["17,15 24,13 31,15 24,23", "#fffdf9"], // forehead
  ["12,19 17,15 24,23 18,26", "#f3efe6"], // left brow
  ["36,19 31,15 24,23 30,26", "#ebe5d8"], // right brow
  ["6,24 12,19 18,26 12,31", "#e6dfd1"], // left cheek
  ["42,24 36,19 30,26 36,31", "#ddd5c4"], // right cheek
  ["18,26 24,23 30,26 24,32", "#fffdf9"], // muzzle
  ["12,31 18,26 24,32 24,44", "#fbf9f5"], // left jaw
  ["36,31 30,26 24,32 24,44", "#f0ebe0"], // right jaw
];

/**
 * Your negotiation agent: a faceted fox mask. The fox is the first preset
 * (Bargain Hunter); the mask and the narrowed eyes make it read as someone
 * acting on your behalf rather than a pet. Same rules as BrowseIcon.
 */
export function AgentIcon({ className }: { className?: string }) {
  const id = useId();
  const outline = `${id}-outline`;
  const ear = `${id}-ear`;

  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn("size-14 shrink-0", className)}
    >
      <defs>
        <linearGradient id={outline} x1="6" y1="5" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--icon-line-start)" }} />
          <stop offset="0.45" style={{ stopColor: "var(--icon-line-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--icon-line-end)" }} />
        </linearGradient>
        <linearGradient id={ear} x1="8" y1="5" x2="40" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#dcaa5e" />
          <stop offset="1" stopColor="#b8823e" />
        </linearGradient>
      </defs>
      {FACETS.map(([points, fill]) => (
        <polygon key={points} points={points} fill={fill === "url(#EAR)" ? `url(#${ear})` : fill} />
      ))}
      {/* Narrowed eyes and nose — the only ink on the mask. */}
      <path d="M13.5 23 20.5 25.2 15.5 26Z M34.5 23 27.5 25.2 32.5 26Z" fill="#1b2a4a" />
      <path d="M21.6 38.5h4.8L24 44Z" fill="#1b2a4a" />
      <polygon
        points={OUTLINE}
        stroke={`url(#${outline})`}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
