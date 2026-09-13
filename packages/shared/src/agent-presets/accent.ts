/**
 * Agent accent colours.
 *
 * An agent's accent is not decoration. The web app uses it as a text colour
 * (taglines, names in negotiation playback), as a translucent fill by appending
 * a hex alpha (`${accent}1f`), and as radar and border strokes. Two rules follow:
 *
 * 1. **Always `#rrggbb`, lowercase.** The alpha-append pattern produces garbage
 *    from `#rgb`, a named colour or `rgb()`. `normalizeAgentAccent` is the one
 *    place that shape is enforced.
 * 2. **Never unreadable.** A free picker happily hands back `#ffee00`, which
 *    as text on the cream surface is 1.14:1. `readableAgentAccent` nudges a
 *    colour just far enough to clear `AGENT_ACCENT_MIN_CONTRAST` against both
 *    themes' page background, and leaves anything already clear untouched.
 *
 * The floor is set by the swatches rather than by a guideline: amber, the
 * palest swatch and a preset colour since before users could choose, sits at
 * 2.04:1 on cream. A custom colour may not be worse than the palette we ship;
 * raising the bar is a palette decision, made here, for every agent at once.
 */

/** Minimum contrast against both page backgrounds. See the module comment. */
export const AGENT_ACCENT_MIN_CONTRAST = 2;

/**
 * Page backgrounds the accent is read against. Mirrors `--bg-primary` in the
 * web app's globals.css (light) and `--color-navy-900` (dark).
 */
export const AGENT_ACCENT_SURFACES = { light: "#fbf9f5", dark: "#080d1a" } as const;

/**
 * The colours offered as one-tap choices, in hue order. The four preset accents
 * are here verbatim so an agent still wearing its preset colour shows as
 * selected; the other six fill the gaps between them.
 */
export const AGENT_ACCENT_SWATCHES = [
  { id: "red", hex: "#ef4444" },
  { id: "orange", hex: "#f97316" },
  { id: "amber", hex: "#f59e0b" },
  { id: "green", hex: "#10b981" },
  { id: "teal", hex: "#14b8a6" },
  { id: "blue", hex: "#3b82f6" },
  { id: "indigo", hex: "#6366f1" },
  { id: "purple", hex: "#a855f7" },
  { id: "pink", hex: "#ec4899" },
  { id: "slate", hex: "#64748b" },
] as const;

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/** `#RGB`, `RGB`, `#RRGGBB` → `#rrggbb`. Anything else → null. */
export function normalizeAgentAccent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const six = HEX6.exec(v);
  if (six) return `#${six[1].toLowerCase()}`;
  const three = HEX3.exec(v);
  if (three)
    return `#${three[1]}${three[1]}${three[2]}${three[2]}${three[3]}${three[3]}`.toLowerCase();
  return null;
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function accentContrast(a: string, b: string): number {
  const [hi, lo] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb;

/**
 * The smallest mix toward `toward` that clears the floor against `surface`.
 * Bisection over the mix amount, so the hue is kept and only lightness moves.
 */
function nudge(rgb: Rgb, toward: Rgb, surface: string): string {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (accentContrast(toHex(mixRgb(rgb, toward, mid)), surface) >= AGENT_ACCENT_MIN_CONTRAST)
      hi = mid;
    else lo = mid;
  }
  return toHex(mixRgb(rgb, toward, hi));
}

/**
 * A colour that stays legible as text in both themes. Too pale for cream is
 * darkened; too dark for navy is lightened; anything already clear of both is
 * returned exactly as given. The two corrections never conflict — the band of
 * luminance that clears both backgrounds is wide.
 */
export function readableAgentAccent(hex: string): string {
  const rgb = toRgb(hex);
  const { light, dark } = AGENT_ACCENT_SURFACES;
  if (accentContrast(hex, light) < AGENT_ACCENT_MIN_CONTRAST) return nudge(rgb, [0, 0, 0], light);
  if (accentContrast(hex, dark) < AGENT_ACCENT_MIN_CONTRAST)
    return nudge(rgb, [255, 255, 255], dark);
  return hex;
}

/**
 * A stored accent, made safe to render: normalized, then kept readable.
 * Returns null when there is no usable colour, so callers fall back to the
 * preset's own accent.
 */
export function resolveAgentAccent(value: unknown): string | null {
  const hex = normalizeAgentAccent(value);
  return hex ? readableAgentAccent(hex) : null;
}
