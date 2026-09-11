/**
 * Locale for API request/response copy.
 *
 * Default is English. Clients send `Accept-Language`; missing or unknown values
 * resolve to `en`. Add a locale by appending to `API_LOCALES`.
 */

export const DEFAULT_API_LOCALE = "en";
export const API_LOCALES = ["en", "ko"] as const;
export type ApiLocale = (typeof API_LOCALES)[number];

export function isApiLocale(value: string | null | undefined): value is ApiLocale {
  return value === "en" || value === "ko";
}

function primaryTag(tag: string): string {
  const base = tag.trim().split(";")[0]?.trim() ?? "";
  return base.split("-")[0]?.toLowerCase() ?? "";
}

function quality(tag: string): number {
  const match = /;\s*q\s*=\s*(1(?:\.0{1,3})?|0(?:\.\d{1,3})?)/i.exec(tag);
  if (!match?.[1]) return 1;
  const q = Number(match[1]);
  return Number.isFinite(q) ? q : 1;
}

/**
 * Parse `Accept-Language`. First supported tag wins; otherwise English.
 * `ko-KR,ko;q=0.9,en;q=0.8` → `ko`. Empty / `*` / `fr` → `en`.
 */
export function parseAcceptLanguage(header: string | string[] | undefined): ApiLocale {
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (!raw?.trim()) return DEFAULT_API_LOCALE;

  const parts = raw
    .split(",")
    .map((part) => ({ tag: primaryTag(part), q: quality(part) }))
    .filter((part) => part.tag && part.tag !== "*")
    .sort((a, b) => b.q - a.q);

  for (const part of parts) {
    if (isApiLocale(part.tag)) return part.tag;
  }
  return DEFAULT_API_LOCALE;
}
