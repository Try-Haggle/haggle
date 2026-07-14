import {
  assertDisputeEvidenceScannerConfig,
  getDisputeEvidenceScannerPolicyStatus,
  scanDisputeEvidence,
  type DisputeEvidenceScannerConfig,
} from "./dispute-evidence-scan.service.js";
import {
  DISPUTE_MODULE_MAX_RESOLVED_ADDRESSES,
  createDisputeModulePinnedLookup,
  resolveDisputeModuleOutboundTarget,
} from "./dispute-module-outbound-url.service.js";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const FIXTURE_TOKEN = "fixture-scanner-secret-123";

type FixtureLookupCallback = (
  error: NodeJS.ErrnoException | null,
  addresses?: { address: string; family: number }[],
) => void;

function fixtureConfig(): DisputeEvidenceScannerConfig {
  return {
    url: "https://scanner.fixture.invalid/v1/scan",
    token: FIXTURE_TOKEN,
    timeoutMs: 1_000,
    maxResponseBytes: 16_384,
    allowInsecureHttp: false,
    allowPrivateNetwork: false,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function runDisputeEvidenceScannerSecurityFixture() {
  let authenticatedRequest = false;
  let redirectsBlocked = false;
  const cleanFetch: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    authenticatedRequest = url.hostname === "scanner.fixture.invalid"
      && new Headers(init?.headers).get("authorization")
        === `Bearer ${FIXTURE_TOKEN}`;
    redirectsBlocked = init?.redirect === "error";
    return jsonResponse({ status: "clean" });
  };
  const noNetworkFetch: typeof fetch = async () => {
    throw new Error("fixture integrity checks must not call the scanner");
  };

  const sizeMismatch = await scanDisputeEvidence({
    bytes: PNG,
    contentType: "image/png",
    expectedSizeBytes: PNG.length + 1,
    filename: "size-mismatch.png",
  }, { config: fixtureConfig(), fetchImpl: noNetworkFetch });
  const typeMismatch = await scanDisputeEvidence({
    bytes: PNG,
    contentType: "image/jpeg",
    expectedSizeBytes: PNG.length,
    filename: "type-mismatch.jpg",
  }, { config: fixtureConfig(), fetchImpl: noNetworkFetch });
  const unconfigured = await scanDisputeEvidence({
    bytes: PNG,
    contentType: "image/png",
    expectedSizeBytes: PNG.length,
    filename: "pending.png",
  }, { config: null, fetchImpl: noNetworkFetch });
  const clean = await scanDisputeEvidence({
    bytes: PNG,
    contentType: "image/png",
    expectedSizeBytes: PNG.length,
    filename: "clean.png",
  }, { config: fixtureConfig(), fetchImpl: cleanFetch });
  const infected = await scanDisputeEvidence({
    bytes: PNG,
    contentType: "image/png",
    expectedSizeBytes: PNG.length,
    filename: "infected.png",
  }, {
    config: fixtureConfig(),
    fetchImpl: async () => jsonResponse({
      status: "infected", detail: "EICAR_FIXTURE_DETECTED",
    }),
  });
  const nonJson = await scanDisputeEvidence({
    bytes: PNG,
    contentType: "image/png",
    expectedSizeBytes: PNG.length,
    filename: "non-json.png",
  }, {
    config: fixtureConfig(),
    fetchImpl: async () => new Response("clean", {
      status: 200, headers: { "content-type": "text/plain" },
    }),
  });
  const oversized = await scanDisputeEvidence({
    bytes: PNG,
    contentType: "image/png",
    expectedSizeBytes: PNG.length,
    filename: "oversized.png",
  }, {
    config: fixtureConfig(),
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(9_000));
        controller.enqueue(new Uint8Array(9_000));
        controller.close();
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const httpFailure = await scanDisputeEvidence({
    bytes: PNG,
    contentType: "image/png",
    expectedSizeBytes: PNG.length,
    filename: "unavailable.png",
  }, {
    config: fixtureConfig(),
    fetchImpl: async () => jsonResponse({ error: "unavailable" }, 503),
  });

  let privateNetworkRejected = false;
  let productionOverrideRejected = false;
  let dnsPrivateResolutionRejected = false;
  let dnsMixedResolutionRejected = false;
  let dnsAddressLimitEnforced = false;
  try {
    assertDisputeEvidenceScannerConfig({
      ...fixtureConfig(), url: "https://127.0.0.1/scan",
    });
  } catch {
    privateNetworkRejected = true;
  }
  try {
    assertDisputeEvidenceScannerConfig({
      ...fixtureConfig(), allowPrivateNetwork: true,
    }, { production: true });
  } catch {
    productionOverrideRejected = true;
  }
  const outboundPolicy = {
    label: "dispute evidence scanner fixture",
    allowInsecureHttp: false,
    allowPrivateNetwork: false,
  };
  const publicTarget = await resolveDisputeModuleOutboundTarget(
    fixtureConfig().url,
    outboundPolicy,
    { lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }] },
  );
  try {
    await resolveDisputeModuleOutboundTarget(
      fixtureConfig().url,
      outboundPolicy,
      { lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }] },
    );
  } catch {
    dnsPrivateResolutionRejected = true;
  }
  try {
    await resolveDisputeModuleOutboundTarget(
      fixtureConfig().url,
      outboundPolicy,
      { lookupImpl: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ] },
    );
  } catch {
    dnsMixedResolutionRejected = true;
  }
  try {
    await resolveDisputeModuleOutboundTarget(
      fixtureConfig().url,
      outboundPolicy,
      { lookupImpl: async () => Array.from(
        { length: DISPUTE_MODULE_MAX_RESOLVED_ADDRESSES + 1 },
        (_, index) => ({
          address: `8.8.8.${index + 1}`,
          family: 4 as const,
        }),
      ) },
    );
  } catch {
    dnsAddressLimitEnforced = true;
  }
  const dnsConnectionPinned = await new Promise<boolean>((resolve) => {
    const lookup = createDisputeModulePinnedLookup(
      publicTarget.url.hostname,
      publicTarget.addresses,
    );
    const callback: FixtureLookupCallback = (error, addresses) =>
      resolve(!error && addresses?.length === 1
      && addresses[0]?.address === "8.8.8.8");
    (lookup as unknown as (
      hostname: string,
      options: { all: true },
      callback: FixtureLookupCallback,
    ) => void)(publicTarget.url.hostname, { all: true }, callback);
  });

  const checks = {
    integritySizeMismatchBlocked:
      sizeMismatch.status === "INFECTED"
      && sizeMismatch.detail === "FILE_SIZE_MISMATCH",
    integrityTypeMismatchBlocked:
      typeMismatch.status === "INFECTED"
      && typeMismatch.detail === "CONTENT_TYPE_MISMATCH",
    unconfiguredQuarantined:
      unconfigured.status === "PENDING"
      && unconfigured.detail === "MALWARE_SCANNER_NOT_CONFIGURED",
    authenticatedRequest,
    redirectsBlocked,
    cleanResponseAccepted:
      clean.status === "CLEAN" && clean.detail === "CLEAN",
    infectedResponseRejected:
      infected.status === "INFECTED"
      && infected.detail === "EICAR_FIXTURE_DETECTED",
    nonJsonRejected:
      nonJson.status === "FAILED"
      && nonJson.detail === "INVALID_SCANNER_CONTENT_TYPE",
    oversizedResponseRejected:
      oversized.status === "FAILED"
      && oversized.detail === "SCANNER_RESPONSE_TOO_LARGE",
    httpFailureQuarantined:
      httpFailure.status === "FAILED"
      && httpFailure.detail === "SCANNER_HTTP_503",
    privateNetworkRejected,
    productionOverrideRejected,
    dnsPublicResolutionAccepted:
      publicTarget.addresses.length === 1
      && publicTarget.addresses[0]?.address === "8.8.8.8",
    dnsPrivateResolutionRejected,
    dnsMixedResolutionRejected,
    dnsAddressLimitEnforced,
    dnsConnectionPinned,
    realNetworkCalled: false,
  };
  const passed = Object.entries(checks)
    .filter(([key, value]) => key === "realNetworkCalled" ? value === false : value)
    .length;
  const total = Object.keys(checks).length;
  const result = {
    schemaVersion: "dispute-evidence-scanner-security-fixture-v1" as const,
    status: passed === total ? "pass" as const : "fail" as const,
    totals: { passed, total },
    checks,
    boundary: {
      haggleApiExecuted: true,
      scannerResponse: "INJECTED_FIXTURE" as const,
      realNetworkCalled: false,
      databaseChanged: false,
    },
    runtimePolicy: getDisputeEvidenceScannerPolicyStatus(),
    containsUrl: false,
    containsToken: false,
  };
  if (JSON.stringify(result).includes(FIXTURE_TOKEN)) {
    throw new Error("DISPUTE_EVIDENCE_SCANNER_FIXTURE_SECRET_EXPOSED");
  }
  return result;
}
