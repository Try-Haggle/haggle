export function createId(prefix?: string): string {
  const cryptoApi = globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string };
  };
  const uuid =
    typeof cryptoApi.crypto?.randomUUID === "function"
      ? cryptoApi.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return prefix ? `${prefix}_${uuid}` : uuid;
}
