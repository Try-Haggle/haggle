import { isIP } from "node:net";

const MAX_TRUSTED_PROXY_RANGES = 32;

function validProxyRange(value: string): boolean {
  const parts = value.split("/");
  if (parts.length > 2) return false;
  const family = isIP(parts[0] ?? "");
  if (!family) return false;
  if (parts.length === 1) return true;
  if (!/^\d{1,3}$/.test(parts[1] ?? "")) return false;
  const prefix = Number(parts[1]);
  return Number.isInteger(prefix) && prefix > 0 && prefix <= (family === 4 ? 32 : 128);
}

export function configuredTrustedProxyCidrs(): false | string[] {
  const raw = process.env.HAGGLE_TRUSTED_PROXY_CIDRS?.trim();
  if (!raw) return false;
  const ranges = raw.split(",").map((value) => value.trim());
  if (
    !ranges.length ||
    ranges.length > MAX_TRUSTED_PROXY_RANGES ||
    ranges.some((value) => !validProxyRange(value)) ||
    new Set(ranges).size !== ranges.length
  ) {
    throw new Error(
      "[CONFIG] HAGGLE_TRUSTED_PROXY_CIDRS must contain 1..32 unique IP/CIDR ranges without /0",
    );
  }
  return ranges;
}

export function getTrustedProxyPolicyStatus() {
  const ranges = configuredTrustedProxyCidrs();
  return {
    configured: ranges !== false,
    trustedRangeCount: ranges === false ? 0 : ranges.length,
    maxTrustedRangeCount: MAX_TRUSTED_PROXY_RANGES,
    containsAddresses: false,
  };
}
