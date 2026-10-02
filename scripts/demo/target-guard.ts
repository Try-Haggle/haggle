const STAGING_HOSTS = new Set(["api.staging.tryhaggle.ai", "app.staging.tryhaggle.ai"]);

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
  const staging = STAGING_HOSTS.has(host);
  if (!local && !staging) {
    throw new Error(
      `Refusing non-staging host "${host}". Allowed: localhost or ${[...STAGING_HOSTS].join(", ")}.`,
    );
  }
  if (!local && url.protocol !== "https:") throw new Error("Staging target must use https.");
  return url;
}
