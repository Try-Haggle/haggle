import { randomUUID } from "node:crypto";
import type { Database } from "@haggle/db";
import Fastify from "fastify";
import { createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth } from "../jobs/dispute-evidence-scan-retry-alert-snapshot-retention.js";
import { getWebSocketAuthTicketRetentionHealth } from "../jobs/websocket-auth-ticket-retention.js";
import { registerPaymentTestToolRoutes } from "../routes/payment-test-tools.js";
import { runApiRateLimitFixture } from "../services/api-rate-limit-fixture.service.js";
import { runConditionalSettlementFinalityAlertFixture } from "../services/conditional-settlement-finality-alert-fixture.service.js";
import { runConditionalSettlementPreflightAlertFixture } from "../services/conditional-settlement-preflight-alert-fixture.service.js";
import { runDisputeAiAuditArchiveFixture } from "../services/dispute-ai-audit-archive-fixture.service.js";
import { runDisputeEvidenceProvenanceFixture } from "../services/dispute-evidence-provenance-fixture.service.js";
import { getDisputeEvidenceScanRetryHealth } from "../services/dispute-evidence-scan-retry.service.js";
import { runDisputeEvidenceScanRetryAlertFixture } from "../services/dispute-evidence-scan-retry-alert-fixture.service.js";
import { runDisputeEvidenceScanRetryAlertSnapshotRetentionFixture } from "../services/dispute-evidence-scan-retry-alert-snapshot-retention-fixture.service.js";
import { runDisputeEvidenceScanRetryFixture } from "../services/dispute-evidence-scan-retry-fixture.service.js";
import { getDisputeEvidenceScannerCircuitHealth } from "../services/dispute-evidence-scanner-circuit.service.js";
import {
  acquireFinalityAlertFixtureLease,
  releaseFinalityAlertFixtureLease,
  runFinalityAlertFixtureLeaseVerification,
  startFinalityAlertFixtureLeaseHeartbeat,
} from "../services/payment-test-operation-lease.service.js";
import { runShipmentApvChaos } from "../services/shipment-apv-chaos.service.js";
import { createShipmentApvFailureAlertApprovalRequest } from "../services/shipment-apv-chaos-failure-alert-approval.service.js";
import { decideShipmentApvFailureAlertApprovalRequest } from "../services/shipment-apv-chaos-failure-alert-decision.service.js";
import { createShipmentApvFailureAlertDeliveryGrant } from "../services/shipment-apv-chaos-failure-alert-delivery-grant.service.js";
import { createShipmentApvFailureAlertDeliveryIntent } from "../services/shipment-apv-chaos-failure-alert-delivery-intent.service.js";
import {
  registerShipmentApvFailureAlertTestKey,
  transitionShipmentApvFailureAlertTestKey,
} from "../services/shipment-apv-chaos-failure-alert-key-registry.service.js";
import { createShipmentApvFailureAlertPayloadOutbox } from "../services/shipment-apv-chaos-failure-alert-payload.service.js";
import { getShipmentApvChaosFailureAlertPreview } from "../services/shipment-apv-chaos-failure-alert-preview.service.js";
import { createShipmentApvFailureAlertReceiverClaim } from "../services/shipment-apv-chaos-failure-alert-receiver-claim.service.js";
import { exportShipmentApvFailureAlertReceiverClaimManifest } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-export.service.js";
import { getShipmentApvFailureAlertReceiverClaimHealth } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-health.service.js";
import { getShipmentApvFailureAlertReceiverClaimManifestHealth } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-manifest-health.service.js";
import { recordShipmentApvFailureAlertReceiverClaimManifestReceipt } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-manifest-receipt.service.js";
import { verifyShipmentApvFailureAlertReceiverContract } from "../services/shipment-apv-chaos-failure-alert-receiver-contract.service.js";
import { createShipmentApvReceiverManifestArchiveAlertApprovalRequest } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-approval.service.js";
import { decideShipmentApvReceiverManifestArchiveAlertApprovalRequest } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-decision.service.js";
import { createShipmentApvReceiverManifestArchiveAlertDeliveryGrant } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-delivery-grant.service.js";
import { createShipmentApvReceiverManifestArchiveAlertDeliveryIntent } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-delivery-intent.service.js";
import { createShipmentApvReceiverManifestArchiveAlertPayloadOutbox } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-payload.service.js";
import { getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";
import { createShipmentApvReceiverManifestArchiveAlertReceiverClaim } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-claim.service.js";
import { getShipmentApvReceiverManifestArchiveAlertReceiverClaimHealth } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-claim-health.service.js";
import { verifyShipmentApvReceiverManifestArchiveAlertReceiverContract } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-contract.service.js";
import { createShipmentApvReceiverManifestArchiveAlertPayloadSignature } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-signature.service.js";
import { createShipmentApvFailureAlertReceiverManifestArchiveIntent } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-intent.service.js";
import { getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-intent-health.service.js";
import {
  createShipmentApvFailureAlertPayloadSignature,
  getShipmentApvFailureAlertTestSigner,
} from "../services/shipment-apv-chaos-failure-alert-signature.service.js";
import {
  getShipmentApvChaosFailureHealth,
  recordShipmentApvChaosFailure,
} from "../services/shipment-apv-chaos-failure-metric.service.js";
import {
  getShipmentApvPayoutReservationHealth,
  listExpiredShipmentApvPayoutReservations,
} from "../services/shipment-apv-payout-offset.service.js";
import { getShipmentApvRetentionAlertFixtureReadiness } from "../services/shipment-apv-retention-alert-fixture.service.js";
import { runShipmentOrderingChaos } from "../services/shipment-ordering-chaos.service.js";
import {
  claimWebhookEvent,
  cleanupWebhookChaosTestClaims,
  getWebhookClaimHealth,
} from "../services/webhook-event-claim.service.js";
import { runWebSocketAuthTicketFixture } from "../services/websocket-auth-ticket-fixture.service.js";
import { runWebSocketAuthTicketRetentionFixture } from "../services/websocket-auth-ticket-retention-fixture.service.js";

vi.mock("../services/webhook-event-claim.service.js", () => ({
  getWebhookEventClaimLeaseSeconds: vi.fn(() => 60),
  webhookPayloadSha256: vi.fn(() => "a".repeat(64)),
  claimWebhookEvent: vi.fn(),
  completeWebhookEvent: vi.fn().mockResolvedValue(true),
  failWebhookEvent: vi.fn().mockResolvedValue(undefined),
  renewWebhookEventClaim: vi.fn().mockResolvedValue(true),
  expireWebhookClaimForChaosTest: vi.fn().mockResolvedValue(undefined),
  releaseWebhookFailureBackoffForChaosTest: vi.fn().mockResolvedValue(undefined),
  cleanupWebhookChaosTestClaims: vi.fn().mockResolvedValue(8),
  getWebhookClaimHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    totals: { processing: 0, completed: 12, failed: 0, staleProcessing: 0, retryReady: 0 },
    sources: [
      {
        source: "stripe",
        processing: 0,
        completed: 12,
        failed: 0,
        staleProcessing: 0,
        retryReady: 0,
        maxAttemptCount: 1,
        oldestUnfinishedAgeSeconds: null,
      },
    ],
    recordedAt: "2026-07-12T00:00:00.000Z",
  }),
}));

vi.mock("../services/dispute-evidence-scan-retry.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/dispute-evidence-scan-retry.service.js")
  >("../services/dispute-evidence-scan-retry.service.js");
  return {
    ...actual,
    getDisputeEvidenceScanRetryHealth: vi.fn().mockResolvedValue({
      schemaVersion: "dispute-evidence-scan-retry-health-v1",
      status: "healthy",
      job: { enabled: false, cronEnabled: false },
      scanner: {
        schemaVersion: "dispute-evidence-scanner-readiness-v1",
        configurationState: "not_configured",
        configured: false,
        authenticated: false,
        transport: { httpsRequired: true, insecureHttpOverride: false },
        network: {
          privateNetworkBlocked: true,
          redirectsBlocked: true,
          dnsResolutionValidated: true,
          dnsConnectionPinned: true,
        },
        limits: {
          timeoutMs: 15000,
          maxResponseBytes: 16384,
          maxFilenameChars: 160,
          maxResolvedAddresses: 16,
        },
        containsUrl: false,
        containsToken: false,
      },
      policy: {
        batchSize: 10,
        maxAttempts: 5,
        leaseSeconds: 60,
        baseBackoffSeconds: 30,
        maxBackoffSeconds: 3600,
      },
      totals: {
        quarantined: 0,
        pending: 0,
        failed: 0,
        processing: 0,
        staleProcessing: 0,
        retryReady: 0,
        exhausted: 0,
        expiredQuarantined: 0,
      },
      oldestUnresolvedAgeSeconds: null,
      containsIdentifiers: false,
      containsStoragePaths: false,
      containsLeaseTokens: false,
      observedAt: "2026-07-14T00:00:00.000Z",
    }),
  };
});

vi.mock("../services/dispute-evidence-scan-retry-fixture.service.js", () => ({
  runDisputeEvidenceScanRetryFixture: vi.fn().mockResolvedValue({
    schemaVersion: "dispute-evidence-scan-retry-fixture-v1",
    status: "pass",
    totals: { passed: 14, total: 14 },
    checks: {
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
    },
    execution: {
      concurrentWorkers: 20,
      claimed: 4,
      clean: 2,
      infected: 1,
      exhausted: 1,
      realNetworkCalled: false,
      realStorageRead: false,
      databaseChanged: true,
    },
    cleanup: { rows: 4, succeeded: true },
    circuit: {
      schemaVersion: "dispute-evidence-scanner-circuit-fixture-v1",
      status: "pass",
      totals: { passed: 8, total: 8 },
      checks: {},
      execution: {
        concurrentCallers: 20,
        permitsGranted: 4,
        capacityBlocked: 16,
        openBlocked: 20,
        halfOpenProbes: 1,
        halfOpenBlocked: 19,
        databaseChanged: true,
        realNetworkCalled: false,
      },
      health: {},
      containsPermitTokens: false,
      containsCircuitKey: false,
      cleanup: { stateRows: 1, succeeded: true },
    },
    containsIdentifiers: false,
    containsStoragePaths: false,
    containsLeaseTokens: false,
  }),
}));

vi.mock("../services/dispute-evidence-scanner-circuit.service.js", () => ({
  getDisputeEvidenceScannerCircuitHealth: vi.fn().mockResolvedValue({
    schemaVersion: "dispute-evidence-scanner-circuit-health-v1",
    status: "healthy",
    state: "CLOSED",
    consecutiveFailures: 0,
    activePermits: 0,
    policy: { failureThreshold: 3, openSeconds: 60, permitLeaseSeconds: 30, maxConcurrent: 4 },
    nextProbeAt: null,
    probeExpiresAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    containsPermitTokens: false,
    containsCircuitKey: false,
    observedAt: "2026-07-14T00:00:00.000Z",
  }),
}));

vi.mock("../services/dispute-evidence-scan-retry-alert.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/dispute-evidence-scan-retry-alert.service.js")
  >("../services/dispute-evidence-scan-retry-alert.service.js");
  return {
    ...actual,
    getDisputeEvidenceScanRetryAlertDeliveryState: vi.fn().mockResolvedValue({
      incidentOpen: false,
      lastIncidentAlertAt: null,
      lastRecoveryAlertAt: null,
    }),
    getDisputeEvidenceScanRetryAlertSenderHealth: vi.fn().mockResolvedValue({
      status: "healthy",
      processing: 0,
      completed: 0,
      failed: 0,
      staleProcessing: 0,
      retryReady: 0,
      maxAttemptCount: 0,
      oldestUnfinishedAgeSeconds: null,
      lastCompletedAt: null,
      snapshotCount: 0,
      retryableSnapshots: 0,
      orphanedSnapshots: 0,
      missingRetrySnapshots: 0,
      bindingViolations: 0,
      recordedAt: "2026-07-14T00:00:00.000Z",
      containsIdentifiers: false,
    }),
    getDisputeEvidenceScanRetryAlertPolicyStatus: vi.fn(() => ({
      configured: false,
      configurationState: "not_configured",
      jobEnabled: false,
      cooldownMinutes: 15,
      retryReadyThreshold: 10,
      staleThreshold: 1,
      exhaustedThreshold: 1,
      expiredThreshold: 1,
      retentionBlockedThreshold: 1,
    })),
  };
});

vi.mock("../services/dispute-evidence-scan-retry-alert-verifier.service.js", async () => ({
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_PATH:
    "/internal/ops/alerts/dispute-evidence-scan-retry",
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_HEALTH_PATH:
    "/admin/ops/alerts/dispute-evidence-scan-retry/health",
  getDisputeEvidenceScanRetryAlertReceiverHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    processing: 0,
    completed: 0,
    failed: 0,
    staleProcessing: 0,
    retryReady: 0,
    maxAttemptCount: 0,
    oldestUnfinishedAgeSeconds: null,
    lastCompletedAt: null,
    recordedAt: "2026-07-14T00:00:00.000Z",
    containsIdentifiers: false,
  }),
  getDisputeEvidenceScanRetryAlertReceiverPolicyStatus: vi.fn(() => ({
    configured: false,
    configurationState: "not_configured",
    acceptedSecretCount: 0,
    maxAcceptedSecretCount: 4,
    timestampToleranceSeconds: 300,
  })),
}));

vi.mock("../services/dispute-evidence-scan-retry-alert-fixture.service.js", () => ({
  runDisputeEvidenceScanRetryAlertFixture: vi.fn().mockResolvedValue({
    schemaVersion: "dispute-evidence-scan-retry-alert-fixture-v1",
    status: "pass",
    totals: { passed: 31, total: 31 },
    checks: {
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
    },
    execution: {
      concurrentSenders: 20,
      incidentDeliveries: 1,
      senderDuplicatesSuppressed: 19,
      concurrentReceivers: 20,
      receiverWinners: 1,
      receiverReplaysBlocked: 20,
      recoveryDeliveries: 1,
      retentionDeliveries: 1,
      failedDeliveryAttempts: 1,
      senderBackoffBlocks: 1,
      senderRetryAttemptCount: 2,
      retryCrossedCooldownBucket: true,
      immutableSnapshots: 2,
      lostResponseReceiverAccepted: 1,
      staleSenderClaims: 1,
      staleSenderReclaims: 1,
      circuitFailures: 3,
      circuitProbes: 1,
      outboundAttempts: 4,
      injectedTransport: true,
      realNetworkCalled: false,
      databaseChanged: true,
    },
    containsIdentifiers: false,
    containsStoragePaths: false,
    containsLeaseTokens: false,
    containsSecrets: false,
    cleanup: { circuitRows: 1, senderClaims: 3, receiverClaims: 3, snapshots: 2, succeeded: true },
  }),
}));

vi.mock("../services/dispute-evidence-scan-retry-alert-snapshot-retention.service.js", () => ({
  getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    eligibleExpired: 0,
    blockedExpired: 0,
    oldestBlockedExpiredAgeSeconds: null,
    policy: { retentionDays: 30, batchSize: 100, jobEnabled: false, cronEnabled: false },
    containsIdentifiers: false,
    recordedAt: "2026-07-14T00:00:00.000Z",
  }),
}));

vi.mock(
  "../services/dispute-evidence-scan-retry-alert-snapshot-retention-fixture.service.js",
  () => ({
    runDisputeEvidenceScanRetryAlertSnapshotRetentionFixture: vi.fn().mockResolvedValue({
      schemaVersion: "dispute-evidence-scan-retry-alert-snapshot-retention-fixture-v1",
      status: "pass",
      totals: { passed: 13, total: 13 },
      checks: {
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
      },
      execution: {
        concurrentWorkers: 20,
        lockWinners: 1,
        lockBlocked: 19,
        deletedCompletedSnapshots: 1,
        preservedFailedSnapshots: 1,
        preservedOrphanSnapshots: 1,
        persistentJobRuns: 1,
        staleLeaseReclaims: 1,
        staleOwnerCompletions: 0,
        externalCalls: 0,
        databaseChanged: true,
      },
      containsIdentifiers: false,
      cleanup: { snapshots: 2, claims: 2, jobStateRestored: true, succeeded: true },
    }),
  }),
);

vi.mock("../jobs/dispute-evidence-scan-retry-alert-snapshot-retention.js", () => ({
  getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth: vi.fn().mockResolvedValue({
    status: "inactive",
    lastRunStatus: "NEVER",
    overdue: false,
    leaseStale: false,
    firstObservedAt: "2026-07-14T00:00:00.000Z",
    lastStartedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastDeletedSnapshots: 0,
    lastFailureCode: null,
    policy: {
      jobEnabled: false,
      cronEnabled: false,
      intervalSeconds: 86_400,
      leaseSeconds: 900,
      maxStartDelaySeconds: 93_600,
    },
    containsIdentifiers: false,
    recordedAt: "2026-07-14T00:00:00.000Z",
  }),
}));

vi.mock("../services/shipment-ordering-chaos.service.js", () => ({
  runShipmentOrderingChaos: vi.fn().mockResolvedValue({
    pass: true,
    finalStatus: "DELIVERED",
    ignored: { stale: "stale", terminal: "terminal" },
    cleanup: { shipmentRows: 1, eventRows: 5, succeeded: true },
  }),
}));

