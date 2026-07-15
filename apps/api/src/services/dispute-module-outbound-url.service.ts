import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export interface DisputeModuleOutboundUrlPolicy {
  label: string;
  allowInsecureHttp?: boolean;
  allowPrivateNetwork?: boolean;
}

export interface DisputeModuleResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type DisputeModuleDnsLookup = (
  hostname: string,
) => Promise<readonly DisputeModuleResolvedAddress[]>;

export const DISPUTE_MODULE_MAX_RESOLVED_ADDRESSES = 16;

const blockedNetworkAddresses = new BlockList();
for (const [network, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const) {
  blockedNetworkAddresses.addSubnet(network, prefix, family);
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
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
  if (ipVersion === 4 || ipVersion === 6) {
    return isDisputeModuleBlockedNetworkAddress(normalized);
  }
  return false;
}

export function isDisputeModuleBlockedNetworkAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return blockedNetworkAddresses.check(normalized, "ipv4");
  if (family === 6) return blockedNetworkAddresses.check(normalized, "ipv6");
  return true;
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

const defaultDnsLookup: DisputeModuleDnsLookup = async (hostname) => {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
};

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new DOMException("aborted", "AbortError")));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export async function resolveDisputeModuleOutboundTarget(
  url: string | URL,
  policy: DisputeModuleOutboundUrlPolicy,
  options: { lookupImpl?: DisputeModuleDnsLookup; signal?: AbortSignal } = {},
): Promise<{ url: URL; addresses: DisputeModuleResolvedAddress[] }> {
  const parsed = assertDisputeModuleOutboundUrl(String(url), policy);
  const hostname = stripIpv6Brackets(parsed.hostname).toLowerCase().replace(/\.$/, "");
  const literalFamily = isIP(hostname);
  let resolved: readonly DisputeModuleResolvedAddress[];
  try {
    resolved = literalFamily
      ? [{ address: hostname, family: literalFamily === 6 ? 6 : 4 }]
      : await awaitWithAbort((options.lookupImpl ?? defaultDnsLookup)(hostname), options.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(`${policy.label} dns resolution failed`);
  }
  if (resolved.length < 1 || resolved.length > DISPUTE_MODULE_MAX_RESOLVED_ADDRESSES) {
    throw new Error(`${policy.label} dns resolution returned an unsafe address count`);
  }
  const unique = new Map<string, DisputeModuleResolvedAddress>();
  for (const entry of resolved) {
    const address = stripIpv6Brackets(entry.address).toLowerCase();
    const family = isIP(address);
    if ((family !== 4 && family !== 6) || family !== entry.family) {
      throw new Error(`${policy.label} dns resolution returned an invalid address`);
    }
    if (!policy.allowPrivateNetwork && isDisputeModuleBlockedNetworkAddress(address)) {
      throw new Error(`${policy.label} dns resolution targeted a blocked network`);
    }
    unique.set(`${family}:${address}`, { address, family });
  }
  if (unique.size < 1) {
    throw new Error(`${policy.label} dns resolution returned no usable address`);
  }
  return { url: parsed, addresses: [...unique.values()] };
}

export function createDisputeModulePinnedLookup(
  hostname: string,
  addresses: readonly DisputeModuleResolvedAddress[],
): LookupFunction {
  const expectedHostname = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  return ((
    requestedHostname: string,
    rawOptions: number | Record<string, unknown>,
    callback: (...args: unknown[]) => void,
  ) => {
    const requested = stripIpv6Brackets(requestedHostname).toLowerCase().replace(/\.$/, "");
    if (requested !== expectedHostname) {
      callback(new Error("outbound pinned lookup hostname mismatch"));
      return;
    }
    const options =
      typeof rawOptions === "number"
        ? { family: rawOptions, all: false }
        : (rawOptions as { family?: number; all?: boolean });
    const requestedFamily = options?.family === 4 || options?.family === 6 ? options.family : 0;
    const candidates =
      requestedFamily === 0
        ? [...addresses]
        : addresses.filter(({ family }) => family === requestedFamily);
    if (candidates.length < 1) {
      callback(new Error("outbound pinned lookup has no matching address"));
      return;
    }
    if (options?.all) {
      callback(null, candidates);
      return;
    }
    callback(null, candidates[0]!.address, candidates[0]!.family);
  }) as LookupFunction;
}

export async function postDisputeModulePinnedBytes(
  url: string | URL,
  request: {
    headers: ConstructorParameters<typeof Headers>[0];
    body: Buffer;
    signal?: AbortSignal;
  },
  policy: DisputeModuleOutboundUrlPolicy,
  options: { lookupImpl?: DisputeModuleDnsLookup } = {},
): Promise<Response> {
  const target = await resolveDisputeModuleOutboundTarget(url, policy, {
    ...options,
    signal: request.signal,
  });
  const safeHeaders = new Headers(request.headers);
  for (const name of [
    "host",
    "connection",
    "keep-alive",
    "proxy-authorization",
    "proxy-authenticate",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ])
    safeHeaders.delete(name);
  safeHeaders.set("content-length", String(request.body.length));
  const headers = Object.fromEntries(safeHeaders.entries());
  const requestFn = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    const clientRequest = requestFn(
      target.url,
      {
        method: "POST",
        headers,
        agent: false,
        lookup: createDisputeModulePinnedLookup(target.url.hostname, target.addresses),
        signal: request.signal,
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, value);
          }
        }
        const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        resolve(
          new Response(body, {
            status: incoming.statusCode ?? 500,
            statusText: incoming.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    clientRequest.on("error", reject);
    clientRequest.end(request.body);
  });
}
