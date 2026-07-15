import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertDisputeEvidenceScannerConfig,
  contentMatchesClaimedType,
  type DisputeEvidenceScannerConfig,
  getDisputeEvidenceScannerPolicyStatus,
  resolveDisputeEvidenceScannerConfigFromEnv,
  scanDisputeEvidence,
} from "../services/dispute-evidence-scan.service.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;

function config(
  overrides: Partial<DisputeEvidenceScannerConfig> = {},
): DisputeEvidenceScannerConfig {
  return {
    url: "https://scanner.example.test/v1/scan",
    token: "scanner-secret-123",
    timeoutMs: 5_000,
    maxResponseBytes: 16_384,
    allowInsecureHttp: false,
    allowPrivateNetwork: false,
    ...overrides,
  };
}

afterEach(() => {
  for (const key of [
    "DISPUTE_EVIDENCE_SCANNER_URL",
    "DISPUTE_EVIDENCE_SCANNER_TOKEN",
    "DISPUTE_EVIDENCE_SCANNER_TIMEOUT_MS",
    "DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP",
    "DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK",
  ])
    delete process.env[key];
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  vi.unstubAllGlobals();
});

describe("dispute evidence scanning", () => {
  it("validates file signatures and quarantines when a scanner is absent", async () => {
    expect(contentMatchesClaimedType(png, "image/png")).toBe(true);
    const result = await scanDisputeEvidence({
      bytes: png,
      contentType: "image/png",
      expectedSizeBytes: png.length,
      filename: "evidence.png",
    });
    expect(result).toMatchObject({
      status: "PENDING",
      provider: "not-configured",
      detail: "MALWARE_SCANNER_NOT_CONFIGURED",
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects MIME and byte-size mismatches before an external call", async () => {
    const fetchImpl = vi.fn();
    const typeMismatch = await scanDisputeEvidence(
      {
        bytes: png,
        contentType: "image/jpeg",
        expectedSizeBytes: png.length,
        filename: "fake.jpg",
      },
      { config: config(), fetchImpl },
    );
    const sizeMismatch = await scanDisputeEvidence(
      {
        bytes: png,
        contentType: "image/png",
        expectedSizeBytes: png.length + 1,
        filename: "truncated.png",
      },
      { config: config(), fetchImpl },
    );
    expect(typeMismatch).toMatchObject({
      status: "INFECTED",
      detail: "CONTENT_TYPE_MISMATCH",
    });
    expect(sizeMismatch).toMatchObject({
      status: "INFECTED",
      detail: "FILE_SIZE_MISMATCH",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends an authenticated no-redirect request and accepts JSON clean output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "clean" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await scanDisputeEvidence(
      {
        bytes: png,
        contentType: "image/png",
        expectedSizeBytes: png.length,
        filename: "evidence.png",
      },
      { config: config(), fetchImpl },
    );

    expect(result).toMatchObject({
      status: "CLEAN",
      provider: "scanner.example.test",
      detail: "CLEAN",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://scanner.example.test/v1/scan"),
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({
          authorization: "Bearer scanner-secret-123",
        }),
      }),
    );
  });

  it("fails closed for non-JSON, oversized, malformed and unavailable responses", async () => {
    const requests = [
      vi.fn().mockResolvedValue(
        new Response("clean", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
      vi.fn().mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "20000",
          },
        }),
      ),
      vi.fn().mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
      vi.fn().mockRejectedValue(new Error("private network detail")),
    ];
    const details = [];
    for (const fetchImpl of requests) {
      const result = await scanDisputeEvidence(
        {
          bytes: png,
          contentType: "image/png",
          expectedSizeBytes: png.length,
          filename: "evidence.png",
        },
        { config: config(), fetchImpl },
      );
      details.push(result.detail);
      expect(result).not.toHaveProperty("error");
    }
    expect(details).toEqual([
      "INVALID_SCANNER_CONTENT_TYPE",
      "SCANNER_RESPONSE_TOO_LARGE",
      "INVALID_SCANNER_RESPONSE",
      "SCANNER_UNAVAILABLE",
    ]);
  });

  it("fails closed before transport when DNS resolves to a blocked network", async () => {
    const result = await scanDisputeEvidence(
      {
        bytes: png,
        contentType: "image/png",
        expectedSizeBytes: png.length,
        filename: "dns-rebinding.png",
      },
      {
        config: config(),
        dnsLookupImpl: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      },
    );
    expect(result).toMatchObject({
      status: "FAILED",
      provider: "scanner.example.test",
      detail: "SCANNER_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("127.0.0.1");
  });

  it("cancels a chunked scanner response before buffering beyond the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(9_000));
        controller.enqueue(new Uint8Array(9_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await scanDisputeEvidence(
      {
        bytes: png,
        contentType: "image/png",
        expectedSizeBytes: png.length,
        filename: "evidence.png",
      },
      {
        config: config(),
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      },
    );
    expect(result).toMatchObject({
      status: "FAILED",
      detail: "SCANNER_RESPONSE_TOO_LARGE",
    });
    expect(cancelled).toBe(true);
  });

  it("rejects unsafe URLs, weak tokens and production overrides", () => {
    expect(() =>
      assertDisputeEvidenceScannerConfig(config({ url: "https://127.0.0.1/scan" })),
    ).toThrow(/private network/);
    expect(() =>
      assertDisputeEvidenceScannerConfig(config({ url: "https://[::ffff:7f00:1]/scan" })),
    ).toThrow(/private network/);
    expect(() =>
      assertDisputeEvidenceScannerConfig(
        config({ url: "https://user:pass@scanner.example.test/scan" }),
      ),
    ).toThrow(/credentials/);
    expect(() => assertDisputeEvidenceScannerConfig(config({ token: "short" }))).toThrow(
      /16 to 512/,
    );
    expect(() =>
      assertDisputeEvidenceScannerConfig(config({ allowPrivateNetwork: true }), {
        production: true,
      }),
    ).toThrow(/forbidden in production/);
  });

  it("reports no-secret configuration state and rejects partial env config", () => {
    expect(getDisputeEvidenceScannerPolicyStatus()).toMatchObject({
      configurationState: "not_configured",
      configured: false,
      containsUrl: false,
      containsToken: false,
      network: {
        privateNetworkBlocked: true,
        redirectsBlocked: true,
        dnsResolutionValidated: true,
        dnsConnectionPinned: true,
      },
      limits: { maxResolvedAddresses: 16 },
    });
    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "https://scanner.example.test/v1/scan";
    expect(getDisputeEvidenceScannerPolicyStatus().configurationState).toBe("partial");
    expect(() => resolveDisputeEvidenceScannerConfigFromEnv()).toThrow(/configured together/);

    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN = "scanner-secret-123";
    expect(getDisputeEvidenceScannerPolicyStatus()).toMatchObject({
      configurationState: "valid",
      configured: true,
      authenticated: true,
    });
    expect(JSON.stringify(getDisputeEvidenceScannerPolicyStatus())).not.toContain(
      "scanner.example.test",
    );
    expect(JSON.stringify(getDisputeEvidenceScannerPolicyStatus())).not.toContain("scanner-secret");
  });
});
