import { afterEach, describe, expect, it } from "vitest";
import { configuredTrustedProxyCidrs, getTrustedProxyPolicyStatus } from "../lib/trusted-proxy.js";

describe("trusted proxy configuration", () => {
  const original = process.env.HAGGLE_TRUSTED_PROXY_CIDRS;

  afterEach(() => {
    if (original === undefined) delete process.env.HAGGLE_TRUSTED_PROXY_CIDRS;
    else process.env.HAGGLE_TRUSTED_PROXY_CIDRS = original;
  });

  it("does not trust forwarding headers by default", () => {
    delete process.env.HAGGLE_TRUSTED_PROXY_CIDRS;
    expect(configuredTrustedProxyCidrs()).toBe(false);
    expect(getTrustedProxyPolicyStatus()).toEqual({
      configured: false,
      trustedRangeCount: 0,
      maxTrustedRangeCount: 32,
      containsAddresses: false,
    });
  });

  it("accepts an explicit unique IP and CIDR allowlist", () => {
    process.env.HAGGLE_TRUSTED_PROXY_CIDRS = "127.0.0.1, 10.20.0.0/16, 2001:db8:abcd::/48";
    expect(configuredTrustedProxyCidrs()).toEqual([
      "127.0.0.1",
      "10.20.0.0/16",
      "2001:db8:abcd::/48",
    ]);
    expect(getTrustedProxyPolicyStatus()).toMatchObject({
      configured: true,
      trustedRangeCount: 3,
      containsAddresses: false,
    });
  });

  it.each([
    "not-an-ip",
    "0.0.0.0/0",
    "::/0",
    "127.0.0.1,127.0.0.1",
    "10.0.0.0/33",
  ])("rejects unsafe or malformed allowlists: %s", (value) => {
    process.env.HAGGLE_TRUSTED_PROXY_CIDRS = value;
    expect(() => configuredTrustedProxyCidrs()).toThrow("HAGGLE_TRUSTED_PROXY_CIDRS");
  });
});
