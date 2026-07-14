const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { JSDOM, VirtualConsole } = require("../../apps/web/node_modules/jsdom");

const htmlPath = path.join(__dirname, "payment-fulfillment-test-console.html");
const recoveryPath = path.join(__dirname, "payment-contract-recovery.js");
const recoverySource = fs.readFileSync(recoveryPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8")
  .replace(/<script defer src="https:\/\/[^>]+><\/script>/g, "")
  .replace('<script src="./payment-contract-recovery.js"></script>', `<script>${recoverySource}</script>`);

const now = new Date().toISOString();
const checkpoint = {
  version: 1,
  saved_at: now,
  payment_id: "pi_restore_001",
  order_id: "order_restore_001",
  settlement_id: `0x${"11".repeat(32)}`,
  settlement_release_id: null,
  contract_address: `0x${"22".repeat(20)}`,
  network: "base-sepolia",
  fund_tx_hash: `0x${"33".repeat(32)}`,
  release_tx_hash: null,
  refund_tx_hash: null,
  funding_recorded: true,
  funding_confirmed: false,
  release_recorded: false,
  refund_recorded: false,
};

let fetchCalls = 0;
const virtualConsole = new VirtualConsole();
const scriptErrors = [];
virtualConsole.on("jsdomError", (error) => scriptErrors.push(error));
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://127.0.0.1:4177/docs/tools/payment-fulfillment-test-console.html",
  virtualConsole,
  beforeParse(window) {
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    Object.defineProperty(window.crypto, "subtle", { configurable: true, value: {
      digest: async (_algorithm, data) => Uint8Array.from(
        createHash("sha256").update(Buffer.from(data)).digest()).buffer,
    } });
    window.fetch = async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run for a mismatched recovery binding");
    };
    window.crypto.randomUUID = () => "88888888-8888-4888-8888-888888888888";
    window.sessionStorage.setItem("haggle.payment-contract-recovery.v1", JSON.stringify(checkpoint));
  },
});

