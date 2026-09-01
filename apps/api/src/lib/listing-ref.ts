const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isListingId(value: string): boolean {
  return UUID_RE.test(value);
}

/** Accept a public slug, /l/:publicId path, or a full listing URL. */
export function normalizeListingPublicId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/l\/([^/]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    const pathMatch = trimmed.match(/(?:^|\/)l\/([^/?#]+)/);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  }
  return trimmed.replace(/^\/+|\/+$/g, "");
}
