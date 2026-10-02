/** Only local or staging hosts are allowed; production is refused outright. */
export function assertSafeTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid or missing HAGGLE_API_URL: "${raw}"`);
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  const staging = /(^|[.-])staging([.-]|$)/.test(host);
  if (!local && !staging) {
    throw new Error(
      `Refusing non-staging host "${host}". Allowed: localhost or hosts containing "staging".`,
    );
  }
  if (!local && url.protocol !== "https:") throw new Error("Staging target must use https.");
  return url;
}