async function main() {
  if (dom.window.document.readyState === "loading") {
    await new Promise((resolve) => dom.window.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  const document = dom.window.document;
  assert.equal(scriptErrors.length, 0);
  const readinessDomains = [...document.querySelectorAll(
    ".readiness-summary-card[data-readiness-domain]")]
    .map((element) => element.dataset.readinessDomain);
  assert.deepEqual(readinessDomains,
    ["payment", "shipping", "dispute", "other"]);
  const readinessDomainDetails = [...document.querySelectorAll(
    ".readiness-flow[data-readiness-domain-details]")];
  assert.deepEqual(readinessDomainDetails.map((element) =>
    element.dataset.readinessDomainDetails),
  ["payment", "shipping", "dispute", "other"]);
  assert.ok(readinessDomainDetails.every((element) =>
    element.tagName === "DETAILS" && element.open === false));
  const readinessDetails = document.querySelector("#readinessCycleDetails");
  assert.ok(readinessDetails);
  assert.equal(readinessDetails.open, false);
  const readinessCycles = [...readinessDetails.querySelectorAll(".readiness-cycle")];
  const readinessCycleNumbers = readinessCycles.map((element) =>
    Number(element.querySelector(".status-pill")?.textContent.match(/\d+/)?.[0]));
  assert.deepEqual(readinessCycleNumbers,
    Array.from({ length: readinessCycles.length }, (_, index) => index + 1));
  assert.ok(readinessCycles
    .every((element) => element.tagName === "DETAILS" && element.open === false));
  assert.equal(document.querySelector("#readinessCycleCount").textContent,
    String(readinessCycles.length));
  assert.equal(document.querySelector("#readinessCycleVisibleCount").textContent,
    `${readinessCycles.length} / ${readinessCycles.length}개 표시`);
  assert.match(document.querySelector("#cycle183Verification").textContent,
    /payload schema v3.*v2 snapshot retry compatibility.*PASS 31\/31.*focused 148\/148/);
  assert.match(document.querySelector("#cycle184Verification").textContent,
    /actual PostgreSQL HTTP rehearsal.*first 202.*replay 200.*conflict 409/);
  assert.match(document.querySelector("#cycle185Verification").textContent,
    /X-Forwarded-For ignored.*request 101 blocked 429.*oversized JSON 413/);
  assert.match(document.querySelector("#cycle186Verification").textContent,
    /PostgreSQL fixed window.*allowed 100 \+ blocked 20.*cleanup rows 0/);
  assert.match(document.querySelector("#cycle188Verification").textContent,
    /30-second lifetime.*20 concurrent consumers = success 1 \/ blocked 19/);
  assert.match(document.querySelector("#cycle191Verification").textContent,
    /Origin checked before ticket extraction and DB consume.*evil Origin 403.*local app Origin 101/);
  assert.match(document.querySelector("#cycle192Verification").textContent,
    /canonical UUID subject.*full API 2,406 passed.*Run Auth FIXTURE ONLY/);
  assert.match(document.querySelector("#cycle193Verification").textContent,
    /contiguous cycle IDs.*domain filter contract.*latest readiness evidence/);
  assert.equal(readinessDetails.querySelector(
    ".readiness-cycle-summary-action span").textContent, "상세 보기");
  readinessDetails.open = true;
  readinessDetails.dispatchEvent(new dom.window.Event("toggle"));
  assert.equal(readinessDetails.querySelector(
    ".readiness-cycle-summary-action span").textContent, "상세 닫기");
  assert.equal(readinessDetails.querySelector("summary")
    .getAttribute("aria-expanded"), "true");
  const firstReadinessCycle = readinessDetails.querySelector(
    ".readiness-cycle");
  assert.equal(firstReadinessCycle.querySelector("code").textContent,
    "shipping routes 15 tests");
  assert.equal(firstReadinessCycle.querySelector(":scope > summary")
    .getAttribute("aria-expanded"), "false");
  firstReadinessCycle.open = true;
  firstReadinessCycle.dispatchEvent(new dom.window.Event("toggle"));
  assert.equal(firstReadinessCycle.querySelector(":scope > summary")
    .getAttribute("aria-expanded"), "true");
  readinessDetails.open = false;
  readinessDetails.dispatchEvent(new dom.window.Event("toggle"));
  const readinessDomain = document.querySelector("#readinessCycleDomain");
  const readinessQuery = document.querySelector("#readinessCycleQuery");
  const visibleReadinessCycles = () => readinessCycles.filter(
    (element) => !element.hidden);
  const renderedReadinessCycles = () => readinessCycles.filter(
    (element) => dom.window.getComputedStyle(element).display !== "none");
  readinessDomain.value = "other";
  readinessDomain.dispatchEvent(new dom.window.Event("change"));
  assert.ok(visibleReadinessCycles().length > 0);
  assert.ok(visibleReadinessCycles().every((element) =>
    element.dataset.readinessCycleDomain === "other"));
  assert.equal(renderedReadinessCycles().length, visibleReadinessCycles().length);
  assert.equal(document.querySelector("#readinessCycleVisibleCount").textContent,
    `${visibleReadinessCycles().length} / ${readinessCycles.length}개 표시`);
  readinessDomain.value = "all";
  readinessQuery.value = "Cycle 193";
  readinessQuery.dispatchEvent(new dom.window.Event("input"));
  assert.deepEqual(visibleReadinessCycles().map((element) =>
    element.querySelector(".status-pill").textContent), ["Cycle 193 완료"]);
  assert.deepEqual(renderedReadinessCycles().map((element) =>
    element.querySelector(".status-pill").textContent), ["Cycle 193 완료"]);
  readinessQuery.value = "";
  readinessQuery.dispatchEvent(new dom.window.Event("input"));
  assert.equal(visibleReadinessCycles().length, readinessCycles.length);
  assert.equal(renderedReadinessCycles().length, readinessCycles.length);
  assert.ok(document.querySelector("#loadDisputeEvidenceScannerReadiness"));
  assert.ok(document.querySelector("#runDisputeEvidenceScannerFixture"));
  assert.ok(document.querySelector('[data-shipping="scannerReadinessStatus"]'));
  assert.ok(document.querySelector('[data-shipping="scannerReadinessNote"]'));
  assert.ok(document.querySelector('[data-shipping="scannerFixtureNote"]'));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/dispute-evidence-scanner/readiness']"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/dispute-evidence-scanner/evaluate']"));
  assert.ok(document.querySelector("#loadDisputeEvidenceScanRetryHealth"));
  assert.ok(document.querySelector("#runDisputeEvidenceScanRetryFixture"));
  assert.ok(document.querySelector("#runDisputeEvidenceScanRetryAlertFixture"));
  assert.ok(document.querySelector(
    "#runDisputeEvidenceScanRetryAlertSnapshotRetentionFixture"));
  assert.ok(document.querySelector('[data-shipping="scannerRetryStatus"]'));
  assert.ok(document.querySelector('[data-shipping="scannerRetryNote"]'));
  assert.ok(document.querySelector('[data-shipping="scannerCircuitNote"]'));
  assert.ok(document.querySelector('[data-shipping="scannerRetryFixtureNote"]'));
  assert.ok(document.querySelector('[data-shipping="scannerRetryAlertStatus"]'));
  assert.ok(document.querySelector('[data-shipping="scannerRetryAlertNote"]'));
  assert.ok(document.querySelector('[data-shipping="scannerRetryAlertReceiver"]'));
  assert.ok(document.querySelector('[data-shipping="scannerRetryAlertFixtureNote"]'));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/dispute-evidence-scan-retry/health']"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/dispute-evidence-scan-retry/evaluate']"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/dispute-evidence-scan-retry-alert/evaluate']"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/dispute-evidence-scan-retry-alert-snapshot-retention/evaluate']"));
  const scannerRuntimePolicy = {
    schemaVersion: "dispute-evidence-scanner-readiness-v1",
    configurationState: "not_configured",
    configured: false,
    authenticated: false,
    transport: { httpsRequired: true, insecureHttpOverride: false },
    network: { privateNetworkBlocked: true, redirectsBlocked: true,
      dnsResolutionValidated: true, dnsConnectionPinned: true },
    limits: { timeoutMs: 15000, maxResponseBytes: 16384,
      maxFilenameChars: 160, maxResolvedAddresses: 16 },
    containsUrl: false,
    containsToken: false,
  };
  assert.equal(dom.window.renderDisputeEvidenceScannerReadiness({
    dispute_evidence_scanner_readiness: scannerRuntimePolicy,
  }), true);
  assert.equal(document.querySelector(
    '[data-shipping="scannerReadinessStatus"]').textContent,
  "NOT CONFIGURED");
  assert.match(document.querySelector(
    '[data-shipping="scannerReadinessNote"]').textContent,
  /URL\/token hidden/);
  const scannerChecks = {
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
  };
  const scannerFixture = {
    schemaVersion: "dispute-evidence-scanner-security-fixture-v1",
    status: "pass",
    totals: { passed: 18, total: 18 },
    checks: scannerChecks,
    boundary: { haggleApiExecuted: true,
      scannerResponse: "INJECTED_FIXTURE", realNetworkCalled: false,
      databaseChanged: false },
    runtimePolicy: scannerRuntimePolicy,
    containsUrl: false,
    containsToken: false,
  };
  assert.equal(dom.window.renderDisputeEvidenceScannerFixture({
    result: scannerFixture,
  }), true);
  assert.match(document.querySelector(
    '[data-shipping="scannerFixtureNote"]').textContent,
  /PASS 18\/18.*DNS public-only \+ pinned.*real network no.*DB changes no/);
  const leakedScannerFixture = structuredClone(scannerFixture);
  leakedScannerFixture.containsToken = true;
  assert.equal(dom.window.renderDisputeEvidenceScannerFixture({
    result: leakedScannerFixture,
  }), false);
  assert.match(document.querySelector(
    '[data-shipping="scannerFixtureNote"]').textContent,
  /UNAVAILABLE/);
  const scannerRetryHealth = {
    schemaVersion: "dispute-evidence-scan-retry-health-v1",
    status: "attention",
    job: { enabled: false, cronEnabled: false },
    scanner: scannerRuntimePolicy,
    policy: { batchSize: 10, maxAttempts: 5, leaseSeconds: 60,
      baseBackoffSeconds: 30, maxBackoffSeconds: 3600 },
    totals: { quarantined: 1, pending: 0, failed: 1, processing: 0,
      staleProcessing: 0, retryReady: 0, exhausted: 1,
      expiredQuarantined: 0 },
    oldestUnresolvedAgeSeconds: 180,
    containsIdentifiers: false,
    containsStoragePaths: false,
    containsLeaseTokens: false,
    observedAt: "2026-07-14T00:00:00.000Z",
  };
  const scannerCircuitHealth = {
    schemaVersion: "dispute-evidence-scanner-circuit-health-v1",
    status: "healthy", state: "CLOSED", consecutiveFailures: 0,
    activePermits: 0,
    policy: { failureThreshold: 3, openSeconds: 60,
      permitLeaseSeconds: 30, maxConcurrent: 4 },
    nextProbeAt: null, probeExpiresAt: null,
    lastSuccessAt: "2026-07-14T00:00:00.000Z",
    lastFailureAt: "2026-07-13T23:59:00.000Z",
    containsPermitTokens: false, containsCircuitKey: false,
    observedAt: "2026-07-14T00:00:00.000Z",
  };
  assert.equal(dom.window.renderDisputeEvidenceScanRetryHealth({
    dispute_evidence_scan_retry_health: scannerRetryHealth,
  }), true);
  assert.equal(document.querySelector(
    '[data-shipping="scannerRetryStatus"]').textContent,
  "ATTENTION · 0 READY");
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryNote"]').textContent,
  /job off.*exhausted 1.*max 5 attempts/);
  assert.equal(dom.window.renderDisputeEvidenceScannerCircuitHealth({
    dispute_evidence_scanner_circuit_health: scannerCircuitHealth,
  }), true);
  assert.match(document.querySelector(
    '[data-shipping="scannerCircuitNote"]').textContent,
  /circuit CLOSED.*permits 0\/4.*failures 0\/3.*probe idle/);
  const scannerRetryChecks = {
    distributedClaimExactlyOnce: true,
    cleanRowsRecovered: true,
    staleLeaseReclaimed: true,
    infectedRejected: true,
    maxAttemptsEnforced: true,
    leasesCleared: true,
    staleFinalizerRejected: true,
    databaseGuardRejectedInvalidLease: true,
    healthDetectedExhausted: true,
    healthNoStaleProcessing: true,
    noRealNetwork: true,
    noRealStorageRead: true,
    identifiersExcluded: true,
    scannerCircuitProtected: true,
  };
  const scannerCircuitOpenHealth = {
    ...scannerCircuitHealth,
    status: "attention", state: "OPEN", consecutiveFailures: 4,
    nextProbeAt: "2026-07-14T00:01:00.000Z", lastSuccessAt: null,
  };
  const scannerCircuitChecks = {
    bulkheadExactlyFour: true,
    failuresOpenedCircuit: true,
    openCircuitBlockedAll: true,
    halfOpenSingleProbe: true,
    successfulProbeClosedCircuit: true,
    infectedResponseCountsAsOperational: true,
    databaseRejectedPermitMutation: true,
    identifiersExcluded: true,
  };
  const scannerCircuitFixture = {
    schemaVersion: "dispute-evidence-scanner-circuit-fixture-v1",
    status: "pass", totals: { passed: 8, total: 8 },
    checks: scannerCircuitChecks,
    execution: { concurrentCallers: 20, permitsGranted: 4,
      capacityBlocked: 16, openBlocked: 20, halfOpenProbes: 1,
      halfOpenBlocked: 19, databaseChanged: true,
      realNetworkCalled: false },
    health: { open: scannerCircuitOpenHealth,
      recovered: scannerCircuitHealth },
    containsPermitTokens: false, containsCircuitKey: false,
    cleanup: { stateRows: 1, succeeded: true },
  };
  const scannerRetryFixture = {
    schemaVersion: "dispute-evidence-scan-retry-fixture-v1",
    status: "pass",
    totals: { passed: 14, total: 14 },
    checks: scannerRetryChecks,
    execution: { concurrentWorkers: 20, claimed: 4, clean: 2,
      infected: 1, exhausted: 1, realNetworkCalled: false,
      realStorageRead: false, databaseChanged: true },
    health: scannerRetryHealth,
    circuit: scannerCircuitFixture,
    containsIdentifiers: false,
    containsStoragePaths: false,
    containsLeaseTokens: false,
    cleanup: { rows: 4, succeeded: true },
  };
  assert.equal(dom.window.renderDisputeEvidenceScanRetryFixture({
    result: scannerRetryFixture,
  }), true);
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryFixtureNote"]').textContent,
  /PASS 14\/14.*workers 20.*circuit 4\/20.*open 20 blocked.*probe 1\/20.*cleanup 4\+1.*network\/storage no/);
  const scannerRetryAlerting = {
    schemaVersion: "dispute-evidence-scan-retry-alerting-v9",
    policy: { configured: false, configurationState: "not_configured",
      jobEnabled: false, cooldownMinutes: 15, retryReadyThreshold: 10,
      staleThreshold: 1, exhaustedThreshold: 1, expiredThreshold: 1,
      retentionBlockedThreshold: 1 },
    delivery: { incidentOpen: false, lastIncidentAlertAt: null,
      lastRecoveryAlertAt: null },
    sender: {
      health: { status: "healthy", processing: 0, completed: 0, failed: 0,
        staleProcessing: 0, retryReady: 0, maxAttemptCount: 0,
        oldestUnfinishedAgeSeconds: null, lastCompletedAt: null,
        snapshotCount: 0, retryableSnapshots: 0, orphanedSnapshots: 0,
        missingRetrySnapshots: 0, bindingViolations: 0,
        recordedAt: "2026-07-14T00:00:00.000Z",
        containsIdentifiers: false },
      retention: { status: "healthy", eligibleExpired: 0, blockedExpired: 0,
        oldestBlockedExpiredAgeSeconds: null,
        policy: { retentionDays: 30, batchSize: 100,
          jobEnabled: false, cronEnabled: false },
        job: { status: "inactive", lastRunStatus: "NEVER", overdue: false,
          leaseStale: false, firstObservedAt: "2026-07-14T00:00:00.000Z",
          lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null,
          lastDeletedSnapshots: 0, lastFailureCode: null,
          policy: { jobEnabled: false, cronEnabled: false,
            intervalSeconds: 86_400, leaseSeconds: 900,
            maxStartDelaySeconds: 93_600 },
          containsIdentifiers: false,
          recordedAt: "2026-07-14T00:00:00.000Z" },
        containsIdentifiers: false,
        recordedAt: "2026-07-14T00:00:00.000Z" },
    },
    receiver: {
      endpoint: { method: "POST",
        path: "/internal/ops/alerts/dispute-evidence-scan-retry",
        rawBodyRequired: true, contentType: "application/json",
        maxBodyBytes: 16_384, hmacSha256: true, freshnessSeconds: 300,
        replayProtected: true, globalRateLimited: true,
        clientIpSource: "fastify_request_ip",
        trustedProxy: { configured: false, trustedRangeCount: 0,
          maxTrustedRangeCount: 32, containsAddresses: false },
        rateLimit: { mode: "local", distributed: false,
          storage: "process_memory", algorithm: "sliding_window",
          keyProtection: "memory_only", maxRequests: 100,
          windowSeconds: 60, failClosedOnStoreError: false,
          healthExempt: true,
          retention: { scheduled: false, intervalSeconds: 3600,
            retentionHours: 24, batchSize: 1000, runOnStart: true },
          containsSecret: false, containsIdentifiers: false },
        healthPath: "/admin/ops/alerts/dispute-evidence-scan-retry/health",
        healthAdminOnly: true },
      policy: { configured: false, configurationState: "not_configured",
        acceptedSecretCount: 0, maxAcceptedSecretCount: 4,
        timestampToleranceSeconds: 300 },
      health: { status: "healthy", processing: 0, completed: 0, failed: 0,
        staleProcessing: 0, retryReady: 0, maxAttemptCount: 0,
        oldestUnfinishedAgeSeconds: null, lastCompletedAt: null,
        recordedAt: "2026-07-14T00:00:00.000Z",
        containsIdentifiers: false },
    },
    containsUrl: false,
    containsSecrets: false,
    containsIdentifiers: false,
  };
  assert.equal(dom.window.renderDisputeEvidenceScanRetryAlerting({
    dispute_evidence_scan_retry_alerting: scannerRetryAlerting,
  }), true);
  assert.equal(document.querySelector(
    '[data-shipping="scannerRetryAlertStatus"]').textContent,
  "INACTIVE");
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryAlertSender"]').textContent,
  /sender healthy.*failed 0.*retry 0.*IDs hidden/);
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryAlertReceiver"]').textContent,
  /POST receiver ready.*not configured.*raw HMAC.*origin\/secret\/IDs hidden/);
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryAlertRetention"]').textContent,
  /retention healthy.*eligible 0.*blocked 0.*30d.*inactive.*never.*overdue no.*last deleted 0.*completed only.*IDs hidden/);
  const scannerRetryAlertChecks = {
    circuitAloneDetectedCritical: true,
    retryQueueBelowThreshold: true,
    circuitAggregateIncluded: true,
    retentionStateSignedCritical: true,
    retentionSemanticTamperRejected: true,
    senderFailureRecorded: true,
    senderBackoffBlocked: true,
    senderRetryReadyObserved: true,
    senderRetryExactlyOnce: true,
    distributedSenderExactlyOnce: true,
    retryCrossedCooldownBucket: true,
    semanticSnapshotStableAcrossRetry: true,
    lostResponseReceiverReplaySafe: true,
    snapshotMutationRejected: true,
    snapshotDeleteRejected: true,
    signedAggregateDelivered: true,
    receiverExactlyOnce: true,
    tamperRejected: true,
    recoveryDelivered: true,
    duplicateRecoverySuppressed: true,
    recoveryReceiverReplayBlocked: true,
    senderHealthRecovered: true,
    senderStaleDetectedCritical: true,
    senderStaleReclaimed: true,
    staleSenderOwnerFenced: true,
    exactFourOutboundAttempts: true,
    identifiersExcluded: true,
    storagePathsExcluded: true,
    leaseTokensExcluded: true,
    secretsExcluded: true,
    realNetworkNotCalled: true,
  };
  const scannerRetryAlertFixture = {
    schemaVersion: "dispute-evidence-scan-retry-alert-fixture-v1",
    status: "pass",
    totals: { passed: 31, total: 31 },
    checks: scannerRetryAlertChecks,
    execution: { concurrentSenders: 20, incidentDeliveries: 1,
      senderDuplicatesSuppressed: 19, concurrentReceivers: 20,
      receiverWinners: 1, receiverReplaysBlocked: 20,
      recoveryDeliveries: 1, retentionDeliveries: 1,
      failedDeliveryAttempts: 1,
      senderBackoffBlocks: 1, senderRetryAttemptCount: 2,
      retryCrossedCooldownBucket: true, immutableSnapshots: 2,
      lostResponseReceiverAccepted: 1,
      staleSenderClaims: 1, staleSenderReclaims: 1,
      circuitFailures: 3, circuitProbes: 1, outboundAttempts: 4,
      injectedTransport: true, realNetworkCalled: false,
      databaseChanged: true },
    containsIdentifiers: false,
    containsStoragePaths: false,
    containsLeaseTokens: false,
    containsSecrets: false,
    cleanup: { circuitRows: 1, senderClaims: 3, receiverClaims: 3,
      snapshots: 2,
      succeeded: true },
  };
  assert.equal(dom.window.renderDisputeEvidenceScanRetryAlertFixture({
    result: scannerRetryAlertFixture,
  }), true);
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryAlertFixtureNote"]').textContent,
  /PASS 31\/31.*circuit-only OPEN.*fail\/backoff\/retry 1\/1\/2.*stale\/reclaim 1\/1.*sender 1\/20.*receiver 1\/20.*snapshot 2.*bucket rollover safe.*lost response replay safe.*retention 1.*probe 1.*cleanup 1\+3\+3\+2/);
  const retentionChecks = {
    expiredClassificationExact: true,
    distributedLockSingleWinner: true,
    completedExpiredDeleted: true,
    failedExpiredPreserved: true,
    orphanExpiredPreserved: true,
    unresolvedDeleteRejected: true,
    postRunHealthAccurate: true,
    boundedBatchApplied: true,
    persistentJobRunRecorded: true,
    staleJobLeaseReclaimed: true,
    staleJobOwnerFenced: true,
    identifiersExcluded: true,
    noExternalSideEffects: true,
  };
  assert.equal(dom.window
    .renderDisputeEvidenceScanRetryAlertSnapshotRetentionFixture({
      result: {
        schemaVersion:
          "dispute-evidence-scan-retry-alert-snapshot-retention-fixture-v1",
        status: "pass", totals: { passed: 13, total: 13 },
        checks: retentionChecks,
        execution: { concurrentWorkers: 20, lockWinners: 1,
          lockBlocked: 19, deletedCompletedSnapshots: 1,
          preservedFailedSnapshots: 1, preservedOrphanSnapshots: 1,
          persistentJobRuns: 1, staleLeaseReclaims: 1,
          staleOwnerCompletions: 0,
          externalCalls: 0, databaseChanged: true },
        containsIdentifiers: false,
        cleanup: { snapshots: 2, claims: 2, jobStateRestored: true,
          succeeded: true },
      },
    }), true);
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryAlertRetentionFixtureNote"]').textContent,
  /PASS 13\/13.*workers 1\/20.*lock blocked 19.*deleted completed 1.*preserved failed\/orphan 1\/1.*job run\/reclaim 1\/1.*stale owner 0.*cleanup 2\+2.*job state restored.*external calls 0/);
  const leakedRetryAlerting = structuredClone(scannerRetryAlerting);
  leakedRetryAlerting.containsSecrets = true;
  assert.equal(dom.window.renderDisputeEvidenceScanRetryAlerting({
    dispute_evidence_scan_retry_alerting: leakedRetryAlerting,
  }), false);
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryAlertStatus"]').textContent,
  /UNAVAILABLE/);
  const leakedRetryHealth = structuredClone(scannerRetryHealth);
  leakedRetryHealth.containsLeaseTokens = true;
  assert.equal(dom.window.renderDisputeEvidenceScanRetryHealth({
    dispute_evidence_scan_retry_health: leakedRetryHealth,
  }), false);
  assert.match(document.querySelector(
    '[data-shipping="scannerRetryStatus"]').textContent,
  /UNAVAILABLE/);
  assert.ok(document.querySelector(
    "#grantShippingApvAlertReceiverManifestArchiveAlertDelivery"));
  assert.ok(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDeliveryGrant"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-decisions/{decisionId}/delivery-grants']"));
  assert.ok(document.querySelector(
    "#buildShippingApvAlertReceiverManifestArchiveAlertPayload"));
  assert.ok(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPayload"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-grants/{grantId}/payload-outbox']"));
  assert.ok(document.querySelector(
    "#signShippingApvAlertReceiverManifestArchiveAlertPayload"));
  assert.ok(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertSignature"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-payload-outbox/{outboxId}/signatures']"));
  assert.ok(document.querySelector(
    "#planShippingApvAlertReceiverManifestArchiveAlertDelivery"));
  assert.ok(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDeliveryIntent"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-payload-signatures/{signatureId}/delivery-intents']"));
  assert.ok(document.querySelector(
    "#verifyShippingApvAlertReceiverManifestArchiveAlertReceiverContract"));
  assert.ok(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverContract"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-intents/{archiveAlertDeliveryIntentId}/receiver-contract/verify']"));
  assert.ok(document.querySelector(
    "#recordShippingApvAlertReceiverManifestArchiveAlertReceiverClaim"));
  assert.ok(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverClaim"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-intents/{archiveAlertDeliveryIntentId}/receiver-claims']"));
  assert.ok(document.querySelector(
    "#loadShippingApvAlertReceiverManifestArchiveAlertReceiverClaimHealth"));
  assert.ok(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverClaimHealth"));
  assert.ok(document.querySelector("#endpoint option[value='/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-receiver-claims/health']"));
  const archiveAlertGrantClientId =
    "77777777-7777-4777-8777-777777777777";
  const archiveAlertGrantDecisionId =
    "44444444-4444-4444-8444-444444444444";
  const archiveAlertGrantId = "88888888-8888-4888-8888-888888888888";
  const archiveAlertGrantFingerprint = "c".repeat(64);
  dom.window.eval(`lastShippingApvFailureAlertReceiverManifestArchiveAlertDecision = {
    decisionId: "${archiveAlertGrantDecisionId}", decision: "APPROVED",
    request: { stateFingerprint: "${archiveAlertGrantFingerprint}" }
  };
  lastShippingApvFailureAlertReceiverManifestArchiveAlertGrantClientRequestId =
    "${archiveAlertGrantClientId}";`);
  const grantedAt = new Date(Date.now() - 60_000).toISOString();
  const cooldownExpiresAt = new Date(Date.parse(grantedAt) + 15 * 60_000)
    .toISOString();
  const archiveAlertGrantResponse = {
    shipping_apv_failure_alert_receiver_manifest_archive_alert_delivery_grant: {
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-delivery-grant-v1",
      deliveryGrantId: archiveAlertGrantId,
      clientGrantId: archiveAlertGrantClientId,
      approvalDecisionId: archiveAlertGrantDecisionId,
      stateFingerprint: archiveAlertGrantFingerprint,
      status: "GRANTED_DRY_RUN", grantedAt, cooldownExpiresAt,
      cooldown: { scope: "state_fingerprint", windowMinutes: 15, active: true },
      replayed: false, persistent: true, appendOnly: true,
      makerCheckerSeparated: true, makerIdentityReturned: false,
      checkerIdentityReturned: false, containsArchiveIdentifiers: false,
      payloadCreated: false, signed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false, productionAccepted: false,
    },
  };
  dom.window.renderShipmentApvFailureAlertReceiverManifestArchiveAlertDeliveryGrant(
    archiveAlertGrantResponse);
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDeliveryGrant")
    .textContent, /GRANTED_DRY_RUN \/ ACTIVE/);
  const archiveAlertPayloadClientId =
    "11111111-1111-4111-8111-111111111111";
  const archiveAlertPayloadOutboxId =
    "22222222-2222-4222-8222-222222222222";
  const archiveAlertPayload = {
    action: "review_warning",
    event_type:
      "shipment_apv_failure_alert_receiver_manifest_archive_alert",
    reasons: ["current_archive_intent_missing"],
    schema_version:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1",
    severity: "warning",
    state_fingerprint: archiveAlertGrantFingerprint,
  };
  dom.window.eval(`
    lastShippingApvFailureAlertReceiverManifestArchiveAlertPayloadClientRequestId =
      "${archiveAlertPayloadClientId}";
  `);
  const archiveAlertPayloadResponse = {
    shipping_apv_failure_alert_receiver_manifest_archive_alert_payload_outbox: {
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-outbox-v1",
      payloadOutboxId: archiveAlertPayloadOutboxId,
      clientOutboxId: archiveAlertPayloadClientId,
      deliveryGrantId: archiveAlertGrantId,
      stateFingerprint: archiveAlertGrantFingerprint,
      payload: archiveAlertPayload,
      payloadSha256: "d".repeat(64),
      status: "UNSIGNED_DRY_RUN",
      createdAt: new Date(Date.parse(grantedAt) + 30_000).toISOString(),
      replayed: false, persistent: true, appendOnly: true,
      containsArchiveIdentifiers: false, createdByIdentityReturned: false,
      signed: false, signature: null,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false, productionAccepted: false,
    },
  };
  dom.window.renderShipmentApvFailureAlertReceiverManifestArchiveAlertPayload(
    archiveAlertPayloadResponse);
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPayload")
    .textContent, /UNSIGNED_DRY_RUN \/ READY/);
  const archiveAlertSignatureClientId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const archiveAlertSignatureId =
    "33333333-3333-4333-8333-333333333333";
  const archiveAlertKeyId = "a".repeat(24);
  const archiveAlertPublicKey = "MCowBQYDK2VwAyEA" + "A".repeat(43) + "=";
  dom.window.eval(`
    lastShippingApvFailureAlertReceiverManifestArchiveAlertSignatureClientRequestId =
      "${archiveAlertSignatureClientId}";
    lastShippingApvFailureAlertSigningKey = {
      keyId: "${archiveAlertKeyId}",
      publicKeySpkiBase64: "${archiveAlertPublicKey}", status: "REGISTERED"
    };
  `);
  const originalPublicSignatureVerifier =
    dom.window.verifyShippingApvFailureAlertPayloadSignaturePublicly;
  dom.window.verifyShippingApvFailureAlertPayloadSignaturePublicly =
    async () => true;
  const archiveAlertSignatureResponse = {
    shipping_apv_failure_alert_receiver_manifest_archive_alert_payload_signature: {
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-signature-v1",
      signatureId: archiveAlertSignatureId,
      clientSignatureId: archiveAlertSignatureClientId,
      payloadOutboxId: archiveAlertPayloadOutboxId,
      payloadSha256: "d".repeat(64),
      signingDomain:
        "haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.payload-sha256.v1",
      algorithm: "Ed25519", keyId: archiveAlertKeyId,
      publicKeySpkiBase64: archiveAlertPublicKey,
      signatureBase64: "A".repeat(86) + "==", status: "SIGNED_DRY_RUN",
      signedAt: new Date(Date.parse(grantedAt) + 45_000).toISOString(),
      replayed: false, persistent: true, appendOnly: true,
      keyManagement: "EPHEMERAL_PROCESS_TEST_KEY",
      registry: "DATABASE_TEST_REGISTRY", registryBound: true,
      registryStatusAtSigning: "ACTIVE", independentTrustAnchor: false,
      trustAnchored: false, signedByIdentityReturned: false,
      signedMessageContainsArchiveIdentifiers: false,
      signatureVerified: true, privateKeyExposed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false, productionAccepted: false,
    },
  };
  await dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertSignature(
      archiveAlertSignatureResponse);
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertSignature")
    .textContent, /SIGNED_DRY_RUN \/ VERIFIED/);
  const archiveAlertDeliveryIntentClientId =
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  dom.window.eval(`
    lastShippingApvFailureAlertReceiverManifestArchiveAlertDeliveryIntentClientRequestId =
      "${archiveAlertDeliveryIntentClientId}";
  `);
  const archiveAlertDeliveryIntentResponse = {
    shipping_apv_failure_alert_receiver_manifest_archive_alert_delivery_intent: {
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-delivery-intent-v1",
      deliveryIntentId: "55555555-5555-4555-8555-555555555555",
      clientDeliveryIntentId: archiveAlertDeliveryIntentClientId,
      payloadSignatureId: archiveAlertSignatureId,
      payloadOutboxId: archiveAlertPayloadOutboxId,
      payloadSha256: "d".repeat(64), keyId: archiveAlertKeyId,
      status: "BLOCKED_CONFIGURATION_DRY_RUN",
      blockingReasons: ["independent_trust_anchor_missing",
        "receiver_endpoint_missing", "receiver_credential_missing"],
      createdAt: new Date(Date.parse(grantedAt) + 50_000).toISOString(),
      replayed: false, persistent: true, appendOnly: true, executable: false,
      requestedByIdentityReturned: false, signatureValueReturned: false,
      publicKeyReturned: false, independentTrustAnchor: false,
      endpointConfigured: false, credentialConfigured: false,
      http: { requestCreated: false },
      delivery: { enabled: false, attempted: false },
      networkRequestSent: false, externalReceiptVerified: false,
      productionAccepted: false,
    },
  };
  dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertDeliveryIntent(
      archiveAlertDeliveryIntentResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDeliveryIntent")
    .textContent, "BLOCKED CONFIG / NO HTTP");
  const archiveAlertReceiverContractResponse = {
    shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_contract: {
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-contract-v1",
      deliveryIntentId: "55555555-5555-4555-8555-555555555555",
      payloadSignatureId: archiveAlertSignatureId,
      payloadOutboxId: archiveAlertPayloadOutboxId,
      status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN", contractVersion: "v1",
      payloadContractVerified: true, payloadHashVerified: true,
      signatureVerified: true, keyBindingVerified: true,
      freshnessVerified: true, intentBindingVerified: true,
      freshnessWindowSeconds: 300,
      trustSource: "DATABASE_TEST_REGISTRY_FIXTURE",
      independentTrustAnchor: false, actorIdentityReturned: false,
      signatureValueReturned: false, publicKeyReturned: false,
      networkReceived: false, externalReceiptVerified: false,
      productionAccepted: false, persistent: false,
      replayProtection: { enabled: false, persistent: false },
      delivery: { enabled: false, attempted: false },
    },
  };
  dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertReceiverContract(
      archiveAlertReceiverContractResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverContract")
    .textContent, "VERIFIED LOCAL CONTRACT / DRY-RUN");
  const archiveAlertReceiverDeliveryId = createHash("sha256").update(
    `haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.receiver-delivery.v1:55555555-5555-4555-8555-555555555555:${"d".repeat(64)}`,
    "utf8").digest("hex");
  const archiveAlertReceiverClaimResponse = {
    shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_claim: {
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-claim-v1",
      receiverClaimId: "66666666-6666-4666-8666-666666666666",
      deliveryId: archiveAlertReceiverDeliveryId,
      deliveryIntentId: "55555555-5555-4555-8555-555555555555",
      payloadSignatureId: archiveAlertSignatureId,
      payloadOutboxId: archiveAlertPayloadOutboxId,
      payloadSha256: "d".repeat(64), keyId: archiveAlertKeyId,
      status: "VERIFIED_LOCAL_ARCHIVE_ALERT_RECEIVER_CLAIM_DRY_RUN",
      receivedAt: new Date(Date.parse(grantedAt) + 55_000).toISOString(),
      replayed: false, persistent: true, appendOnly: true,
      receiverContractVerified: true,
      replayProtection: { enabled: true, persistent: true },
      trustSource: "DATABASE_TEST_REGISTRY_FIXTURE",
      independentTrustAnchor: false, actorIdentityReturned: false,
      signatureValueReturned: false, publicKeyReturned: false,
      networkReceived: false, externalReceiptVerified: false,
      productionAccepted: false,
      delivery: { enabled: false, attempted: false },
    },
  };
  await dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertReceiverClaim(
      archiveAlertReceiverClaimResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverClaim")
    .textContent, "PERSISTED LOCAL CLAIM / REPLAY SAFE");
  const unsafeReceiverClaimResponse = structuredClone(
    archiveAlertReceiverClaimResponse);
  unsafeReceiverClaimResponse
    .shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_claim
    .networkReceived = true;
  await dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertReceiverClaim(
      unsafeReceiverClaimResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverClaim")
    .textContent, "UNAVAILABLE");
  const archiveAlertReceiverClaimHealthResponse = {
    shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_claim_health: {
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-claim-health-v1",
      status: "healthy",
      totals: { claims: 1, last24Hours: 1, olderThan30Days: 0 },
      violations: {
        binding: 0, deliveryId: 0, freshness: 0, unsafeSideEffect: 0,
      },
      criticalCount: 0,
      retention: { policy: "UNSET_PRESERVE", automaticDeletion: false },
      containsRawIdentifiers: false, independentTrustAnchor: false,
      networkReceipt: false, externalReceiptVerified: false,
      productionAccepted: false,
      observedAt: new Date().toISOString(),
    },
  };
  dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertReceiverClaimHealth(
      archiveAlertReceiverClaimHealthResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverClaimHealth")
    .textContent, "HEALTHY / 0");
  const unsafeReceiverClaimHealthResponse = structuredClone(
    archiveAlertReceiverClaimHealthResponse);
  unsafeReceiverClaimHealthResponse
    .shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_claim_health
    .containsRawIdentifiers = true;
  dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertReceiverClaimHealth(
      unsafeReceiverClaimHealthResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverClaimHealth")
    .textContent, "UNAVAILABLE");
  const reboundReceiverClaimResponse = structuredClone(
    archiveAlertReceiverClaimResponse);
  reboundReceiverClaimResponse
    .shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_claim
    .deliveryId = "f".repeat(64);
  await dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertReceiverClaim(
      reboundReceiverClaimResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverClaim")
    .textContent, "UNAVAILABLE");
  const unsafeReceiverContractResponse = structuredClone(
    archiveAlertReceiverContractResponse);
  unsafeReceiverContractResponse
    .shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_contract
    .networkReceived = true;
  dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertReceiverContract(
      unsafeReceiverContractResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertReceiverContract")
    .textContent, "UNAVAILABLE");
  const unsafeDeliveryIntentResponse = structuredClone(
    archiveAlertDeliveryIntentResponse);
  unsafeDeliveryIntentResponse
    .shipping_apv_failure_alert_receiver_manifest_archive_alert_delivery_intent
    .http.requestCreated = true;
  dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertDeliveryIntent(
      unsafeDeliveryIntentResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDeliveryIntent")
    .textContent, "UNAVAILABLE");
  const tamperedSignatureResponse = structuredClone(
    archiveAlertSignatureResponse);
  tamperedSignatureResponse
    .shipping_apv_failure_alert_receiver_manifest_archive_alert_payload_signature
    .signingDomain = "haggle.shipment-apv-failure-alert.payload-sha256.v1";
  await dom.window
    .renderShipmentApvFailureAlertReceiverManifestArchiveAlertSignature(
      tamperedSignatureResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertSignature")
    .textContent, "UNAVAILABLE");
  dom.window.verifyShippingApvFailureAlertPayloadSignaturePublicly =
    originalPublicSignatureVerifier;
  const tamperedPayloadResponse = structuredClone(archiveAlertPayloadResponse);
  tamperedPayloadResponse
    .shipping_apv_failure_alert_receiver_manifest_archive_alert_payload_outbox
    .payload.requested_by = "55555555-5555-4555-8555-555555555555";
  dom.window.renderShipmentApvFailureAlertReceiverManifestArchiveAlertPayload(
    tamperedPayloadResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPayload")
    .textContent, "UNAVAILABLE");
  const tamperedGrantResponse = structuredClone(archiveAlertGrantResponse);
  tamperedGrantResponse
    .shipping_apv_failure_alert_receiver_manifest_archive_alert_delivery_grant
    .payloadCreated = true;
  dom.window.renderShipmentApvFailureAlertReceiverManifestArchiveAlertDeliveryGrant(
    tamperedGrantResponse);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDeliveryGrant")
    .textContent, "UNAVAILABLE");
  assert.equal(document.querySelector("#paymentId").value, checkpoint.payment_id);
  assert.equal(document.querySelector("#orderId").value, checkpoint.order_id);
  assert.equal(document.querySelector("#contractAddress").value, checkpoint.contract_address);
  assert.match(document.querySelector("#contractStatus").textContent, /Receipt recovery restored/);
  assert.match(document.querySelector("#contractRecoveryDetail").textContent, /예치 receipt 복구 가능/);
  assert.equal(document.querySelector("#clearContractRecovery").disabled, false);

  const stored = dom.window.sessionStorage.getItem("haggle.payment-contract-recovery.v1");
  assert.ok(stored);
  assert.equal(stored.includes("signature"), false);
  assert.equal(stored.includes("token"), false);

  document.querySelector("#paymentId").value = "pi_wrong_binding";
  document.querySelector("#confirmFunding").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(fetchCalls, 0);
  assert.match(document.querySelector("#contractStatus").textContent, /바인딩과 현재 입력이 다릅니다/);

  document.querySelector("#paymentId").value = checkpoint.payment_id;
  document.querySelector("#orderId").value = "order_wrong_binding";
  document.querySelector("#signRelease").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(fetchCalls, 0);
  assert.match(document.querySelector("#contractStatus").textContent, /바인딩과 현재 입력이 다릅니다/);

  document.querySelector("#orderId").value = checkpoint.order_id;
  document.querySelector("#paymentId").value = "pi_wrong_refund_binding";
  document.querySelector("#signRefund").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(fetchCalls, 0);
  assert.match(document.querySelector("#contractStatus").textContent, /바인딩과 현재 입력이 다릅니다/);

  dom.window.eval("contractTestState.refundExecution = { stale: true }");
  document.querySelector("#resetGuidedWorkflow").click();
  assert.equal(dom.window.sessionStorage.getItem("haggle.payment-contract-recovery.v1"), null);
  assert.equal(document.querySelector("#clearContractRecovery").disabled, true);
  assert.equal(dom.window.eval("contractTestState.refundExecution"), null);

  let capturedRequest = null;
  dom.window.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ test: "conditional_settlement_finality", result: { pass: true, checks: {} } }),
    };
  };
  document.querySelector("#runOnchainFinalityFixture").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.match(capturedRequest.url, /\/tools\/payment-test\/conditional-settlement\/finality\/evaluate$/);
  assert.equal(capturedRequest.options.headers["Idempotency-Key"], "88888888-8888-4888-8888-888888888888");
  assert.match(capturedRequest.options.headers.Authorization, /^Bearer /);

  const recoveryRequests = [];
  dom.window.fetch = async (url) => {
    recoveryRequests.push(url);
    if (recoveryRequests.length === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR_EXPIRED",
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        restoration_remediation_recovery_queue: {
          items: [], truncated: false, nextCursor: null, recordedAt: now,
        },
      }),
    };
  };
  dom.window.eval('lastInvoiceRestorationRemediationRecoveryCursor = "expired_cursor"');
  await dom.window.eval("loadShippingApvRemediationRecovery(null)");
  assert.equal(recoveryRequests.length, 2);
  assert.match(recoveryRequests[0], /cursor=expired_cursor$/);
  assert.doesNotMatch(recoveryRequests[1], /[?&]cursor=/);
  assert.equal(document.querySelector("#shippingApvStagingRemediation").textContent, "0 STALE APPLYING");

  const readyApvPreflight = () => ({
    shipping_apv_fixture_readiness: {
      eligible: true,
      status: "ready",
      reasons: [],
      checks: {
        non_production_runtime: true,
        retention_job_inactive: true,
        retention_state_present: true,
        retention_state_idle: true,
        fixture_lease_available: true,
      },
      singleton: { status: "SUCCEEDED" },
      executionLease: { available: true },
      stateFingerprint: "a".repeat(64),
      validForSeconds: 5,
    },
  });
  const apvFailureHealth = (total, verification, execution) => ({
    shipping_apv_failure_health: {
      status: total === 0 ? "healthy" : "warning",
      windowHours: 24,
      retentionDays: 30,
      total,
      stages: {
        rollback_verification: { count: verification, lastFailureAt: total ? now : null },
        rollback_failure_isolation: { count: 0, lastFailureAt: null },
        fixture_execution: { count: execution, lastFailureAt: null },
      },
      policy: { version: "shipment-apv-chaos-failure-policy-v1",
        reasons: total ? ["rollback_verification_warning"] : [],
        thresholds: {
          rollback_verification: { warning: 1, critical: 3 },
          rollback_failure_isolation: { warning: 1, critical: 3 },
          fixture_execution: { warning: 3, critical: 10 },
        } },
      lifecycle: total ? {
        phase: "active", firstObservedAt: now, warningObservedAt: now,
        criticalObservedAt: null, recoveredAt: null, lastFailureAt: now,
      } : {
        phase: "clear", firstObservedAt: null, warningObservedAt: null,
        criticalObservedAt: null, recoveredAt: null, lastFailureAt: null,
      },
      lastFailureAt: total ? now : null,
      recordedAt: now,
    },
  });
  const apvRequests = [];
  dom.window.fetch = async (url, options = {}) => {
    apvRequests.push({ url, options });
    if (apvRequests.length === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => readyApvPreflight(),
      };
    }
    if (apvRequests.length === 2) {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({
          test: "shipment_apv_chaos",
          result: {
            pass: false,
            error: {
              code: "SHIPMENT_APV_CHAOS_FAILED",
              stage: "rollback_verification",
              failure_id: "11111111-1111-4111-8111-111111111111",
            },
          },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => apvFailureHealth(1, 1, 0),
    };
  };
  await dom.window.eval("runShippingApvChaos(null)");
  assert.equal(apvRequests.length, 3);
  assert.match(apvRequests[0].url, /\/tools\/payment-test\/shipping-apv\/readiness$/);
  assert.match(apvRequests[1].url, /\/tools\/payment-test\/shipping-apv\/chaos$/);
  assert.match(apvRequests[2].url, /\/tools\/payment-test\/shipping-apv\/failure-health$/);
  assert.equal(document.querySelector("#shippingApvResult").textContent, "FAIL");
  assert.equal(document.querySelector("#shippingApvChecks").textContent, "500 · rollback_verification");
  assert.equal(document.querySelector("#shippingApvReservationRollback").textContent, "FAIL");
  assert.match(document.querySelector("#shippingApvReservationRollbackNote").textContent,
    /rollback_verification · internal error redacted · fail-closed/);
  assert.equal(document.querySelector("#shippingApvRetentionAlert").textContent, "NOT STARTED");
  assert.match(document.querySelector("#shippingApvRetentionAlertNote").textContent,
    /SHIPMENT_APV_CHAOS_FAILED · rollback_verification · failure 11111111-1111-4111-8111-111111111111/);
  assert.match(document.querySelector("#callLog").textContent,
    /failure 11111111-1111-4111-8111-111111111111/);
  assert.equal(document.querySelector("#shippingApvFailureHealth").textContent, "WARNING / 1");
  assert.match(document.querySelector("#shippingApvFailureHealthNote").textContent,
    /24h · verify 1 · isolation 0 · execution 0/);
  assert.equal(document.querySelector("#shippingApvFailureLifecycle").textContent,
    "ACTIVE / WARNING");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal|private-table/i);

  let networkAttempts = 0;
  dom.window.fetch = async () => {
    networkAttempts += 1;
    if (networkAttempts === 1) {
      return { ok: true, status: 200, json: async () => readyApvPreflight() };
    }
    if (networkAttempts === 2) {
      throw new Error("postgres://secret:password@db.internal/private-table");
    }
    return { ok: true, status: 200, json: async () => apvFailureHealth(0, 0, 0) };
  };
  await dom.window.eval("runShippingApvChaos(null)");
  assert.equal(networkAttempts, 3);
  assert.equal(document.querySelector("#shippingApvResult").textContent, "FAIL");
  assert.match(document.querySelector("#shippingApvRetentionAlertNote").textContent,
    /REQUEST_FAILED · fixture_execution · failure unavailable/);
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal|private-table/i);
  assert.equal(document.querySelector("#shippingApvFailureHealth").textContent, "HEALTHY / 0");
  assert.equal(document.querySelector("#shippingApvFailureLifecycle").textContent,
    "CLEAR / HEALTHY");

  dom.window.fetch = async () => {
    throw new Error("postgres://secret:password@db.internal/private-metric");
  };
  await dom.window.eval("fetchShippingApvFailureHealth()");
  assert.equal(document.querySelector("#shippingApvFailureHealth").textContent, "UNAVAILABLE");
  assert.equal(document.querySelector("#shippingApvFailureLifecycle").textContent, "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureHealthNote").textContent,
    /ERR · bounded aggregate not loaded · previous value cleared/);
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal|private-table|private-metric/i);

  const alertPreview = (overrides = {}) => ({
    shipping_apv_failure_alert_preview: {
      schemaVersion: "shipment-apv-chaos-failure-alert-preview-v1",
      mode: "preview_only",
      action: "review_warning",
      severity: "warning",
      reasons: ["rollback_verification_warning"],
      stateFingerprint: "c".repeat(64),
      validForSeconds: 5,
      approval: { required: true, state: "not_requested" },
      delivery: { enabled: false, attempted: false },
      cooldown: { windowMinutes: 15, scope: "state_fingerprint", enforced: false },
      lifecycle: { phase: "active", firstObservedAt: now, warningObservedAt: now,
        criticalObservedAt: null, recoveredAt: null, lastFailureAt: now },
      recordedAt: now,
      ...overrides,
    },
  });
  const previewRequests = [];
  dom.window.fetch = async (url, options = {}) => {
    previewRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => alertPreview() };
  };
  await dom.window.eval("fetchShippingApvFailureAlertPreview()");
  assert.equal(previewRequests.length, 1);
  assert.match(previewRequests[0].url,
    /\/tools\/payment-test\/shipping-apv\/failure-alert-preview$/);
  assert.equal(previewRequests[0].options.cache, "no-store");
  assert.equal(document.querySelector("#shippingApvFailureAlertPreview").textContent,
    "경고 검토 / WARNING");
  assert.match(document.querySelector("#shippingApvFailureAlertPreviewNote").textContent,
    /preview only · approval required · delivery disabled · cooldown 15m preview \/ not enforced/);
  assert.match(document.querySelector("#shippingApvFailureAlertPreviewNote").textContent,
    /state c{12} · TTL 5s · rollback_verification_warning/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => alertPreview({
    action: "review_recovery", severity: "critical", reasons: ["recovered_from_critical"],
    lifecycle: { phase: "recovered", firstObservedAt: now, warningObservedAt: now,
      criticalObservedAt: now, recoveredAt: now, lastFailureAt: now },
  }) });
  await dom.window.eval("fetchShippingApvFailureAlertPreview()");
  assert.equal(document.querySelector("#shippingApvFailureAlertPreview").textContent,
    "복구 확인 / CRITICAL");
  assert.match(document.querySelector("#shippingApvFailureAlertPreviewNote").textContent,
    /recovered_from_critical/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => alertPreview({
    delivery: { enabled: true, attempted: true },
  }) });
  await dom.window.eval("fetchShippingApvFailureAlertPreview()");
  assert.equal(document.querySelector("#shippingApvFailureAlertPreview").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertPreviewNote").textContent,
    /INVALID · preview not loaded · previous value cleared · no delivery attempted/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => alertPreview({
    approval: { required: false, state: "not_required" },
    reasons: ["unknown_reason"],
  }) });
  await dom.window.eval("fetchShippingApvFailureAlertPreview()");
  assert.equal(document.querySelector("#shippingApvFailureAlertPreview").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertPreviewNote").textContent,
    /INVALID · preview not loaded · previous value cleared · no delivery attempted/);

  dom.window.fetch = async () => {
    throw new Error("postgres://secret:password@db.internal/private-preview");
  };
  await dom.window.eval("fetchShippingApvFailureAlertPreview()");
  assert.equal(document.querySelector("#shippingApvFailureAlertPreview").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertPreviewNote").textContent,
    /ERR · preview not loaded · previous value cleared · no delivery attempted/);
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal|private-preview/i);

  const approvalRequests = [];
  let approvalClientRequestId = "";
  dom.window.fetch = async (url, options = {}) => {
    approvalRequests.push({ url, options });
    if (url.endsWith("/failure-alert-preview")) {
      return { ok: true, status: 200, json: async () => alertPreview() };
    }
    const body = JSON.parse(options.body);
    approvalClientRequestId = body.client_request_id;
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_approval_request: {
        id: "77777777-7777-4777-8777-777777777777",
        clientRequestId: body.client_request_id,
        stateFingerprint: body.state_fingerprint,
        action: "review_warning",
        severity: "warning",
        reasons: ["rollback_verification_warning"],
        status: "PENDING",
        requestedAt: now,
        expiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        replayed: false,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("requestShippingApvFailureAlertApproval(null)");
  assert.equal(approvalRequests.length, 2);
  assert.match(approvalRequests[0].url, /\/failure-alert-preview$/);
  assert.match(approvalRequests[1].url, /\/failure-alert-approval-requests$/);
  assert.equal(approvalRequests[1].options.method, "POST");
  assert.equal(approvalRequests[1].options.cache, "no-store");
  assert.match(approvalClientRequestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(document.querySelector("#shippingApvFailureAlertApprovalRequest").textContent,
    "승인 대기 / WARNING");
  assert.match(document.querySelector("#shippingApvFailureAlertApprovalRequestNote").textContent,
    /immutable · created · state c{12} .* decision none · delivery disabled/);

  dom.window.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_request_id, approvalClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_approval_request: {
        id: "77777777-7777-4777-8777-777777777777",
        clientRequestId: body.client_request_id,
        stateFingerprint: body.state_fingerprint,
        action: "review_warning", severity: "warning",
        reasons: ["rollback_verification_warning"], status: "PENDING",
        requestedAt: now,
        expiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        replayed: true, delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("requestShippingApvFailureAlertApproval(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertApprovalRequestNote").textContent,
    /immutable · idempotent replay/);

  const decisionRequests = [];
  let decisionClientRequestId = "";
  dom.window.fetch = async (url, options = {}) => {
    decisionRequests.push({ url, options });
    const body = JSON.parse(options.body);
    decisionClientRequestId = body.client_decision_id;
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_approval_decision: {
        id: "44444444-4444-4444-8444-444444444444",
        clientDecisionId: body.client_decision_id,
        approvalRequestId: "77777777-7777-4777-8777-777777777777",
        stateFingerprint: "c".repeat(64),
        decision: body.decision,
        reason: "checker_approved_snapshot",
        decidedAt: now,
        replayed: false,
        makerCheckerSeparated: true,
        executable: false,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("decideShippingApvFailureAlertApproval(null, 'APPROVED')");
  assert.match(decisionRequests[0].url,
    /\/failure-alert-approval-requests\/77777777-7777-4777-8777-777777777777\/decisions$/);
  assert.equal(decisionRequests[0].options.method, "POST");
  assert.equal(decisionRequests[0].options.cache, "no-store");
  assert.equal(JSON.parse(decisionRequests[0].options.body).decision, "APPROVED");
  assert.match(decisionClientRequestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(document.querySelector("#shippingApvFailureAlertApprovalDecision").textContent,
    "체커 승인 / SNAPSHOT");
  assert.match(document.querySelector("#shippingApvFailureAlertApprovalDecisionNote").textContent,
    /append-only · created · maker\/checker separated .* non-executable · delivery disabled/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_decision_id, decisionClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_approval_decision: {
        id: "44444444-4444-4444-8444-444444444444",
        clientDecisionId: body.client_decision_id,
        approvalRequestId: "77777777-7777-4777-8777-777777777777",
        stateFingerprint: "c".repeat(64), decision: "APPROVED",
        reason: "checker_approved_snapshot", decidedAt: now, replayed: true,
        makerCheckerSeparated: true, executable: false,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("decideShippingApvFailureAlertApproval(null, 'APPROVED')");
  assert.match(document.querySelector("#shippingApvFailureAlertApprovalDecisionNote").textContent,
    /append-only · idempotent replay/);

  const grantRequests = [];
  let grantClientRequestId = "";
  dom.window.fetch = async (url, options = {}) => {
    grantRequests.push({ url, options });
    const body = JSON.parse(options.body);
    grantClientRequestId = body.client_grant_id;
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_delivery_grant: {
        schemaVersion: "shipment-apv-failure-alert-delivery-grant-v1",
        id: "22222222-2222-4222-8222-222222222222",
        clientGrantId: body.client_grant_id,
        approvalDecisionId: "44444444-4444-4444-8444-444444444444",
        stateFingerprint: "c".repeat(64), status: "GRANTED_DRY_RUN",
        grantedAt: now, cooldownExpiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        replayed: false, dryRun: true, payloadPrepared: false, signatureCreated: false,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("prepareShippingApvFailureAlertGrant(null)");
  assert.match(grantRequests[0].url,
    /\/failure-alert-approval-decisions\/44444444-4444-4444-8444-444444444444\/delivery-grants$/);
  assert.equal(grantRequests[0].options.method, "POST");
  assert.equal(grantRequests[0].options.cache, "no-store");
  assert.match(grantClientRequestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(document.querySelector("#shippingApvFailureAlertDeliveryGrant").textContent,
    "DRY-RUN GRANTED / COOLDOWN");
  assert.match(document.querySelector("#shippingApvFailureAlertDeliveryGrantNote").textContent,
    /created · state c{12} · cooldown until .* payload no · signature no · delivery disabled/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_grant_id, grantClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_delivery_grant: {
        schemaVersion: "shipment-apv-failure-alert-delivery-grant-v1",
        id: "22222222-2222-4222-8222-222222222222",
        clientGrantId: body.client_grant_id,
        approvalDecisionId: "44444444-4444-4444-8444-444444444444",
        stateFingerprint: "c".repeat(64), status: "GRANTED_DRY_RUN",
        grantedAt: now, cooldownExpiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        replayed: true, dryRun: true, payloadPrepared: false, signatureCreated: false,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("prepareShippingApvFailureAlertGrant(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertDeliveryGrantNote").textContent,
    /idempotent replay · state c{12}/);

  const payloadRequests = [];
  let payloadClientRequestId = "";
  const unsignedPayload = {
    schema_version: "shipment-apv-failure-alert-payload-v1",
    event_type: "shipment_apv_failure_alert",
    action: "review_warning",
    severity: "warning",
    reasons: ["rollback_verification_warning"],
    state_fingerprint: "c".repeat(64),
  };
  dom.window.fetch = async (url, options = {}) => {
    payloadRequests.push({ url, options });
    const body = JSON.parse(options.body);
    payloadClientRequestId = body.client_outbox_id;
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_payload_outbox: {
        schemaVersion: "shipment-apv-failure-alert-payload-outbox-v1",
        id: "33333333-3333-4333-8333-333333333333",
        clientOutboxId: body.client_outbox_id,
        deliveryGrantId: "22222222-2222-4222-8222-222222222222",
        stateFingerprint: "c".repeat(64), payload: unsignedPayload,
        payloadSha256: "d".repeat(64), status: "UNSIGNED_DRY_RUN",
        createdAt: now, replayed: false, signed: false, signature: null,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("buildShippingApvFailureAlertPayload(null)");
  assert.match(payloadRequests[0].url,
    /\/failure-alert-delivery-grants\/22222222-2222-4222-8222-222222222222\/payload-outbox$/);
  assert.equal(payloadRequests[0].options.method, "POST");
  assert.equal(payloadRequests[0].options.cache, "no-store");
  assert.match(payloadClientRequestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(document.querySelector("#shippingApvFailureAlertPayloadOutbox").textContent,
    "UNSIGNED PAYLOAD / READY");
  assert.match(document.querySelector("#shippingApvFailureAlertPayloadOutboxNote").textContent,
    /created · review_warning\/warning · reasons 1 · hash d{16} · signature no · delivery disabled/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_outbox_id, payloadClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_payload_outbox: {
        schemaVersion: "shipment-apv-failure-alert-payload-outbox-v1",
        id: "33333333-3333-4333-8333-333333333333",
        clientOutboxId: body.client_outbox_id,
        deliveryGrantId: "22222222-2222-4222-8222-222222222222",
        stateFingerprint: "c".repeat(64), payload: unsignedPayload,
        payloadSha256: "d".repeat(64), status: "UNSIGNED_DRY_RUN",
        createdAt: now, replayed: true, signed: false, signature: null,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("buildShippingApvFailureAlertPayload(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertPayloadOutboxNote").textContent,
    /idempotent replay · review_warning\/warning/);

  const keyRegistryRequests = [];
  let keyRegistrationClientRequestId = "";
  const publicKeySpkiBase64 = Buffer.alloc(44).toString("base64");
  const keyRegistryResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-test-key-registry-v1",
    keyId: "a".repeat(24), algorithm: "Ed25519", publicKeySpkiBase64,
    eventType: "REGISTERED", eventReason: "ephemeral_test_key_registered",
    status: "REGISTERED", lifecycleReason: "ephemeral_test_key_registered",
    registeredAt: now, lastTransitionAt: now, replayed: false,
    keyManagement: "EPHEMERAL_PROCESS_TEST_KEY", registry: "DATABASE_TEST_REGISTRY",
    independentTrustAnchor: false, privateKeyExposed: false, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    keyRegistryRequests.push({ url, options });
    const body = JSON.parse(options.body);
    keyRegistrationClientRequestId = body.client_event_id;
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_signing_key: keyRegistryResponse(),
    }) };
  };
  await dom.window.eval("registerShippingApvFailureAlertTestKey(null)");
  assert.match(keyRegistryRequests[0].url,
    /\/failure-alert-signing-keys\/register$/);
  assert.equal(keyRegistryRequests[0].options.method, "POST");
  assert.equal(keyRegistryRequests[0].options.cache, "no-store");
  assert.match(keyRegistrationClientRequestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(document.querySelector("#shippingApvFailureAlertSigningKey").textContent,
    "REGISTERED / TEST REGISTRY");
  assert.match(document.querySelector("#shippingApvFailureAlertSigningKeyNote").textContent,
    /recorded · Ed25519 · key a{24} · ephemeral_test_key_registered · private key hidden · independent trust anchor no/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_event_id, keyRegistrationClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_signing_key: keyRegistryResponse({ replayed: true }),
    }) };
  };
  await dom.window.eval("registerShippingApvFailureAlertTestKey(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertSigningKeyNote").textContent,
    /idempotent\/existing · Ed25519/);

  const signatureRequests = [];
  let signatureClientRequestId = "";
  let publicVerifyResult = true;
  Object.defineProperty(dom.window.crypto, "subtle", { configurable: true, value: {
    importKey: async () => ({ type: "public", algorithm: { name: "Ed25519" } }),
    verify: async () => publicVerifyResult,
    digest: async (_algorithm, data) => Uint8Array.from(
      createHash("sha256").update(Buffer.from(data)).digest()).buffer,
  } });
  const signatureBase64 = Buffer.alloc(64).toString("base64");
  const signatureResponse = (body, overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-payload-signature-v1",
    id: "55555555-5555-4555-8555-555555555555",
    clientSignatureId: body.client_signature_id,
    payloadOutboxId: "33333333-3333-4333-8333-333333333333",
    payloadSha256: "d".repeat(64),
    signingDomain: "haggle.shipment-apv-failure-alert.payload-sha256.v1",
    algorithm: "Ed25519", keyId: "a".repeat(24), publicKeySpkiBase64,
    signatureBase64, status: "SIGNED_DRY_RUN", signedAt: now, replayed: false,
    keyManagement: "EPHEMERAL_PROCESS_TEST_KEY", trustAnchored: false,
    registryBound: true, registryStatusAtSigning: "ACTIVE",
    independentTrustAnchor: false,
    signatureVerified: true, privateKeyExposed: false,
    delivery: { enabled: false, attempted: false }, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    signatureRequests.push({ url, options });
    const body = JSON.parse(options.body);
    signatureClientRequestId = body.client_signature_id;
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_payload_signature: signatureResponse(body),
    }) };
  };
  await dom.window.eval("signShippingApvFailureAlertPayload(null)");
  assert.match(signatureRequests[0].url,
    /\/failure-alert-payload-outbox\/33333333-3333-4333-8333-333333333333\/signatures$/);
  assert.equal(signatureRequests[0].options.method, "POST");
  assert.equal(signatureRequests[0].options.cache, "no-store");
  assert.match(signatureClientRequestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(document.querySelector("#shippingApvFailureAlertPayloadSignature").textContent,
    "SIGNED / VERIFIED");
  assert.match(document.querySelector("#shippingApvFailureAlertPayloadSignatureNote").textContent,
    /created · Ed25519 · registered test key a{24} · hash d{16} · browser public verify yes · registry bound · independent trust anchor no · private key hidden · delivery disabled/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_signature_id, signatureClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_payload_signature: signatureResponse(body, { replayed: true }),
    }) };
  };
  await dom.window.eval("signShippingApvFailureAlertPayload(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertPayloadSignatureNote").textContent,
    /idempotent replay · Ed25519/);

  const deliveryIntentRequests = [];
  let deliveryIntentClientRequestId = "";
  const deliveryIntentResponse = (body, overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-delivery-intent-v1",
    id: "77777777-7777-4777-8777-777777777777",
    clientDeliveryIntentId: body.client_delivery_intent_id,
    payloadSignatureId: "55555555-5555-4555-8555-555555555555",
    payloadOutboxId: "33333333-3333-4333-8333-333333333333",
    payloadSha256: "d".repeat(64), keyId: "a".repeat(24),
    status: "BLOCKED_CONFIGURATION_DRY_RUN",
    blockingReasons: ["independent_trust_anchor_missing",
      "receiver_endpoint_missing", "receiver_credential_missing"],
    createdAt: now, replayed: false, persistent: true, executable: false,
    http: { requestCreated: false }, delivery: { enabled: false, attempted: false },
    ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    deliveryIntentRequests.push({ url, options });
    const body = JSON.parse(options.body);
    deliveryIntentClientRequestId = body.client_delivery_intent_id;
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_delivery_intent: deliveryIntentResponse(body),
    }) };
  };
  await dom.window.eval("queueShippingApvFailureAlertDeliveryIntent(null)");
  assert.match(deliveryIntentRequests[0].url,
    /\/failure-alert-payload-signatures\/55555555-5555-4555-8555-555555555555\/delivery-intents$/);
  assert.equal(deliveryIntentRequests[0].options.method, "POST");
  assert.equal(deliveryIntentRequests[0].options.cache, "no-store");
  assert.match(deliveryIntentClientRequestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(document.querySelector("#shippingApvFailureAlertDeliveryIntent").textContent,
    "BLOCKED CONFIGURATION / DRY-RUN");
  assert.match(document.querySelector("#shippingApvFailureAlertDeliveryIntentNote").textContent,
    /persisted · blockers 3 · trust anchor missing · receiver endpoint missing · credential missing · HTTP request no · delivery attempted no/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_delivery_intent_id, deliveryIntentClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_delivery_intent: deliveryIntentResponse(body, { replayed: true }),
    }) };
  };
  await dom.window.eval("queueShippingApvFailureAlertDeliveryIntent(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertDeliveryIntentNote").textContent,
    /idempotent replay · blockers 3/);

  const receiverContractRequests = [];
  const receiverContractResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-receiver-contract-v1",
    deliveryIntentId: "77777777-7777-4777-8777-777777777777",
    payloadSignatureId: "55555555-5555-4555-8555-555555555555",
    status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN", contractVersion: "v1",
    payloadContractVerified: true, payloadHashVerified: true,
    signatureVerified: true, keyBindingVerified: true,
    freshnessVerified: true, freshnessWindowSeconds: 300,
    trustSource: "DATABASE_TEST_REGISTRY_FIXTURE", independentTrustAnchor: false,
    networkReceived: false, productionAccepted: false, persistent: false,
    replayProtection: { enabled: false, persistent: false },
    delivery: { enabled: false, attempted: false }, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    receiverContractRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_contract: receiverContractResponse(),
    }) };
  };
  await dom.window.eval("verifyShippingApvFailureAlertReceiverContract(null)");
  assert.match(receiverContractRequests[0].url,
    /\/failure-alert-delivery-intents\/77777777-7777-4777-8777-777777777777\/receiver-contract\/verify$/);
  assert.equal(receiverContractRequests[0].options.method, "POST");
  assert.equal(receiverContractRequests[0].options.cache, "no-store");
  assert.deepEqual(JSON.parse(receiverContractRequests[0].options.body), {});
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverContract").textContent,
    "VERIFIED LOCAL CONTRACT / DRY-RUN");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverContractNote").textContent,
    /payload contract yes · hash yes · Ed25519 yes · key binding yes · freshness ≤300s · DB test trust only · network received no · production accepted no · replay protection no/);

  const receiverClaimRequests = [];
  const receiverClaimResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-v1",
    id: "88888888-8888-4888-8888-888888888888", deliveryId: "e".repeat(64),
    deliveryIntentId: "77777777-7777-4777-8777-777777777777",
    payloadSignatureId: "55555555-5555-4555-8555-555555555555",
    payloadSha256: "d".repeat(64), keyId: "a".repeat(24),
    status: "VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN", receivedAt: now,
    replayed: false, persistent: true, receiverContractVerified: true,
    replayProtection: { enabled: true, persistent: true },
    trustSource: "DATABASE_TEST_REGISTRY_FIXTURE", independentTrustAnchor: false,
    networkReceived: false, productionAccepted: false,
    delivery: { enabled: false, attempted: false }, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    receiverClaimRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_claim: receiverClaimResponse(),
    }) };
  };
  await dom.window.eval("recordShippingApvFailureAlertReceiverClaim(null)");
  assert.match(receiverClaimRequests[0].url,
    /\/failure-alert-delivery-intents\/77777777-7777-4777-8777-777777777777\/receiver-claims$/);
  assert.equal(receiverClaimRequests[0].options.method, "POST");
  assert.equal(receiverClaimRequests[0].options.cache, "no-store");
  assert.deepEqual(JSON.parse(receiverClaimRequests[0].options.body), {});
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaim").textContent,
    "PERSISTED LOCAL CLAIM / DRY-RUN");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimNote").textContent,
    /first recorded · delivery e{16} · contract verified yes · replay protection yes · DB test trust only · network received no · production accepted no/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim: receiverClaimResponse({ replayed: true }),
  }) });
  await dom.window.eval("recordShippingApvFailureAlertReceiverClaim(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimNote").textContent,
    /idempotent replay · delivery e{16}/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim: receiverClaimResponse({
      networkReceived: true,
    }),
  }) });
  await dom.window.eval("recordShippingApvFailureAlertReceiverClaim(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaim").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimNote").textContent,
    /INVALID · claim not trusted · network received no · production accepted no/);

  const receiverClaimHealthRequests = [];
  const receiverClaimHealthResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-health-v1",
    status: "healthy",
    totals: { claims: 1, last24Hours: 1, olderThan30Days: 0 },
    violations: { binding: 0, deliveryId: 0, freshness: 0, unsafeSideEffect: 0 },
    criticalCount: 0,
    retention: { policy: "UNSET_PRESERVE", automaticDeletion: false },
    networkReceipt: false, productionAccepted: false, observedAt: now,
    ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    receiverClaimHealthRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_claim_health: receiverClaimHealthResponse(),
    }) };
  };
  await dom.window.eval("loadShippingApvFailureAlertReceiverClaimHealth(null)");
  assert.match(receiverClaimHealthRequests[0].url,
    /\/failure-alert-receiver-claims\/health$/);
  assert.equal(receiverClaimHealthRequests[0].options.method, "GET");
  assert.equal(receiverClaimHealthRequests[0].options.cache, "no-store");
  assert.equal(receiverClaimHealthRequests[0].options.body, undefined);
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimHealth").textContent,
    "HEALTHY / 0");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimHealthNote").textContent,
    /claims 1 · 24h 1 · >30d 0 · binding 0 · delivery ID 0 · freshness 0 · unsafe 0 · preserve \/ no auto-delete · network receipt no/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim_health: receiverClaimHealthResponse({
      networkReceipt: true,
    }),
  }) });
  await dom.window.eval("loadShippingApvFailureAlertReceiverClaimHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimHealth").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimHealthNote").textContent,
    /INVALID · aggregate not trusted · no identifiers exposed · no mutation/);

  dom.window.fetch = async () => {
    throw new Error("postgres://secret:password@db.internal/receiver-claim-health");
  };
  await dom.window.eval("loadShippingApvFailureAlertReceiverClaimHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimHealth").textContent,
    "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal|receiver-claim-health/i);

  const receiverClaimManifestRequests = [];
  const manifestDomain = "haggle.shipment-apv-failure-alert.receiver-claim-manifest.v1";
  const receiptDigests = ["e".repeat(64)];
  const manifestDigest = createHash("sha256")
    .update(`${manifestDomain}:1:${receiptDigests.join(",")}`, "utf8").digest("hex");
  const receiverClaimManifestResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-v1",
    status: "COMPLETE_LOCAL_MANIFEST_DRY_RUN", manifestDomain, manifestDigest,
    entryCount: 1, receiptDigests, maxEntries: 1000, complete: true,
    healthStatus: "healthy", containsRawIdentifiers: false, persistent: false,
    externalArchive: false, networkDelivered: false, productionAccepted: false,
    generatedAt: now, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    receiverClaimManifestRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_claim_manifest: receiverClaimManifestResponse(),
    }) };
  };
  await dom.window.eval("exportShippingApvFailureAlertReceiverClaimManifest(null)");
  assert.match(receiverClaimManifestRequests[0].url,
    /\/failure-alert-receiver-claims\/manifest$/);
  assert.equal(receiverClaimManifestRequests[0].options.method, "GET");
  assert.equal(receiverClaimManifestRequests[0].options.cache, "no-store");
  assert.equal(receiverClaimManifestRequests[0].options.body, undefined);
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifest").textContent,
    "VERIFIED LOCAL MANIFEST / DRY-RUN");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestNote").textContent,
    new RegExp(`entries 1/1000 · manifest ${manifestDigest.slice(0, 16)} · browser SHA-256 yes · raw identifiers no · persistent no · external archive no · network delivered no · production accepted no`));

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim_manifest: receiverClaimManifestResponse({
      manifestDigest: "f".repeat(64),
    }),
  }) });
  await dom.window.eval("exportShippingApvFailureAlertReceiverClaimManifest(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifest").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestNote").textContent,
    /INVALID · manifest not trusted · raw identifiers not shown · no external delivery/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim_manifest: receiverClaimManifestResponse({
      containsRawIdentifiers: true,
    }),
  }) });
  await dom.window.eval("exportShippingApvFailureAlertReceiverClaimManifest(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifest").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestNote").textContent,
    /raw identifiers not shown/);

  dom.window.fetch = async () => {
    throw new Error("postgres://secret:password@db.internal/receiver-claim-manifest");
  };
  await dom.window.eval("exportShippingApvFailureAlertReceiverClaimManifest(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifest").textContent,
    "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal|receiver-claim-manifest/i);

  const manifestReceiptRequests = [];
  const manifestReceiptResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-receipt-v1",
    status: "PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN", revision: 1,
    manifestDigest, previousManifestDigest: null, entryCount: 1, receiptDigests,
    generatedAt: now, recordedAt: now, replayed: false, persistent: true,
    appendOnly: true, digestVerified: true, healthStatus: "healthy",
    containsRawIdentifiers: false, externalArchive: false, networkDelivered: false,
    productionAccepted: false, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    manifestReceiptRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_claim_manifest_receipt: manifestReceiptResponse(),
    }) };
  };
  await dom.window.eval("recordShippingApvFailureAlertReceiverClaimManifestReceipt(null)");
  assert.match(manifestReceiptRequests[0].url,
    /\/failure-alert-receiver-claim-manifests\/receipts$/);
  assert.equal(manifestReceiptRequests[0].options.method, "POST");
  assert.equal(manifestReceiptRequests[0].options.cache, "no-store");
  assert.deepEqual(JSON.parse(manifestReceiptRequests[0].options.body), {});
  assert.equal(manifestReceiptRequests[0].options.headers["Content-Type"], "application/json");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestReceipt").textContent,
    "PERSISTED MANIFEST RECEIPT / REV 1");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestReceiptNote").textContent,
    new RegExp(`revision recorded · entries 1 · manifest ${manifestDigest.slice(0, 16)} · previous none · browser SHA-256 yes · append-only yes · local persistent yes · external archive no · network delivered no`));

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim_manifest_receipt: manifestReceiptResponse({
      replayed: true,
    }),
  }) });
  await dom.window.eval("recordShippingApvFailureAlertReceiverClaimManifestReceipt(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestReceiptNote").textContent,
    /idempotent replay · entries 1/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim_manifest_receipt: manifestReceiptResponse({
      externalArchive: true,
    }),
  }) });
  await dom.window.eval("recordShippingApvFailureAlertReceiverClaimManifestReceipt(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestReceipt").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestReceiptNote").textContent,
    /INVALID · receipt not trusted · no external archive or network delivery/);

  dom.window.fetch = async () => {
    throw new Error("postgres://secret:password@db.internal/manifest-receipt");
  };
  await dom.window.eval("recordShippingApvFailureAlertReceiverClaimManifestReceipt(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestReceipt").textContent,
    "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal|manifest-receipt/i);

  const manifestHealthRequests = [];
  const manifestHealthResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-health-v1",
    status: "healthy",
    totals: { receipts: 2, latestRevision: 2, latestReceiptEntries: 1,
      currentSourceEntries: 1 },
    violations: { revisionGap: 0, previousMismatch: 0, manifestDigest: 0,
      receiptSet: 0, unsafeSideEffect: 0, timestamp: 0, sourceLimit: 0 },
    criticalCount: 0,
    coverage: { currentSourceCovered: true, missingCurrentReceipt: false },
    freshness: { slaSeconds: 86400, latestReceiptAgeSeconds: 60, stale: false },
    containsRawIdentifiers: false, externalArchive: false,
    networkDelivered: false, productionAccepted: false, observedAt: now,
    ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    manifestHealthRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_claim_manifest_health: manifestHealthResponse(),
    }) };
  };
  await dom.window.eval("loadShippingApvFailureAlertReceiverClaimManifestHealth(null)");
  assert.match(manifestHealthRequests[0].url,
    /\/failure-alert-receiver-claim-manifests\/health$/);
  assert.equal(manifestHealthRequests[0].options.method, "GET");
  assert.equal(manifestHealthRequests[0].options.cache, "no-store");
  assert.equal(manifestHealthRequests[0].options.body, undefined);
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealth").textContent,
    "HEALTHY / 0");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealthNote").textContent,
    /receipts 2 · latest rev 2 · latest entries 1 · source entries 1 · gap 0 · previous 0 · digest 0 · set 0 · unsafe 0 · time 0 · limit 0 · source covered yes · age 60s · stale no · raw identifiers no · external archive no/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim_manifest_health: manifestHealthResponse({
      status: "warning",
      totals: { receipts: 0, latestRevision: null, latestReceiptEntries: null,
        currentSourceEntries: 0 },
      coverage: { currentSourceCovered: false, missingCurrentReceipt: true },
      freshness: { slaSeconds: 86400, latestReceiptAgeSeconds: null, stale: false },
    }),
  }) });
  await dom.window.eval("loadShippingApvFailureAlertReceiverClaimManifestHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealth").textContent,
    "WARNING / 0");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealthNote").textContent,
    /receipts 0 · latest rev none · latest entries none · source entries 0 .* source covered no · age none · stale no/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim_manifest_health: manifestHealthResponse({
      containsRawIdentifiers: true,
    }),
  }) });
  await dom.window.eval("loadShippingApvFailureAlertReceiverClaimManifestHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealth").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealthNote").textContent,
    /INVALID · chain aggregate not trusted · no identifiers exposed · no mutation/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_claim_manifest_health: manifestHealthResponse({
      status: "healthy", criticalCount: 1,
      violations: { revisionGap: 1, previousMismatch: 0, manifestDigest: 0,
        receiptSet: 0, unsafeSideEffect: 0, timestamp: 0, sourceLimit: 0 },
    }),
  }) });
  await dom.window.eval("loadShippingApvFailureAlertReceiverClaimManifestHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealth").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealthNote").textContent,
    /INVALID · chain aggregate not trusted/);

  dom.window.fetch = async () => {
    throw new Error("postgres://secret:password@db.internal/manifest-health");
  };
  await dom.window.eval("loadShippingApvFailureAlertReceiverClaimManifestHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverClaimManifestHealth").textContent,
    "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal|manifest-health/i);

  const archiveIntentRequests = [];
  const archiveIntentResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-intent-v1",
    archiveIntentId: "33333333-3333-4333-8333-333333333333",
    clientArchiveIntentId: "88888888-8888-4888-8888-888888888888",
    manifestRevision: 1, manifestDigest,
    status: "BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN",
    blockingReasons: ["independent_worm_endpoint_missing",
      "archive_credential_missing", "archive_signing_key_missing",
      "archive_delivery_worker_missing"],
    createdAt: now, replayed: false, persistent: true, appendOnly: true,
    executable: false, containsRawIdentifiers: false,
    http: { requestCreated: false }, delivery: { enabled: false, attempted: false },
    externalReceipt: { verified: false }, productionAccepted: false, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    archiveIntentRequests.push({ url, options });
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_manifest_archive_intent:
        archiveIntentResponse({ clientArchiveIntentId: body.client_archive_intent_id }),
    }) };
  };
  await dom.window.eval("queueShippingApvFailureAlertReceiverManifestArchiveIntent(null)");
  assert.match(archiveIntentRequests[0].url,
    /\/failure-alert-receiver-claim-manifest-receipts\/archive-intents$/);
  assert.equal(archiveIntentRequests[0].options.method, "POST");
  assert.equal(archiveIntentRequests[0].options.cache, "no-store");
  assert.equal(JSON.parse(archiveIntentRequests[0].options.body).client_archive_intent_id,
    "88888888-8888-4888-8888-888888888888");
  assert.equal(archiveIntentRequests[0].options.headers["Content-Type"], "application/json");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveIntent").textContent,
    "BLOCKED ARCHIVE CONFIG / REV 1");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveIntentNote").textContent,
    new RegExp(`intent recorded · manifest ${manifestDigest.slice(0, 16)} · blockers 4 · WORM endpoint missing · credential missing · signing key missing · worker missing · append-only yes · HTTP request no · delivery attempted no · external receipt no · production accepted no`));

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_intent:
      archiveIntentResponse({ replayed: true }),
  }) });
  await dom.window.eval("queueShippingApvFailureAlertReceiverManifestArchiveIntent(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveIntentNote").textContent,
    /idempotent replay · manifest/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_intent:
      archiveIntentResponse({ containsRawIdentifiers: true }),
  }) });
  await dom.window.eval("queueShippingApvFailureAlertReceiverManifestArchiveIntent(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveIntent").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveIntentNote").textContent,
    /INVALID · archive intent not trusted · no HTTP request or delivery/);

  dom.window.fetch = async () => {
    throw new Error("postgres://secret:password@db.internal/archive-intent");
  };
  await dom.window.eval("queueShippingApvFailureAlertReceiverManifestArchiveIntent(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveIntent").textContent,
    "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal/i);

  const archiveHealthRequests = [];
  const archiveHealthResponse = (overrides = {}) => ({
    schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-health-v1",
    status: "healthy", totals: { intents: 1, latestReceiptRevision: 1,
      latestIntentRevision: 1, currentSourceEntries: 0 },
    violations: { binding: 0, blockers: 0, unsafeSideEffect: 0,
      timestamp: 0, sourceLimit: 0 }, criticalCount: 0,
    coverage: { currentReceiptIntentCovered: true,
      missingCurrentArchiveIntent: false },
    freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 60, stale: false },
    containsRawIdentifiers: false, httpRequestCreated: false,
    networkDelivered: false, externalReceiptVerified: false,
    productionAccepted: false, observedAt: now, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    archiveHealthRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_manifest_archive_health:
        archiveHealthResponse(),
    }) };
  };
  await dom.window.eval("loadShippingApvFailureAlertReceiverManifestArchiveHealth(null)");
  assert.match(archiveHealthRequests[0].url,
    /\/failure-alert-receiver-manifest-archive-intents\/health$/);
  assert.equal(archiveHealthRequests[0].options.method, "GET");
  assert.equal(archiveHealthRequests[0].options.cache, "no-store");
  assert.equal(archiveHealthRequests[0].options.body, undefined);
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveHealth").textContent,
    "HEALTHY / 0");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveHealthNote").textContent,
    /intents 1 · latest receipt 1 · latest intent 1 · source entries 0 .* current covered yes · age 60s · stale no · HTTP no · external receipt no/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_health: archiveHealthResponse({
      status: "warning", totals: { intents: 0, latestReceiptRevision: null,
        latestIntentRevision: null, currentSourceEntries: 0 },
      coverage: { currentReceiptIntentCovered: false,
        missingCurrentArchiveIntent: true },
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: null, stale: false },
    }),
  }) });
  await dom.window.eval("loadShippingApvFailureAlertReceiverManifestArchiveHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveHealth").textContent,
    "WARNING / 0");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveHealthNote").textContent,
    /current covered no · age none · stale no/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_health:
      archiveHealthResponse({ httpRequestCreated: true }),
  }) });
  await dom.window.eval("loadShippingApvFailureAlertReceiverManifestArchiveHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveHealth").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveHealthNote").textContent,
    /INVALID · archive health not trusted · no identifiers or mutation/);

  dom.window.fetch = async () => { throw new Error(
    "postgres://secret:password@db.internal/archive-health"); };
  await dom.window.eval("loadShippingApvFailureAlertReceiverManifestArchiveHealth(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverManifestArchiveHealth").textContent,
    "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal/);

  const archiveAlertPreviewRequests = [];
  const archiveAlertPreviewResponse = (overrides = {}) => ({
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1",
    mode: "preview_only", action: "none", severity: "healthy", reasons: [],
    stateFingerprint: "c".repeat(64), validForSeconds: 5,
    approval: { required: false, state: "not_required" },
    delivery: { endpointConfigured: false, enabled: false, attempted: false,
      networkDelivered: false, externalReceiptVerified: false,
      productionAccepted: false },
    payload: { created: false, signed: false },
    health: { status: "healthy", totals: { intents: 1, latestReceiptRevision: 1,
      latestIntentRevision: 1, currentSourceEntries: 0 },
      violations: { binding: 0, blockers: 0, unsafeSideEffect: 0,
        timestamp: 0, sourceLimit: 0 }, criticalCount: 0,
      coverage: { currentReceiptIntentCovered: true,
        missingCurrentArchiveIntent: false },
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 60, stale: false } },
    containsRawIdentifiers: false, observedAt: now, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    archiveAlertPreviewRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_preview:
        archiveAlertPreviewResponse(),
    }) };
  };
  await dom.window.eval(
    "loadShippingApvFailureAlertReceiverManifestArchiveAlertPreview(null)");
  assert.match(archiveAlertPreviewRequests[0].url,
    /\/failure-alert-receiver-manifest-archive-alert-preview$/);
  assert.equal(archiveAlertPreviewRequests[0].options.method, "GET");
  assert.equal(archiveAlertPreviewRequests[0].options.cache, "no-store");
  assert.equal(archiveAlertPreviewRequests[0].options.body, undefined);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreview").textContent,
  "조치 없음 / HEALTHY");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreviewNote").textContent,
  /이유 없음 · 승인 불필요 · 지문 c{16} · TTL 5s · endpoint 설정 no · payload 생성 no · 서명 no · HTTP no · 외부 영수증 no/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_alert_preview:
      archiveAlertPreviewResponse({ action: "review_warning", severity: "warning",
        reasons: ["current_archive_intent_missing"],
        approval: { required: true, state: "not_requested" },
        health: { status: "warning", totals: { intents: 0, latestReceiptRevision: null,
          latestIntentRevision: null, currentSourceEntries: 0 },
          violations: { binding: 0, blockers: 0, unsafeSideEffect: 0,
            timestamp: 0, sourceLimit: 0 }, criticalCount: 0,
          coverage: { currentReceiptIntentCovered: false,
            missingCurrentArchiveIntent: true }, freshness: { slaSeconds: 86400,
            latestIntentAgeSeconds: null, stale: false } } }),
  }) });
  await dom.window.eval(
    "loadShippingApvFailureAlertReceiverManifestArchiveAlertPreview(null)");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreview").textContent,
  "경고 검토 / WARNING");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreviewNote").textContent,
  /이유 현재 보관 의도 없음 · 승인 필요/);

  const archiveAlertApprovalRequests = [];
  const archiveAlertApprovalResponse = (overrides = {}) => ({
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-approval-request-v1",
    approvalRequestId: "22222222-2222-4222-8222-222222222222",
    clientRequestId: "88888888-8888-4888-8888-888888888888",
    preview: { schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1",
      stateFingerprint: "c".repeat(64), action: "review_warning",
      severity: "warning", reasons: ["current_archive_intent_missing"] },
    status: "PENDING", requestedAt: now,
    expiresAt: new Date(Date.parse(now) + 15 * 60 * 1000).toISOString(),
    replayed: false, persistent: true, appendOnly: true,
    containsArchiveIdentifiers: false, makerIdentityReturned: false,
    checkerDecisionCreated: false, payloadCreated: false, signed: false,
    delivery: { enabled: false, attempted: false },
    externalReceiptVerified: false, productionAccepted: false, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    archiveAlertApprovalRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_approval_request:
        archiveAlertApprovalResponse(),
    }) };
  };
  await dom.window.eval(
    "requestShippingApvFailureAlertReceiverManifestArchiveAlertApproval(null)");
  const archiveAlertApprovalBody =
    JSON.parse(archiveAlertApprovalRequests[0].options.body);
  assert.match(archiveAlertApprovalRequests[0].url,
    /\/failure-alert-receiver-manifest-archive-alert-approval-requests$/);
  assert.equal(archiveAlertApprovalRequests[0].options.method, "POST");
  assert.equal(archiveAlertApprovalRequests[0].options.cache, "no-store");
  assert.equal(archiveAlertApprovalRequests[0].options.headers["Content-Type"],
    "application/json");
  assert.equal(archiveAlertApprovalBody.client_request_id,
    "88888888-8888-4888-8888-888888888888");
  assert.equal(archiveAlertApprovalBody.state_fingerprint, "c".repeat(64));
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertApproval").textContent,
  "PENDING MAKER REQUEST / WARNING");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertApprovalNote").textContent,
  /append-only recorded · request 22222222 · state c{16} · reasons 1 · 15분 만료 · maker ID 반환 no · checker 결정 no · payload no · 서명 no · HTTP no/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_alert_approval_request:
      archiveAlertApprovalResponse({ replayed: true }),
  }) });
  await dom.window.eval(
    "requestShippingApvFailureAlertReceiverManifestArchiveAlertApproval(null)");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertApprovalNote").textContent,
  /idempotent replay · request 22222222/);

  const archiveAlertDecisionRequests = [];
  const archiveAlertDecisionResponse = (clientDecisionId, overrides = {}) => ({
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-approval-decision-v1",
    decisionId: "44444444-4444-4444-8444-444444444444",
    clientDecisionId,
    approvalRequestId: "22222222-2222-4222-8222-222222222222",
    request: { schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1",
      stateFingerprint: "c".repeat(64), action: "review_warning",
      severity: "warning", reasons: ["current_archive_intent_missing"] },
    decision: "APPROVED", reason: "checker_approved_snapshot",
    decidedAt: now, replayed: false, persistent: true, appendOnly: true,
    makerCheckerSeparated: true, makerIdentityReturned: false,
    checkerIdentityReturned: false, containsArchiveIdentifiers: false,
    payloadCreated: false, signed: false,
    delivery: { enabled: false, attempted: false },
    externalReceiptVerified: false, productionAccepted: false, ...overrides,
  });
  dom.window.fetch = async (url, options = {}) => {
    archiveAlertDecisionRequests.push({ url, options });
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_approval_decision:
        archiveAlertDecisionResponse(body.client_decision_id),
    }) };
  };
  await dom.window.eval(
    "decideShippingApvFailureAlertReceiverManifestArchiveAlertApproval(null, 'APPROVED')");
  const archiveAlertDecisionBody =
    JSON.parse(archiveAlertDecisionRequests[0].options.body);
  assert.match(archiveAlertDecisionRequests[0].url,
    /\/failure-alert-receiver-manifest-archive-alert-approval-requests\/22222222-2222-4222-8222-222222222222\/decision$/);
  assert.equal(archiveAlertDecisionRequests[0].options.method, "POST");
  assert.equal(archiveAlertDecisionRequests[0].options.cache, "no-store");
  assert.equal(archiveAlertDecisionRequests[0].options.headers["Content-Type"],
    "application/json");
  assert.match(archiveAlertDecisionBody.client_decision_id,
    /^[0-9a-f-]{36}$/);
  assert.equal(archiveAlertDecisionBody.decision, "APPROVED");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDecision").textContent,
  "APPROVED CHECKER DECISION / WARNING");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDecisionNote").textContent,
  /append-only recorded · decision 44444444 · maker-checker 분리 yes · 현재 상태 재검증 yes · maker\/checker ID 반환 no · payload no · 서명 no · HTTP no/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_decision_id,
      archiveAlertDecisionBody.client_decision_id);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_approval_decision:
        archiveAlertDecisionResponse(body.client_decision_id, { replayed: true }),
    }) };
  };
  await dom.window.eval(
    "decideShippingApvFailureAlertReceiverManifestArchiveAlertApproval(null, 'APPROVED')");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDecisionNote").textContent,
  /idempotent replay · decision 44444444/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_approval_decision:
        archiveAlertDecisionResponse(body.client_decision_id,
          { checkerIdentityReturned: true }),
    }) };
  };
  await dom.window.eval(
    "decideShippingApvFailureAlertReceiverManifestArchiveAlertApproval(null, 'APPROVED')");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDecision").textContent,
  "UNAVAILABLE");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDecisionNote").textContent,
  /INVALID · checker 결정을 신뢰할 수 없음 · payload·서명·외부 전송 없음/);

  dom.window.fetch = async () => { throw new Error(
    "postgres://secret:password@db.internal/archive-alert-decision"); };
  await dom.window.eval(
    "decideShippingApvFailureAlertReceiverManifestArchiveAlertApproval(null, 'APPROVED')");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDecision").textContent,
  "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_alert_approval_request:
      archiveAlertApprovalResponse({ makerIdentityReturned: true }),
  }) });
  await dom.window.eval(
    "requestShippingApvFailureAlertReceiverManifestArchiveAlertApproval(null)");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertApproval").textContent,
  "UNAVAILABLE");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertApprovalNote").textContent,
  /INVALID · maker 요청을 신뢰할 수 없음 · checker·payload·외부 전송 없음/);

  dom.window.fetch = async () => { throw new Error(
    "postgres://secret:password@db.internal/archive-alert-approval"); };
  await dom.window.eval(
    "requestShippingApvFailureAlertReceiverManifestArchiveAlertApproval(null)");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertApproval").textContent,
  "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_alert_preview:
      archiveAlertPreviewResponse({ action: "escalate_critical", severity: "critical",
        stateFingerprint: "d".repeat(64),
        reasons: ["archive_intent_binding_violation", "current_archive_intent_missing"],
        approval: { required: true, state: "not_requested" },
        health: { status: "critical", totals: { intents: 1, latestReceiptRevision: 1,
          latestIntentRevision: null, currentSourceEntries: 0 },
          violations: { binding: 1, blockers: 0, unsafeSideEffect: 0,
            timestamp: 0, sourceLimit: 0 }, criticalCount: 1,
          coverage: { currentReceiptIntentCovered: false,
            missingCurrentArchiveIntent: true }, freshness: { slaSeconds: 86400,
            latestIntentAgeSeconds: null, stale: false } } }),
  }) });
  await dom.window.eval(
    "loadShippingApvFailureAlertReceiverManifestArchiveAlertPreview(null)");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreview").textContent,
  "심각 경보 검토 / CRITICAL");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreviewNote").textContent,
  /이유 영수증 결합 오류 \/ 현재 보관 의도 없음 · 승인 필요/);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertApproval").textContent, "-");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertApprovalNote").textContent,
  /공개 상태가 바뀌어 새 maker 요청이 필요합니다/);
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDecision").textContent, "-");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertDecisionNote").textContent,
  /공개 상태가 바뀌어 새 checker 결정이 필요합니다/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_manifest_archive_alert_preview:
      archiveAlertPreviewResponse({ payload: { created: true, signed: false } }),
  }) });
  await dom.window.eval(
    "loadShippingApvFailureAlertReceiverManifestArchiveAlertPreview(null)");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreview").textContent,
  "UNAVAILABLE");
  assert.match(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreviewNote").textContent,
  /INVALID · 경보 프리뷰를 신뢰할 수 없음 · 승인·payload·외부 전송 없음/);

  dom.window.fetch = async () => { throw new Error(
    "postgres://secret:password@db.internal/archive-alert-preview"); };
  await dom.window.eval(
    "loadShippingApvFailureAlertReceiverManifestArchiveAlertPreview(null)");
  assert.equal(document.querySelector(
    "#shippingApvFailureAlertReceiverManifestArchiveAlertPreview").textContent,
  "UNAVAILABLE");
  assert.doesNotMatch(document.querySelector("#callLog").textContent,
    /secret|password|db\.internal/);

  dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    shipping_apv_failure_alert_receiver_contract: receiverContractResponse({
      productionAccepted: true,
    }),
  }) });
  await dom.window.eval("verifyShippingApvFailureAlertReceiverContract(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertReceiverContract").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertReceiverContractNote").textContent,
    /INVALID · local contract not verified · network received no · production accepted no/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_delivery_intent: deliveryIntentResponse(body, {
        http: { requestCreated: true },
      }),
    }) };
  };
  await dom.window.eval("queueShippingApvFailureAlertDeliveryIntent(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertDeliveryIntent").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertDeliveryIntentNote").textContent,
    /INVALID · intent not trusted · HTTP request no · delivery attempted no/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_payload_signature: signatureResponse(body, {
        privateKey: "must-not-be-present",
      }),
    }) };
  };
  await dom.window.eval("signShippingApvFailureAlertPayload(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertPayloadSignature").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertPayloadSignatureNote").textContent,
    /INVALID · signature not trusted · private key hidden · no delivery/);

  publicVerifyResult = false;
  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_payload_signature: signatureResponse(body, { replayed: true }),
    }) };
  };
  await dom.window.eval("signShippingApvFailureAlertPayload(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertPayloadSignature").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertPayloadSignatureNote").textContent,
    /PUBLIC VERIFY FAILED · signature not trusted/);
  publicVerifyResult = true;

  const keyTransitionRequests = [];
  dom.window.fetch = async (url, options = {}) => {
    keyTransitionRequests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_signing_key: keyRegistryResponse({
        eventType: "RETIRED", eventReason: "ephemeral_test_key_retired",
        status: "RETIRED", lifecycleReason: "ephemeral_test_key_retired",
        lastTransitionAt: new Date(Date.parse(now) + 1_000).toISOString(),
      }),
    }) };
  };
  await dom.window.eval("transitionShippingApvFailureAlertTestKey(null, 'RETIRE')");
  assert.match(keyTransitionRequests[0].url,
    new RegExp(`/failure-alert-signing-keys/${"a".repeat(24)}/transitions$`));
  assert.equal(document.querySelector("#shippingApvFailureAlertSigningKey").textContent,
    "RETIRED / TEST REGISTRY");
  assert.match(document.querySelector("#shippingApvFailureAlertSigningKeyNote").textContent,
    /ephemeral_test_key_retired/);
  dom.window.fetch = async () => { throw new Error("sign route must not be called"); };
  await dom.window.eval("signShippingApvFailureAlertPayload(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertPayloadSignature").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertPayloadSignatureNote").textContent,
    /NO ACTIVE TEST KEY · signature not trusted/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_payload_outbox: {
        schemaVersion: "shipment-apv-failure-alert-payload-outbox-v1",
        id: "33333333-3333-4333-8333-333333333333",
        clientOutboxId: body.client_outbox_id,
        deliveryGrantId: "22222222-2222-4222-8222-222222222222",
        stateFingerprint: "c".repeat(64),
        payload: { ...unsignedPayload, requested_by: "secret" },
        payloadSha256: "d".repeat(64), status: "UNSIGNED_DRY_RUN",
        createdAt: now, replayed: true, signed: false, signature: null,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("buildShippingApvFailureAlertPayload(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertPayloadOutbox").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertPayloadOutboxNote").textContent,
    /INVALID · payload not stored · no signature or delivery/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_delivery_grant: {
        schemaVersion: "shipment-apv-failure-alert-delivery-grant-v1",
        id: "22222222-2222-4222-8222-222222222222",
        clientGrantId: body.client_grant_id,
        approvalDecisionId: "44444444-4444-4444-8444-444444444444",
        stateFingerprint: "c".repeat(64), status: "GRANTED_DRY_RUN",
        grantedAt: now, cooldownExpiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        replayed: true, dryRun: true, payloadPrepared: true, signatureCreated: false,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("prepareShippingApvFailureAlertGrant(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertDeliveryGrant").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertDeliveryGrantNote").textContent,
    /INVALID · grant not created · no payload, signature or delivery/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_grant_id, grantClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_delivery_grant: {
        schemaVersion: "shipment-apv-failure-alert-delivery-grant-v1",
        id: "22222222-2222-4222-8222-222222222222",
        clientGrantId: body.client_grant_id,
        approvalDecisionId: "44444444-4444-4444-8444-444444444444",
        stateFingerprint: "c".repeat(64), status: "GRANTED_DRY_RUN",
        grantedAt: now, cooldownExpiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        replayed: true, dryRun: true, payloadPrepared: false, signatureCreated: false,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("prepareShippingApvFailureAlertGrant(null)");
  assert.match(document.querySelector("#shippingApvFailureAlertDeliveryGrantNote").textContent,
    /idempotent replay · state c{12}/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_approval_decision: {
        id: "44444444-4444-4444-8444-444444444444",
        clientDecisionId: body.client_decision_id,
        approvalRequestId: "77777777-7777-4777-8777-777777777777",
        stateFingerprint: "c".repeat(64), decision: "REJECTED",
        reason: "checker_rejected_snapshot", decidedAt: now, replayed: false,
        makerCheckerSeparated: true, executable: true,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("decideShippingApvFailureAlertApproval(null, 'REJECTED')");
  assert.equal(document.querySelector("#shippingApvFailureAlertApprovalDecision").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertApprovalDecisionNote").textContent,
    /INVALID · decision not recorded · non-executable · no delivery/);

  dom.window.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    assert.equal(body.client_decision_id, decisionClientRequestId);
    return { ok: true, status: 200, json: async () => ({
      shipping_apv_failure_alert_approval_decision: {
        id: "44444444-4444-4444-8444-444444444444",
        clientDecisionId: body.client_decision_id,
        approvalRequestId: "77777777-7777-4777-8777-777777777777",
        stateFingerprint: "c".repeat(64), decision: "APPROVED",
        reason: "checker_approved_snapshot", decidedAt: now, replayed: true,
        makerCheckerSeparated: true, executable: false,
        delivery: { enabled: false, attempted: false },
      },
    }) };
  };
  await dom.window.eval("decideShippingApvFailureAlertApproval(null, 'APPROVED')");
  assert.match(document.querySelector("#shippingApvFailureAlertApprovalDecisionNote").textContent,
    /append-only · idempotent replay/);

  dom.window.fetch = async () => ({ ok: false, status: 409,
    json: async () => ({ error: "SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED" }) });
  await dom.window.eval("requestShippingApvFailureAlertApproval(null)");
  assert.equal(document.querySelector("#shippingApvFailureAlertApprovalRequest").textContent,
    "UNAVAILABLE");
  assert.match(document.querySelector("#shippingApvFailureAlertApprovalRequestNote").textContent,
    /409 · request not recorded · previous value cleared · no decision or delivery/);

  console.log("payment contract recovery dashboard integration: PASS");
  dom.window.close();
}

main().catch((error) => {
  dom.window.close();
  throw error;
});
