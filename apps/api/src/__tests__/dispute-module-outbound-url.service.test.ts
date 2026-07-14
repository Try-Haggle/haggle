import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  DISPUTE_MODULE_MAX_RESOLVED_ADDRESSES,
  createDisputeModulePinnedLookup,
  isDisputeModuleBlockedNetworkAddress,
  postDisputeModulePinnedBytes,
  resolveDisputeModuleOutboundTarget,
  type DisputeModuleResolvedAddress,
} from "../services/dispute-module-outbound-url.service.js";

const policy = {
  label: "fixture scanner",
  allowInsecureHttp: false,
  allowPrivateNetwork: false,
};

const servers: ReturnType<typeof createServer>[] = [];

type FixtureLookupCallback = (
  error: NodeJS.ErrnoException | null,
  addresses?: DisputeModuleResolvedAddress[],
) => void;

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (server.listening) {
      server.close();
      await once(server, "close");
    }
  }));
});

function invokePinnedLookup(
  lookup: ReturnType<typeof createDisputeModulePinnedLookup>,
  hostname: string,
): Promise<DisputeModuleResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    const callback: FixtureLookupCallback = (error, addresses) =>
      error ? reject(error) : resolve(addresses ?? []);
    (lookup as unknown as (
      host: string,
      options: { all: true },
      callback: FixtureLookupCallback,
    ) => void)(hostname, { all: true }, callback);
  });
}

describe("dispute module pinned outbound requests", () => {
  it("classifies private, reserved, mapped and documentation addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "198.51.100.2",
      "::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ]) expect(isDisputeModuleBlockedNetworkAddress(address)).toBe(true);
    expect(isDisputeModuleBlockedNetworkAddress("8.8.8.8")).toBe(false);
    expect(isDisputeModuleBlockedNetworkAddress("2606:4700:4700::1111"))
      .toBe(false);
  });

  it("pins a bounded, deduplicated public DNS answer", async () => {
    const target = await resolveDisputeModuleOutboundTarget(
      "https://scanner.example.test/v1/scan",
      policy,
      { lookupImpl: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "8.8.8.8", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ] },
    );
    expect(target.addresses).toEqual([
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    await expect(invokePinnedLookup(
      createDisputeModulePinnedLookup(
        target.url.hostname,
        target.addresses,
      ),
      "scanner.example.test",
    )).resolves.toEqual(target.addresses);
  });

  it("rejects private-only, mixed, invalid, empty and oversized DNS answers", async () => {
    const resolveWith = (addresses: DisputeModuleResolvedAddress[]) =>
      resolveDisputeModuleOutboundTarget(
        "https://scanner.example.test/v1/scan",
        policy,
        { lookupImpl: async () => addresses },
      );
    await expect(resolveWith([{ address: "127.0.0.1", family: 4 }]))
      .rejects.toThrow(/blocked network/);
    await expect(resolveWith([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.2", family: 4 },
    ])).rejects.toThrow(/blocked network/);
    await expect(resolveWith([{ address: "not-an-ip", family: 4 }]))
      .rejects.toThrow(/invalid address/);
    await expect(resolveWith([])).rejects.toThrow(/unsafe address count/);
    await expect(resolveWith(Array.from(
      { length: DISPUTE_MODULE_MAX_RESOLVED_ADDRESSES + 1 },
      (_, index) => ({ address: `8.8.8.${index + 1}`, family: 4 as const }),
    ))).rejects.toThrow(/unsafe address count/);
  });

  it("returns a bounded DNS error without leaking resolver details", async () => {
    await expect(resolveDisputeModuleOutboundTarget(
      "https://scanner.example.test/v1/scan",
      policy,
      { lookupImpl: async () => {
        throw new Error("secret resolver host 10.0.0.9");
      } },
    )).rejects.toThrow("fixture scanner dns resolution failed");
  });

  it("applies the caller abort signal while DNS resolution is pending", async () => {
    const controller = new AbortController();
    const pending = resolveDisputeModuleOutboundTarget(
      "https://scanner.example.test/v1/scan",
      policy,
      { lookupImpl: async () => new Promise(() => undefined),
        signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses the validated address for the connection while preserving Host", async () => {
    let received = 0;
    let receivedHost = "";
    let receivedBody = "";
    const server = createServer((request, response) => {
      received += 1;
      receivedHost = request.headers.host ?? "";
      request.on("data", (chunk) => {
        receivedBody += Buffer.from(chunk).toString("utf8");
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "clean" }));
      });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("port missing");
    const response = await postDisputeModulePinnedBytes(
      `http://scanner.example.test:${address.port}/v1/scan`,
      { headers: { "content-type": "application/octet-stream" },
        body: Buffer.from("fixture") },
      { ...policy, allowInsecureHttp: true, allowPrivateNetwork: true },
      { lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }] },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "clean" });
    expect(received).toBe(1);
    expect(receivedHost).toBe(`scanner.example.test:${address.port}`);
    expect(receivedBody).toBe("fixture");
  });

  it("rejects a private DNS answer before opening a connection", async () => {
    let received = 0;
    const server = createServer((_request, response) => {
      received += 1;
      response.end();
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("port missing");
    await expect(postDisputeModulePinnedBytes(
      `http://scanner.example.test:${address.port}/v1/scan`,
      { headers: {}, body: Buffer.from("fixture") },
      { ...policy, allowInsecureHttp: true },
      { lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }] },
    )).rejects.toThrow(/blocked network/);
    expect(received).toBe(0);
  });
});
