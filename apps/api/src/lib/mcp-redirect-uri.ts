const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MAX_REDIRECT_URI_LENGTH = 2048;

export function isSafeMcpRedirectUri(uri: string): boolean {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_REDIRECT_URI_LENGTH) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.username || parsed.password) return false;
  if (parsed.hash) return false;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (host.includes("*")) return false;

  if (parsed.protocol === "http:") {
    return LOOPBACK_HOSTS.has(host);
  }

  return true;
}
