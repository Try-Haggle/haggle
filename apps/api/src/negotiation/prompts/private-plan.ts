/** Private per-side plan. Lives on the session snapshot and MEMO only — never HNP. */

export const PRIVATE_PLAN_MAX_CHARS = 400;

export function sanitizePrivatePlan(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length < 8) return undefined;
  return compact.length > PRIVATE_PLAN_MAX_CHARS
    ? compact.slice(0, PRIVATE_PLAN_MAX_CHARS - 1).trimEnd() + "…"
    : compact;
}