vi.mock("../services/shipment-apv-chaos.service.js", () => ({
  runShipmentApvChaos: vi.fn().mockResolvedValue({
    pass: true,
    checks: { buffer_capped: true, buyer_effect_zero: true },
    overBuffer: {
      status: "REVIEW_REQUIRED",
      buffer_applied_minor: 150,
      seller_liability_minor: 250,
    },
    credit: { status: "CREDIT_RECORDED", carrier_credit_minor: 100 },
    concurrent: { requests: 20, acquired: 1, blocked: 19 },
    cleanup: { adjustments: 3, shipments: 1, releases: 1, succeeded: true },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-metric.service.js", () => ({
  recordShipmentApvChaosFailure: vi.fn().mockResolvedValue(undefined),
  getShipmentApvChaosFailureHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    windowHours: 24,
    retentionDays: 30,
    total: 0,
    stages: {
      rollback_verification: { count: 0, lastFailureAt: null },
      rollback_failure_isolation: { count: 0, lastFailureAt: null },
      fixture_execution: { count: 0, lastFailureAt: null },
    },
    lastFailureAt: null,
    recordedAt: "2026-07-13T12:00:00.000Z",
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-preview.service.js", () => ({
  getShipmentApvChaosFailureAlertPreview: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-chaos-failure-alert-preview-v1",
    mode: "preview_only",
    action: "none",
    severity: "healthy",
    reasons: [],
    stateFingerprint: "b".repeat(64),
    validForSeconds: 5,
    approval: { required: false, state: "not_required" },
    delivery: { enabled: false, attempted: false },
    cooldown: { windowMinutes: 15, scope: "state_fingerprint", enforced: false },
    lifecycle: {
      phase: "clear",
      firstObservedAt: null,
      warningObservedAt: null,
      criticalObservedAt: null,
      recoveredAt: null,
      lastFailureAt: null,
    },
    recordedAt: "2026-07-13T12:00:00.000Z",
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-approval.service.js", () => ({
  createShipmentApvFailureAlertApprovalRequest: vi.fn().mockResolvedValue({
    id: "77777777-7777-4777-8777-777777777777",
    clientRequestId: "88888888-8888-4888-8888-888888888888",
    stateFingerprint: "b".repeat(64),
    action: "review_warning",
    severity: "warning",
    reasons: ["rollback_verification_warning"],
    status: "PENDING",
    requestedAt: "2026-07-13T12:00:00.000Z",
    expiresAt: "2026-07-13T12:15:00.000Z",
    replayed: false,
    delivery: { enabled: false, attempted: false },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-decision.service.js", () => ({
  decideShipmentApvFailureAlertApprovalRequest: vi.fn().mockResolvedValue({
    id: "44444444-4444-4444-8444-444444444444",
    clientDecisionId: "55555555-5555-4555-8555-555555555555",
    approvalRequestId: "77777777-7777-4777-8777-777777777777",
    stateFingerprint: "b".repeat(64),
    decision: "APPROVED",
    reason: "checker_approved_snapshot",
    decidedAt: "2026-07-13T12:05:00.000Z",
    replayed: false,
    makerCheckerSeparated: true,
    executable: false,
    delivery: { enabled: false, attempted: false },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-delivery-grant.service.js", () => ({
  createShipmentApvFailureAlertDeliveryGrant: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-delivery-grant-v1",
    id: "22222222-2222-4222-8222-222222222222",
    clientGrantId: "33333333-3333-4333-8333-333333333333",
    approvalDecisionId: "44444444-4444-4444-8444-444444444444",
    stateFingerprint: "b".repeat(64),
    status: "GRANTED_DRY_RUN",
    grantedAt: "2026-07-13T12:05:00.000Z",
    cooldownExpiresAt: "2026-07-13T12:20:00.000Z",
    replayed: false,
    dryRun: true,
    payloadPrepared: false,
    signatureCreated: false,
    delivery: { enabled: false, attempted: false },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-payload.service.js", () => ({
  createShipmentApvFailureAlertPayloadOutbox: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-payload-outbox-v1",
    id: "33333333-3333-4333-8333-333333333333",
    clientOutboxId: "11111111-1111-4111-8111-111111111111",
    deliveryGrantId: "22222222-2222-4222-8222-222222222222",
    stateFingerprint: "b".repeat(64),
    payload: {
      schema_version: "shipment-apv-failure-alert-payload-v1",
      event_type: "shipment_apv_failure_alert",
      action: "review_warning",
      severity: "warning",
      reasons: ["rollback_verification_warning"],
      state_fingerprint: "b".repeat(64),
    },
    payloadSha256: "c".repeat(64),
    status: "UNSIGNED_DRY_RUN",
    createdAt: "2026-07-13T12:06:00.000Z",
    replayed: false,
    signed: false,
    signature: null,
    delivery: { enabled: false, attempted: false },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-signature.service.js", () => ({
  getShipmentApvFailureAlertTestSigner: vi.fn(() => ({
    keyId: "a".repeat(24),
    publicKeySpkiBase64: "MCowBQYDK2VwAyEA" + "A".repeat(43) + "=",
    signMessage: vi.fn(),
  })),
  createShipmentApvFailureAlertPayloadSignature: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-payload-signature-v1",
    id: "55555555-5555-4555-8555-555555555555",
    clientSignatureId: "11111111-1111-4111-8111-111111111111",
    payloadOutboxId: "33333333-3333-4333-8333-333333333333",
    payloadSha256: "c".repeat(64),
    signingDomain: "haggle.shipment-apv-failure-alert.payload-sha256.v1",
    algorithm: "Ed25519",
    keyId: "a".repeat(24),
    publicKeySpkiBase64: "MCowBQYDK2VwAyEA" + "A".repeat(43) + "=",
    signatureBase64: "A".repeat(86) + "==",
    status: "SIGNED_DRY_RUN",
    keyManagement: "EPHEMERAL_PROCESS_TEST_KEY",
    trustAnchored: false,
    registryBound: true,
    registryStatusAtSigning: "ACTIVE",
    independentTrustAnchor: false,
    signedAt: "2026-07-13T12:30:00.000Z",
    replayed: false,
    signatureVerified: true,
    privateKeyExposed: false,
    delivery: { enabled: false, attempted: false },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-key-registry.service.js", () => ({
  registerShipmentApvFailureAlertTestKey: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-test-key-registry-v1",
    keyId: "a".repeat(24),
    algorithm: "Ed25519",
    publicKeySpkiBase64: "MCowBQYDK2VwAyEA" + "A".repeat(43) + "=",
    eventType: "REGISTERED",
    eventReason: "ephemeral_test_key_registered",
    status: "REGISTERED",
    lifecycleReason: "ephemeral_test_key_registered",
    registeredAt: "2026-07-13T12:29:00.000Z",
    lastTransitionAt: "2026-07-13T12:29:00.000Z",
    replayed: false,
    keyManagement: "EPHEMERAL_PROCESS_TEST_KEY",
    registry: "DATABASE_TEST_REGISTRY",
    independentTrustAnchor: false,
    privateKeyExposed: false,
  }),
  transitionShipmentApvFailureAlertTestKey: vi.fn().mockImplementation(async (_db, input) => ({
    schemaVersion: "shipment-apv-failure-alert-test-key-registry-v1",
    keyId: input.keyId,
    algorithm: "Ed25519",
    publicKeySpkiBase64: "MCowBQYDK2VwAyEA" + "A".repeat(43) + "=",
    eventType: input.action === "RETIRE" ? "RETIRED" : "REVOKED",
    eventReason:
      input.action === "RETIRE" ? "ephemeral_test_key_retired" : "ephemeral_test_key_revoked",
    status: input.action === "RETIRE" ? "RETIRED" : "REVOKED",
    lifecycleReason:
      input.action === "RETIRE" ? "ephemeral_test_key_retired" : "ephemeral_test_key_revoked",
    registeredAt: "2026-07-13T12:29:00.000Z",
    lastTransitionAt: "2026-07-13T12:31:00.000Z",
    replayed: false,
    keyManagement: "EPHEMERAL_PROCESS_TEST_KEY",
    registry: "DATABASE_TEST_REGISTRY",
    independentTrustAnchor: false,
    privateKeyExposed: false,
  })),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-delivery-intent.service.js", () => ({
  createShipmentApvFailureAlertDeliveryIntent: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-delivery-intent-v1",
    id: "77777777-7777-4777-8777-777777777777",
    clientDeliveryIntentId: "11111111-1111-4111-8111-111111111111",
    payloadSignatureId: "55555555-5555-4555-8555-555555555555",
    payloadOutboxId: "33333333-3333-4333-8333-333333333333",
    payloadSha256: "c".repeat(64),
    keyId: "a".repeat(24),
    status: "BLOCKED_CONFIGURATION_DRY_RUN",
    blockingReasons: [
      "independent_trust_anchor_missing",
      "receiver_endpoint_missing",
      "receiver_credential_missing",
    ],
    createdAt: "2026-07-13T19:00:00.000Z",
    replayed: false,
    persistent: true,
    executable: false,
    http: { requestCreated: false },
    delivery: { enabled: false, attempted: false },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-receiver-contract.service.js", () => ({
  verifyShipmentApvFailureAlertReceiverContract: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-receiver-contract-v1",
    deliveryIntentId: "77777777-7777-4777-8777-777777777777",
    payloadSignatureId: "55555555-5555-4555-8555-555555555555",
    status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN",
    contractVersion: "v1",
    payloadContractVerified: true,
    payloadHashVerified: true,
    signatureVerified: true,
    keyBindingVerified: true,
    freshnessVerified: true,
    freshnessWindowSeconds: 300,
    trustSource: "DATABASE_TEST_REGISTRY_FIXTURE",
    independentTrustAnchor: false,
    networkReceived: false,
    productionAccepted: false,
    persistent: false,
    replayProtection: { enabled: false, persistent: false },
    delivery: { enabled: false, attempted: false },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-receiver-claim.service.js", () => ({
  createShipmentApvFailureAlertReceiverClaim: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-v1",
    id: "88888888-8888-4888-8888-888888888888",
    deliveryId: "e".repeat(64),
    deliveryIntentId: "77777777-7777-4777-8777-777777777777",
    payloadSignatureId: "55555555-5555-4555-8555-555555555555",
    payloadSha256: "c".repeat(64),
    keyId: "a".repeat(24),
    status: "VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN",
    receivedAt: "2026-07-13T20:00:00.000Z",
    replayed: false,
    persistent: true,
    receiverContractVerified: true,
    replayProtection: { enabled: true, persistent: true },
    trustSource: "DATABASE_TEST_REGISTRY_FIXTURE",
    independentTrustAnchor: false,
    networkReceived: false,
    productionAccepted: false,
    delivery: { enabled: false, attempted: false },
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-receiver-claim-health.service.js", () => ({
  getShipmentApvFailureAlertReceiverClaimHealth: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-health-v1",
    status: "healthy",
    totals: { claims: 1, last24Hours: 1, olderThan30Days: 0 },
    violations: { binding: 0, deliveryId: 0, freshness: 0, unsafeSideEffect: 0 },
    criticalCount: 0,
    retention: { policy: "UNSET_PRESERVE", automaticDeletion: false },
    networkReceipt: false,
    productionAccepted: false,
    observedAt: "2026-07-13T20:01:00.000Z",
  }),
}));

vi.mock("../services/shipment-apv-chaos-failure-alert-receiver-claim-export.service.js", () => ({
  exportShipmentApvFailureAlertReceiverClaimManifest: vi.fn().mockResolvedValue({
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-v1",
    status: "COMPLETE_LOCAL_MANIFEST_DRY_RUN",
    manifestDomain: "haggle.shipment-apv-failure-alert.receiver-claim-manifest.v1",
    manifestDigest: "f".repeat(64),
    entryCount: 1,
    receiptDigests: ["e".repeat(64)],
    maxEntries: 1000,
    complete: true,
    healthStatus: "healthy",
    containsRawIdentifiers: false,
    persistent: false,
    externalArchive: false,
    networkDelivered: false,
    productionAccepted: false,
    generatedAt: "2026-07-13T21:00:00.000Z",
  }),
}));

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-claim-manifest-receipt.service.js",
  () => ({
    recordShipmentApvFailureAlertReceiverClaimManifestReceipt: vi.fn().mockResolvedValue({
      schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-receipt-v1",
      status: "PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN",
      revision: 1,
      manifestDigest: "f".repeat(64),
      previousManifestDigest: null,
      entryCount: 1,
      receiptDigests: ["e".repeat(64)],
      generatedAt: "2026-07-13T21:00:00.000Z",
      recordedAt: "2026-07-13T21:00:01.000Z",
      replayed: false,
      persistent: true,
      appendOnly: true,
      digestVerified: true,
      healthStatus: "healthy",
      containsRawIdentifiers: false,
      externalArchive: false,
      networkDelivered: false,
      productionAccepted: false,
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-claim-manifest-health.service.js",
  () => ({
    getShipmentApvFailureAlertReceiverClaimManifestHealth: vi.fn().mockResolvedValue({
      schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-health-v1",
      status: "healthy",
      totals: { receipts: 2, latestRevision: 2, latestReceiptEntries: 1, currentSourceEntries: 1 },
      violations: {
        revisionGap: 0,
        previousMismatch: 0,
        manifestDigest: 0,
        receiptSet: 0,
        unsafeSideEffect: 0,
        timestamp: 0,
        sourceLimit: 0,
      },
      criticalCount: 0,
      coverage: { currentSourceCovered: true, missingCurrentReceipt: false },
      freshness: { slaSeconds: 86400, latestReceiptAgeSeconds: 60, stale: false },
      containsRawIdentifiers: false,
      externalArchive: false,
      networkDelivered: false,
      productionAccepted: false,
      observedAt: "2026-07-13T22:00:00.000Z",
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-intent.service.js",
  () => ({
    createShipmentApvFailureAlertReceiverManifestArchiveIntent: vi.fn().mockResolvedValue({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-intent-v1",
      archiveIntentId: "33333333-3333-4333-8333-333333333333",
      clientArchiveIntentId: "11111111-1111-4111-8111-111111111111",
      manifestRevision: 1,
      manifestDigest: "a".repeat(64),
      status: "BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN",
      blockingReasons: [
        "independent_worm_endpoint_missing",
        "archive_credential_missing",
        "archive_signing_key_missing",
        "archive_delivery_worker_missing",
      ],
      createdAt: "2026-07-13T23:00:00.000Z",
      replayed: false,
      persistent: true,
      appendOnly: true,
      executable: false,
      containsRawIdentifiers: false,
      http: { requestCreated: false },
      delivery: { enabled: false, attempted: false },
      externalReceipt: { verified: false },
      productionAccepted: false,
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-intent-health.service.js",
  () => ({
    getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth: vi.fn().mockResolvedValue({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-health-v1",
      status: "healthy",
      totals: {
        intents: 1,
        latestReceiptRevision: 1,
        latestIntentRevision: 1,
        currentSourceEntries: 0,
      },
      violations: { binding: 0, blockers: 0, unsafeSideEffect: 0, timestamp: 0, sourceLimit: 0 },
      criticalCount: 0,
      coverage: { currentReceiptIntentCovered: true, missingCurrentArchiveIntent: false },
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 60, stale: false },
      containsRawIdentifiers: false,
      httpRequestCreated: false,
      networkDelivered: false,
      externalReceiptVerified: false,
      productionAccepted: false,
      observedAt: "2026-07-13T23:30:00.000Z",
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js",
  () => ({
    getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview: vi.fn().mockResolvedValue({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1",
      mode: "preview_only",
      action: "none",
      severity: "healthy",
      reasons: [],
      stateFingerprint: "c".repeat(64),
      validForSeconds: 5,
      approval: { required: false, state: "not_required" },
      delivery: {
        endpointConfigured: false,
        enabled: false,
        attempted: false,
        networkDelivered: false,
        externalReceiptVerified: false,
        productionAccepted: false,
      },
      payload: { created: false, signed: false },
      health: {
        status: "healthy",
        totals: {
          intents: 1,
          latestReceiptRevision: 1,
          latestIntentRevision: 1,
          currentSourceEntries: 0,
        },
        violations: { binding: 0, blockers: 0, unsafeSideEffect: 0, timestamp: 0, sourceLimit: 0 },
        criticalCount: 0,
        coverage: { currentReceiptIntentCovered: true, missingCurrentArchiveIntent: false },
        freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 60, stale: false },
      },
      containsRawIdentifiers: false,
      observedAt: "2026-07-13T23:30:00.000Z",
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-approval.service.js",
  () => ({
    createShipmentApvReceiverManifestArchiveAlertApprovalRequest: vi.fn().mockResolvedValue({
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-approval-request-v1",
      approvalRequestId: "22222222-2222-4222-8222-222222222222",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      preview: {
        schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1",
        stateFingerprint: "c".repeat(64),
        action: "review_warning",
        severity: "warning",
        reasons: ["current_archive_intent_missing"],
      },
      status: "PENDING",
      requestedAt: "2026-07-13T23:30:00.000Z",
      expiresAt: "2026-07-13T23:45:00.000Z",
      replayed: false,
      persistent: true,
      appendOnly: true,
      containsArchiveIdentifiers: false,
      makerIdentityReturned: false,
      checkerDecisionCreated: false,
      payloadCreated: false,
      signed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false,
      productionAccepted: false,
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-decision.service.js",
  () => ({
    decideShipmentApvReceiverManifestArchiveAlertApprovalRequest: vi.fn().mockResolvedValue({
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-approval-decision-v1",
      decisionId: "44444444-4444-4444-8444-444444444444",
      clientDecisionId: "33333333-3333-4333-8333-333333333333",
      approvalRequestId: "22222222-2222-4222-8222-222222222222",
      request: {
        schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1",
        stateFingerprint: "c".repeat(64),
        action: "review_warning",
        severity: "warning",
        reasons: ["current_archive_intent_missing"],
      },
      decision: "APPROVED",
      reason: "checker_approved_snapshot",
      decidedAt: "2026-07-13T23:35:00.000Z",
      replayed: false,
      persistent: true,
      appendOnly: true,
      makerCheckerSeparated: true,
      makerIdentityReturned: false,
      checkerIdentityReturned: false,
      containsArchiveIdentifiers: false,
      payloadCreated: false,
      signed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false,
      productionAccepted: false,
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-delivery-grant.service.js",
  () => ({
    createShipmentApvReceiverManifestArchiveAlertDeliveryGrant: vi.fn().mockResolvedValue({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-delivery-grant-v1",
      deliveryGrantId: "88888888-8888-4888-8888-888888888888",
      clientGrantId: "77777777-7777-4777-8777-777777777777",
      approvalDecisionId: "44444444-4444-4444-8444-444444444444",
      stateFingerprint: "c".repeat(64),
      status: "GRANTED_DRY_RUN",
      grantedAt: "2026-07-13T23:36:00.000Z",
      cooldownExpiresAt: "2026-07-13T23:51:00.000Z",
      cooldown: { scope: "state_fingerprint", windowMinutes: 15, active: true },
      replayed: false,
      persistent: true,
      appendOnly: true,
      makerCheckerSeparated: true,
      makerIdentityReturned: false,
      checkerIdentityReturned: false,
      containsArchiveIdentifiers: false,
      payloadCreated: false,
      signed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false,
      productionAccepted: false,
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-payload.service.js",
  () => ({
    createShipmentApvReceiverManifestArchiveAlertPayloadOutbox: vi.fn().mockResolvedValue({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-outbox-v1",
      payloadOutboxId: "22222222-2222-4222-8222-222222222222",
      clientOutboxId: "11111111-1111-4111-8111-111111111111",
      deliveryGrantId: "88888888-8888-4888-8888-888888888888",
      stateFingerprint: "c".repeat(64),
      payload: {
        schema_version: "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1",
        event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert",
        action: "review_warning",
        severity: "warning",
        reasons: ["current_archive_intent_missing"],
        state_fingerprint: "c".repeat(64),
      },
      payloadSha256: "d".repeat(64),
      status: "UNSIGNED_DRY_RUN",
      createdAt: "2026-07-13T23:37:00.000Z",
      replayed: false,
      persistent: true,
      appendOnly: true,
      containsArchiveIdentifiers: false,
      createdByIdentityReturned: false,
      signed: false,
      signature: null,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false,
      productionAccepted: false,
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-signature.service.js",
  () => ({
    createShipmentApvReceiverManifestArchiveAlertPayloadSignature: vi.fn().mockResolvedValue({
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-signature-v1",
      signatureId: "33333333-3333-4333-8333-333333333333",
      clientSignatureId: "11111111-1111-4111-8111-111111111111",
      payloadOutboxId: "22222222-2222-4222-8222-222222222222",
      payloadSha256: "d".repeat(64),
      signingDomain:
        "haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.payload-sha256.v1",
      algorithm: "Ed25519",
      keyId: "a".repeat(24),
      publicKeySpkiBase64: "MCowBQYDK2VwAyEA" + "A".repeat(43) + "=",
      signatureBase64: "A".repeat(86) + "==",
      status: "SIGNED_DRY_RUN",
      signedAt: "2026-07-14T00:07:00.000Z",
      replayed: false,
      persistent: true,
      appendOnly: true,
      keyManagement: "EPHEMERAL_PROCESS_TEST_KEY",
      registry: "DATABASE_TEST_REGISTRY",
      registryBound: true,
      registryStatusAtSigning: "ACTIVE",
      independentTrustAnchor: false,
      trustAnchored: false,
      signedByIdentityReturned: false,
      signedMessageContainsArchiveIdentifiers: false,
      signatureVerified: true,
      privateKeyExposed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false,
      productionAccepted: false,
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-delivery-intent.service.js",
  () => ({
    createShipmentApvReceiverManifestArchiveAlertDeliveryIntent: vi.fn().mockResolvedValue({
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-delivery-intent-v1",
      deliveryIntentId: "44444444-4444-4444-8444-444444444444",
      clientDeliveryIntentId: "11111111-1111-4111-8111-111111111111",
      payloadSignatureId: "33333333-3333-4333-8333-333333333333",
      payloadOutboxId: "22222222-2222-4222-8222-222222222222",
      payloadSha256: "d".repeat(64),
      keyId: "a".repeat(24),
      status: "BLOCKED_CONFIGURATION_DRY_RUN",
      blockingReasons: [
        "independent_trust_anchor_missing",
        "receiver_endpoint_missing",
        "receiver_credential_missing",
      ],
      createdAt: "2026-07-14T00:08:00.000Z",
      replayed: false,
      persistent: true,
      appendOnly: true,
      executable: false,
      requestedByIdentityReturned: false,
      signatureValueReturned: false,
      publicKeyReturned: false,
      independentTrustAnchor: false,
      endpointConfigured: false,
      credentialConfigured: false,
      http: { requestCreated: false },
      delivery: { enabled: false, attempted: false },
      networkRequestSent: false,
      externalReceiptVerified: false,
      productionAccepted: false,
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-contract.service.js",
  () => ({
    verifyShipmentApvReceiverManifestArchiveAlertReceiverContract: vi.fn().mockResolvedValue({
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-contract-v1",
      deliveryIntentId: "44444444-4444-4444-8444-444444444444",
      payloadSignatureId: "33333333-3333-4333-8333-333333333333",
      payloadOutboxId: "22222222-2222-4222-8222-222222222222",
      status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN",
      contractVersion: "v1",
      payloadContractVerified: true,
      payloadHashVerified: true,
      signatureVerified: true,
      keyBindingVerified: true,
      freshnessVerified: true,
      intentBindingVerified: true,
      freshnessWindowSeconds: 300,
      trustSource: "DATABASE_TEST_REGISTRY_FIXTURE",
      independentTrustAnchor: false,
      actorIdentityReturned: false,
      signatureValueReturned: false,
      publicKeyReturned: false,
      networkReceived: false,
      externalReceiptVerified: false,
      productionAccepted: false,
      persistent: false,
      replayProtection: { enabled: false, persistent: false },
      delivery: { enabled: false, attempted: false },
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-claim.service.js",
  () => ({
    createShipmentApvReceiverManifestArchiveAlertReceiverClaim: vi.fn().mockResolvedValue({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-claim-v1",
      receiverClaimId: "55555555-5555-4555-8555-555555555555",
      deliveryId: "e".repeat(64),
      deliveryIntentId: "44444444-4444-4444-8444-444444444444",
      payloadSignatureId: "33333333-3333-4333-8333-333333333333",
      payloadOutboxId: "22222222-2222-4222-8222-222222222222",
      payloadSha256: "d".repeat(64),
      keyId: "a".repeat(24),
      status: "VERIFIED_LOCAL_ARCHIVE_ALERT_RECEIVER_CLAIM_DRY_RUN",
      receivedAt: "2026-07-14T00:09:00.000Z",
      replayed: false,
      persistent: true,
      appendOnly: true,
      receiverContractVerified: true,
      replayProtection: { enabled: true, persistent: true },
      trustSource: "DATABASE_TEST_REGISTRY_FIXTURE",
      independentTrustAnchor: false,
      actorIdentityReturned: false,
      signatureValueReturned: false,
      publicKeyReturned: false,
      networkReceived: false,
      externalReceiptVerified: false,
      productionAccepted: false,
      delivery: { enabled: false, attempted: false },
    }),
  }),
);

vi.mock(
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-claim-health.service.js",
  () => ({
    getShipmentApvReceiverManifestArchiveAlertReceiverClaimHealth: vi.fn().mockResolvedValue({
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-claim-health-v1",
      status: "healthy",
      totals: { claims: 1, last24Hours: 1, olderThan30Days: 0 },
      violations: {
        binding: 0,
        deliveryId: 0,
        freshness: 0,
        unsafeSideEffect: 0,
      },
      criticalCount: 0,
      retention: { policy: "UNSET_PRESERVE", automaticDeletion: false },
      containsRawIdentifiers: false,
      independentTrustAnchor: false,
      networkReceipt: false,
      externalReceiptVerified: false,
      productionAccepted: false,
      observedAt: "2026-07-14T06:01:00.000Z",
    }),
  }),
);

vi.mock("../services/shipment-apv-retention-alert-fixture.service.js", () => ({
  getShipmentApvRetentionAlertFixtureReadiness: vi.fn().mockResolvedValue({
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
    scheduler: { jobEnabled: false, configured: false },
    singleton: { status: "SUCCEEDED" },
    executionLease: { available: true },
    recordedAt: "2026-07-13T12:00:00.000Z",
  }),
}));

vi.mock("../services/api-rate-limit-fixture.service.js", () => ({
  runApiRateLimitFixture: vi.fn().mockResolvedValue({
    schemaVersion: "api-rate-limit-fixture-v1",
    instanceARequests: 60,
    instanceBRequests: 60,
    sharedAllowed: 100,
    sharedBlocked: 20,
    distributedExactLimit: true,
    independentIdentityAllowed: true,
    storedRows: 2,
    hashesValid: true,
    rawIdentityStored: false,
    retentionWorkers: 20,
    retentionInserted: 3,
    retentionDeleted: 3,
    retentionRemaining: 0,
    boundedRetention: true,
    containsIdentifiers: false,
    containsHashes: false,
    containsSecret: false,
    externalCalls: 0,
    cleanupRows: 0,
  }),
}));

vi.mock("../services/websocket-auth-ticket-fixture.service.js", () => ({
  runWebSocketAuthTicketFixture: vi.fn().mockResolvedValue({
    schemaVersion: "websocket-auth-ticket-fixture-v1",
    concurrentConsumers: 20,
    successfulConsumers: 1,
    blockedConsumers: 19,
    replayBlocked: true,
    wrongChannelBlocked: true,
    correctChannelAccepted: true,
    concurrentIssuers: 20,
    activeScopeRows: 1,
    acceptedSupersessionTickets: 1,
    supersededTicketsBlocked: 19,
    storedRowsObserved: 1,
    storedHashesValid: true,
    rawTicketStored: false,
    expiredInserted: 1,
    expiredRemaining: 0,
    cleanupRows: 0,
    accessTokenInUrl: false,
    containsTicket: false,
    containsHash: false,
    containsUserId: false,
    externalCalls: 0,
  }),
}));

vi.mock("../services/websocket-auth-ticket-retention-fixture.service.js", () => ({
  runWebSocketAuthTicketRetentionFixture: vi.fn().mockResolvedValue({
    schemaVersion: "websocket-auth-ticket-retention-fixture-v1",
    retentionWorkers: 20,
    lockWinners: 1,
    deletingWorkers: 1,
    expiredInserted: 3,
    expiredDeleted: 3,
    expiredRemaining: 0,
    activeInserted: 1,
    activePreserved: true,
    observedGlobalExpiredBefore: 3,
    cleanupDeleted: 1,
    cleanupRows: 0,
    containsTicket: false,
    containsHash: false,
    containsUserId: false,
    externalCalls: 0,
  }),
}));

vi.mock("../jobs/websocket-auth-ticket-retention.js", () => ({
  getWebSocketAuthTicketRetentionPolicyStatus: vi.fn(() => ({
    scheduled: false,
    intervalSeconds: 300,
    runOnStart: true,
    batchSize: 1000,
    singleton: "postgres_advisory_transaction_lock",
    skipLocked: true,
    containsTicket: false,
    containsHash: false,
    containsUserId: false,
  })),
  getWebSocketAuthTicketRetentionHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    activeCount: 0,
    expiredCount: 0,
    oldestExpiredAgeSeconds: null,
    recordedAt: "2026-07-14T12:00:00.000Z",
  }),
}));

vi.mock("../services/dispute-ai-audit-archive-fixture.service.js", () => ({
  runDisputeAiAuditArchiveFixture: vi.fn().mockResolvedValue({
    pass: true,
    checks: "1/1",
    enqueued: true,
    duplicate_idempotent: true,
    signature_valid: true,
    event_count: 1,
    delivered: true,
    receipt_match: true,
    archive_cleanup: 1,
    event_cleanup: 1,
  }),
}));

vi.mock("../services/dispute-evidence-provenance-fixture.service.js", () => ({
  runDisputeEvidenceProvenanceFixture: vi.fn().mockResolvedValue({
    pass: true,
    checks: "22/22",
    stored: true,
    trusted: true,
    artifact_tamper_blocked: true,
    source_swap_blocked: true,
    revoked_key_blocked: true,
    append_only_update_blocked: true,
    archive_enqueued: true,
    archive_duplicate_idempotent: true,
    archive_payload_immutable: true,
    receipt_mismatch_dead_lettered: true,
    archive_delivered: true,
    receipt_matched: true,
    archive_survived_evidence_delete: true,
    atomic_rollback_clean: true,
    failure_queue_detected: true,
    archive_requeued: true,
    requeue_audit_once: true,
    firing_alert_delivered: true,
    recovery_alert_delivered: true,
    receiver_replay_blocked: true,
    duplicate_recovery_blocked: true,
    cleanup: true,
    key_id: "test-key",
  }),
}));

vi.mock("../services/conditional-settlement-preflight-alert-fixture.service.js", () => ({
  runConditionalSettlementPreflightAlertFixture: vi.fn().mockResolvedValue({
    pass: true,
    checks: {
      firing_delivered: true,
      sender_duplicate_blocked: true,
      recovery_delivered: true,
      duplicate_recovery_blocked: true,
      signatures_valid: true,
      receiver_replay_blocked: true,
      payload_conflict_isolated: true,
      no_external_network: true,
    },
    deliveries: { firing: 3, recovery: 3 },
    receiver: { verified: 6, replay_blocked: 6, payload_conflict: true },
    retry: {
      failed: true,
      backoff_blocked: true,
      released: 1,
      delivered: true,
      attempt_count: 2,
      recovered: true,
    },
    concurrency: {
      requests: 20,
      firing: { delivered: 1, blocked: 19, fetchCalls: 1 },
      recovery: { delivered: 1, blocked: 19, fetchCalls: 1 },
    },
    cleanup: { deleted: 12, remaining: 0 },
  }),
}));

vi.mock("../services/conditional-settlement-finality-alert-fixture.service.js", () => ({
  runConditionalSettlementFinalityAlertFixture: vi.fn().mockResolvedValue({
    pass: true,
    checks: {
      critical_firing_delivered: true,
      duplicate_firing_blocked: true,
      recovery_delivered: true,
      duplicate_recovery_blocked: true,
      signatures_valid: true,
      aggregate_only: true,
      receiver_verified: true,
      receiver_replay_blocked: true,
      payload_conflict_isolated: true,
      receiver_concurrency_single_winner: true,
      stale_owner_fenced_and_recovered: true,
      receiver_failure_backoff_recovered: true,
      rotation_overlap_and_retirement: true,
      receiver_health_alert_firing_recovery: true,
      receiver_health_recovery_duplicate_blocked: true,
      receiver_health_alert_signatures_valid: true,
      receiver_health_alert_receiver_verified: true,
      receiver_health_alert_receiver_replay_blocked: true,
      receiver_health_alert_receiver_conflict_isolated: true,
      receiver_health_alert_receiver_concurrency_single_winner: true,
      receiver_health_alert_receiver_stale_owner_fenced: true,
    },
    deliveries: 2,
    receiver: { verified: 2, replayBlocked: 2, payloadConflict: true },
    concurrency: { requests: 20, winners: 1, blocked: 19, completed: true },
    takeover: { staleOwnerFenced: true, completed: true, attemptCount: 2 },
    retry: { backoffBlocked: true, released: 1, completed: true, attemptCount: 2 },
    rotation: {
      overlapAccepted: true,
      retiredSecretRejected: true,
      overlapSecretCount: 2,
      retiredSecretCount: 1,
    },
    receiverHealthAlert: {
      firing: "delivered",
      recovery: "recovered",
      duplicateRecovery: "recovery_already_sent_or_in_progress",
      deliveries: 2,
      receiverVerified: 2,
      receiverReplayBlocked: 2,
      receiverConflict: true,
      concurrency: { requests: 20, winners: 1, blocked: 19, completed: true },
      takeover: { staleOwnerFenced: true, completed: true, attemptCount: 2 },
    },
    firing: "delivered",
    duplicateFiring: "skipped",
    recovery: "recovered",
    duplicateRecovery: "skipped",
    cleanup: { deleted: 13 },
  }),
}));

vi.mock("../services/payment-test-operation-lease.service.js", () => ({
  PAYMENT_TEST_OPERATION_LEASE_SECONDS: 300,
  PAYMENT_TEST_OPERATION_HEARTBEAT_SECONDS: 100,
  acquireFinalityAlertFixtureLease: vi.fn().mockResolvedValue({
    key: "conditional-settlement-finality-alert-fixture",
    leaseId: "11111111-1111-4111-8111-111111111111",
    ownerId: "admin",
    expiresAt: new Date("2026-07-12T18:05:00.000Z"),
  }),
  releaseFinalityAlertFixtureLease: vi.fn().mockResolvedValue(true),
  runFinalityAlertFixtureLeaseVerification: vi.fn().mockResolvedValue({
    pass: true,
    firstAcquired: true,
    competitorBlocked: true,
    takeoverAcquired: true,
    heartbeatRenewed: true,
    originalExpiryTakeoverBlocked: true,
    oldOwnerFenced: true,
    newOwnerReleased: true,
    takeoverAfterSeconds: 541,
    cleanupRemaining: 0,
  }),
  startFinalityAlertFixtureLeaseHeartbeat: vi.fn(() => ({
    stop: vi.fn(),
    snapshot: vi.fn(() => ({ renewals: 0, failures: 0, lost: false })),
  })),
}));

vi.mock("../services/shipment-apv-payout-offset.service.js", () => ({
  getShipmentApvPayoutReservationHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    expiredReserved: 0,
    signedExpired: 0,
    unsignedExpired: 0,
    affectedSellers: 0,
    appliedOffsetMinor: 0,
    oldestExpiredAgeSeconds: null,
    recordedAt: "2026-07-12T00:00:00.000Z",
  }),
  listExpiredShipmentApvPayoutReservations: vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null, recordedAt: "2026-07-12T00:00:00.000Z" }),
}));

vi.mock("../services/shipment-apv-payout-cancellation.service.js", () => ({
  getShipmentApvPayoutCancellationApprovalHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    pendingRequests: 0,
    expiringSoonRequests: 0,
    oldestPendingAgeSeconds: null,
    recordedAt: "2026-07-12T00:00:00.000Z",
  }),
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ENV = {
  HAGGLE_X402_MODE: process.env.HAGGLE_X402_MODE,
  HAGGLE_X402_NETWORK: process.env.HAGGLE_X402_NETWORK,
  HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS: process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
  HAGGLE_ROUTER_RELAYER_PRIVATE_KEY: process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY,
  HAGGLE_X402_USDC_ASSET_ADDRESS: process.env.HAGGLE_X402_USDC_ASSET_ADDRESS,
  HAGGLE_X402_FEE_WALLET: process.env.HAGGLE_X402_FEE_WALLET,
  HAGGLE_BASE_RPC_URL: process.env.HAGGLE_BASE_RPC_URL,
  HAGGLE_ENV: process.env.HAGGLE_ENV,
  HAGGLE_ENABLE_PAYMENT_TEST_TOOLS: process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS,
  SUPABASE_URL: process.env.SUPABASE_URL,
  DISPUTE_EVIDENCE_SCANNER_URL: process.env.DISPUTE_EVIDENCE_SCANNER_URL,
  DISPUTE_EVIDENCE_SCANNER_TOKEN: process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN,
  DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP:
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP,
  DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK:
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK,
};
const mockCreatePublicClient = vi.mocked(createPublicClient);
const mockPrivateKeyToAccount = vi.mocked(privateKeyToAccount);

function makeDb(returningRow: Record<string, unknown>) {
  const values = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([returningRow]),
  });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    db: { insert } as unknown as Database,
    insert,
    values,
  };
}

function makeApp(
  db: Database,
  user: { id: string; role: string } | null = {
    id: "00000000-0000-4000-a000-000000000010",
    role: "authenticated",
  },
  requestLogError?: (...args: unknown[]) => void,
) {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    if (user) request.user = user;
    if (requestLogError) request.log.error = requestLogError as typeof request.log.error;
  });
  registerPaymentTestToolRoutes(app, db);
  return app;
}

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.clearAllMocks();
});

describe("payment test tool routes", () => {
  it("runs the PostgreSQL WebSocket ticket fixture through an admin route", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/websocket-ticket/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      test: "websocket_auth_ticket",
      policy: {
        transport: "sec-websocket-protocol",
        accessTokenInUrl: false,
        singleUse: true,
        containsTicket: false,
      },
      result: {
        successfulConsumers: 1,
        blockedConsumers: 19,
        replayBlocked: true,
        wrongChannelBlocked: true,
        expiredRemaining: 0,
        cleanupRows: 0,
      },
    });
    expect(runWebSocketAuthTicketFixture).toHaveBeenCalledOnce();
    await app.close();
  });

  it("protects and redacts the WebSocket ticket fixture", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS;
    const { db } = makeDb({});
    const denied = makeApp(db);
    expect(
      (
        await denied.inject({
          method: "POST",
          url: "/tools/payment-test/websocket-ticket/evaluate",
        })
      ).statusCode,
    ).toBe(403);
    await denied.close();

    process.env.NODE_ENV = "test";
    vi.mocked(runWebSocketAuthTicketFixture).mockRejectedValueOnce(
      new Error("ticket.secret-user-hash"),
    );
    const errors = vi.fn();
    const admin = makeApp(
      db,
      {
        id: "99999999-9999-4999-8999-999999999999",
        role: "admin",
      },
      errors,
    );
    const failed = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/websocket-ticket/evaluate",
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.headers["cache-control"]).toBe("no-store");
    expect(failed.body).not.toContain("secret-user-hash");
    expect(errors).toHaveBeenCalled();
    await admin.close();
  });

  it("runs and reports the bounded WebSocket ticket retention fixture", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/websocket-ticket-retention/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      test: "websocket_auth_ticket_retention",
      policy: {
        intervalSeconds: 300,
        runOnStart: true,
        batchSize: 1000,
        singleton: "postgres_advisory_transaction_lock",
        containsTicket: false,
      },
      result: {
        retentionWorkers: 20,
        deletingWorkers: 1,
        expiredDeleted: 3,
        expiredRemaining: 0,
        activePreserved: true,
        cleanupRows: 0,
        containsTicket: false,
        externalCalls: 0,
      },
    });
    expect(runWebSocketAuthTicketRetentionFixture).toHaveBeenCalledOnce();

    const health = await app.inject({
      method: "GET",
      url: "/tools/payment-test/websocket-ticket-retention/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(health.json()).toMatchObject({
      websocket_ticket_retention: {
        policy: { intervalSeconds: 300, containsHash: false },
        health: { status: "healthy", expiredCount: 0, oldestExpiredAgeSeconds: null },
      },
    });
    expect(getWebSocketAuthTicketRetentionHealth).toHaveBeenCalledWith(db);
    await app.close();
  });

  it("protects and redacts WebSocket ticket retention operations", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS;
    const { db } = makeDb({});
    const denied = makeApp(db);
    for (const request of [
      { method: "POST" as const, url: "/tools/payment-test/websocket-ticket-retention/evaluate" },
      { method: "GET" as const, url: "/tools/payment-test/websocket-ticket-retention/health" },
    ]) {
      expect((await denied.inject(request)).statusCode).toBe(403);
    }
    await denied.close();

    process.env.NODE_ENV = "test";
    vi.mocked(runWebSocketAuthTicketRetentionFixture).mockRejectedValueOnce(
      new Error("postgres://ticket-secret@db.internal/hash"),
    );
    vi.mocked(getWebSocketAuthTicketRetentionHealth).mockRejectedValueOnce(
      new Error("postgres://health-secret@db.internal/hash"),
    );
    const errors = vi.fn();
    const admin = makeApp(
      db,
      {
        id: "99999999-9999-4999-8999-999999999999",
        role: "admin",
      },
      errors,
    );
    const fixtureFailure = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/websocket-ticket-retention/evaluate",
    });
    const healthFailure = await admin.inject({
      method: "GET",
      url: "/tools/payment-test/websocket-ticket-retention/health",
    });
    expect(fixtureFailure.statusCode).toBe(503);
    expect(healthFailure.statusCode).toBe(503);
    expect(`${fixtureFailure.body}${healthFailure.body}`).not.toMatch(
      /ticket-secret|health-secret|db\.internal/,
    );
    expect(errors).toHaveBeenCalledTimes(2);
    await admin.close();
  });

  it("runs the distributed API rate-limit fixture through an admin route", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/api-rate-limit/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      test: "api_rate_limit",
      result: {
        distributedExactLimit: true,
        sharedAllowed: 100,
        sharedBlocked: 20,
        boundedRetention: true,
        cleanupRows: 0,
        containsIdentifiers: false,
        containsHashes: false,
        containsSecret: false,
      },
    });
    expect(runApiRateLimitFixture).toHaveBeenCalledOnce();
    await app.close();
  });

  it("protects and redacts the distributed API rate-limit fixture", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS;
    const { db } = makeDb({});
    const denied = makeApp(db);
    expect(
      (await denied.inject({ method: "POST", url: "/tools/payment-test/api-rate-limit/evaluate" }))
        .statusCode,
    ).toBe(403);
    await denied.close();

    process.env.NODE_ENV = "test";
    vi.mocked(runApiRateLimitFixture).mockRejectedValueOnce(
      new Error("postgresql://secret-host/raw-ip"),
    );
    const errors = vi.fn();
    const admin = makeApp(
      db,
      {
        id: "99999999-9999-4999-8999-999999999999",
        role: "admin",
      },
      errors,
    );
    const failed = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/api-rate-limit/evaluate",
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.headers["cache-control"]).toBe("no-store");
    expect(failed.body).not.toContain("secret-host");
    expect(failed.body).not.toContain("raw-ip");
    expect(errors).toHaveBeenCalled();
    await admin.close();
  });

  it("reports no-secret evidence scanner readiness for an admin", async () => {
    process.env.NODE_ENV = "test";
    for (const key of [
      "DISPUTE_EVIDENCE_SCANNER_URL",
      "DISPUTE_EVIDENCE_SCANNER_TOKEN",
      "DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP",
      "DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK",
    ])
      delete process.env[key];
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });

    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/dispute-evidence-scanner/readiness",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      dispute_evidence_scanner_readiness: {
        schemaVersion: "dispute-evidence-scanner-readiness-v1",
        configurationState: "not_configured",
        configured: false,
        authenticated: false,
        network: { privateNetworkBlocked: true, redirectsBlocked: true },
        containsUrl: false,
        containsToken: false,
      },
    });
  });

  it("runs the evidence scanner security fixture through the actual API", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });

    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-evidence-scanner/evaluate",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      test: "dispute_evidence_scanner_security",
      result: {
        status: "pass",
        totals: { passed: 18, total: 18 },
        boundary: {
          haggleApiExecuted: true,
          scannerResponse: "INJECTED_FIXTURE",
          realNetworkCalled: false,
          databaseChanged: false,
        },
        containsUrl: false,
        containsToken: false,
      },
    });
    expect(JSON.stringify(response.json())).not.toContain("scanner-secret");
    expect(JSON.stringify(response.json())).not.toContain("fixture.invalid");
  });

  it("protects evidence scanner readiness and fixture routes", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS;
    const { db } = makeDb({});
    const app = makeApp(db);

    const [readiness, fixture] = await Promise.all([
      app.inject({ method: "GET", url: "/tools/payment-test/dispute-evidence-scanner/readiness" }),
      app.inject({ method: "POST", url: "/tools/payment-test/dispute-evidence-scanner/evaluate" }),
    ]);
    expect(readiness.statusCode).toBe(403);
    expect(fixture.statusCode).toBe(403);
  });

  it("returns identifier-free evidence scan retry health", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/dispute-evidence-scan-retry/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      dispute_evidence_scan_retry_health: {
        schemaVersion: "dispute-evidence-scan-retry-health-v1",
        status: "healthy",
        totals: { retryReady: 0, exhausted: 0, staleProcessing: 0 },
        containsIdentifiers: false,
        containsStoragePaths: false,
        containsLeaseTokens: false,
      },
      dispute_evidence_scanner_circuit_health: {
        schemaVersion: "dispute-evidence-scanner-circuit-health-v1",
        status: "healthy",
        state: "CLOSED",
        consecutiveFailures: 0,
        activePermits: 0,
        containsPermitTokens: false,
        containsCircuitKey: false,
      },
      dispute_evidence_scan_retry_alerting: {
        schemaVersion: "dispute-evidence-scan-retry-alerting-v9",
        policy: {
          configurationState: "not_configured",
          jobEnabled: false,
          retentionBlockedThreshold: 1,
        },
        delivery: { incidentOpen: false },
        sender: {
          health: {
            status: "healthy",
            failed: 0,
            retryReady: 0,
            staleProcessing: 0,
            snapshotCount: 0,
            retryableSnapshots: 0,
            orphanedSnapshots: 0,
            missingRetrySnapshots: 0,
            bindingViolations: 0,
            containsIdentifiers: false,
          },
          retention: {
            status: "healthy",
            eligibleExpired: 0,
            blockedExpired: 0,
            containsIdentifiers: false,
            policy: { retentionDays: 30, batchSize: 100 },
            job: {
              status: "inactive",
              lastRunStatus: "NEVER",
              overdue: false,
              leaseStale: false,
              lastDeletedSnapshots: 0,
              containsIdentifiers: false,
            },
          },
        },
        receiver: {
          endpoint: {
            method: "POST",
            path: "/internal/ops/alerts/dispute-evidence-scan-retry",
            rawBodyRequired: true,
            contentType: "application/json",
            maxBodyBytes: 16_384,
            hmacSha256: true,
            freshnessSeconds: 300,
            replayProtected: true,
            globalRateLimited: true,
            clientIpSource: "fastify_request_ip",
            trustedProxy: {
              configured: false,
              trustedRangeCount: 0,
              maxTrustedRangeCount: 32,
              containsAddresses: false,
            },
            rateLimit: {
              mode: "local",
              distributed: false,
              storage: "process_memory",
              algorithm: "sliding_window",
              keyProtection: "memory_only",
              maxRequests: 100,
              windowSeconds: 60,
              failClosedOnStoreError: false,
              healthExempt: true,
              retention: {
                scheduled: false,
                intervalSeconds: 3600,
                retentionHours: 24,
                batchSize: 1000,
                runOnStart: true,
              },
              containsSecret: false,
              containsIdentifiers: false,
            },
            healthPath: "/admin/ops/alerts/dispute-evidence-scan-retry/health",
            healthAdminOnly: true,
          },
          policy: { configurationState: "not_configured" },
          health: { status: "healthy", containsIdentifiers: false },
        },
        containsUrl: false,
        containsSecrets: false,
        containsIdentifiers: false,
      },
    });
    expect(getDisputeEvidenceScanRetryHealth).toHaveBeenCalledOnce();
    expect(getDisputeEvidenceScannerCircuitHealth).toHaveBeenCalledOnce();
    expect(getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth).toHaveBeenCalledOnce();
    await app.close();
  });

  it("runs the distributed evidence scan retry fixture through the API", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-evidence-scan-retry/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      test: "dispute_evidence_scan_retry",
      result: {
        schemaVersion: "dispute-evidence-scan-retry-fixture-v1",
        status: "pass",
        totals: { passed: 14, total: 14 },
        circuit: {
          schemaVersion: "dispute-evidence-scanner-circuit-fixture-v1",
          status: "pass",
          totals: { passed: 8, total: 8 },
        },
        execution: {
          concurrentWorkers: 20,
          claimed: 4,
          realNetworkCalled: false,
          realStorageRead: false,
          databaseChanged: true,
        },
        cleanup: { rows: 4, succeeded: true },
        containsIdentifiers: false,
        containsStoragePaths: false,
        containsLeaseTokens: false,
      },
    });
    expect(runDisputeEvidenceScanRetryFixture).toHaveBeenCalledOnce();
    await app.close();
  });

  it("redacts evidence scan retry health and fixture failures", async () => {
    process.env.NODE_ENV = "test";
    vi.mocked(getDisputeEvidenceScanRetryHealth).mockRejectedValueOnce(
      new Error("postgres://secret-host/private-table"),
    );
    vi.mocked(runDisputeEvidenceScanRetryFixture).mockRejectedValueOnce(
      new Error("scanner-token=secret-value"),
    );
    vi.mocked(runDisputeEvidenceScanRetryAlertFixture).mockRejectedValueOnce(
      new Error("alert-secret=private-value"),
    );
    vi.mocked(runDisputeEvidenceScanRetryAlertSnapshotRetentionFixture).mockRejectedValueOnce(
      new Error("retention-row=private-value"),
    );
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });
    const [health, fixture, alertFixture, retentionFixture] = await Promise.all([
      app.inject({ method: "GET", url: "/tools/payment-test/dispute-evidence-scan-retry/health" }),
      app.inject({
        method: "POST",
        url: "/tools/payment-test/dispute-evidence-scan-retry/evaluate",
      }),
      app.inject({
        method: "POST",
        url: "/tools/payment-test/dispute-evidence-scan-retry-alert/evaluate",
      }),
      app.inject({
        method: "POST",
        url: "/tools/payment-test/dispute-evidence-scan-retry-alert-snapshot-retention/evaluate",
      }),
    ]);
    expect(health.statusCode).toBe(503);
    expect(health.body).toBe(
      JSON.stringify({
        error: "DISPUTE_EVIDENCE_SCAN_RETRY_HEALTH_UNAVAILABLE",
      }),
    );
    expect(fixture.statusCode).toBe(503);
    expect(fixture.body).toBe(
      JSON.stringify({
        error: "DISPUTE_EVIDENCE_SCAN_RETRY_FIXTURE_FAILED",
      }),
    );
    expect(alertFixture.statusCode).toBe(503);
    expect(alertFixture.body).toBe(
      JSON.stringify({
        error: "DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_FIXTURE_FAILED",
      }),
    );
    expect(retentionFixture.statusCode).toBe(503);
    expect(retentionFixture.body).toBe(
      JSON.stringify({
        error: "DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_RETENTION_FIXTURE_FAILED",
      }),
    );
    expect(
      `${health.body}${fixture.body}${alertFixture.body}${retentionFixture.body}`,
    ).not.toContain("private-value");
    await app.close();
  });

  it("runs the signed evidence scan retry alert fixture through the API", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-evidence-scan-retry-alert/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      test: "dispute_evidence_scan_retry_alert",
      result: {
        schemaVersion: "dispute-evidence-scan-retry-alert-fixture-v1",
        status: "pass",
        totals: { passed: 31, total: 31 },
        execution: {
          concurrentSenders: 20,
          incidentDeliveries: 1,
          senderDuplicatesSuppressed: 19,
          concurrentReceivers: 20,
          receiverWinners: 1,
          receiverReplaysBlocked: 20,
          recoveryDeliveries: 1,
          retentionDeliveries: 1,
          failedDeliveryAttempts: 1,
          senderBackoffBlocks: 1,
          senderRetryAttemptCount: 2,
          retryCrossedCooldownBucket: true,
          immutableSnapshots: 2,
          lostResponseReceiverAccepted: 1,
          staleSenderClaims: 1,
          staleSenderReclaims: 1,
          circuitFailures: 3,
          circuitProbes: 1,
          outboundAttempts: 4,
          realNetworkCalled: false,
          databaseChanged: true,
        },
        cleanup: {
          circuitRows: 1,
          senderClaims: 3,
          receiverClaims: 3,
          snapshots: 2,
          succeeded: true,
        },
        containsIdentifiers: false,
        containsStoragePaths: false,
        containsLeaseTokens: false,
        containsSecrets: false,
      },
    });
    expect(runDisputeEvidenceScanRetryAlertFixture).toHaveBeenCalledOnce();
    await app.close();
  });

  it("runs completed-only alert snapshot retention through the API", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "99999999-9999-4999-8999-999999999999",
      role: "admin",
    });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-evidence-scan-retry-alert-snapshot-retention/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      test: "dispute_evidence_scan_retry_alert_snapshot_retention",
      result: {
        status: "pass",
        totals: { passed: 13, total: 13 },
        execution: {
          concurrentWorkers: 20,
          lockWinners: 1,
          lockBlocked: 19,
          deletedCompletedSnapshots: 1,
          preservedFailedSnapshots: 1,
          preservedOrphanSnapshots: 1,
          persistentJobRuns: 1,
          staleLeaseReclaims: 1,
          staleOwnerCompletions: 0,
          externalCalls: 0,
        },
        cleanup: { snapshots: 2, claims: 2, jobStateRestored: true, succeeded: true },
        containsIdentifiers: false,
      },
    });
    expect(runDisputeEvidenceScanRetryAlertSnapshotRetentionFixture).toHaveBeenCalledOnce();
    await app.close();
  });

  it("protects evidence scan retry health and fixture routes", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS;
    const { db } = makeDb({});
    const app = makeApp(db);
    const [health, fixture, alertFixture, retentionFixture] = await Promise.all([
      app.inject({ method: "GET", url: "/tools/payment-test/dispute-evidence-scan-retry/health" }),
      app.inject({
        method: "POST",
        url: "/tools/payment-test/dispute-evidence-scan-retry/evaluate",
      }),
      app.inject({
        method: "POST",
        url: "/tools/payment-test/dispute-evidence-scan-retry-alert/evaluate",
      }),
      app.inject({
        method: "POST",
        url: "/tools/payment-test/dispute-evidence-scan-retry-alert-snapshot-retention/evaluate",
      }),
    ]);
    expect(health.statusCode).toBe(403);
    expect(fixture.statusCode).toBe(403);
    expect(alertFixture.statusCode).toBe(403);
    expect(retentionFixture.statusCode).toBe(403);
    await app.close();
  });

  it("runs and protects the conditional settlement finality alert fixture", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/finality-alert/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      test: "conditional_settlement_finality_alert",
      result: {
        pass: true,
        deliveries: 2,
        checks: {
          critical_firing_delivered: true,
          duplicate_firing_blocked: true,
          recovery_delivered: true,
          duplicate_recovery_blocked: true,
          signatures_valid: true,
          aggregate_only: true,
          receiver_verified: true,
          receiver_replay_blocked: true,
          payload_conflict_isolated: true,
          receiver_concurrency_single_winner: true,
          stale_owner_fenced_and_recovered: true,
          receiver_failure_backoff_recovered: true,
          rotation_overlap_and_retirement: true,
          receiver_health_alert_firing_recovery: true,
          receiver_health_recovery_duplicate_blocked: true,
          receiver_health_alert_signatures_valid: true,
          receiver_health_alert_receiver_verified: true,
          receiver_health_alert_receiver_replay_blocked: true,
          receiver_health_alert_receiver_conflict_isolated: true,
          receiver_health_alert_receiver_concurrency_single_winner: true,
          receiver_health_alert_receiver_stale_owner_fenced: true,
        },
        receiver: { verified: 2, replayBlocked: 2, payloadConflict: true },
        concurrency: { requests: 20, winners: 1, blocked: 19, completed: true },
        takeover: { staleOwnerFenced: true, completed: true, attemptCount: 2 },
        retry: { backoffBlocked: true, released: 1, completed: true, attemptCount: 2 },
        rotation: {
          overlapAccepted: true,
          retiredSecretRejected: true,
          overlapSecretCount: 2,
          retiredSecretCount: 1,
        },
        receiverHealthAlert: {
          firing: "delivered",
          recovery: "recovered",
          duplicateRecovery: "recovery_already_sent_or_in_progress",
          deliveries: 2,
          receiverVerified: 2,
          receiverReplayBlocked: 2,
          receiverConflict: true,
          concurrency: { requests: 20, winners: 1, blocked: 19, completed: true },
          takeover: { staleOwnerFenced: true, completed: true, attemptCount: 2 },
        },
      },
    });
    expect(runConditionalSettlementFinalityAlertFixture).toHaveBeenCalledOnce();
    expect(acquireFinalityAlertFixtureLease).toHaveBeenCalledOnce();
    expect(runFinalityAlertFixtureLeaseVerification).toHaveBeenCalledOnce();
    expect(startFinalityAlertFixtureLeaseHeartbeat).toHaveBeenCalledOnce();
    expect(releaseFinalityAlertFixtureLease).toHaveBeenCalledOnce();
    await admin.close();
    vi.clearAllMocks();
    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/conditional-settlement/finality-alert/evaluate",
        })
      ).statusCode,
    ).toBe(403);
    expect(runConditionalSettlementFinalityAlertFixture).not.toHaveBeenCalled();
    await user.close();
  });

  it("returns a redacted finality alert fixture failure stage", async () => {
    vi.mocked(runConditionalSettlementFinalityAlertFixture).mockRejectedValueOnce(
      Object.assign(new Error("postgres://secret:password@db.internal"), {
        code: "FINALITY_ALERT_FIXTURE_FAILED",
        stage: "health_receiver_burst",
        diagnostics: {
          stages: [{ name: "sender_lifecycle", durationMs: 2 }],
          totalMs: 3,
          slowestStage: "sender_lifecycle",
          slowestStageMs: 2,
          failureStage: "health_receiver_burst",
        },
      }),
    );
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/finality-alert/evaluate",
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      test: "conditional_settlement_finality_alert",
      result: {
        pass: false,
        error: { code: "FINALITY_ALERT_FIXTURE_FAILED", stage: "health_receiver_burst" },
        diagnostics: { failureStage: "health_receiver_burst" },
      },
    });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("password");
    expect(response.body).not.toContain("db.internal");
    await admin.close();
  });

  it("rejects a concurrent finality alert fixture before it starts", async () => {
    vi.mocked(acquireFinalityAlertFixtureLease).mockResolvedValueOnce(null);
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/finality-alert/evaluate",
    });
    expect(response.statusCode).toBe(409);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.json()).toEqual({
      error: "FINALITY_ALERT_FIXTURE_ALREADY_RUNNING",
      retry_after_seconds: 5,
    });
    expect(runConditionalSettlementFinalityAlertFixture).not.toHaveBeenCalled();
    expect(releaseFinalityAlertFixtureLease).not.toHaveBeenCalled();
    await admin.close();
  });

  it("does not report fixture success when the global lease cannot be released", async () => {
    vi.mocked(releaseFinalityAlertFixtureLease).mockResolvedValueOnce(false);
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/finality-alert/evaluate",
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "FINALITY_ALERT_FIXTURE_LEASE_RELEASE_FAILED" });
    expect(runConditionalSettlementFinalityAlertFixture).toHaveBeenCalledOnce();
    await admin.close();
  });

  it("does not report fixture success after heartbeat detects lease loss", async () => {
    vi.mocked(startFinalityAlertFixtureLeaseHeartbeat).mockReturnValueOnce({
      stop: vi.fn(),
      snapshot: vi.fn(() => ({ renewals: 0, failures: 0, lost: true })),
    });
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/finality-alert/evaluate",
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "FINALITY_ALERT_FIXTURE_LEASE_LOST" });
    expect(releaseFinalityAlertFixtureLease).toHaveBeenCalledOnce();
    await admin.close();
  });

  it("returns privacy-bounded conditional settlement finality health to admins only", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        total: "3",
        pending: "1",
        unavailable: "2",
        orphaned_receipts: "1",
        rpc_unavailable: "1",
        configuration_blocked: "0",
        overdue_pending: "0",
        oldest_pending_age_seconds: "45",
      },
    ]);
    const db = { execute } as unknown as Database;
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "GET",
      url: "/admin/payments/conditional-settlement/finality-health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      conditional_settlement_finality_health: {
        status: "critical",
        total: 3,
        pending: 1,
        unavailable: 2,
        orphanedReceipts: 1,
        rpcUnavailable: 1,
        overduePending: 0,
        oldestPendingAgeSeconds: 45,
      },
      conditional_settlement_finality_alert_receiver: {
        configured: false,
        status: "healthy",
        processing: 0,
      },
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /payment_intent|order_id|tx_hash|block_hash/i,
    );
    await admin.close();
    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "GET",
          url: "/admin/payments/conditional-settlement/finality-health",
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("runs and protects the conditional settlement preflight alert fixture", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/onchain-preflight-alert/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      test: "conditional_settlement_preflight_alert",
      result: {
        pass: true,
        deliveries: { firing: 3, recovery: 3 },
        receiver: { verified: 6, replay_blocked: 6, payload_conflict: true },
        retry: {
          failed: true,
          backoff_blocked: true,
          delivered: true,
          attempt_count: 2,
          recovered: true,
        },
        concurrency: {
          requests: 20,
          firing: { delivered: 1, blocked: 19, fetchCalls: 1 },
          recovery: { delivered: 1, blocked: 19, fetchCalls: 1 },
        },
        cleanup: { deleted: 12, remaining: 0 },
      },
    });
    expect(runConditionalSettlementPreflightAlertFixture).toHaveBeenCalledOnce();
    await admin.close();
    vi.clearAllMocks();
    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/onchain-preflight-alert/evaluate",
        })
      ).statusCode,
    ).toBe(403);
    expect(runConditionalSettlementPreflightAlertFixture).not.toHaveBeenCalled();
    await user.close();
  });
  it("runs and protects the conditional settlement finality fixture", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/finality/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      test: "conditional_settlement_finality",
      result: {
        pass: true,
        policy: { default_confirmations: 2 },
        checks: {
          one_block_short_pending: true,
          exact_threshold_confirmed: true,
          head_behind_fail_closed: true,
          rpc_failure_redacted: true,
          missing_receipt_block_fail_closed: true,
          invalid_policy_fail_closed: true,
        },
      },
    });
    await admin.close();
    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/conditional-settlement/finality/evaluate",
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });
  it("runs isolated shipment APV fairness chaos for admins", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({ method: "POST", url: "/tools/payment-test/shipping-apv/chaos" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toMatchObject({
      test: "shipment_apv_chaos",
      result: {
        pass: true,
        overBuffer: { status: "REVIEW_REQUIRED", seller_liability_minor: 250 },
        credit: { status: "CREDIT_RECORDED", carrier_credit_minor: 100 },
        concurrent: { acquired: 1, blocked: 19 },
        cleanup: { succeeded: true },
      },
    });
    expect(runShipmentApvChaos).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns a bounded redacted rollback verification failure stage", async () => {
    vi.mocked(runShipmentApvChaos).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_VERIFICATION_FAILED"),
    );
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({ method: "POST", url: "/tools/payment-test/shipping-apv/chaos" });
    expect(res.statusCode).toBe(500);
    expect(res.headers["cache-control"]).toBe("no-store");
    const verification = res.json();
    expect(verification).toMatchObject({
      test: "shipment_apv_chaos",
      result: {
        pass: false,
        error: { code: "SHIPMENT_APV_CHAOS_FAILED", stage: "rollback_verification" },
      },
    });
    expect(verification.result.error.failure_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(res.headers["x-haggle-failure-id"]).toBe(verification.result.error.failure_id);
    expect(recordShipmentApvChaosFailure).toHaveBeenLastCalledWith(db, {
      stage: "rollback_verification",
    });
    vi.mocked(runShipmentApvChaos).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_FAILURE_ISOLATION_FAILED"),
    );
    const isolation = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/chaos",
    });
    expect(isolation.statusCode).toBe(500);
    const isolationBody = isolation.json();
    expect(isolationBody).toMatchObject({
      test: "shipment_apv_chaos",
      result: {
        pass: false,
        error: { code: "SHIPMENT_APV_CHAOS_FAILED", stage: "rollback_failure_isolation" },
      },
    });
    expect(isolation.headers["x-haggle-failure-id"]).toBe(isolationBody.result.error.failure_id);
    expect(isolationBody.result.error.failure_id).not.toBe(verification.result.error.failure_id);
    expect(recordShipmentApvChaosFailure).toHaveBeenLastCalledWith(db, {
      stage: "rollback_failure_isolation",
    });
    await app.close();
  });

  it("redacts unexpected shipment APV fixture errors to the generic bounded stage", async () => {
    vi.mocked(runShipmentApvChaos).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/private-table"),
    );
    vi.mocked(recordShipmentApvChaosFailure).mockRejectedValueOnce(
      new Error("postgres://metric-secret:password@db.internal/private-metric"),
    );
    const { db } = makeDb({});
    const logError = vi.fn();
    const app = makeApp(
      db,
      { id: "99999999-9999-4999-8999-999999999999", role: "admin" },
      logError,
    );
    const res = await app.inject({ method: "POST", url: "/tools/payment-test/shipping-apv/chaos" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).toMatchObject({
      test: "shipment_apv_chaos",
      result: {
        pass: false,
        error: { code: "SHIPMENT_APV_CHAOS_FAILED", stage: "fixture_execution" },
      },
    });
    expect(res.headers["x-haggle-failure-id"]).toBe(body.result.error.failure_id);
    expect(res.body).not.toMatch(/secret|password|db\.internal|private-table/);
    expect(logError).toHaveBeenCalledWith(
      {
        event: "shipment_apv_chaos_failed",
        failure_id: body.result.error.failure_id,
        stage: "fixture_execution",
        metric_recorded: false,
      },
      "Shipment APV chaos fixture failed",
    );
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(
      /secret|password|db\.internal|private-table|private-metric/,
    );
    await app.close();
  });

  it("returns bounded shipment APV failure health only to enabled admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_health: {
        status: "healthy",
        windowHours: 24,
        retentionDays: 30,
        total: 0,
      },
    });
    expect(getShipmentApvChaosFailureHealth).toHaveBeenCalledWith(db);
    await admin.close();

    const user = makeApp(db);
    expect(
      (await user.inject({ method: "GET", url: "/tools/payment-test/shipping-apv/failure-health" }))
        .statusCode,
    ).toBe(403);
    await user.close();
  });

  it("redacts shipment APV failure health storage errors", async () => {
    vi.mocked(getShipmentApvChaosFailureHealth).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/private-metric"),
    );
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-health",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SHIPMENT_APV_FAILURE_HEALTH_UNAVAILABLE" });
    expect(response.body).not.toMatch(/secret|password|db\.internal|private-metric/);
    await app.close();
  });

  it("returns a preview-only APV escalation decision only to enabled admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-preview",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_preview: {
        mode: "preview_only",
        action: "none",
        delivery: { enabled: false, attempted: false },
        approval: { required: false },
        stateFingerprint: "b".repeat(64),
      },
    });
    expect(getShipmentApvChaosFailureAlertPreview).toHaveBeenCalledWith(db);
    await admin.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "GET",
          url: "/tools/payment-test/shipping-apv/failure-alert-preview",
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("redacts APV escalation preview storage errors", async () => {
    vi.mocked(getShipmentApvChaosFailureAlertPreview).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/private-preview"),
    );
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-preview",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SHIPMENT_APV_FAILURE_ALERT_PREVIEW_UNAVAILABLE" });
    expect(response.body).not.toMatch(/secret|password|db\.internal|private-preview/);
    await app.close();
  });

  it("creates a state-bound APV alert approval request only for an enabled admin", async () => {
    const { db } = makeDb({});
    const adminId = "99999999-9999-4999-8999-999999999999";
    const admin = makeApp(db, { id: adminId, role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests",
      payload: {
        client_request_id: "88888888-8888-4888-8888-888888888888",
        state_fingerprint: "b".repeat(64),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_approval_request: {
        status: "PENDING",
        action: "review_warning",
        replayed: false,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(createShipmentApvFailureAlertApprovalRequest).toHaveBeenCalledWith(db, {
      clientRequestId: "88888888-8888-4888-8888-888888888888",
      stateFingerprint: "b".repeat(64),
      requestedBy: adminId,
    });
    await admin.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests",
          payload: {
            client_request_id: "88888888-8888-4888-8888-888888888888",
            state_fingerprint: "b".repeat(64),
          },
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates and bounds APV alert approval request conflicts and storage errors", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests",
          payload: { client_request_id: "bad", state_fingerprint: "secret" },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(createShipmentApvFailureAlertApprovalRequest).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED"),
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests",
      payload: {
        client_request_id: "88888888-8888-4888-8888-888888888888",
        state_fingerprint: "b".repeat(64),
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED" });
    vi.mocked(createShipmentApvFailureAlertApprovalRequest).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/private-approval"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests",
      payload: {
        client_request_id: "88888888-8888-4888-8888-888888888888",
        state_fingerprint: "b".repeat(64),
      },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REQUEST_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|private-approval/);
    await app.close();
  });

  it("records a non-executable APV alert checker decision only for a different admin", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const app = makeApp(db, { id: checkerId, role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests/77777777-7777-4777-8777-777777777777/decisions",
      payload: { client_decision_id: "55555555-5555-4555-8555-555555555555", decision: "APPROVED" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_approval_decision: {
        decision: "APPROVED",
        makerCheckerSeparated: true,
        executable: false,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(decideShipmentApvFailureAlertApprovalRequest).toHaveBeenCalledWith(db, {
      approvalRequestId: "77777777-7777-4777-8777-777777777777",
      clientDecisionId: "55555555-5555-4555-8555-555555555555",
      decision: "APPROVED",
      decidedBy: checkerId,
    });
    await app.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests/77777777-7777-4777-8777-777777777777/decisions",
          payload: {
            client_decision_id: "55555555-5555-4555-8555-555555555555",
            decision: "APPROVED",
          },
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates and bounds APV alert checker conflicts and storage errors", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests/bad/decisions",
          payload: { client_decision_id: "bad", decision: "secret" },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(decideShipmentApvFailureAlertApprovalRequest).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_MAKER_CHECKER_REQUIRED"),
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests/77777777-7777-4777-8777-777777777777/decisions",
      payload: { client_decision_id: "55555555-5555-4555-8555-555555555555", decision: "APPROVED" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_MAKER_CHECKER_REQUIRED",
    });
    vi.mocked(decideShipmentApvFailureAlertApprovalRequest).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/private-decision"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-requests/77777777-7777-4777-8777-777777777777/decisions",
      payload: { client_decision_id: "55555555-5555-4555-8555-555555555555", decision: "REJECTED" },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_DECISION_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|private-decision/);
    await app.close();
  });

  it("creates an APV alert dry-run grant only for the approved checker admin", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const app = makeApp(db, { id: checkerId, role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-decisions/44444444-4444-4444-8444-444444444444/delivery-grants",
      payload: { client_grant_id: "33333333-3333-4333-8333-333333333333" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_delivery_grant: {
        status: "GRANTED_DRY_RUN",
        dryRun: true,
        payloadPrepared: false,
        signatureCreated: false,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(createShipmentApvFailureAlertDeliveryGrant).toHaveBeenCalledWith(db, {
      approvalDecisionId: "44444444-4444-4444-8444-444444444444",
      clientGrantId: "33333333-3333-4333-8333-333333333333",
      grantedBy: checkerId,
    });
    await app.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-approval-decisions/44444444-4444-4444-8444-444444444444/delivery-grants",
          payload: { client_grant_id: "33333333-3333-4333-8333-333333333333" },
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates and bounds APV alert grant conflicts and storage errors", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-approval-decisions/bad/delivery-grants",
          payload: { client_grant_id: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(createShipmentApvFailureAlertDeliveryGrant).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_ACTIVE"),
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-decisions/44444444-4444-4444-8444-444444444444/delivery-grants",
      payload: { client_grant_id: "33333333-3333-4333-8333-333333333333" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_ACTIVE" });
    vi.mocked(createShipmentApvFailureAlertDeliveryGrant).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/private-grant"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-approval-decisions/44444444-4444-4444-8444-444444444444/delivery-grants",
      payload: { client_grant_id: "33333333-3333-4333-8333-333333333333" },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_DELIVERY_GRANT_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|private-grant/);
    await app.close();
  });

  it("creates an unsigned APV alert payload outbox only for the grant checker", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const app = makeApp(db, { id: checkerId, role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-delivery-grants/22222222-2222-4222-8222-222222222222/payload-outbox",
      payload: { client_outbox_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_payload_outbox: {
        status: "UNSIGNED_DRY_RUN",
        signed: false,
        signature: null,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(createShipmentApvFailureAlertPayloadOutbox).toHaveBeenCalledWith(db, {
      deliveryGrantId: "22222222-2222-4222-8222-222222222222",
      clientOutboxId: "11111111-1111-4111-8111-111111111111",
      createdBy: checkerId,
    });
    await app.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-delivery-grants/22222222-2222-4222-8222-222222222222/payload-outbox",
          payload: { client_outbox_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates and bounds APV alert payload conflicts and storage errors", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-delivery-grants/bad/payload-outbox",
          payload: { client_outbox_id: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(createShipmentApvFailureAlertPayloadOutbox).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED"),
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-delivery-grants/22222222-2222-4222-8222-222222222222/payload-outbox",
      payload: { client_outbox_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED" });
    vi.mocked(createShipmentApvFailureAlertPayloadOutbox).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/private-payload"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-delivery-grants/22222222-2222-4222-8222-222222222222/payload-outbox",
      payload: { client_outbox_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_OUTBOX_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|private-payload/);
    await app.close();
  });

  it("creates a verified non-delivering APV alert signature receipt", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const app = makeApp(db, { id: checkerId, role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-payload-outbox/33333333-3333-4333-8333-333333333333/signatures",
      payload: { client_signature_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_payload_signature: {
        status: "SIGNED_DRY_RUN",
        algorithm: "Ed25519",
        signatureVerified: true,
        keyManagement: "EPHEMERAL_PROCESS_TEST_KEY",
        trustAnchored: false,
        registryBound: true,
        registryStatusAtSigning: "ACTIVE",
        independentTrustAnchor: false,
        privateKeyExposed: false,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(createShipmentApvFailureAlertPayloadSignature).toHaveBeenCalledWith(db, {
      payloadOutboxId: "33333333-3333-4333-8333-333333333333",
      clientSignatureId: "11111111-1111-4111-8111-111111111111",
      signedBy: checkerId,
      signer: expect.objectContaining({
        keyId: "a".repeat(24),
        publicKeySpkiBase64: expect.any(String),
        signMessage: expect.any(Function),
      }),
    });
    expect(getShipmentApvFailureAlertTestSigner).toHaveBeenCalled();
    await app.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-payload-outbox/33333333-3333-4333-8333-333333333333/signatures",
          payload: { client_signature_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates and bounds APV alert signature conflicts and signer errors", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-payload-outbox/bad/signatures",
          payload: { client_signature_id: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(createShipmentApvFailureAlertPayloadSignature).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_INTEGRITY_FAILED"),
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-payload-outbox/33333333-3333-4333-8333-333333333333/signatures",
      payload: { client_signature_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_INTEGRITY_FAILED",
    });
    vi.mocked(createShipmentApvFailureAlertPayloadSignature).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/private-signature"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-payload-outbox/33333333-3333-4333-8333-333333333333/signatures",
      payload: { client_signature_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|private-signature/);
    await app.close();
  });

  it("registers the current ephemeral APV test signing key for an admin", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const app = makeApp(db, { id: checkerId, role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-signing-keys/register",
      payload: { client_event_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_signing_key: {
        status: "REGISTERED",
        registry: "DATABASE_TEST_REGISTRY",
        independentTrustAnchor: false,
        privateKeyExposed: false,
      },
    });
    expect(registerShipmentApvFailureAlertTestKey).toHaveBeenCalledWith(db, {
      clientEventId: "11111111-1111-4111-8111-111111111111",
      registeredBy: checkerId,
      signer: expect.objectContaining({
        keyId: "a".repeat(24),
        publicKeySpkiBase64: expect.any(String),
        signMessage: expect.any(Function),
      }),
    });
    await app.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-signing-keys/register",
          payload: { client_event_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("records one terminal APV test key lifecycle transition", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const app = makeApp(db, { id: checkerId, role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: `/tools/payment-test/shipping-apv/failure-alert-signing-keys/${"a".repeat(24)}/transitions`,
      payload: { client_event_id: "11111111-1111-4111-8111-111111111111", action: "REVOKE" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_signing_key: {
        status: "REVOKED",
        lifecycleReason: "ephemeral_test_key_revoked",
      },
    });
    expect(transitionShipmentApvFailureAlertTestKey).toHaveBeenCalledWith(db, {
      keyId: "a".repeat(24),
      clientEventId: "11111111-1111-4111-8111-111111111111",
      action: "REVOKE",
      changedBy: checkerId,
    });
    await app.close();
  });

  it("validates and redacts APV test key registry failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-signing-keys/register",
          payload: { client_event_id: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-signing-keys/bad/transitions",
          payload: { client_event_id: "11111111-1111-4111-8111-111111111111", action: "DELETE" },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(registerShipmentApvFailureAlertTestKey).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_TERMINAL"),
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-signing-keys/register",
      payload: { client_event_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(conflict.statusCode).toBe(409);
    vi.mocked(registerShipmentApvFailureAlertTestKey).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/key-registry"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-signing-keys/register",
      payload: { client_event_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_KEY_REGISTRY_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|key-registry/);
    await app.close();
  });

  it("stores a blocked non-executable APV delivery intent", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const app = makeApp(db, { id: checkerId, role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-payload-signatures/55555555-5555-4555-8555-555555555555/delivery-intents",
      payload: { client_delivery_intent_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_delivery_intent: {
        status: "BLOCKED_CONFIGURATION_DRY_RUN",
        persistent: true,
        executable: false,
        http: { requestCreated: false },
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(createShipmentApvFailureAlertDeliveryIntent).toHaveBeenCalledWith(db, {
      payloadSignatureId: "55555555-5555-4555-8555-555555555555",
      clientDeliveryIntentId: "11111111-1111-4111-8111-111111111111",
      requestedBy: checkerId,
    });
    await app.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-payload-signatures/55555555-5555-4555-8555-555555555555/delivery-intents",
          payload: { client_delivery_intent_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates and redacts APV delivery intent failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-payload-signatures/bad/delivery-intents",
          payload: { client_delivery_intent_id: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(createShipmentApvFailureAlertDeliveryIntent).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_NOT_ACTIVE"),
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-payload-signatures/55555555-5555-4555-8555-555555555555/delivery-intents",
      payload: { client_delivery_intent_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(conflict.statusCode).toBe(409);
    vi.mocked(createShipmentApvFailureAlertDeliveryIntent).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/delivery-intent"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-payload-signatures/55555555-5555-4555-8555-555555555555/delivery-intents",
      payload: { client_delivery_intent_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|delivery-intent/);
    await app.close();
  });

  it("verifies the local APV receiver contract without accepting delivery", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/77777777-7777-4777-8777-777777777777/receiver-contract/verify",
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_contract: {
        status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN",
        signatureVerified: true,
        freshnessVerified: true,
        independentTrustAnchor: false,
        networkReceived: false,
        productionAccepted: false,
        persistent: false,
        replayProtection: { enabled: false, persistent: false },
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(verifyShipmentApvFailureAlertReceiverContract).toHaveBeenCalledWith(db, {
      deliveryIntentId: "77777777-7777-4777-8777-777777777777",
    });
    await app.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/77777777-7777-4777-8777-777777777777/receiver-contract/verify",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates and redacts APV receiver contract failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/bad/receiver-contract/verify",
          payload: { unexpected: true },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(verifyShipmentApvFailureAlertReceiverContract).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/77777777-7777-4777-8777-777777777777/receiver-contract/verify",
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    vi.mocked(verifyShipmentApvFailureAlertReceiverContract).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/receiver-contract"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/77777777-7777-4777-8777-777777777777/receiver-contract/verify",
      payload: {},
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|receiver-contract/);
    await app.close();
  });

  it("stores one local APV receiver claim without accepting network delivery", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/77777777-7777-4777-8777-777777777777/receiver-claims",
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_claim: {
        status: "VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN",
        persistent: true,
        receiverContractVerified: true,
        replayProtection: { enabled: true, persistent: true },
        networkReceived: false,
        productionAccepted: false,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(createShipmentApvFailureAlertReceiverClaim).toHaveBeenCalledWith(db, {
      deliveryIntentId: "77777777-7777-4777-8777-777777777777",
    });
    await app.close();
  });

  it("validates and redacts APV receiver claim failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/bad/receiver-claims",
          payload: { unexpected: true },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(createShipmentApvFailureAlertReceiverClaim).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_CONFLICT"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/77777777-7777-4777-8777-777777777777/receiver-claims",
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    vi.mocked(createShipmentApvFailureAlertReceiverClaim).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/receiver-claim"),
    );
    const unavailable = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-delivery-intents/77777777-7777-4777-8777-777777777777/receiver-claims",
      payload: {},
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_UNAVAILABLE",
    });
    expect(unavailable.body).not.toMatch(/secret|password|db\.internal|receiver-claim/);
    await app.close();
  });

  it("returns identifier-free APV receiver claim health only to admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const response = await admin.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claims/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      shipping_apv_failure_alert_receiver_claim_health: {
        schemaVersion: "shipment-apv-failure-alert-receiver-claim-health-v1",
        status: "healthy",
        totals: { claims: 1, last24Hours: 1, olderThan30Days: 0 },
        violations: { binding: 0, deliveryId: 0, freshness: 0, unsafeSideEffect: 0 },
        criticalCount: 0,
        retention: { policy: "UNSET_PRESERVE", automaticDeletion: false },
        networkReceipt: false,
        productionAccepted: false,
        observedAt: "2026-07-13T20:01:00.000Z",
      },
    });
    expect(getShipmentApvFailureAlertReceiverClaimHealth).toHaveBeenCalledWith(db);
    await admin.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "GET",
          url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claims/health",
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("redacts APV receiver claim health failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(getShipmentApvFailureAlertReceiverClaimHealth).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/receiver-claim-health"),
    );
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claims/health",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_HEALTH_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal|receiver-claim-health/);
    await app.close();
  });

  it("exports an opaque APV receiver claim manifest only to admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const response = await admin.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claims/manifest",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_claim_manifest: {
        status: "COMPLETE_LOCAL_MANIFEST_DRY_RUN",
        entryCount: 1,
        receiptDigests: ["e".repeat(64)],
        containsRawIdentifiers: false,
        externalArchive: false,
        networkDelivered: false,
        productionAccepted: false,
      },
    });
    expect(exportShipmentApvFailureAlertReceiverClaimManifest).toHaveBeenCalledWith(db);
    await admin.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "GET",
          url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claims/manifest",
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("bounds and redacts APV receiver claim manifest failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(exportShipmentApvFailureAlertReceiverClaimManifest).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_HEALTH_BLOCKED"),
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claims/manifest",
        })
      ).statusCode,
    ).toBe(409);
    vi.mocked(exportShipmentApvFailureAlertReceiverClaimManifest).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/receiver-claim-manifest"),
    );
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claims/manifest",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal|receiver-claim-manifest/);
    await app.close();
  });

  it("records an append-only APV receiver manifest receipt only for admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifests/receipts",
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_claim_manifest_receipt: {
        status: "PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN",
        revision: 1,
        previousManifestDigest: null,
        persistent: true,
        appendOnly: true,
        digestVerified: true,
        containsRawIdentifiers: false,
        externalArchive: false,
        networkDelivered: false,
        productionAccepted: false,
      },
    });
    expect(recordShipmentApvFailureAlertReceiverClaimManifestReceipt).toHaveBeenCalledWith(db);
    await admin.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifests/receipts",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates, bounds and redacts APV receiver manifest receipt failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifests/receipts",
          payload: { unexpected: true },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(recordShipmentApvFailureAlertReceiverClaimManifestReceipt).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_CONFLICT"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifests/receipts",
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    vi.mocked(recordShipmentApvFailureAlertReceiverClaimManifestReceipt).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/manifest-receipt"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifests/receipts",
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal|manifest-receipt/);
    await app.close();
  });

  it("returns identifier-free APV receiver manifest chain health only to admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const response = await admin.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifests/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      shipping_apv_failure_alert_receiver_claim_manifest_health: {
        schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-health-v1",
        status: "healthy",
        totals: {
          receipts: 2,
          latestRevision: 2,
          latestReceiptEntries: 1,
          currentSourceEntries: 1,
        },
        violations: {
          revisionGap: 0,
          previousMismatch: 0,
          manifestDigest: 0,
          receiptSet: 0,
          unsafeSideEffect: 0,
          timestamp: 0,
          sourceLimit: 0,
        },
        criticalCount: 0,
        coverage: { currentSourceCovered: true, missingCurrentReceipt: false },
        freshness: { slaSeconds: 86400, latestReceiptAgeSeconds: 60, stale: false },
        containsRawIdentifiers: false,
        externalArchive: false,
        networkDelivered: false,
        productionAccepted: false,
        observedAt: "2026-07-13T22:00:00.000Z",
      },
    });
    expect(getShipmentApvFailureAlertReceiverClaimManifestHealth).toHaveBeenCalledWith(db);
    await admin.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "GET",
          url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifests/health",
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("redacts APV receiver manifest chain health failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(getShipmentApvFailureAlertReceiverClaimManifestHealth).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/manifest-health"),
    );
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifests/health",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_HEALTH_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal|manifest-health/);
    await app.close();
  });

  it("records a blocked receiver manifest archive intent only for admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const response = await admin.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifest-receipts/archive-intents",
      payload: { client_archive_intent_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_intent: {
        status: "BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN",
        manifestRevision: 1,
        persistent: true,
        appendOnly: true,
        executable: false,
        containsRawIdentifiers: false,
        http: { requestCreated: false },
        delivery: { enabled: false, attempted: false },
        externalReceipt: { verified: false },
        productionAccepted: false,
      },
    });
    expect(createShipmentApvFailureAlertReceiverManifestArchiveIntent).toHaveBeenCalledWith(db, {
      clientArchiveIntentId: "11111111-1111-4111-8111-111111111111",
      requestedBy: "66666666-6666-4666-8666-666666666666",
    });
    await admin.close();

    const user = makeApp(db);
    expect(
      (
        await user.inject({
          method: "POST",
          url: "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifest-receipts/archive-intents",
          payload: { client_archive_intent_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });

  it("validates, bounds and redacts receiver manifest archive intent failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-claim-manifest-receipts/archive-intents";
    expect(
      (await app.inject({ method: "POST", url, payload: { client_archive_intent_id: "bad" } }))
        .statusCode,
    ).toBe(400);
    vi.mocked(createShipmentApvFailureAlertReceiverManifestArchiveIntent).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_HEALTH_BLOCKED"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          payload: { client_archive_intent_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(409);
    vi.mocked(createShipmentApvFailureAlertReceiverManifestArchiveIntent).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-intent"),
    );
    const response = await app.inject({
      method: "POST",
      url,
      payload: { client_archive_intent_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal|archive-intent/);
    await app.close();
  });

  it("returns identifier-free receiver manifest archive health only to admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-intents/health";
    const response = await admin.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_health: {
        status: "healthy",
        totals: {
          intents: 1,
          latestReceiptRevision: 1,
          latestIntentRevision: 1,
          currentSourceEntries: 0,
        },
        criticalCount: 0,
        coverage: { currentReceiptIntentCovered: true },
        containsRawIdentifiers: false,
        httpRequestCreated: false,
        networkDelivered: false,
        externalReceiptVerified: false,
        productionAccepted: false,
      },
    });
    expect(getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth).toHaveBeenCalledWith(db);
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "GET", url })).statusCode).toBe(403);
    await user.close();
  });

  it("redacts receiver manifest archive health failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-health"),
    );
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-intents/health",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal/);
    await app.close();
  });

  it("returns the receiver manifest archive alert preview only to admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-preview";
    const response = await admin.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_preview: {
        mode: "preview_only",
        action: "none",
        severity: "healthy",
        approval: { required: false, state: "not_required" },
        delivery: {
          endpointConfigured: false,
          enabled: false,
          attempted: false,
          networkDelivered: false,
        },
        payload: { created: false, signed: false },
        containsRawIdentifiers: false,
      },
    });
    expect(getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview).toHaveBeenCalledWith(db);
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "GET", url })).statusCode).toBe(403);
    await user.close();
  });

  it("redacts receiver manifest archive alert preview failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-preview"),
    );
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-preview",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal/);
    await app.close();
  });

  it("creates a receiver manifest archive alert maker request only for admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-requests";
    const payload = {
      client_request_id: "11111111-1111-4111-8111-111111111111",
      state_fingerprint: "c".repeat(64),
    };
    const response = await admin.inject({ method: "POST", url, payload });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_approval_request: {
        status: "PENDING",
        appendOnly: true,
        containsArchiveIdentifiers: false,
        makerIdentityReturned: false,
        checkerDecisionCreated: false,
        payloadCreated: false,
        signed: false,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(createShipmentApvReceiverManifestArchiveAlertApprovalRequest).toHaveBeenCalledWith(db, {
      clientRequestId: payload.client_request_id,
      stateFingerprint: payload.state_fingerprint,
      requestedBy: "66666666-6666-4666-8666-666666666666",
    });
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "POST", url, payload })).statusCode).toBe(403);
    await user.close();
  });

  it("validates and reports archive alert maker request conflicts", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-requests";
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          payload: { client_request_id: "not-a-uuid", state_fingerprint: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    for (const code of [
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_NOT_ACTIONABLE",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REPLAY_CONFLICT",
    ]) {
      vi.mocked(createShipmentApvReceiverManifestArchiveAlertApprovalRequest).mockRejectedValueOnce(
        new Error(code),
      );
      const response = await app.inject({
        method: "POST",
        url,
        payload: {
          client_request_id: "11111111-1111-4111-8111-111111111111",
          state_fingerprint: "c".repeat(64),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: code });
    }
    await app.close();
  });

  it("redacts receiver manifest archive alert maker request failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertApprovalRequest).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-approval"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-requests",
      payload: {
        client_request_id: "11111111-1111-4111-8111-111111111111",
        state_fingerprint: "c".repeat(64),
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal/);
    await app.close();
  });

  it("records receiver manifest archive alert checker decisions only for admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-requests/22222222-2222-4222-8222-222222222222/decision";
    const payload = {
      client_decision_id: "33333333-3333-4333-8333-333333333333",
      decision: "APPROVED",
    };
    const response = await admin.inject({ method: "POST", url, payload });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_approval_decision: {
        decision: "APPROVED",
        appendOnly: true,
        makerCheckerSeparated: true,
        makerIdentityReturned: false,
        checkerIdentityReturned: false,
        containsArchiveIdentifiers: false,
        payloadCreated: false,
        signed: false,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest).toHaveBeenCalledWith(db, {
      approvalRequestId: "22222222-2222-4222-8222-222222222222",
      clientDecisionId: payload.client_decision_id,
      decidedBy: "66666666-6666-4666-8666-666666666666",
      decision: "APPROVED",
    });
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "POST", url, payload })).statusCode).toBe(403);
    await user.close();
  });

  it("validates and reports receiver manifest archive checker conflicts", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const base =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-requests";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/bad/decision`,
          payload: { client_decision_id: "bad", decision: "YES" },
        })
      ).statusCode,
    ).toBe(400);
    for (const code of [
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REQUEST_NOT_FOUND",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_MAKER_CHECKER_REQUIRED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_ALREADY_DECIDED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REQUEST_EXPIRED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_REPLAY_CONFLICT",
    ]) {
      vi.mocked(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest).mockRejectedValueOnce(
        new Error(code),
      );
      const response = await app.inject({
        method: "POST",
        url: `${base}/22222222-2222-4222-8222-222222222222/decision`,
        payload: {
          client_decision_id: "33333333-3333-4333-8333-333333333333",
          decision: "REJECTED",
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: code });
    }
    await app.close();
  });

  it("redacts receiver manifest archive checker decision failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-decision"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-requests/22222222-2222-4222-8222-222222222222/decision",
      payload: { client_decision_id: "33333333-3333-4333-8333-333333333333", decision: "APPROVED" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal/);
    await app.close();
  });

  it("grants an approved receiver manifest archive alert only to admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-decisions/44444444-4444-4444-8444-444444444444/delivery-grants";
    const payload = {
      client_grant_id: "77777777-7777-4777-8777-777777777777",
    };
    const response = await admin.inject({ method: "POST", url, payload });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_delivery_grant: {
        status: "GRANTED_DRY_RUN",
        cooldown: { scope: "state_fingerprint", windowMinutes: 15, active: true },
        persistent: true,
        appendOnly: true,
        makerCheckerSeparated: true,
        makerIdentityReturned: false,
        checkerIdentityReturned: false,
        containsArchiveIdentifiers: false,
        payloadCreated: false,
        signed: false,
        delivery: { enabled: false, attempted: false },
        externalReceiptVerified: false,
        productionAccepted: false,
      },
    });
    expect(createShipmentApvReceiverManifestArchiveAlertDeliveryGrant).toHaveBeenCalledWith(db, {
      approvalDecisionId: "44444444-4444-4444-8444-444444444444",
      clientGrantId: payload.client_grant_id,
      grantedBy: "66666666-6666-4666-8666-666666666666",
    });
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "POST", url, payload })).statusCode).toBe(403);
    await user.close();
  });

  it("validates and reports receiver manifest archive alert grant conflicts", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const base =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-decisions";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/bad/delivery-grants`,
          payload: { client_grant_id: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    const conflicts = [
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_REPLAY_CONFLICT",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_NOT_APPROVED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_ACTOR_MISMATCH",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_ALREADY_GRANTED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_INVALID",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REQUEST_EXPIRED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_COOLDOWN_ACTIVE",
    ];
    for (const code of conflicts) {
      vi.mocked(createShipmentApvReceiverManifestArchiveAlertDeliveryGrant).mockRejectedValueOnce(
        new Error(code),
      );
      const response = await app.inject({
        method: "POST",
        url: `${base}/44444444-4444-4444-8444-444444444444/delivery-grants`,
        payload: { client_grant_id: "77777777-7777-4777-8777-777777777777" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: code });
    }
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertDeliveryGrant).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_NOT_FOUND"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/44444444-4444-4444-8444-444444444444/delivery-grants`,
          payload: { client_grant_id: "77777777-7777-4777-8777-777777777777" },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("redacts receiver manifest archive alert grant failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertDeliveryGrant).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-grant"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-approval-decisions/44444444-4444-4444-8444-444444444444/delivery-grants",
      payload: { client_grant_id: "77777777-7777-4777-8777-777777777777" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_GRANT_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal/);
    await app.close();
  });

  it("builds an unsigned receiver manifest archive alert payload only for admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-grants/88888888-8888-4888-8888-888888888888/payload-outbox";
    const payload = {
      client_outbox_id: "11111111-1111-4111-8111-111111111111",
    };
    const response = await admin.inject({ method: "POST", url, payload });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_payload_outbox: {
        status: "UNSIGNED_DRY_RUN",
        payload: {
          event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert",
          action: "review_warning",
          severity: "warning",
          reasons: ["current_archive_intent_missing"],
        },
        persistent: true,
        appendOnly: true,
        containsArchiveIdentifiers: false,
        createdByIdentityReturned: false,
        signed: false,
        signature: null,
        delivery: { enabled: false, attempted: false },
        externalReceiptVerified: false,
        productionAccepted: false,
      },
    });
    expect(createShipmentApvReceiverManifestArchiveAlertPayloadOutbox).toHaveBeenCalledWith(db, {
      deliveryGrantId: "88888888-8888-4888-8888-888888888888",
      clientOutboxId: payload.client_outbox_id,
      createdBy: "66666666-6666-4666-8666-666666666666",
    });
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "POST", url, payload })).statusCode).toBe(403);
    await user.close();
  });

  it("validates and reports receiver manifest archive alert payload conflicts", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const base =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-grants";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/bad/payload-outbox`,
          payload: {
            client_outbox_id: "bad",
            extra: true,
          },
        })
      ).statusCode,
    ).toBe(400);
    const conflicts = [
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_REPLAY_CONFLICT",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_GRANT_INVALID",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_ACTOR_MISMATCH",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_ALREADY_CREATED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_COOLDOWN_EXPIRED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED",
    ];
    for (const code of conflicts) {
      vi.mocked(createShipmentApvReceiverManifestArchiveAlertPayloadOutbox).mockRejectedValueOnce(
        new Error(code),
      );
      const response = await app.inject({
        method: "POST",
        url: `${base}/88888888-8888-4888-8888-888888888888/payload-outbox`,
        payload: { client_outbox_id: "11111111-1111-4111-8111-111111111111" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: code });
    }
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertPayloadOutbox).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_GRANT_NOT_FOUND"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/88888888-8888-4888-8888-888888888888/payload-outbox`,
          payload: { client_outbox_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("redacts receiver manifest archive alert payload failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertPayloadOutbox).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-payload"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-grants/88888888-8888-4888-8888-888888888888/payload-outbox",
      payload: { client_outbox_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal/);
    await app.close();
  });

  it("signs a receiver manifest archive alert payload only for admins", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const admin = makeApp(db, { id: checkerId, role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-payload-outbox/22222222-2222-4222-8222-222222222222/signatures";
    const payload = {
      client_signature_id: "11111111-1111-4111-8111-111111111111",
    };
    const response = await admin.inject({ method: "POST", url, payload });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_payload_signature: {
        status: "SIGNED_DRY_RUN",
        algorithm: "Ed25519",
        signatureVerified: true,
        persistent: true,
        appendOnly: true,
        registryBound: true,
        registryStatusAtSigning: "ACTIVE",
        independentTrustAnchor: false,
        trustAnchored: false,
        signedByIdentityReturned: false,
        signedMessageContainsArchiveIdentifiers: false,
        privateKeyExposed: false,
        delivery: { enabled: false, attempted: false },
        externalReceiptVerified: false,
        productionAccepted: false,
      },
    });
    expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature).toHaveBeenCalledWith(db, {
      payloadOutboxId: "22222222-2222-4222-8222-222222222222",
      clientSignatureId: payload.client_signature_id,
      signedBy: checkerId,
      signer: expect.objectContaining({
        keyId: "a".repeat(24),
        publicKeySpkiBase64: expect.any(String),
        signMessage: expect.any(Function),
      }),
    });
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "POST", url, payload })).statusCode).toBe(403);
    await user.close();
  });

  it("validates and reports receiver manifest archive alert signature conflicts", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const base =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-payload-outbox";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/bad/signatures`,
          payload: { client_signature_id: "bad", extra: true },
        })
      ).statusCode,
    ).toBe(400);
    const conflicts = [
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_REPLAY_CONFLICT",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_INVALID",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_ACTOR_MISMATCH",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_ALREADY_SIGNED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_COOLDOWN_EXPIRED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_KEY_NOT_ACTIVE",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED",
    ];
    for (const code of conflicts) {
      vi.mocked(
        createShipmentApvReceiverManifestArchiveAlertPayloadSignature,
      ).mockRejectedValueOnce(new Error(code));
      const response = await app.inject({
        method: "POST",
        url: `${base}/22222222-2222-4222-8222-222222222222/signatures`,
        payload: { client_signature_id: "11111111-1111-4111-8111-111111111111" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: code });
    }
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertPayloadSignature).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_OUTBOX_NOT_FOUND"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/22222222-2222-4222-8222-222222222222/signatures`,
          payload: { client_signature_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("redacts receiver manifest archive alert signature failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertPayloadSignature).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-signature"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-payload-outbox/22222222-2222-4222-8222-222222222222/signatures",
      payload: { client_signature_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal/);
    await app.close();
  });

  it("plans a blocked receiver manifest archive alert delivery only for admins", async () => {
    const { db } = makeDb({});
    const checkerId = "66666666-6666-4666-8666-666666666666";
    const admin = makeApp(db, { id: checkerId, role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-payload-signatures/33333333-3333-4333-8333-333333333333/delivery-intents";
    const payload = {
      client_delivery_intent_id: "11111111-1111-4111-8111-111111111111",
    };
    const response = await admin.inject({ method: "POST", url, payload });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_delivery_intent: {
        status: "BLOCKED_CONFIGURATION_DRY_RUN",
        blockingReasons: [
          "independent_trust_anchor_missing",
          "receiver_endpoint_missing",
          "receiver_credential_missing",
        ],
        persistent: true,
        appendOnly: true,
        executable: false,
        requestedByIdentityReturned: false,
        signatureValueReturned: false,
        publicKeyReturned: false,
        independentTrustAnchor: false,
        endpointConfigured: false,
        credentialConfigured: false,
        http: { requestCreated: false },
        delivery: { enabled: false, attempted: false },
        networkRequestSent: false,
        externalReceiptVerified: false,
        productionAccepted: false,
      },
    });
    expect(createShipmentApvReceiverManifestArchiveAlertDeliveryIntent).toHaveBeenCalledWith(db, {
      payloadSignatureId: "33333333-3333-4333-8333-333333333333",
      clientDeliveryIntentId: payload.client_delivery_intent_id,
      requestedBy: checkerId,
    });
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "POST", url, payload })).statusCode).toBe(403);
    await user.close();
  });

  it("validates and reports receiver manifest archive alert delivery intent conflicts", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const base =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-payload-signatures";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/bad/delivery-intents`,
          payload: {
            client_delivery_intent_id: "bad",
            extra: true,
          },
        })
      ).statusCode,
    ).toBe(400);
    const conflicts = [
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_REPLAY_CONFLICT",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_INVALID",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_ACTOR_MISMATCH",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_ALREADY_CREATED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_COOLDOWN_EXPIRED",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_KEY_NOT_ACTIVE",
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED",
    ];
    for (const code of conflicts) {
      vi.mocked(createShipmentApvReceiverManifestArchiveAlertDeliveryIntent).mockRejectedValueOnce(
        new Error(code),
      );
      const response = await app.inject({
        method: "POST",
        url: `${base}/33333333-3333-4333-8333-333333333333/delivery-intents`,
        payload: { client_delivery_intent_id: "11111111-1111-4111-8111-111111111111" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: code });
    }
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertDeliveryIntent).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_NOT_FOUND"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/33333333-3333-4333-8333-333333333333/delivery-intents`,
          payload: { client_delivery_intent_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("redacts receiver manifest archive alert delivery intent failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertDeliveryIntent).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-intent"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-payload-signatures/33333333-3333-4333-8333-333333333333/delivery-intents",
      payload: { client_delivery_intent_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal/);
    await app.close();
  });

  it("verifies the receiver manifest archive alert local contract only for admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-intents/44444444-4444-4444-8444-444444444444/receiver-contract/verify";
    const response = await admin.inject({ method: "POST", url, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_contract: {
        status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN",
        payloadContractVerified: true,
        payloadHashVerified: true,
        signatureVerified: true,
        keyBindingVerified: true,
        freshnessVerified: true,
        intentBindingVerified: true,
        freshnessWindowSeconds: 300,
        independentTrustAnchor: false,
        actorIdentityReturned: false,
        signatureValueReturned: false,
        publicKeyReturned: false,
        networkReceived: false,
        externalReceiptVerified: false,
        productionAccepted: false,
        persistent: false,
        replayProtection: { enabled: false, persistent: false },
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract).toHaveBeenCalledWith(db, {
      deliveryIntentId: "44444444-4444-4444-8444-444444444444",
    });
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "POST", url, payload: {} })).statusCode).toBe(403);
    await user.close();
  });

  it("validates receiver manifest archive alert local contract requests and rejections", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const base =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-intents";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/bad/receiver-contract/verify`,
          payload: { extra: true },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED"),
    );
    const rejected = await app.inject({
      method: "POST",
      url: `${base}/44444444-4444-4444-8444-444444444444/receiver-contract/verify`,
      payload: {},
    });
    expect(rejected.statusCode).toBe(409);
    vi.mocked(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_NOT_FOUND"),
    );
    const missing = await app.inject({
      method: "POST",
      url: `${base}/44444444-4444-4444-8444-444444444444/receiver-contract/verify`,
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("redacts receiver manifest archive alert local contract failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-receiver"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-intents/44444444-4444-4444-8444-444444444444/receiver-contract/verify",
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal|archive-alert-receiver/);
    await app.close();
  });

  it("records a persistent receiver manifest archive alert claim only for admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-intents/44444444-4444-4444-8444-444444444444/receiver-claims";
    const response = await admin.inject({ method: "POST", url, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_claim: {
        status: "VERIFIED_LOCAL_ARCHIVE_ALERT_RECEIVER_CLAIM_DRY_RUN",
        deliveryIntentId: "44444444-4444-4444-8444-444444444444",
        persistent: true,
        appendOnly: true,
        receiverContractVerified: true,
        replayProtection: { enabled: true, persistent: true },
        independentTrustAnchor: false,
        actorIdentityReturned: false,
        signatureValueReturned: false,
        publicKeyReturned: false,
        networkReceived: false,
        externalReceiptVerified: false,
        productionAccepted: false,
        delivery: { enabled: false, attempted: false },
      },
    });
    expect(createShipmentApvReceiverManifestArchiveAlertReceiverClaim).toHaveBeenCalledWith(db, {
      deliveryIntentId: "44444444-4444-4444-8444-444444444444",
    });
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "POST", url, payload: {} })).statusCode).toBe(403);
    await user.close();
  });

  it("validates receiver manifest archive alert claims and known conflicts", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const base =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-intents";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/bad/receiver-claims`,
          payload: { extra: true },
        })
      ).statusCode,
    ).toBe(400);
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertReceiverClaim).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/44444444-4444-4444-8444-444444444444/receiver-claims`,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertReceiverClaim).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_CONFLICT"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/44444444-4444-4444-8444-444444444444/receiver-claims`,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertReceiverClaim).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_NOT_FOUND"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/44444444-4444-4444-8444-444444444444/receiver-claims`,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("redacts receiver manifest archive alert claim failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(createShipmentApvReceiverManifestArchiveAlertReceiverClaim).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-claim"),
    );
    const response = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-delivery-intents/44444444-4444-4444-8444-444444444444/receiver-claims",
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal|archive-alert-claim/);
    await app.close();
  });

  it("returns identifier-free archive alert receiver claim health only to admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    const url =
      "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-receiver-claims/health";
    const response = await admin.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      shipping_apv_failure_alert_receiver_manifest_archive_alert_receiver_claim_health: {
        schemaVersion:
          "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-claim-health-v1",
        status: "healthy",
        totals: { claims: 1, last24Hours: 1, olderThan30Days: 0 },
        violations: {
          binding: 0,
          deliveryId: 0,
          freshness: 0,
          unsafeSideEffect: 0,
        },
        criticalCount: 0,
        retention: {
          policy: "UNSET_PRESERVE",
          automaticDeletion: false,
        },
        containsRawIdentifiers: false,
        independentTrustAnchor: false,
        networkReceipt: false,
        externalReceiptVerified: false,
        productionAccepted: false,
        observedAt: "2026-07-14T06:01:00.000Z",
      },
    });
    expect(getShipmentApvReceiverManifestArchiveAlertReceiverClaimHealth).toHaveBeenCalledWith(db);
    await admin.close();
    const user = makeApp(db);
    expect((await user.inject({ method: "GET", url })).statusCode).toBe(403);
    await user.close();
  });

  it("redacts archive alert receiver claim health failures", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "66666666-6666-4666-8666-666666666666", role: "admin" });
    vi.mocked(getShipmentApvReceiverManifestArchiveAlertReceiverClaimHealth).mockRejectedValueOnce(
      new Error("postgres://secret:password@db.internal/archive-alert-claim-health"),
    );
    const response = await app.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/failure-alert-receiver-manifest-archive-alert-receiver-claims/health",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_HEALTH_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/secret|password|db\.internal|archive-alert-claim-health/);
    await app.close();
  });

  it("blocks shipment APV chaos for non-admin users", async () => {
    const { db } = makeDb({});
    const app = makeApp(db);
    const res = await app.inject({ method: "POST", url: "/tools/payment-test/shipping-apv/chaos" });
    expect(res.statusCode).toBe(403);
    expect(runShipmentApvChaos).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns mutation-free shipment APV fixture readiness only to admins", async () => {
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/readiness",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      shipping_apv_fixture_readiness: {
        eligible: true,
        status: "ready",
        reasons: [],
        singleton: { status: "SUCCEEDED" },
        executionLease: { available: true },
      },
    });
    expect(getShipmentApvRetentionAlertFixtureReadiness).toHaveBeenCalledOnce();
    await admin.close();

    vi.mocked(getShipmentApvRetentionAlertFixtureReadiness).mockClear();
    const user = makeApp(db);
    expect(
      (await user.inject({ method: "GET", url: "/tools/payment-test/shipping-apv/readiness" }))
        .statusCode,
    ).toBe(403);
    expect(getShipmentApvRetentionAlertFixtureReadiness).not.toHaveBeenCalled();
    await user.close();
  });

  it("redacts shipment APV fixture readiness database failures", async () => {
    vi.mocked(getShipmentApvRetentionAlertFixtureReadiness).mockRejectedValueOnce(
      new Error("postgres://secret@internal/fixture"),
    );
    const { db } = makeDb({});
    const admin = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({
      method: "GET",
      url: "/tools/payment-test/shipping-apv/readiness",
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "SHIPMENT_APV_FIXTURE_PREFLIGHT_UNAVAILABLE" });
    expect(response.body).not.toContain("postgres://");
    await admin.close();
  });

  it("runs the real multi-signal image pixel fixture evaluation for admins", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-image-similarity/evaluate",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      test: "dispute_image_similarity",
      result: {
        pass: true,
        checks: "4/4",
        cases: [
          { key: "recompressed", actual_review: true, pass: true },
          { key: "cropped", actual_review: true, pass: true },
          { key: "recolored", actual_review: true, pass: true },
          { key: "different_structure", actual_review: false, pass: true },
        ],
      },
    });
    await app.close();
  });

  it("blocks image pixel fixture evaluation for non-admin users", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-image-similarity/evaluate",
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("runs and protects the AI audit archive fixture", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const adminApp = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await adminApp.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-ai-audit-archive/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      test: "dispute_ai_audit_archive",
      result: { pass: true, delivered: true, receipt_match: true },
    });
    expect(runDisputeAiAuditArchiveFixture).toHaveBeenCalledOnce();
    await adminApp.close();
    vi.clearAllMocks();
    const userApp = makeApp(db);
    expect(
      (
        await userApp.inject({
          method: "POST",
          url: "/tools/payment-test/dispute-ai-audit-archive/evaluate",
        })
      ).statusCode,
    ).toBe(403);
    expect(runDisputeAiAuditArchiveFixture).not.toHaveBeenCalled();
    await userApp.close();
  });

  it("runs and protects the evidence provenance fixture", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const adminApp = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await adminApp.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-evidence-provenance/evaluate",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      test: "dispute_evidence_provenance",
      result: {
        pass: true,
        checks: "22/22",
        trusted: true,
        artifact_tamper_blocked: true,
        append_only_update_blocked: true,
        archive_delivered: true,
        archive_survived_evidence_delete: true,
        atomic_rollback_clean: true,
        failure_queue_detected: true,
        archive_requeued: true,
        requeue_audit_once: true,
        firing_alert_delivered: true,
        recovery_alert_delivered: true,
        receiver_replay_blocked: true,
        duplicate_recovery_blocked: true,
        cleanup: true,
      },
    });
    expect(runDisputeEvidenceProvenanceFixture).toHaveBeenCalledOnce();
    await adminApp.close();
    vi.clearAllMocks();
    const userApp = makeApp(db);
    expect(
      (
        await userApp.inject({
          method: "POST",
          url: "/tools/payment-test/dispute-evidence-provenance/evaluate",
        })
      ).statusCode,
    ).toBe(403);
    expect(runDisputeEvidenceProvenanceFixture).not.toHaveBeenCalled();
    await userApp.close();
  });

  it("runs isolated shipment ordering chaos for admins", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-ordering/chaos",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      test: "shipment_ordering_chaos",
      result: {
        pass: true,
        finalStatus: "DELIVERED",
        ignored: { stale: "stale", terminal: "terminal" },
        cleanup: { succeeded: true },
      },
    });
    expect(runShipmentOrderingChaos).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks shipment ordering chaos for non-admin users", async () => {
    const { db } = makeDb({});
    const app = makeApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/shipping-ordering/chaos",
    });
    expect(res.statusCode).toBe(403);
    expect(runShipmentOrderingChaos).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns redacted webhook claim health to admins", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({ method: "GET", url: "/admin/webhooks/claims/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      webhook_claim_health: {
        status: "healthy",
        totals: { completed: 12 },
        sources: [{ source: "stripe" }],
      },
      alerting: {
        configured: false,
        jobEnabled: false,
        wouldAlert: false,
        severity: null,
        reasons: [],
      },
      alert_receiver: { configured: false, status: "unavailable", acceptedSecretCount: 0 },
    });
    expect(getWebhookClaimHealth).toHaveBeenCalledOnce();
    expect(res.body).not.toContain("payload");
    expect(res.body).not.toContain("eventId");
    expect(res.body).not.toContain("WEBHOOK_CLAIM_ALERT_URL");
    expect(res.body).not.toContain("WEBHOOK_CLAIM_ALERT_SECRET");
    await app.close();
  });

  it("blocks webhook claim health from non-admin users", async () => {
    const { db } = makeDb({});
    const app = makeApp(db);
    const res = await app.inject({ method: "GET", url: "/admin/webhooks/claims/health" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns aggregate-only APV payout reservation health to admins", async () => {
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-payout-reservations/health",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      shipment_apv_payout_reservation_health: { status: "healthy", expiredReserved: 0 },
      alerting: { configured: false, jobEnabled: false, wouldAlert: false },
    });
    expect(getShipmentApvPayoutReservationHealth).toHaveBeenCalledOnce();
    expect(res.body).not.toContain("seller_id");
    expect(res.body).not.toContain("order_id");
    expect(res.body).not.toContain("offset_id");
    await app.close();
  });

  it("blocks APV payout reservation health from non-admin users", async () => {
    const { db } = makeDb({});
    const app = makeApp(db);
    const res = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-payout-reservations/health",
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns a bounded APV payout recovery queue to admins", async () => {
    vi.mocked(listExpiredShipmentApvPayoutReservations).mockResolvedValueOnce({
      items: [
        {
          offsetId: "11111111-1111-4111-8111-111111111111",
          settlementReleaseId: "22222222-2222-4222-8222-222222222222",
          orderId: "33333333-3333-4333-8333-333333333333",
          sellerId: "44444444-4444-4444-8444-444444444444",
          currency: "USDC",
          appliedOffsetMinor: 40,
          signed: true,
          expiredAt: "2026-07-12T00:00:00.000Z",
          expiredAgeSeconds: 60,
          createdAt: "2026-07-11T23:00:00.000Z",
        },
      ],
      nextCursor: "opaque-cursor",
      recordedAt: "2026-07-12T00:01:00.000Z",
    });
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-payout-reservations/recovery-queue?limit=10",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      shipment_apv_payout_recovery_queue: {
        items: [{ appliedOffsetMinor: 40 }],
        nextCursor: "opaque-cursor",
      },
    });
    expect(listExpiredShipmentApvPayoutReservations).toHaveBeenCalledWith(expect.anything(), {
      limit: 10,
    });
    await app.close();
  });

  it("blocks APV payout recovery queue from non-admin users and invalid limits", async () => {
    const { db } = makeDb({});
    const userApp = makeApp(db);
    expect(
      (
        await userApp.inject({
          method: "GET",
          url: "/admin/shipments/apv-payout-reservations/recovery-queue",
        })
      ).statusCode,
    ).toBe(403);
    await userApp.close();
    const adminApp = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    expect(
      (
        await adminApp.inject({
          method: "GET",
          url: "/admin/shipments/apv-payout-reservations/recovery-queue?limit=101",
        })
      ).statusCode,
    ).toBe(400);
    await adminApp.close();
  });

  it("runs an admin-only webhook claim chaos report and cleans test rows", async () => {
    process.env.NODE_ENV = "test";
    const acquired = (eventId: string, attemptCount = 1) => ({
      outcome: "acquired" as const,
      source: "haggle-chaos-test",
      eventId,
      claimId: randomUUID(),
      attemptCount,
    });
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce(acquired("contested"))
      .mockResolvedValueOnce({
        outcome: "in_progress",
        source: "haggle-chaos-test",
        eventId: "contested",
      })
      .mockResolvedValueOnce({
        outcome: "duplicate",
        source: "haggle-chaos-test",
        eventId: "contested",
      })
      .mockResolvedValueOnce({
        outcome: "payload_conflict",
        source: "haggle-chaos-test",
        eventId: "contested",
      })
      .mockResolvedValueOnce(acquired("unique"))
      .mockResolvedValueOnce(acquired("heartbeat"))
      .mockResolvedValueOnce(acquired("takeover", 1))
      .mockResolvedValueOnce(acquired("takeover", 2))
      .mockResolvedValueOnce(acquired("retry", 1))
      .mockResolvedValueOnce({
        outcome: "retry_later",
        source: "haggle-chaos-test",
        eventId: "retry",
      })
      .mockResolvedValueOnce(acquired("retry", 2));
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/webhook-claim/chaos",
      payload: { same_event_requests: 2, unique_events: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      test: "webhook_claim_chaos",
      result: {
        pass: true,
        contested: { acquired: 1, in_progress: 1 },
        unique: { acquired: 1 },
        cleanup: { deleted_test_rows: 8, source: "haggle-chaos-test" },
      },
    });
    expect(cleanupWebhookChaosTestClaims).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks webhook chaos testing for non-admin users", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/webhook-claim/chaos",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("PAYMENT_TEST_TOOLS_DISABLED");
    await app.close();
  });

  it("creates a USDC settlement approval fixture for the authenticated buyer", async () => {
    process.env.NODE_ENV = "test";
    const now = new Date("2026-06-13T00:00:00.000Z");
    const { db, values } = makeDb({
      id: "11111111-1111-4111-8111-111111111111",
      approvalState: "APPROVED",
      listingId: "22222222-2222-4222-8222-222222222222",
      sellerId: "33333333-3333-4333-8333-333333333333",
      buyerId: "00000000-0000-4000-a000-000000000010",
      finalAmountMinor: "100000",
      currency: "USDC",
      selectedPaymentRail: "x402",
      sellerApprovalMode: "AUTO_WITHIN_POLICY",
      buyerApprovedAt: now,
      sellerApprovedAt: now,
      shipmentInputDueAt: now,
    });
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/settlement-approval",
      payload: {
        scenario: "unit_mock",
        amount_minor: 100_000,
        fulfillment_type: "physical_shipping",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerId: "00000000-0000-4000-a000-000000000010",
        finalAmountMinor: "100000",
        currency: "USDC",
        selectedPaymentRail: "x402",
        termsSnapshot: expect.objectContaining({
          scenario: "unit_mock",
          final_amount_minor: 100_000,
          currency: "USDC",
          fulfillment_type: "physical_shipping",
          settlement_asset: "USDC",
        }),
      }),
    );
    expect(res.json()).toMatchObject({
      approval: {
        id: "11111111-1111-4111-8111-111111111111",
        approval_state: "APPROVED",
        final_amount_minor: 100000,
        currency: "USDC",
        fulfillment_type: "physical_shipping",
      },
      next: {
        endpoint: "/payments/prepare",
      },
    });
  });

  it("rejects non-UUID local buyer ids because payment tables use UUID columns", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, { id: "test-user-001", role: "authenticated" });

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/settlement-approval",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "PAYMENT_TEST_BUYER_ID_MUST_BE_UUID" });
  });

  it("blocks production fixture creation for non-admin users", async () => {
    process.env.NODE_ENV = "production";
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/settlement-approval",
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "PAYMENT_TEST_TOOLS_DISABLED" });
  });

  it("creates a dispute-ready paid/delivered order fixture without real money", async () => {
    process.env.NODE_ENV = "test";
    const approvalId = "11111111-1111-4111-8111-111111111111";
    const orderId = "22222222-2222-4222-8222-222222222222";
    const intentId = "33333333-3333-4333-8333-333333333333";
    let insertCount = 0;
    const values = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      const ids = [approvalId, orderId, intentId];
      const id = ids[Math.min(insertCount, ids.length - 1)];
      insertCount += 1;
      return {
        returning: vi.fn().mockResolvedValue([{ ...payload, id }]),
      };
    });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-ready-order",
      payload: {
        order_status: "DELIVERED",
        selected_payment_rail: "stripe",
        amount_minor: 45000,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.fixture).toMatchObject({
      order_id: orderId,
      order_status: "DELIVERED",
      payment_intent_status: "SETTLED",
      money_moved: false,
      card_pan_used: false,
      next: { mcp_tool: "haggle_start_dispute" },
    });
    expect(JSON.stringify(body)).not.toMatch(/\b4[0-9]{12}(?:[0-9]{3})?\b/);
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("blocks production dispute-ready fixture for non-admin users", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HAGGLE_ENV;
    delete process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS;
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-ready-order",
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("PAYMENT_TEST_TOOLS_DISABLED");
  });

  it("returns AUTH_REQUIRED when dispute-ready-order has no bearer user", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db, null);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-ready-order",
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "AUTH_REQUIRED" });
  });

  it("allows staging dogfood dispute-ready-order for non-admin UUID buyers when flag is on", async () => {
    process.env.NODE_ENV = "production";
    process.env.HAGGLE_ENV = "staging";
    process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS = "true";
    // currentPaymentRuntime() resolves JWKS policy when NODE_ENV=production.
    process.env.SUPABASE_URL = "https://example.supabase.co";
    const approvalId = "11111111-1111-4111-8111-111111111111";
    const orderId = "22222222-2222-4222-8222-222222222222";
    const intentId = "33333333-3333-4333-8333-333333333333";
    let insertCount = 0;
    const values = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      const ids = [approvalId, orderId, intentId];
      const id = ids[Math.min(insertCount, ids.length - 1)];
      insertCount += 1;
      return {
        returning: vi.fn().mockResolvedValue([{ ...payload, id }]),
      };
    });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Database;
    // MCP OAuth resolves as role=user; staging dogfood must accept that buyer JWT.
    const app = makeApp(db, {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      role: "user",
    });

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-ready-order",
      payload: { order_status: "DELIVERED" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().fixture).toMatchObject({
      order_id: orderId,
      money_moved: false,
      card_pan_used: false,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ buyerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }),
    );
  });

  it("blocks staging dispute-ready-order when payment-test tools flag is off", async () => {
    process.env.NODE_ENV = "production";
    process.env.HAGGLE_ENV = "staging";
    delete process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS;
    const { db } = makeDb({});
    const app = makeApp(db, {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      role: "user",
    });

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-ready-order",
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("PAYMENT_TEST_TOOLS_DISABLED");
  });

  it("rejects unknown dispute AI evaluation scenarios before calling a provider", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-ai/evaluate",
      payload: {
        scenario_keys: ["missing_scenario"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "UNKNOWN_DISPUTE_AI_EVAL_SCENARIO",
      unknown_keys: ["missing_scenario"],
    });
    expect(res.json().available_scenarios.length).toBeGreaterThan(0);
  });

  it("blocks production dispute AI evaluation for non-admin users", async () => {
    process.env.NODE_ENV = "production";
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/dispute-ai/evaluate",
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "PAYMENT_TEST_TOOLS_DISABLED" });
  });

  it("reports missing contract signing env before creating funding signatures", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
    delete process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY;
    delete process.env.HAGGLE_BASE_RPC_URL;
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/funding-signature",
      payload: {
        buyer_wallet_address: "0x0da9Ebd940a2B0bBB91d9A3813F72dfc2FA1A658",
        seller_wallet_address: "0x7eB0303A1E04E3C2c7FF13D675FD2d8399bddCD6",
        amount_minor: 100_000,
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: "CONDITIONAL_FUNDING_SIGNATURE_UNAVAILABLE",
      runtime: {
        conditional_settlement_ready: false,
      },
    });
  });

  it("reports configuration-only blockers for the full onchain flow without exposing secrets", async () => {
    process.env.NODE_ENV = "test";
    process.env.HAGGLE_X402_MODE = "mock";
    process.env.HAGGLE_X402_NETWORK = "unsupported-test-network";
    delete process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
    delete process.env.HAGGLE_X402_USDC_ASSET_ADDRESS;
    delete process.env.HAGGLE_X402_FEE_WALLET;
    delete process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY;
    delete process.env.HAGGLE_BASE_RPC_URL;
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({ method: "GET", url: "/tools/payment-test/runtime" });

    expect(res.statusCode).toBe(200);
    expect(res.json().runtime.onchain_flow_preflight).toMatchObject({
      status: "blocked",
      ready: false,
      checks: {
        x402_real_mode: false,
        supported_network: false,
        usdc_asset_address: false,
        conditional_settlement_address: false,
        fee_wallet_address: false,
        relayer_signer: false,
        base_rpc: false,
      },
    });
    expect(res.json().runtime.onchain_flow_preflight.blocked_by).toEqual([
      "x402_real_mode",
      "supported_network",
      "usdc_asset_address",
      "conditional_settlement_address",
      "fee_wallet_address",
      "relayer_signer",
      "base_rpc",
    ]);
    expect(JSON.stringify(res.json())).not.toContain("private_key");
  });

  it("requires real x402 mode in addition to signer configuration for onchain readiness", async () => {
    process.env.NODE_ENV = "test";
    process.env.HAGGLE_X402_MODE = "real";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    process.env.HAGGLE_X402_USDC_ASSET_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.HAGGLE_X402_FEE_WALLET = "0x3333333333333333333333333333333333333333";
    process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY = `0x${"44".repeat(32)}`;
    process.env.HAGGLE_BASE_RPC_URL = "https://rpc.example.test";
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({ method: "GET", url: "/tools/payment-test/runtime" });

    expect(res.statusCode).toBe(200);
    expect(res.json().runtime).toMatchObject({
      conditional_settlement_ready: true,
      onchain_flow_preflight: {
        status: "ready",
        ready: true,
        blocked_by: [],
      },
    });
  });

  it("rejects zero addresses, a zero signer key, and an invalid RPC URL in preflight", async () => {
    process.env.NODE_ENV = "test";
    process.env.HAGGLE_X402_MODE = "real";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS = `0x${"00".repeat(20)}`;
    process.env.HAGGLE_X402_USDC_ASSET_ADDRESS = `0x${"00".repeat(20)}`;
    process.env.HAGGLE_X402_FEE_WALLET = `0x${"00".repeat(20)}`;
    process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY = `0x${"00".repeat(32)}`;
    process.env.HAGGLE_BASE_RPC_URL = "not-a-url";
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({ method: "GET", url: "/tools/payment-test/runtime" });

    expect(res.statusCode).toBe(200);
    expect(res.json().runtime.onchain_flow_preflight).toMatchObject({
      status: "blocked",
      checks: {
        x402_real_mode: true,
        supported_network: true,
        usdc_asset_address: false,
        conditional_settlement_address: false,
        fee_wallet_address: false,
        relayer_signer: false,
        base_rpc: false,
      },
    });
  });

  it("skips the live onchain probe when required server configuration is missing", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
    delete process.env.HAGGLE_X402_USDC_ASSET_ADDRESS;
    delete process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY;
    delete process.env.HAGGLE_BASE_RPC_URL;
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/tools/payment-test/onchain-preflight" });

    expect(res.statusCode).toBe(200);
    expect(res.json().onchain_preflight).toMatchObject({
      status: "blocked",
      ready: false,
      probe_skipped: true,
      checks: null,
    });
    expect(res.json().onchain_preflight.config_blocked_by).toEqual([
      "x402_real_mode",
      "usdc_asset_address",
      "conditional_settlement_address",
      "fee_wallet_address",
      "relayer_signer",
      "base_rpc",
    ]);
    expect(res.json().onchain_preflight.probe_prerequisite_blocked_by).toEqual([
      "base_rpc",
      "conditional_settlement_address",
      "usdc_asset_address",
      "relayer_signer",
    ]);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });

  it("keeps chain diagnostics available when alert history storage is unavailable", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
    delete process.env.HAGGLE_X402_USDC_ASSET_ADDRESS;
    delete process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY;
    delete process.env.HAGGLE_BASE_RPC_URL;
    const { db } = makeDb({});
    (db as unknown as { execute: ReturnType<typeof vi.fn> }).execute = vi
      .fn()
      .mockRejectedValue(new Error("private db detail"));
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/tools/payment-test/onchain-preflight" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      onchain_preflight: { status: "blocked", probe_skipped: true },
      preflight_alerting: { stateUnavailable: true },
    });
    expect(res.body).not.toContain("private db detail");
  });

  it("runs the admin live onchain probe and returns only bounded public diagnostics", async () => {
    process.env.NODE_ENV = "test";
    process.env.HAGGLE_X402_MODE = "real";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.HAGGLE_BASE_RPC_URL = "https://rpc.secret.example";
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    process.env.HAGGLE_X402_USDC_ASSET_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.HAGGLE_X402_FEE_WALLET = "0x5555555555555555555555555555555555555555";
    process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY = `0x${"33".repeat(32)}`;
    mockPrivateKeyToAccount.mockReturnValue({
      address: "0x4444444444444444444444444444444444444444",
    } as unknown as ReturnType<typeof privateKeyToAccount>);
    mockCreatePublicClient.mockReturnValue({
      getChainId: vi.fn().mockResolvedValue(84532),
      getBytecode: vi.fn().mockResolvedValueOnce("0x60016000").mockResolvedValueOnce("0x60026000"),
      readContract: vi
        .fn()
        .mockResolvedValueOnce("0x4444444444444444444444444444444444444444")
        .mockResolvedValueOnce(true),
    } as never);
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/tools/payment-test/onchain-preflight" });

    expect(res.statusCode).toBe(200);
    expect(res.json().onchain_preflight).toMatchObject({
      status: "ready",
      ready: true,
      chain_probe_ready: true,
      probe_skipped: false,
      config_blocked_by: [],
      expected_chain_id: 84532,
      observed_chain_id: 84532,
      settlement_bytecode_bytes: 4,
      usdc_bytecode_bytes: 4,
      checks: {
        rpc_reachable: true,
        chain_id_match: true,
        settlement_bytecode: true,
        usdc_bytecode: true,
        signer_matches: true,
        usdc_allowed: true,
      },
    });
    const serialized = JSON.stringify(res.json());
    expect(serialized).not.toContain("rpc.secret.example");
    expect(serialized).not.toContain(process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY);
    expect(serialized).not.toContain("0x4444444444444444444444444444444444444444");
    expect(serialized).not.toContain("0x60016000");
  });

  it("keeps the overall flow blocked when chain bindings pass but x402 config is incomplete", async () => {
    process.env.NODE_ENV = "test";
    process.env.HAGGLE_X402_MODE = "mock";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.HAGGLE_BASE_RPC_URL = "https://rpc.example.test";
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    process.env.HAGGLE_X402_USDC_ASSET_ADDRESS = "0x2222222222222222222222222222222222222222";
    delete process.env.HAGGLE_X402_FEE_WALLET;
    process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY = `0x${"33".repeat(32)}`;
    mockPrivateKeyToAccount.mockReturnValue({
      address: "0x4444444444444444444444444444444444444444",
    } as unknown as ReturnType<typeof privateKeyToAccount>);
    mockCreatePublicClient.mockReturnValue({
      getChainId: vi.fn().mockResolvedValue(84532),
      getBytecode: vi.fn().mockResolvedValue("0x60016000"),
      readContract: vi
        .fn()
        .mockResolvedValueOnce("0x4444444444444444444444444444444444444444")
        .mockResolvedValueOnce(true),
    } as never);
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/tools/payment-test/onchain-preflight" });

    expect(res.statusCode).toBe(200);
    expect(res.json().onchain_preflight).toMatchObject({
      status: "blocked",
      ready: false,
      chain_probe_ready: true,
      config_blocked_by: ["x402_real_mode", "fee_wallet_address"],
      blocked_by: [],
    });
  });

  it("restricts the live onchain probe to admins", async () => {
    const { db } = makeDb({});
    const app = makeApp(db);
    const res = await app.inject({ method: "GET", url: "/tools/payment-test/onchain-preflight" });
    expect(res.statusCode).toBe(403);
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });

  it("blocks production contract signing for non-admin users", async () => {
    process.env.NODE_ENV = "production";
    process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS = "true";
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/release-signature",
      payload: {
        settlement_id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        seller_wallet_address: "0x7eB0303A1E04E3C2c7FF13D675FD2d8399bddCD6",
        fee_wallet_address: "0xAf697e64cA951488E82FDef2FA179D1797DD02D3",
        amount_minor: 100_000,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "PAYMENT_TEST_TOOLS_DISABLED" });
  });

  it("reports missing contract signing env before creating refund signatures", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
    delete process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY;
    delete process.env.HAGGLE_BASE_RPC_URL;
    const { db } = makeDb({});
    const app = makeApp(db);

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/conditional-settlement/refund-signature",
      payload: {
        settlement_id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: "CONDITIONAL_REFUND_SIGNATURE_UNAVAILABLE",
      runtime: { conditional_settlement_ready: false },
    });
    await app.close();
  });

  it("blocks production payment test tools for admin unless explicitly enabled", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HAGGLE_ENABLE_PAYMENT_TEST_TOOLS;
    const { db } = makeDb({});
    const app = makeApp(db, { id: "99999999-9999-4999-8999-999999999999", role: "admin" });

    const res = await app.inject({
      method: "POST",
      url: "/tools/payment-test/contract/fund",
      payload: {
        order_id: "order_prod_guard",
        amount_minor: 100_000,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "PAYMENT_TEST_TOOLS_DISABLED" });
  });

  it("simulates a test contract fund, dispute lock, and buyer refund resolution", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db);

    const fund = await app.inject({
      method: "POST",
      url: "/tools/payment-test/contract/fund",
      payload: {
        order_id: "order_123",
        payment_intent_id: "payment_123",
        amount_minor: 100_000,
      },
    });
    expect(fund.statusCode).toBe(201);
    expect(fund.json()).toMatchObject({
      test_contract: {
        order_id: "order_123",
        payment_intent_id: "payment_123",
        amount_minor: 100_000,
        status: "FUNDED",
      },
      idempotent: false,
    });

    const lock = await app.inject({
      method: "POST",
      url: "/tools/payment-test/contract/lock-dispute",
      payload: {
        order_id: "order_123",
        dispute_id: "dispute_123",
      },
    });
    expect(lock.statusCode).toBe(200);
    expect(lock.json()).toMatchObject({
      test_contract: {
        order_id: "order_123",
        dispute_id: "dispute_123",
        status: "DISPUTED",
        invariant_checks: {
          dispute_blocks_buyer_confirm: true,
        },
      },
    });

    const resolve = await app.inject({
      method: "POST",
      url: "/tools/payment-test/contract/resolve",
      payload: {
        order_id: "order_123",
        dispute_id: "dispute_123",
        outcome: "buyer_favor",
        summary: "Buyer claim accepted in test contract simulator",
      },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json()).toMatchObject({
      test_contract: {
        order_id: "order_123",
        status: "REFUNDED_TO_BUYER",
        outcome: "buyer_favor",
        refund_amount_minor: 100_000,
        seller_release_amount_minor: 0,
      },
    });

    await app.close();
  });

  it("releases a funded test contract to the seller after a successful delivery", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db);

    const fund = await app.inject({
      method: "POST",
      url: "/tools/payment-test/contract/fund",
      payload: {
        order_id: "order_happy_path",
        payment_intent_id: "payment_happy_path",
        amount_minor: 100_000,
      },
    });
    expect(fund.statusCode).toBe(201);

    const release = await app.inject({
      method: "POST",
      url: "/tools/payment-test/contract/release",
      payload: {
        order_id: "order_happy_path",
        summary: "Buyer confirmed delivery",
      },
    });

    expect(release.statusCode).toBe(200);
    expect(release.json()).toMatchObject({
      test_contract: {
        order_id: "order_happy_path",
        status: "RELEASED_TO_SELLER",
        outcome: "seller_favor",
        refund_amount_minor: 0,
        seller_release_amount_minor: 100_000,
      },
      idempotent: false,
    });
  });

  it("keeps test contract funding idempotent for the same order and terms", async () => {
    process.env.NODE_ENV = "test";
    const { db } = makeDb({});
    const app = makeApp(db);
    const payload = {
      order_id: "order_idempotent",
      payment_intent_id: "payment_idempotent",
      amount_minor: 50_000,
    };

    const first = await app.inject({
      method: "POST",
      url: "/tools/payment-test/contract/fund",
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/tools/payment-test/contract/fund",
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ idempotent: true });
    await app.close();
  });
});
