/**
 * Post-auth redirect targets. Every place that sends a person somewhere after
 * signing in or up — the sign-in page, the sign-up page and the OAuth/email
 * callback — goes through here, so a `next` from the URL can never take them
 * off-site.
 */

const PROBE_ORIGIN = "http://same-origin.invalid";

/**
 * Returns `next` only if it is a path on this site, else null.
 *
 * Checked by actually parsing it, not by string prefixes: browsers read
 * "/\evil.com" as "//evil.com", strip tabs and newlines ("/\t/evil.com"), and
 * a value glued onto an origin ("@evil.com" → "https://app@evil.com") changes
 * the host. Resolving against a probe origin and requiring the origin to
 * survive catches all of these at once.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next?.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Where a person lands after signing in from the sign-in or sign-up page. */
export function postSignInPath(token: string | null, next: string | null): string {
  if (token) return `/sell/dashboard?claim=${encodeURIComponent(token)}`;
  return safeNextPath(next) ?? "/buy/dashboard";
}
