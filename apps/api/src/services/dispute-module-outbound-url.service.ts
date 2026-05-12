import { isIP } from "node:net";

export interface DisputeModuleOutboundUrlPolicy {
  label: string;
  allowInsecureHttp?: boolean;
  allowPrivateNetwork?: boolean;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  const first = Number.parseInt(normalized.split(":")[0] ?? "", 16);
  if (!Number.isFinite(first)) return false;
  return (
    first >= 0xfc00 && first <= 0xfdff ||
    first >= 0xfe80 && first <= 0xfebf
  );
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isPrivateIpv6(normalized);
  return false;
}

export function assertDisputeModuleOutboundUrl(
  url: string,
  policy: DisputeModuleOutboundUrlPolicy,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${policy.label} url must be a valid URL`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${policy.label} url must not include credentials`);
  }
  if (parsed.protocol !== "https:") {
    if (!(parsed.protocol === "http:" && policy.allowInsecureHttp)) {
      throw new Error(`${policy.label} url must use HTTPS unless allow_insecure_http is true`);
    }
  }
  if (!policy.allowPrivateNetwork && isPrivateHostname(parsed.hostname)) {
    throw new Error(`${policy.label} url must not target localhost or private network hosts`);
  }
  return parsed;
}
