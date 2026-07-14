import { afterEach, describe, expect, it, vi } from "vitest";
import { runDisputeEvidenceScannerSecurityFixture } from
  "../services/dispute-evidence-scanner-fixture.service.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dispute evidence scanner security fixture", () => {
  it("exercises the scanner boundary without external network or persistence", async () => {
    const realFetch = vi.fn().mockRejectedValue(new Error("network forbidden"));
    vi.stubGlobal("fetch", realFetch);
    const result = await runDisputeEvidenceScannerSecurityFixture();

    expect(result).toMatchObject({
      schemaVersion: "dispute-evidence-scanner-security-fixture-v1",
      status: "pass",
      totals: { passed: 18, total: 18 },
      checks: {
        integritySizeMismatchBlocked: true,
        integrityTypeMismatchBlocked: true,
        unconfiguredQuarantined: true,
        authenticatedRequest: true,
        redirectsBlocked: true,
        cleanResponseAccepted: true,
        infectedResponseRejected: true,
        nonJsonRejected: true,
        oversizedResponseRejected: true,
        httpFailureQuarantined: true,
        privateNetworkRejected: true,
        productionOverrideRejected: true,
        dnsPublicResolutionAccepted: true,
        dnsPrivateResolutionRejected: true,
        dnsMixedResolutionRejected: true,
        dnsAddressLimitEnforced: true,
        dnsConnectionPinned: true,
        realNetworkCalled: false,
      },
      boundary: {
        haggleApiExecuted: true,
        scannerResponse: "INJECTED_FIXTURE",
        realNetworkCalled: false,
        databaseChanged: false,
      },
      containsUrl: false,
      containsToken: false,
    });
    expect(realFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("fixture-scanner-secret");
    expect(JSON.stringify(result)).not.toContain("scanner.fixture.invalid");
  });
});
