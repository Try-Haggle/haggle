import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "../middleware/rate-limit.js";
import { deriveAppealSlaState, registerDisputeRoutes } from "../routes/disputes.js";
import {
  fundTestContract,
  getTestContractByOrderId,
  resetTestContractLedgerForTests,
} from "../services/test-contract-ledger.service.js";
import { ADMIN_HEADERS, AUTH_HEADERS, closeTestApp, getTestApp } from "./helpers.js";

// --- Mock service layers ---
vi.mock("../services/payment-record.service.js", () => ({
  createAgentPaymentGrantRecord: vi.fn().mockResolvedValue(null),
  getAgentPaymentGrantById: vi.fn().mockResolvedValue(null),
  createPaymentDisclosureRecord: vi.fn().mockResolvedValue(null),
  createPaymentAuthorizationRecord: vi.fn().mockResolvedValue(null),
  createPaymentSettlementRecord: vi.fn().mockResolvedValue(null),
  createRefundRecord: vi.fn().mockResolvedValue(null),
  createStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  ensureCommerceOrderForApproval: vi.fn().mockResolvedValue(null),
  getPaymentIntentById: vi.fn().mockResolvedValue(null),
  getPaymentIntentRowById: vi.fn().mockResolvedValue(null),
  getSettlementApprovalById: vi.fn().mockResolvedValue(null),
  updateCommerceOrderStatus: vi.fn().mockResolvedValue(null),
  updateStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  getCommerceOrderByOrderId: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  createSettlementReleaseRecord: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByOrderId: vi.fn().mockResolvedValue(null),
  updateSettlementReleaseRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-resolution-finalizer.js", () => ({
  finalizeDisputeResolution: vi.fn().mockResolvedValue({
    dispute: null,
    auto_refund: null,
    deposit_refund: null,
    module_settlement_webhook: null,
  }),
}));

vi.mock("../services/shipment-record.service.js", () => ({
  createShipmentRecord: vi.fn().mockResolvedValue(null),
  getShipmentById: vi.fn().mockResolvedValue(null),
  getShipmentByOrderId: vi.fn().mockResolvedValue(null),
  updateShipmentRecord: vi.fn().mockResolvedValue(null),
  insertShipmentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/admin-action-log.service.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/dispute-record.service.js", () => ({
  createDisputeRecord: vi.fn().mockResolvedValue(null),
  getDisputeById: vi.fn().mockResolvedValue(null),
  getDisputeByOrderId: vi.fn().mockResolvedValue(null),
  updateDisputeRecord: vi.fn().mockResolvedValue(null),
  addDisputeEvidenceRecord: vi.fn().mockResolvedValue(null),
  createDisputeEvidenceUploadRecord: vi.fn().mockResolvedValue(null),
  getDisputeEvidenceUploadByPath: vi.fn().mockResolvedValue(null),
  getDisputeEvidenceUploadById: vi.fn().mockResolvedValue(null),
  getDisputeEvidenceUploadByEvidenceId: vi.fn().mockResolvedValue(null),
  hasCommittedCameraEvidenceSha256: vi.fn().mockResolvedValue(false),
  findNearestCommittedCameraEvidence: vi.fn().mockResolvedValue(null),
  listDisputeEvidenceSimilarityReviews: vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null, recordedAt: "2026-07-12T00:00:00.000Z" }),
  getDisputeEvidenceSimilarityReviewHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    pendingReviews: 0,
    overdueSla: 0,
    dueSoon: 0,
    expiredUnresolved: 0,
    oldestPendingAgeSeconds: null,
    recordedAt: "2026-07-12T00:00:00.000Z",
    autoExpiredLast24Hours: 0,
    lastAutoExpiredAt: null,
  }),
  decideDisputeEvidenceSimilarityReview: vi.fn().mockResolvedValue({ outcome: "approved" }),
  listBlockingDisputeEvidenceUploads: vi.fn().mockResolvedValue([]),
  markDisputeEvidenceUploadCommitted: vi.fn().mockResolvedValue(null),
  updateDisputeEvidenceUploadScan: vi.fn().mockResolvedValue(undefined),
  updateDisputeEvidenceUploadSimilarity: vi.fn().mockResolvedValue(undefined),
  rejectDisputeEvidenceUpload: vi.fn().mockResolvedValue(undefined),
  createDisputeResolutionRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-similarity-review-expiry.service.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../services/dispute-similarity-review-expiry.service.js")
    >();
  return {
    ...original,
    listDisputeSimilarityReviewExpiryEvents: vi
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null }),
    getDisputeSimilarityReviewExpiryEventById: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("../services/dispute-similarity-review-audit-export.service.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../services/dispute-similarity-review-audit-export.service.js")
    >();
  return { ...original, createSignedDisputeSimilarityReviewAuditExport: vi.fn() };
});

vi.mock(
  "../services/dispute-similarity-review-audit-archive.service.js",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../services/dispute-similarity-review-audit-archive.service.js")
      >();
    return {
      ...original,
      getDisputeSimilarityReviewAuditArchiveHealth: vi.fn().mockResolvedValue({
        status: "healthy",
        pending: 0,
        processing: 0,
        failed: 0,
        deadLetter: 0,
        staleProcessing: 0,
        retryReady: 0,
        overdueUnfinished: 0,
        unfinishedMaxAgeMinutes: 15,
        oldestUnfinishedAgeSeconds: null,
        recordedAt: "2026-07-12T00:00:00.000Z",
      }),
      listDisputeSimilarityReviewAuditArchiveFailures: vi
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null, recordedAt: "2026-07-12T00:00:00.000Z" }),
      requeueDisputeSimilarityReviewAuditArchive: vi
        .fn()
        .mockResolvedValue({ outcome: "not_found" }),
    };
  },
);

vi.mock(
  "../services/dispute-similarity-review-audit-archive-alert.service.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../services/dispute-similarity-review-audit-archive-alert.service.js")
    >()),
    getDisputeSimilarityReviewAuditArchiveAlertDeliveryState: vi.fn().mockResolvedValue({
      incidentOpen: false,
      lastIncidentAlertAt: null,
      lastRecoveryAlertAt: null,
    }),
  }),
);

vi.mock("../services/dispute-storage.service.js", () => ({
  createDisputeUploadUrl: vi.fn().mockImplementation(async (objectPath: string) => ({
    uploadUrl: `https://upload.example/${objectPath}`,
    storagePath: `dispute-evidence/${objectPath}`,
    token: "upload-token",
    expiresIn: 600,
  })),
  disputeEvidenceExists: vi.fn().mockResolvedValue(true),
  downloadDisputeEvidence: vi.fn().mockResolvedValue(Buffer.from("test-evidence")),
  createDisputeViewUrl: vi.fn().mockResolvedValue("https://view.example/signed"),
}));

vi.mock("../services/dispute-evidence-scan.service.js", () => ({
  resolveDisputeEvidenceScannerConfigFromEnv: vi.fn(() => null),
  scanDisputeEvidence: vi.fn().mockResolvedValue({
    status: "CLEAN",
    sha256: "a".repeat(64),
    provider: "test-scanner",
    detail: "CLEAN",
  }),
}));

vi.mock("../services/dispute-evidence-provenance.service.js", () => ({
  createSignedDisputeEvidenceProvenance: vi
    .fn()
    .mockImplementation(
      ({ disputeId, evidenceId, sourceContentSha256, artifacts, generatedAt }) => ({
        manifest: {
          schema: "haggle.dispute-evidence-derived-artifacts.v1",
          dispute_id: disputeId,
          evidence_id: evidenceId,
          source_content_sha256: sourceContentSha256,
          verifier_provider: "test-vision",
          generated_at: generatedAt.toISOString(),
          artifact_count: artifacts.length,
          artifacts_sha256: "b".repeat(64),
        },
        signature: {
          algorithm: "Ed25519",
          key_id: "test-key",
          public_key_spki_base64: "test-public-key",
          value_base64: "test-signature",
        },
      }),
    ),
}));

vi.mock("../services/dispute-evidence-provenance-archive.service.js", () => ({
  enqueueDisputeEvidenceProvenanceArchive: vi
    .fn()
    .mockResolvedValue({ outcome: "enqueued", archive: { id: "archive-1" } }),
  getDisputeEvidenceProvenanceArchiveHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    pending: 0,
    processing: 0,
    failed: 0,
    deadLetter: 0,
    delivered: 1,
    staleProcessing: 0,
    eligibleEvidence: 1,
    archivedEvidence: 1,
    coverageGap: 0,
    coveragePercent: 100,
    recordedAt: "2026-07-12T00:00:00.000Z",
  }),
  getDisputeEvidenceProvenanceArchivePolicyStatus: vi.fn(() => ({
    configured: false,
    configurationState: "not_configured",
    jobEnabled: false,
  })),
  listDisputeEvidenceProvenanceArchiveFailures: vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null, recordedAt: "2026-07-12T00:00:00.000Z" }),
  requeueDisputeEvidenceProvenanceArchive: vi
    .fn()
    .mockResolvedValue({ outcome: "already_queued", archive: { status: "PENDING" } }),
}));

vi.mock("../services/dispute-evidence-provenance-archive-alert.service.js", () => ({
  getDisputeEvidenceProvenanceArchiveAlertPolicyStatus: vi.fn(() => ({
    configured: false,
    configurationState: "not_configured",
    jobEnabled: false,
  })),
  getDisputeEvidenceProvenanceArchiveAlertDeliveryState: vi.fn().mockResolvedValue({
    incidentOpen: false,
    lastIncidentAlertAt: null,
    lastRecoveryAlertAt: null,
  }),
}));

vi.mock("../services/dispute-camera-challenge.service.js", () => ({
  verifyCameraChallenge: vi.fn().mockResolvedValue({
    status: "VERIFIED",
    provider: "test-vision",
    detail: "CHALLENGE_VERIFIED",
    confidence: 0.99,
    detectedText: "HAGGLE-VERIFY-123",
    visualObservations: [
      { category: "visible_damage", observation: "Scratch on the camera body", confidence: 0.88 },
    ],
  }),
}));

vi.mock("../services/dispute-image-similarity.service.js", () => ({
  CAMERA_SIMILARITY_REVIEW_DISTANCE: 6,
  CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE: 14,
  CAMERA_SIMILARITY_COLOR_DISTANCE: 20,
  computeImageSimilarityFingerprint: vi.fn().mockResolvedValue({
    dHash: "01".repeat(32),
    aHash: "10".repeat(32),
    colorHistogram: Array(12).fill(64),
  }),
}));

vi.mock("../services/dispute-evidence-retention.service.js", () => ({
  evidenceRetentionPolicy: vi.fn(() => ({ committedDays: 90, orphanDays: 7, batchSize: 50 })),
  getDisputeEvidenceRetentionSummary: vi.fn().mockResolvedValue(null),
  setDisputeEvidenceLegalHold: vi.fn().mockResolvedValue(true),
}));

vi.mock("../jobs/dispute-evidence-retention.js", () => ({
  runDisputeEvidenceRetention: vi.fn().mockResolvedValue({
    dry_run: true,
    eligible: 0,
    claimed: 0,
    deleted: 0,
    failed: 0,
    held: 0,
  }),
}));

vi.mock("../services/dispute-ai.service.js", () => ({
  buildDisputeAiCaseContextFromDispute: vi.fn((dispute, options = {}) => ({
    dispute_id: dispute.id,
    tier: options.tier ?? 1,
    opened_by: dispute.opened_by,
    reason_code: dispute.reason_code,
    transaction: {
      amount_minor: options.transaction?.amount_minor ?? 0,
      currency: options.transaction?.currency ?? "USDC",
      status: options.transaction?.status ?? "UNKNOWN",
    },
    party_statements: {},
    evidence: dispute.evidence ?? [],
    policy: options.policy,
  })),
  createDisputeAiProvider: vi.fn(() => ({ completeJson: vi.fn() })),
  resolveDisputeAiModel: vi.fn(() => "deepseek-v4-pro"),
  runResolutionAssessor: vi.fn(),
}));

vi.mock("../services/dispute-precedent.service.js", () => ({
  listApprovedDisputePrecedents: vi.fn().mockResolvedValue([]),
  toResolutionAssessorPrecedentExamples: vi.fn(
    (precedents: Array<{ id: string; analysis_version: string; policy_version: string }>) =>
      precedents.map((precedent) => ({ id: precedent.id })),
  ),
  buildDisputePrecedentSnapshot: vi.fn(
    (
      precedents: Array<{
        id: string;
        analysis_version: string;
        policy_version: string;
      }>,
    ) => ({
      ids: precedents.map((precedent) => precedent.id),
      analysis_versions: [...new Set(precedents.map((precedent) => precedent.analysis_version))],
      policy_versions: [...new Set(precedents.map((precedent) => precedent.policy_version))],
      sha256:
        precedents.length === 0
          ? "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
          : "a".repeat(64),
    }),
  ),
}));

vi.mock("../services/dispute-ai-assessment-event.service.js", () => ({
  appendDisputeAiAssessmentEvent: vi.fn().mockResolvedValue(undefined),
  listDisputeAiAssessmentEvents: vi.fn().mockResolvedValue([]),
  verifyDisputeAiAssessmentEventChain: vi.fn((events) => ({
    valid: true,
    sealed_events: events.filter((event: { eventHash?: string | null }) => Boolean(event.eventHash))
      .length,
    legacy_unsealed_events: events.filter(
      (event: { eventHash?: string | null }) => !event.eventHash,
    ).length,
    head_event_hash: events.at(-1)?.eventHash ?? null,
  })),
}));

vi.mock("../services/dispute-ai-assessment-lease.service.js", () => ({
  acquireDisputeAiAssessmentLease: vi.fn(),
  releaseDisputeAiAssessmentLease: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/dispute-operation-lease.service.js", () => ({
  acquireDisputeOperationLease: vi.fn(),
  disputeOperationLeaseKey: vi.fn((disputeId, operation) => `${disputeId}:${operation}`),
  releaseDisputeOperationLease: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/dispute-ai-audit-export.service.js", () => {
  class DisputeAuditSigningNotConfiguredError extends Error {}
  return {
    DisputeAuditSigningNotConfiguredError,
    createSignedDisputeAiAuditExport: vi.fn().mockReturnValue({
      manifest: {
        schema: "haggle.dispute-ai-audit.v1",
        dispute_id: "some-id",
        event_count: 0,
        chain_valid: true,
      },
      events: [],
      signature: {
        algorithm: "Ed25519",
        key_id: "abc123",
        public_key_spki_base64: "public-key",
        value_base64: "signature",
      },
    }),
  };
});

vi.mock("../services/dispute-ai-audit-archive.service.js", () => ({
  enqueueDisputeAiAuditArchive: vi.fn(),
  getLatestDisputeAiAuditArchive: vi.fn(),
  getDisputeAiAuditArchiveHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    pending: 0,
    processing: 0,
    failed: 0,
    deadLetter: 0,
    staleProcessing: 0,
    retryReady: 0,
    overdueUnfinished: 0,
    unfinishedMaxAgeMinutes: 15,
    oldestUnfinishedAgeSeconds: null,
    recordedAt: "2026-07-12T00:00:00.000Z",
  }),
  getDisputeAiAuditArchiveCoverage: vi.fn().mockResolvedValue({
    status: "healthy",
    totalChains: 0,
    eligibleChains: 0,
    archivedCurrent: 0,
    eligibleUnarchived: 0,
    overdueEligibleUnarchived: 0,
    blockedUnsealed: 0,
    blockedOversized: 0,
    coveragePercent: 100,
    oldestUnarchivedAgeSeconds: null,
    coverageMaxAgeMinutes: 15,
    maxExportEvents: 10_000,
    recordedAt: "2026-07-12T00:00:00.000Z",
  }),
  getDisputeAiAuditDiscoveryFailureHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    open: 0,
    invalidChain: 0,
    tooLarge: 0,
    unsealed: 0,
    resolvedLast24h: 0,
    oldestOpenAgeSeconds: null,
    recordedAt: "2026-07-12T00:00:00.000Z",
  }),
  listDisputeAiAuditDiscoveryFailures: vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null, recordedAt: "2026-07-12T00:00:00.000Z" }),
  retryDisputeAiAuditDiscoveryFailure: vi.fn().mockResolvedValue({ outcome: "not_found" }),
  listDisputeAiAuditArchiveFailures: vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null, recordedAt: "2026-07-12T00:00:00.000Z" }),
  requeueDisputeAiAuditArchive: vi.fn().mockResolvedValue({ outcome: "not_found" }),
  getDisputeAiAuditArchivePolicyStatus: vi.fn(() => ({
    configured: false,
    configurationState: "partial",
    jobEnabled: false,
    maxExportEvents: 10_000,
  })),
}));
vi.mock("../services/dispute-ai-audit-archive-alert.service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../services/dispute-ai-audit-archive-alert.service.js")
  >()),
  getDisputeAiAuditArchiveAlertDeliveryState: vi.fn().mockResolvedValue({
    incidentOpen: false,
    lastIncidentAlertAt: null,
    lastRecoveryAlertAt: null,
  }),
}));

vi.mock("../services/dispute-deposit.service.js", () => ({
  getDepositByDisputeId: vi.fn().mockResolvedValue(null),
  createDeposit: vi.fn().mockResolvedValue(null),
  getPendingExpiredDeposits: vi.fn().mockResolvedValue([]),
  updateDepositStatus: vi.fn().mockResolvedValue(null),
  updateDepositMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/authentication-record.service.js", () => ({
  getAuthenticationByOrderId: vi.fn().mockResolvedValue(null),
  createAuthenticationRecord: vi.fn().mockResolvedValue(null),
  updateAuthenticationRecord: vi.fn().mockResolvedValue(null),
  getAuthenticationById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-score.service.js", () => ({
  computeAndStoreTrustScore: vi.fn().mockResolvedValue(null),
  getTrustScore: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/ds-rating.service.js", () => ({
  submitDSRating: vi.fn().mockResolvedValue(null),
  getDSRatings: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/arp-segment.service.js", () => ({
  getARPSegment: vi.fn().mockResolvedValue(null),
  computeAndStoreARPSegment: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/tag.service.js", () => ({
  getTagsForUser: vi.fn().mockResolvedValue([]),
  addTag: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/intent.service.js", () => ({
  getIntentById: vi.fn().mockResolvedValue(null),
  createIntent: vi.fn().mockResolvedValue(null),
  listIntents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/skill.service.js", () => ({
  getSkillById: vi.fn().mockResolvedValue(null),
  listSkills: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/draft.service.js", () => ({
  getDraftById: vi.fn().mockResolvedValue(null),
  listDrafts: vi.fn().mockResolvedValue([]),
  createDraft: vi.fn().mockResolvedValue(null),
  updateDraft: vi.fn().mockResolvedValue(null),
  deleteDraft: vi.fn().mockResolvedValue(null),
  publishDraft: vi.fn().mockResolvedValue(null),
}));

import { runDisputeEvidenceRetention } from "../jobs/dispute-evidence-retention.js";
import {
  buildDisputeAiCaseContextFromDispute,
  runResolutionAssessor,
} from "../services/dispute-ai.service.js";
import {
  appendDisputeAiAssessmentEvent,
  listDisputeAiAssessmentEvents,
} from "../services/dispute-ai-assessment-event.service.js";
import {
  acquireDisputeAiAssessmentLease,
  releaseDisputeAiAssessmentLease,
} from "../services/dispute-ai-assessment-lease.service.js";
import {
  enqueueDisputeAiAuditArchive,
  getDisputeAiAuditArchiveCoverage,
  getDisputeAiAuditArchiveHealth,
  getDisputeAiAuditDiscoveryFailureHealth,
  getLatestDisputeAiAuditArchive,
  listDisputeAiAuditArchiveFailures,
  listDisputeAiAuditDiscoveryFailures,
  requeueDisputeAiAuditArchive,
  retryDisputeAiAuditDiscoveryFailure,
} from "../services/dispute-ai-audit-archive.service.js";
import { createSignedDisputeAiAuditExport } from "../services/dispute-ai-audit-export.service.js";
import { verifyCameraChallenge } from "../services/dispute-camera-challenge.service.js";
import { createDeposit } from "../services/dispute-deposit.service.js";
import {
  getDisputeEvidenceRetentionSummary,
  setDisputeEvidenceLegalHold,
} from "../services/dispute-evidence-retention.service.js";
import { scanDisputeEvidence } from "../services/dispute-evidence-scan.service.js";
import { computeImageSimilarityFingerprint } from "../services/dispute-image-similarity.service.js";
import {
  acquireDisputeOperationLease,
  releaseDisputeOperationLease,
} from "../services/dispute-operation-lease.service.js";
import { listApprovedDisputePrecedents } from "../services/dispute-precedent.service.js";
import {
  addDisputeEvidenceRecord,
  createDisputeEvidenceUploadRecord,
  createDisputeRecord,
  createDisputeResolutionRecord,
  decideDisputeEvidenceSimilarityReview,
  findNearestCommittedCameraEvidence,
  getDisputeById,
  getDisputeByOrderId,
  getDisputeEvidenceSimilarityReviewHealth,
  getDisputeEvidenceUploadByEvidenceId,
  getDisputeEvidenceUploadById,
  getDisputeEvidenceUploadByPath,
  hasCommittedCameraEvidenceSha256,
  listBlockingDisputeEvidenceUploads,
  listDisputeEvidenceSimilarityReviews,
  markDisputeEvidenceUploadCommitted,
  rejectDisputeEvidenceUpload,
  updateDisputeEvidenceUploadScan,
  updateDisputeEvidenceUploadSimilarity,
  updateDisputeRecord,
} from "../services/dispute-record.service.js";
import { finalizeDisputeResolution } from "../services/dispute-resolution-finalizer.js";
import {
  getDisputeSimilarityReviewAuditArchiveHealth,
  listDisputeSimilarityReviewAuditArchiveFailures,
  requeueDisputeSimilarityReviewAuditArchive,
} from "../services/dispute-similarity-review-audit-archive.service.js";
import { createSignedDisputeSimilarityReviewAuditExport } from "../services/dispute-similarity-review-audit-export.service.js";
import {
  getDisputeSimilarityReviewExpiryEventById,
  listDisputeSimilarityReviewExpiryEvents,
} from "../services/dispute-similarity-review-expiry.service.js";
import {
  createDisputeUploadUrl,
  createDisputeViewUrl,
  disputeEvidenceExists,
  downloadDisputeEvidence,
} from "../services/dispute-storage.service.js";
// Import mocked service functions for per-test overrides
import {
  createRefundRecord,
  getCommerceOrderByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import { createSettlementReleaseRecord } from "../services/settlement-release.service.js";
import { getShipmentByOrderId } from "../services/shipment-record.service.js";

const mockGetCommerceOrderByOrderId = getCommerceOrderByOrderId as ReturnType<typeof vi.fn>;
const mockUpdateCommerceOrderStatus = updateCommerceOrderStatus as ReturnType<typeof vi.fn>;
const mockCreateRefundRecord = createRefundRecord as ReturnType<typeof vi.fn>;
const mockCreateSettlementReleaseRecord = createSettlementReleaseRecord as ReturnType<typeof vi.fn>;
const mockFinalizeDisputeResolution = finalizeDisputeResolution as ReturnType<typeof vi.fn>;
const mockGetShipmentByOrderId = getShipmentByOrderId as ReturnType<typeof vi.fn>;
const mockCreateDisputeRecord = createDisputeRecord as ReturnType<typeof vi.fn>;
const mockCreateDisputeEvidenceUploadRecord = createDisputeEvidenceUploadRecord as ReturnType<
  typeof vi.fn
>;
const mockGetDisputeEvidenceUploadByPath = getDisputeEvidenceUploadByPath as ReturnType<
  typeof vi.fn
>;
const mockGetDisputeEvidenceUploadById = getDisputeEvidenceUploadById as ReturnType<typeof vi.fn>;
const mockGetDisputeEvidenceUploadByEvidenceId = getDisputeEvidenceUploadByEvidenceId as ReturnType<
  typeof vi.fn
>;
const mockHasCommittedCameraEvidenceSha256 = hasCommittedCameraEvidenceSha256 as ReturnType<
  typeof vi.fn
>;
const mockFindNearestCommittedCameraEvidence = findNearestCommittedCameraEvidence as ReturnType<
  typeof vi.fn
>;
const mockListDisputeEvidenceSimilarityReviews = listDisputeEvidenceSimilarityReviews as ReturnType<
  typeof vi.fn
>;
const mockGetDisputeEvidenceSimilarityReviewHealth =
  getDisputeEvidenceSimilarityReviewHealth as ReturnType<typeof vi.fn>;
const mockDecideDisputeEvidenceSimilarityReview =
  decideDisputeEvidenceSimilarityReview as ReturnType<typeof vi.fn>;
const mockListBlockingDisputeEvidenceUploads = listBlockingDisputeEvidenceUploads as ReturnType<
  typeof vi.fn
>;
const mockGetDisputeById = getDisputeById as ReturnType<typeof vi.fn>;
const mockGetDisputeByOrderId = getDisputeByOrderId as ReturnType<typeof vi.fn>;
const mockMarkDisputeEvidenceUploadCommitted = markDisputeEvidenceUploadCommitted as ReturnType<
  typeof vi.fn
>;
const mockUpdateDisputeEvidenceUploadScan = updateDisputeEvidenceUploadScan as ReturnType<
  typeof vi.fn
>;
const mockUpdateDisputeEvidenceUploadSimilarity =
  updateDisputeEvidenceUploadSimilarity as ReturnType<typeof vi.fn>;
const mockRejectDisputeEvidenceUpload = rejectDisputeEvidenceUpload as ReturnType<typeof vi.fn>;
const mockAddDisputeEvidenceRecord = addDisputeEvidenceRecord as ReturnType<typeof vi.fn>;
const mockUpdateDisputeRecord = updateDisputeRecord as ReturnType<typeof vi.fn>;
const mockCreateDisputeResolutionRecord = createDisputeResolutionRecord as ReturnType<typeof vi.fn>;
const mockCreateDeposit = createDeposit as ReturnType<typeof vi.fn>;
const mockCreateDisputeUploadUrl = createDisputeUploadUrl as ReturnType<typeof vi.fn>;
const mockCreateDisputeViewUrl = createDisputeViewUrl as ReturnType<typeof vi.fn>;
const mockDisputeEvidenceExists = disputeEvidenceExists as ReturnType<typeof vi.fn>;
const mockDownloadDisputeEvidence = downloadDisputeEvidence as ReturnType<typeof vi.fn>;
const mockScanDisputeEvidence = scanDisputeEvidence as ReturnType<typeof vi.fn>;
const mockVerifyCameraChallenge = verifyCameraChallenge as ReturnType<typeof vi.fn>;
const mockComputeImageSimilarityFingerprint = computeImageSimilarityFingerprint as ReturnType<
  typeof vi.fn
>;
const mockListDisputeSimilarityReviewExpiryEvents =
  listDisputeSimilarityReviewExpiryEvents as ReturnType<typeof vi.fn>;
const mockGetDisputeSimilarityReviewExpiryEventById =
  getDisputeSimilarityReviewExpiryEventById as ReturnType<typeof vi.fn>;
const mockCreateSignedDisputeSimilarityReviewAuditExport =
  createSignedDisputeSimilarityReviewAuditExport as ReturnType<typeof vi.fn>;
const mockGetDisputeSimilarityReviewAuditArchiveHealth =
  getDisputeSimilarityReviewAuditArchiveHealth as ReturnType<typeof vi.fn>;
const mockListDisputeSimilarityReviewAuditArchiveFailures =
  listDisputeSimilarityReviewAuditArchiveFailures as ReturnType<typeof vi.fn>;
const mockRequeueDisputeSimilarityReviewAuditArchive =
  requeueDisputeSimilarityReviewAuditArchive as ReturnType<typeof vi.fn>;
const mockGetDisputeEvidenceRetentionSummary = getDisputeEvidenceRetentionSummary as ReturnType<
  typeof vi.fn
>;
const mockSetDisputeEvidenceLegalHold = setDisputeEvidenceLegalHold as ReturnType<typeof vi.fn>;
const mockRunDisputeEvidenceRetention = runDisputeEvidenceRetention as ReturnType<typeof vi.fn>;
const mockRunResolutionAssessor = runResolutionAssessor as ReturnType<typeof vi.fn>;
const mockBuildDisputeAiCaseContextFromDispute = buildDisputeAiCaseContextFromDispute as ReturnType<
  typeof vi.fn
>;
const mockListApprovedDisputePrecedents = listApprovedDisputePrecedents as ReturnType<typeof vi.fn>;
const mockAppendDisputeAiAssessmentEvent = appendDisputeAiAssessmentEvent as ReturnType<
  typeof vi.fn
>;
const mockListDisputeAiAssessmentEvents = listDisputeAiAssessmentEvents as ReturnType<typeof vi.fn>;
const mockAcquireDisputeAiAssessmentLease = acquireDisputeAiAssessmentLease as ReturnType<
  typeof vi.fn
>;
const mockReleaseDisputeAiAssessmentLease = releaseDisputeAiAssessmentLease as ReturnType<
  typeof vi.fn
>;
const mockAcquireDisputeOperationLease = acquireDisputeOperationLease as ReturnType<typeof vi.fn>;
const mockReleaseDisputeOperationLease = releaseDisputeOperationLease as ReturnType<typeof vi.fn>;
const mockCreateSignedDisputeAiAuditExport = createSignedDisputeAiAuditExport as ReturnType<
  typeof vi.fn
>;
const mockEnqueueDisputeAiAuditArchive = enqueueDisputeAiAuditArchive as ReturnType<typeof vi.fn>;
const mockGetLatestDisputeAiAuditArchive = getLatestDisputeAiAuditArchive as ReturnType<
  typeof vi.fn
>;
const mockGetDisputeAiAuditArchiveHealth = getDisputeAiAuditArchiveHealth as ReturnType<
  typeof vi.fn
>;
const _mockGetDisputeAiAuditArchiveCoverage = getDisputeAiAuditArchiveCoverage as ReturnType<
  typeof vi.fn
>;
const _mockGetDisputeAiAuditDiscoveryFailureHealth =
  getDisputeAiAuditDiscoveryFailureHealth as ReturnType<typeof vi.fn>;
const mockListDisputeAiAuditDiscoveryFailures = listDisputeAiAuditDiscoveryFailures as ReturnType<
  typeof vi.fn
>;
const mockRetryDisputeAiAuditDiscoveryFailure = retryDisputeAiAuditDiscoveryFailure as ReturnType<
  typeof vi.fn
>;
const mockListDisputeAiAuditArchiveFailures = listDisputeAiAuditArchiveFailures as ReturnType<
  typeof vi.fn
>;
const mockRequeueDisputeAiAuditArchive = requeueDisputeAiAuditArchive as ReturnType<typeof vi.fn>;

/** Fake order that satisfies the ownership middleware. */
function fakeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord_123",
    buyerId: "test-user-001",
    sellerId: "test-seller-001",
    amountMinor: 50000,
    status: "DELIVERED",
    ...overrides,
  };
}

function fakeShipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "shp_123",
    order_id: "ord_123",
    seller_id: "test-seller-001",
    buyer_id: "test-user-001",
    shipment_type: "outbound",
    status: "LABEL_CREATED",
    carrier: "USPS",
    selected_rate_id: "rate_ground",
    label_created_at: new Date().toISOString(),
    metadata: {
      prepared_rate_quotes: [
        {
          id: "rate_ground",
          carrier: "USPS",
          service: "GroundAdvantage",
          est_delivery_days: 3,
        },
      ],
    },
    events: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Fake dispute record. */
function fakeDispute(overrides: Record<string, unknown> = {}) {
  return {
    id: "some-id",
    order_id: "ord_123",
    reason_code: "ITEM_NOT_AS_DESCRIBED",
    opened_by: "buyer",
    status: "OPEN",
    evidence: [],
    metadata: { tier: 1 },
    ...overrides,
  };
}

function fakeEvidenceUpload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    disputeId: "some-id",
    uploadedBy: "buyer",
    evidenceType: "image",
    contentType: "image/png",
    fileSizeBytes: 1234,
    storagePath: "dispute-evidence/some-id/uploaded.png",
    status: "PENDING",
    scanStatus: "PENDING",
    contentSha256: null,
    cameraSessionId: null,
    captureDeclaredSha256: null,
    perceptualHash: null,
    averageHash: null,
    colorHistogram: null,
    similaritySignals: null,
    similarityStatus: "PENDING",
    similarityDistance: null,
    similarityReviewedBy: null,
    similarityReviewedAt: null,
    retentionStatus: "ACTIVE",
    retentionUntil: null,
    deletionClaimId: null,
    deletionClaimedAt: null,
    deletionAttempts: 0,
    deletionNextAttemptAt: null,
    deletionLastError: null,
    deletedAt: null,
    scanProvider: null,
    scanDetail: null,
    scannedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    committedEvidenceId: null,
    committedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeCameraSession(
  id: string,
  storagePath: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    dispute_id: "some-id",
    party: "buyer" as const,
    user_id: "test-user-001",
    device_mode: "mobile" as const,
    challenge_code: "HAGGLE-VERIFY-123",
    status: "UPLOAD_URL_ISSUED" as const,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    capture_url: `https://api.test/disputes/some-id/camera-capture?session_id=${id}`,
    qr_payload: `https://api.test/disputes/some-id/camera-capture?session_id=${id}`,
    storage_path: storagePath,
    ...overrides,
  };
}

describe("Dispute routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(() => {
    resetRateLimitsForTests();
    resetTestContractLedgerForTests();
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] })
      .__HAGGLE_TEST_DB_SELECT_ROWS__;
    mockGetCommerceOrderByOrderId.mockResolvedValue(null);
    mockGetShipmentByOrderId.mockResolvedValue(null);
    mockGetDisputeById.mockResolvedValue(null);
    mockGetDisputeByOrderId.mockResolvedValue(null);
    mockCreateDisputeRecord.mockResolvedValue(null);
    mockUpdateCommerceOrderStatus.mockResolvedValue(null);
    mockCreateDisputeEvidenceUploadRecord.mockResolvedValue(null);
    mockGetDisputeEvidenceUploadByPath.mockResolvedValue(null);
    mockGetDisputeEvidenceUploadById.mockResolvedValue(null);
    mockDecideDisputeEvidenceSimilarityReview.mockResolvedValue({ outcome: "approved" });
    mockGetDisputeSimilarityReviewExpiryEventById.mockResolvedValue(null);
    mockGetDisputeSimilarityReviewAuditArchiveHealth.mockResolvedValue({
      status: "healthy",
      pending: 0,
      processing: 0,
      failed: 0,
      deadLetter: 0,
      staleProcessing: 0,
      retryReady: 0,
      overdueUnfinished: 0,
      unfinishedMaxAgeMinutes: 15,
      oldestUnfinishedAgeSeconds: null,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    mockListDisputeSimilarityReviewAuditArchiveFailures.mockResolvedValue({
      items: [],
      nextCursor: null,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    mockRequeueDisputeSimilarityReviewAuditArchive.mockResolvedValue({ outcome: "not_found" });
    mockGetDisputeEvidenceUploadByEvidenceId.mockResolvedValue(null);
    mockHasCommittedCameraEvidenceSha256.mockResolvedValue(false);
    mockFindNearestCommittedCameraEvidence.mockResolvedValue(null);
    mockMarkDisputeEvidenceUploadCommitted.mockResolvedValue(true);
    mockAddDisputeEvidenceRecord.mockResolvedValue(null);
    mockUpdateDisputeEvidenceUploadScan.mockResolvedValue(undefined);
    mockUpdateDisputeEvidenceUploadSimilarity.mockResolvedValue(undefined);
    mockRejectDisputeEvidenceUpload.mockResolvedValue(undefined);
    mockListBlockingDisputeEvidenceUploads.mockResolvedValue([]);
    mockUpdateDisputeRecord.mockResolvedValue(null);
    mockCreateDeposit.mockResolvedValue(null);
    mockCreateDisputeUploadUrl.mockImplementation(async (objectPath: string) => ({
      uploadUrl: `https://upload.example/${objectPath}`,
      storagePath: `dispute-evidence/${objectPath}`,
      token: "upload-token",
      expiresIn: 600,
    }));
    mockDisputeEvidenceExists.mockResolvedValue(true);
    mockDownloadDisputeEvidence.mockResolvedValue(Buffer.from("test-evidence"));
    mockScanDisputeEvidence.mockResolvedValue({
      status: "CLEAN",
      sha256: "a".repeat(64),
      provider: "test-scanner",
      detail: "CLEAN",
    });
    mockVerifyCameraChallenge.mockResolvedValue({
      status: "VERIFIED",
      provider: "test-vision",
      detail: "CHALLENGE_VERIFIED",
      confidence: 0.99,
      detectedText: "HAGGLE-VERIFY-123",
      visualObservations: [
        { category: "visible_damage", observation: "Scratch on the camera body", confidence: 0.88 },
      ],
    });
    mockComputeImageSimilarityFingerprint.mockResolvedValue({
      dHash: "01".repeat(32),
      aHash: "10".repeat(32),
      colorHistogram: Array(12).fill(64),
    });
    mockGetDisputeEvidenceRetentionSummary.mockResolvedValue(null);
    mockSetDisputeEvidenceLegalHold.mockResolvedValue(true);
    mockRunDisputeEvidenceRetention.mockResolvedValue({
      dry_run: true,
      eligible: 0,
      claimed: 0,
      deleted: 0,
      failed: 0,
      held: 0,
    });
    mockRunResolutionAssessor.mockResolvedValue({
      ok: true,
      role: "resolution_assessor",
      displayName: "Resolution Assessor",
      schemaName: "dispute_ai_resolution_assessor_v2",
      contextHash: "ctx_test_1",
      output: {
        recommended_outcome: "buyer_favor",
        confidence: "medium",
        buyer_score: 0.8,
        seller_score: 0.2,
        rationale: "Buyer camera evidence is stronger.",
        evidence_findings: ["Buyer submitted verified camera evidence."],
        precedent_comparisons: [],
        missing_evidence: [],
        risk_flags: [],
        escalation_required: false,
        next_actions: ["Prepare manual resolution review."],
      },
      model: "mock-dispute-ai",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      cost: null,
    });
    mockListApprovedDisputePrecedents.mockResolvedValue([]);
    mockAppendDisputeAiAssessmentEvent.mockResolvedValue(undefined);
    mockListDisputeAiAssessmentEvents.mockResolvedValue([]);
    mockAcquireDisputeAiAssessmentLease.mockImplementation(async (_db, input) => ({
      ...input,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    }));
    mockReleaseDisputeAiAssessmentLease.mockResolvedValue(undefined);
    mockAcquireDisputeOperationLease.mockImplementation(async (_db, input) => ({
      key: `${input.disputeId}:${input.operation}`,
      ...input,
      expiresAt: new Date(Date.now() + 60_000),
    }));
    mockReleaseDisputeOperationLease.mockResolvedValue(undefined);
    mockCreateSignedDisputeAiAuditExport.mockClear();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // POST /orders/:orderId/disputes - hardened public open path
  it("POST /orders/:orderId/disputes derives buyer role and freezes the order", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Battery health was listed as 92%, but the phone reports 72%.",
        client_request_id: "open-001",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.opened_by).toBe("buyer");
    expect(body.order_status).toBe("IN_DISPUTE");
    expect(body.idempotent).toBe(false);
    expect(body.dispute.opened_by).toBe("buyer");
    expect(body.dispute.metadata.client_request_id).toBe("open-001");
    expect(mockCreateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        order_id: "ord_123",
        opened_by: "buyer",
      }),
    );
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
      expect.anything(),
      "ord_123",
      "IN_DISPUTE",
    );
    expect(body.test_contract_lock).toEqual({
      locked: false,
      reason: "NO_TEST_CONTRACT",
    });
  });

  it("POST /orders/:orderId/disputes auto-locks fake-money test-contract ledger at L1 open", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);
    fundTestContract({
      order_id: "ord_123",
      payment_intent_id: "pi_fake_b2",
      amount_minor: 50_000,
    });

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Battery health mismatch — lock fake-money escrow",
        client_request_id: "b2-lock-open-001",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.order_status).toBe("IN_DISPUTE");
    expect(body.test_contract_lock).toMatchObject({
      locked: true,
      idempotent: false,
      test_contract: {
        order_id: "ord_123",
        status: "DISPUTED",
        invariant_checks: { dispute_blocks_buyer_confirm: true },
      },
    });
    expect(getTestContractByOrderId("ord_123")?.dispute_id).toBe(body.dispute.id);
  });

  it("GET /orders/:orderId/dispute-eligibility explains why delivery is not due", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(
      fakeOrder({ status: "FULFILLMENT_ACTIVE" }),
    );
    mockGetShipmentByOrderId.mockResolvedValueOnce(fakeShipment());

    const res = await app.inject({
      method: "GET",
      url: "/orders/ord_123/dispute-eligibility",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.shipment_status).toBe("LABEL_CREATED");
    expect(body.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ITEM_NOT_RECEIVED",
          eligible: false,
          error: "DELIVERY_NOT_DUE",
        }),
      ]),
    );
  });

  it("POST /orders/:orderId/disputes blocks item-not-received before carrier acceptance", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(
      fakeOrder({ status: "FULFILLMENT_ACTIVE" }),
    );
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);
    mockGetShipmentByOrderId.mockResolvedValueOnce(fakeShipment());

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_RECEIVED",
        summary: "The label was just created but I did not receive the item.",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "DELIVERY_NOT_DUE",
      reason_code: "ITEM_NOT_RECEIVED",
    });
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalled();
  });

  it("POST /orders/:orderId/disputes cannot bypass shipping gates with a refund reason", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(
      fakeOrder({ status: "FULFILLMENT_ACTIVE" }),
    );
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);
    mockGetShipmentByOrderId.mockResolvedValueOnce(fakeShipment());

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "REFUND_DISPUTE",
        summary: "Trying an unrelated reason before a refund exists.",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("REFUND_NOT_RECORDED");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalled();
  });

  it("POST /orders/:orderId/disputes rejects users who are not order parties", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(
      fakeOrder({
        buyerId: "someone-else",
        sellerId: "another-user",
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Battery condition is materially different.",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  it("POST /orders/:orderId/disputes rejects non-disputable order states", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder({ status: "PAYMENT_PENDING" }));
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_RECEIVED",
        summary: "I have not received the item.",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "ORDER_NOT_DISPUTABLE",
      order_status: "PAYMENT_PENDING",
      blocking_gate: "payment_not_settled",
    });
    expect(res.json().staging_fixture.endpoint).toBe(
      "POST /tools/payment-test/dispute-ready-order",
    );
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  it("POST /orders/:orderId/disputes returns existing dispute for matching idempotency key", async () => {
    const existing = fakeDispute({
      id: "dsp_existing",
      metadata: { client_request_id: "open-001", tier: 1 },
    });
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder({ status: "IN_DISPUTE" }));
    mockGetDisputeByOrderId.mockResolvedValueOnce(existing);

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Retrying the same open request.",
        client_request_id: "open-001",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().idempotent).toBe(true);
    expect(res.json().dispute.id).toBe("dsp_existing");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  it("POST /orders/:orderId/disputes blocks a second active dispute", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder({ status: "IN_DISPUTE" }));
    mockGetDisputeByOrderId.mockResolvedValueOnce(
      fakeDispute({
        id: "dsp_existing",
        metadata: { client_request_id: "open-001", tier: 1 },
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Trying to create a different active dispute.",
        client_request_id: "open-002",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ACTIVE_DISPUTE_EXISTS");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/review rejects dispute parties and requires an admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/review",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ADMIN_REQUIRED");
    expect(mockUpdateDisputeRecord).not.toHaveBeenCalled();
  });

  // POST /disputes - schema validation
  it("POST /disputes returns 400 without body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_DISPUTE_REQUEST");
  });

  it("POST /disputes returns 400 with missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: { order_id: "ord_123" }, // missing reason_code and opened_by
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_DISPUTE_REQUEST");
    expect(res.json().issues).toBeDefined();
  });

  it("POST /disputes rejects oversized evidence text", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: {
        order_id: "ord_123",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        opened_by: "buyer",
        evidence: [
          {
            submitted_by: "buyer",
            type: "text",
            text: "x".repeat(10_001),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_DISPUTE_REQUEST");
  });

  it("POST /disputes rejects initial file evidence that bypasses quarantine", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: {
        order_id: "ord_123",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        opened_by: "buyer",
        evidence: [
          {
            submitted_by: "buyer",
            type: "image",
            uri: "https://example.test/unscanned.png",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("FILE_EVIDENCE_UPLOAD_REQUIRED");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes returns 400 with invalid reason_code", async () => {
    // Route checks order existence before reason_code validity
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: {
        order_id: "ord_123",
        reason_code: "TOTALLY_INVALID_CODE",
        opened_by: "buyer",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_REASON_CODE");
  });

  it("POST /disputes maps a concurrent active-dispute conflict to 409", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());
    mockCreateDisputeRecord.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "dispute_cases_active_order_uidx"'),
    );

    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: {
        order_id: "ord_123",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        opened_by: "buyer",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ACTIVE_DISPUTE_EXISTS");
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalled();
  });

  // GET /disputes/:id
  it("GET /disputes/:id returns 404 for nonexistent dispute", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/disputes/nonexistent-id",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  // GET /disputes/by-order/:orderId
  it("GET /disputes/by-order/:orderId returns 404 for unknown order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/disputes/by-order/ord_unknown",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  it("POST /disputes/:id/evidence/upload-url rejects unsafe filenames", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "../escape.png",
        content_type: "image/png",
        file_size_bytes: 1234,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_PATH");
    expect(mockCreateDisputeEvidenceUploadRecord).not.toHaveBeenCalled();
    expect(mockCreateDisputeUploadUrl).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/upload-url records a pending upload intent", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "battery.png",
        content_type: "image/png",
        file_size_bytes: 1234,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().evidence_type).toBe("image");
    expect(res.json().storage_path).toContain("dispute-evidence/some-id/");
    expect(mockCreateDisputeEvidenceUploadRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disputeId: "some-id",
        uploadedBy: "buyer",
        evidenceType: "image",
        contentType: "image/png",
        fileSizeBytes: 1234,
      }),
    );
    // Controlled Evidence intent stores media metadata only — never card PAN.
    expect(mockCreateDisputeEvidenceUploadRecord.mock.calls[0][1]).not.toHaveProperty("pan");
    expect(JSON.stringify(res.json())).not.toMatch(/\bpan\b/i);
  });

  it("POST /disputes/:id/evidence/upload-url rejects unsupported mime types", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "receipt.pdf",
        content_type: "application/pdf",
        file_size_bytes: 1234,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("UNSUPPORTED_CONTENT_TYPE");
    expect(mockCreateDisputeEvidenceUploadRecord).not.toHaveBeenCalled();
    expect(mockCreateDisputeUploadUrl).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/upload-url rejects oversized images", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "huge.png",
        content_type: "image/png",
        file_size_bytes: 10 * 1024 * 1024 + 1,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("FILE_TOO_LARGE");
    expect(mockCreateDisputeEvidenceUploadRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/upload-url rejects non-party callers", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(
      fakeOrder({ buyerId: "other-buyer", sellerId: "other-seller" }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "battery.png",
        content_type: "image/png",
        file_size_bytes: 1234,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
    expect(mockCreateDisputeEvidenceUploadRecord).not.toHaveBeenCalled();
    expect(mockCreateDisputeUploadUrl).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence marks a completed AI assessment stale", async () => {
    const assessedEvidenceHash = createHash("sha256").update(JSON.stringify([])).digest("hex");
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          ai_resolution_assessor: {
            status: "COMPLETED",
            assessment_id: "asm_before_text",
            evidence_snapshot_hash: assessedEvidenceHash,
          },
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence",
      headers: AUTH_HEADERS,
      payload: {
        submitted_by: "seller",
        type: "text",
        text: "Battery health screenshot was captured after delivery.",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().dispute.metadata).toMatchObject({
      ai_assessment_stale: true,
      ai_assessment_stale_reason: "EVIDENCE_ADDED",
      ai_assessment_previous_evidence_snapshot_hash: assessedEvidenceHash,
    });
    expect(res.json().dispute.metadata.ai_assessment_current_evidence_snapshot_hash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(res.json().dispute.metadata.ai_assessment_current_evidence_snapshot_hash).not.toBe(
      assessedEvidenceHash,
    );
  });

  it("POST /disputes/:id/evidence rejects file URI evidence outside the quarantined upload flow", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute({ status: "UNDER_REVIEW" }));
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence",
      headers: AUTH_HEADERS,
      payload: {
        submitted_by: "buyer",
        type: "image",
        uri: "https://example.test/unscanned.png",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("FILE_EVIDENCE_UPLOAD_REQUIRED");
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/camera-session creates a camera capture window", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/camera-session",
      headers: { ...AUTH_HEADERS, host: "api.test" },
      payload: {
        device_mode: "qr",
        expires_in_seconds: 300,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.camera_session.device_mode).toBe("qr");
    expect(body.camera_session.test_only).toBe(false);
    expect(body.camera_session.used_for_dispute).toBe(true);
    expect(body.camera_session.challenge_code).toMatch(/^HAGGLE-/);
    expect(body.camera_session.qr_payload).toContain("/disputes/some-id/camera-capture");
    const captureToken = new URL(body.camera_session.capture_url).hash
      .replace(/^#/, "")
      .split("&")
      .map((entry) => entry.split("="))
      .find(([key]) => key === "capture_token")?.[1];
    expect(captureToken).toBeTruthy();
    const persistedPayload = mockUpdateDisputeRecord.mock.calls.at(-1)?.[1] as {
      metadata?: { camera_capture_sessions?: Record<string, { capture_token_hash?: string }> };
    };
    const persistedSession = Object.values(
      persistedPayload.metadata?.camera_capture_sessions ?? {},
    )[0];
    expect(persistedSession?.capture_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(persistedPayload)).not.toContain(String(captureToken));
    expect(body.policy.accepted_evidence_source).toBe("haggle_camera_only");
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          camera_capture_sessions: expect.any(Object),
        }),
      }),
    );
  });

  it("POST /disputes/:id/evidence/camera-session uses the configured public API origin", async () => {
    const originalPublicApiUrl = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = "https://api.tryhaggle.ai/callback-path";
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    try {
      const res = await app.inject({
        method: "POST",
        url: "/disputes/some-id/evidence/camera-session",
        headers: { ...AUTH_HEADERS, host: "attacker.example" },
        payload: { device_mode: "qr", expires_in_seconds: 300 },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().camera_session.capture_url).toMatch(
        /^https:\/\/api\.tryhaggle\.ai\/disputes\/some-id\/camera-capture/,
      );
      expect(res.json().camera_session.capture_url).not.toContain("attacker.example");
    } finally {
      if (originalPublicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = originalPublicApiUrl;
    }
  });

  it("GET /disputes/:id/camera-capture renders the mobile capture page for an active session", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: {
          tier: 1,
          camera_capture_sessions: {
            cam_123: {
              id: "cam_123",
              dispute_id: "some-id",
              party: "buyer",
              user_id: "test-user-001",
              device_mode: "qr",
              challenge_code: "HAGGLE-VERIFY-123",
              status: "PENDING",
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
              qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
            },
          },
        },
      }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/disputes/some-id/camera-capture?session_id=cam_123",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.body).toContain("Haggle Camera Evidence");
    expect(res.body).toContain("navigator.mediaDevices.getUserMedia");
    expect(res.body).toContain('window.crypto.subtle.digest("SHA-256"');
    expect(res.body).toContain("capture_sha256: captureSha256");
    expect(res.body).toContain("camera_capture_token");
    expect(res.body).not.toContain("localStorage");
    expect(res.body).toContain("HAGGLE-VERIFY-123");
  });

  it("POST /disputes/:id/evidence/upload-url binds image uploads to camera sessions", async () => {
    const session = {
      id: "cam_123",
      dispute_id: "some-id",
      party: "buyer",
      user_id: "test-user-001",
      device_mode: "mobile",
      challenge_code: "HAGGLE-VERIFY-123",
      status: "PENDING",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
      qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: {
          tier: 1,
          camera_capture_sessions: { cam_123: session },
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "camera.jpg",
        content_type: "image/jpeg",
        file_size_bytes: 1234,
        camera_session_id: "cam_123",
        capture_sha256: "a".repeat(64),
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().camera_session.status).toBe("UPLOAD_URL_ISSUED");
    expect(res.json().camera_session.storage_path).toContain("dispute-evidence/some-id/");
    expect(res.json().camera_commit_token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          camera_capture_sessions: expect.objectContaining({
            cam_123: expect.objectContaining({
              status: "UPLOAD_URL_ISSUED",
              content_type: "image/jpeg",
              capture_declared_sha256: "a".repeat(64),
              capture_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          }),
        }),
      }),
    );
    expect(mockCreateDisputeEvidenceUploadRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cameraSessionId: "cam_123",
        captureDeclaredSha256: "a".repeat(64),
      }),
    );
  });

  it("POST /disputes/:id/evidence/upload-url rejects an invalid scoped camera token", async () => {
    const validToken = "a".repeat(43);
    const session = {
      id: "cam_scoped_token",
      dispute_id: "some-id",
      party: "buyer",
      user_id: "test-user-001",
      device_mode: "mobile",
      challenge_code: "HAGGLE-VERIFY-789",
      status: "PENDING",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_scoped_token",
      qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_scoped_token",
      capture_token_hash: createHash("sha256").update(validToken).digest("hex"),
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: { tier: 1, camera_capture_sessions: { cam_scoped_token: session } },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "camera.jpg",
        content_type: "image/jpeg",
        file_size_bytes: 1234,
        camera_session_id: "cam_scoped_token",
        camera_capture_token: "b".repeat(43),
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("INVALID_CAMERA_CAPTURE_TOKEN");
    expect(mockCreateDisputeEvidenceUploadRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/upload-url requires a capture hash for real camera evidence", async () => {
    const session = fakeCameraSession("cam_hash_required", "", { status: "PENDING" });
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: { tier: 1, camera_capture_sessions: { cam_hash_required: session } },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "camera.jpg",
        content_type: "image/jpeg",
        file_size_bytes: 1234,
        camera_session_id: "cam_hash_required",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CAMERA_CAPTURE_HASH_REQUIRED");
    expect(mockCreateDisputeEvidenceUploadRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/upload-url rejects video for camera sessions", async () => {
    const session = {
      id: "cam_123",
      dispute_id: "some-id",
      party: "buyer",
      user_id: "test-user-001",
      device_mode: "mobile",
      challenge_code: "HAGGLE-VERIFY-123",
      status: "PENDING",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
      qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: {
          tier: 1,
          camera_capture_sessions: { cam_123: session },
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "camera.mp4",
        content_type: "video/mp4",
        file_size_bytes: 1234,
        camera_session_id: "cam_123",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CAMERA_SESSION_IMAGE_ONLY");
    expect(mockCreateDisputeEvidenceUploadRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/commit rejects cross-dispute or traversal storage paths", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const cross = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/other-id/uploaded.png",
        type: "image",
      },
    });
    expect(cross.statusCode).toBe(400);
    expect(cross.json().error).toBe("INVALID_STORAGE_PATH");

    const traversal = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/../other-id/uploaded.png",
        type: "image",
      },
    });
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json().error).toBe("INVALID_STORAGE_PATH");
    expect(mockGetDisputeEvidenceUploadByPath).not.toHaveBeenCalled();
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/commit rejects unissued storage paths", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
        description: "Battery screen",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("UPLOAD_INTENT_NOT_FOUND");
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/commit rejects type mismatches", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      disputeId: "some-id",
      uploadedBy: "buyer",
      evidenceType: "image",
      contentType: "image/png",
      fileSizeBytes: 1234,
      storagePath: "dispute-evidence/some-id/uploaded.png",
      status: "PENDING",
      scanStatus: "PENDING",
      contentSha256: null,
      cameraSessionId: null,
      captureDeclaredSha256: null,
      scanProvider: null,
      scanDetail: null,
      scannedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      committedEvidenceId: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "video",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("EVIDENCE_TYPE_MISMATCH");
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/commit commits a matching pending upload", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      disputeId: "some-id",
      uploadedBy: "buyer",
      evidenceType: "image",
      contentType: "image/png",
      fileSizeBytes: 1234,
      storagePath: "dispute-evidence/some-id/uploaded.png",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      committedEvidenceId: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
        description: "Battery screen",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().evidence.uri).toBe("dispute-evidence/some-id/uploaded.png");
    expect(mockDisputeEvidenceExists).toHaveBeenCalledWith("some-id/uploaded.png");
    expect(mockAddDisputeEvidenceRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dispute_id: "some-id",
        submitted_by: "buyer",
        type: "image",
        uri: "dispute-evidence/some-id/uploaded.png",
      }),
    );
    expect(mockMarkDisputeEvidenceUploadCommitted).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
      expect.any(String),
      false,
    );
  });

  it("POST /disputes/:id/evidence/commit quarantines a file while malware scanning is pending", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(fakeEvidenceUpload());
    mockScanDisputeEvidence.mockResolvedValueOnce({
      status: "PENDING",
      sha256: "b".repeat(64),
      provider: "not-configured",
      detail: "MALWARE_SCANNER_NOT_CONFIGURED",
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
        description: "Battery screen",
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      status: "EVIDENCE_QUARANTINED",
      scan_status: "PENDING",
      retryable: true,
    });
    expect(mockUpdateDisputeEvidenceUploadScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        status: "PENDING",
        sha256: "b".repeat(64),
      }),
    );
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
    expect(mockMarkDisputeEvidenceUploadCommitted).not.toHaveBeenCalled();
  });

  it("does not race an active scanner retry lease", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(
      fakeEvidenceUpload({
        status: "QUARANTINED",
        scanStatus: "SCANNING",
        scanLeaseToken: "33333333-3333-4333-8333-333333333333",
        scanLeaseExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
        description: "Battery screen",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      status: "EVIDENCE_QUARANTINED",
      scan_status: "SCANNING",
      retryable: true,
    });
    expect(mockDisputeEvidenceExists).not.toHaveBeenCalled();
    expect(mockDownloadDisputeEvidence).not.toHaveBeenCalled();
    expect(mockScanDisputeEvidence).not.toHaveBeenCalled();
  });

  it("reuses a worker CLEAN result when the user retries a non-camera commit", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(
      fakeEvidenceUpload({
        status: "QUARANTINED",
        scanStatus: "CLEAN",
        contentSha256: "a".repeat(64),
        scanProvider: "scanner.example.test",
        scanDetail: "CLEAN",
      }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
        description: "Battery screen",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockDownloadDisputeEvidence).not.toHaveBeenCalled();
    expect(mockScanDisputeEvidence).not.toHaveBeenCalled();
    expect(mockUpdateDisputeEvidenceUploadScan).not.toHaveBeenCalled();
    expect(mockMarkDisputeEvidenceUploadCommitted).toHaveBeenCalledOnce();
  });

  it("POST /disputes/:id/evidence/commit rejects a file that fails integrity scanning", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(fakeEvidenceUpload());
    mockScanDisputeEvidence.mockResolvedValueOnce({
      status: "INFECTED",
      sha256: "c".repeat(64),
      provider: "haggle-integrity",
      detail: "CONTENT_TYPE_MISMATCH",
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("EVIDENCE_FILE_REJECTED");
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/commit commits verified camera evidence", async () => {
    const session = {
      id: "cam_123",
      dispute_id: "some-id",
      party: "buyer",
      user_id: "test-user-001",
      device_mode: "mobile",
      challenge_code: "HAGGLE-VERIFY-123",
      status: "UPLOAD_URL_ISSUED",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
      qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
      storage_path: "dispute-evidence/some-id/uploaded.png",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: {
          tier: 1,
          camera_capture_sessions: { cam_123: session },
          ai_resolution_assessor: {
            status: "COMPLETED",
            assessment_id: "asm_before_camera",
            evidence_snapshot_hash: createHash("sha256").update(JSON.stringify([])).digest("hex"),
          },
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      disputeId: "some-id",
      uploadedBy: "buyer",
      evidenceType: "image",
      contentType: "image/png",
      fileSizeBytes: 1234,
      storagePath: "dispute-evidence/some-id/uploaded.png",
      status: "PENDING",
      scanStatus: "PENDING",
      contentSha256: null,
      cameraSessionId: "cam_123",
      captureDeclaredSha256: "a".repeat(64),
      scanProvider: null,
      scanDetail: null,
      scannedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      committedEvidenceId: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
        description: "Item condition photo",
        camera_session_id: "cam_123",
        captured_at: "2026-07-02T12:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().camera_session.status).toBe("COMMITTED");
    expect(res.json().visual_observation_provenance).toMatchObject({
      status: "SIGNED",
      artifact_count: 1,
      external_archive: "enqueued",
    });
    expect(res.json().ai_assessment_state).toMatchObject({
      stale: true,
      stale_reason: "CAMERA_EVIDENCE_COMMITTED",
    });
    expect(mockAddDisputeEvidenceRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: expect.stringContaining("[Verified Haggle Camera Evidence]"),
        derived_artifacts: [
          expect.objectContaining({
            kind: "image_visual_observation",
            source_evidence_id: expect.any(String),
            text: "Scratch on the camera body",
            metadata: expect.objectContaining({
              category: "visible_damage",
              confidence: 0.88,
              provider: "test-vision",
            }),
          }),
        ],
      }),
    );
    expect(mockVerifyCameraChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeCode: "HAGGLE-VERIFY-123",
      }),
    );
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          ai_assessment_stale: true,
          ai_assessment_stale_reason: "CAMERA_EVIDENCE_COMMITTED",
          camera_capture_sessions: expect.objectContaining({
            cam_123: expect.objectContaining({
              status: "COMMITTED",
              challenge_verification: expect.objectContaining({
                status: "VERIFIED",
                provider: "test-vision",
              }),
              committed_evidence_id: expect.any(String),
            }),
          }),
        }),
      }),
    );
    expect(mockHasCommittedCameraEvidenceSha256).toHaveBeenCalledWith(
      expect.anything(),
      "a".repeat(64),
    );
    expect(res.json().capture_binding).toMatchObject({
      status: "VERIFIED",
      declared_sha256: "a".repeat(64),
      content_sha256: "a".repeat(64),
      exact_reuse_checked: true,
    });
  });

  it("rejects camera bytes that differ from the capture-page hash binding", async () => {
    const path = "dispute-evidence/some-id/hash-mismatch.png";
    const session = fakeCameraSession("cam_hash_mismatch", path);
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: { tier: 1, camera_capture_sessions: { cam_hash_mismatch: session } },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(
      fakeEvidenceUpload({
        storagePath: path,
        cameraSessionId: "cam_hash_mismatch",
        captureDeclaredSha256: "b".repeat(64),
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: { storage_path: path, type: "image", camera_session_id: "cam_hash_mismatch" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("CAMERA_CAPTURE_HASH_MISMATCH");
    expect(mockRejectDisputeEvidenceUpload).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "haggle-capture-binding",
      "CAMERA_CAPTURE_HASH_MISMATCH",
    );
    expect(mockVerifyCameraChallenge).not.toHaveBeenCalled();
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("rejects exact reuse of previously committed camera bytes", async () => {
    const path = "dispute-evidence/some-id/reused-camera.png";
    const session = fakeCameraSession("cam_reused", path);
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: { tier: 1, camera_capture_sessions: { cam_reused: session } },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(
      fakeEvidenceUpload({
        storagePath: path,
        cameraSessionId: "cam_reused",
        captureDeclaredSha256: "a".repeat(64),
      }),
    );
    mockHasCommittedCameraEvidenceSha256.mockResolvedValueOnce(true);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: { storage_path: path, type: "image", camera_session_id: "cam_reused" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CAMERA_EVIDENCE_REUSED");
    expect(mockRejectDisputeEvidenceUpload).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "haggle-exact-reuse",
      "CAMERA_EVIDENCE_REUSED",
    );
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
    expect(mockMarkDisputeEvidenceUploadCommitted).not.toHaveBeenCalled();
  });

  it("maps the committed camera hash unique constraint race to a reuse response", async () => {
    const path = "dispute-evidence/some-id/reuse-race.png";
    const session = fakeCameraSession("cam_reuse_race", path);
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: { tier: 1, camera_capture_sessions: { cam_reuse_race: session } },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(
      fakeEvidenceUpload({
        storagePath: path,
        cameraSessionId: "cam_reuse_race",
        captureDeclaredSha256: "a".repeat(64),
      }),
    );
    mockMarkDisputeEvidenceUploadCommitted.mockRejectedValueOnce(
      Object.assign(new Error("duplicate"), {
        code: "23505",
        constraint: "dispute_evidence_uploads_committed_camera_sha256_unique",
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: { storage_path: path, type: "image", camera_session_id: "cam_reuse_race" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CAMERA_EVIDENCE_REUSED");
  });

  it("quarantines a perceptually similar camera image for operator review", async () => {
    const path = "dispute-evidence/some-id/similar-camera.png";
    const session = fakeCameraSession("cam_similar", path);
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: { tier: 1, camera_capture_sessions: { cam_similar: session } },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(
      fakeEvidenceUpload({
        storagePath: path,
        cameraSessionId: "cam_similar",
        captureDeclaredSha256: "a".repeat(64),
      }),
    );
    mockFindNearestCommittedCameraEvidence.mockResolvedValueOnce({
      uploadId: "prior-upload",
      distance: 3,
      assessment: {
        reviewRequired: true,
        dHashDistance: 3,
        aHashDistance: 5,
        colorDistance: 8.5,
        matchedSignals: ["dhash_near", "ahash_near", "structure_color_combined"],
        score: 0.4,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: { storage_path: path, type: "image", camera_session_id: "cam_similar" },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      status: "CAMERA_SIMILARITY_REVIEW_REQUIRED",
      similarity: {
        status: "REVIEW_REQUIRED",
        distance: 3,
        threshold: 6,
        distances: { dhash: 3, ahash: 5, color: 8.5 },
        matched_signals: ["dhash_near", "ahash_near", "structure_color_combined"],
      },
      retryable: false,
    });
    expect(mockUpdateDisputeEvidenceUploadSimilarity).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        status: "REVIEW_REQUIRED",
        distance: 3,
        averageHash: "10".repeat(32),
        colorHistogram: Array(12).fill(64),
        signals: expect.objectContaining({
          matched_signals: expect.arrayContaining(["dhash_near", "ahash_near"]),
        }),
      }),
    );
    expect(mockMarkDisputeEvidenceUploadCommitted).not.toHaveBeenCalled();
  });

  it("allows an admin to approve a pending camera similarity review", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetDisputeEvidenceUploadById.mockResolvedValue(
      fakeEvidenceUpload({
        id: "11111111-1111-4111-8111-111111111111",
        status: "QUARANTINED",
        cameraSessionId: "cam_review",
        perceptualHash: "01".repeat(32),
        similarityStatus: "REVIEW_REQUIRED",
        similarityDistance: 4,
      }),
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/disputes/some-id/evidence-uploads/11111111-1111-4111-8111-111111111111/similarity-review",
      headers: ADMIN_HEADERS,
      payload: { decision: "approve", note: "Same item, newly captured challenge is visible" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      similarity_status: "APPROVED",
      next_action: "retry_evidence_commit",
    });
    expect(mockDecideDisputeEvidenceSimilarityReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disputeId: "some-id",
        uploadId: "11111111-1111-4111-8111-111111111111",
        reviewerId: "test-admin-001",
        decision: "approve",
      }),
    );
  });

  it("lists review-required images with safe signed previews for admins", async () => {
    mockListDisputeEvidenceSimilarityReviews.mockResolvedValueOnce({
      items: [
        {
          uploadId: "11111111-1111-4111-8111-111111111111",
          disputeId: "33333333-3333-4333-8333-333333333333",
          uploadedBy: "buyer",
          contentType: "image/jpeg",
          fileSizeBytes: 1234,
          storagePath: "private/review.jpg",
          matchedUploadId: "44444444-4444-4444-8444-444444444444",
          matchedStoragePath: "private/reference.jpg",
          similarityDistance: 4,
          similaritySignals: {
            distances: { dhash: 4, ahash: 2, color: 5 },
            matched_signals: ["dhash_near"],
          },
          expiresAt: "2026-07-13T00:00:00.000Z",
          createdAt: "2026-07-12T00:00:00.000Z",
          waitingAgeSeconds: 3600,
          dueInSeconds: 82_800,
        },
      ],
      nextCursor: null,
      recordedAt: "2026-07-12T01:00:00.000Z",
    });
    mockCreateDisputeViewUrl
      .mockResolvedValueOnce("https://view.example/signed-review")
      .mockResolvedValueOnce("https://view.example/signed-reference");
    const res = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-reviews?limit=20",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      similarity_review_queue: {
        items: [
          {
            upload_id: "11111111-1111-4111-8111-111111111111",
            preview_url: "https://view.example/signed-review",
            preview_status: "ready",
            reference_preview_url: "https://view.example/signed-reference",
            reference_preview_status: "ready",
            distances: { dhash: 4, ahash: 2, color: 5 },
            matched_signals: ["dhash_near"],
          },
        ],
      },
    });
    expect(res.body).not.toContain("private/review.jpg");
    expect(res.body).not.toContain("private/reference.jpg");
    expect(res.body).not.toContain("44444444-4444-4444-8444-444444444444");
    expect(res.body).not.toContain("similaritySignals");
  });

  it("marks a failed preview URL unavailable without failing the review queue", async () => {
    mockListDisputeEvidenceSimilarityReviews.mockResolvedValueOnce({
      items: [
        {
          uploadId: "11111111-1111-4111-8111-111111111111",
          disputeId: "33333333-3333-4333-8333-333333333333",
          uploadedBy: "buyer",
          contentType: "image/jpeg",
          fileSizeBytes: 1234,
          storagePath: "private/missing.jpg",
          similarityDistance: 4,
          similaritySignals: null,
          expiresAt: "2026-07-13T00:00:00.000Z",
          createdAt: "2026-07-12T00:00:00.000Z",
          waitingAgeSeconds: 1,
          dueInSeconds: 10,
        },
      ],
      nextCursor: null,
      recordedAt: "2026-07-12T00:00:01.000Z",
    });
    mockCreateDisputeViewUrl.mockRejectedValueOnce(new Error("storage unavailable"));
    const res = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-reviews",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      similarity_review_queue: { items: [{ preview_url: null, preview_status: "unavailable" }] },
    });
  });

  it("keeps the submitted preview available when only the reference preview fails", async () => {
    mockListDisputeEvidenceSimilarityReviews.mockResolvedValueOnce({
      items: [
        {
          uploadId: "11111111-1111-4111-8111-111111111111",
          disputeId: "33333333-3333-4333-8333-333333333333",
          uploadedBy: "buyer",
          contentType: "image/jpeg",
          fileSizeBytes: 1234,
          storagePath: "private/review.jpg",
          matchedUploadId: "44444444-4444-4444-8444-444444444444",
          matchedStoragePath: "private/missing-reference.jpg",
          similarityDistance: 4,
          similaritySignals: null,
          expiresAt: "2026-07-13T00:00:00.000Z",
          createdAt: "2026-07-12T00:00:00.000Z",
          waitingAgeSeconds: 1,
          dueInSeconds: 10,
        },
      ],
      nextCursor: null,
      recordedAt: "2026-07-12T00:00:01.000Z",
    });
    mockCreateDisputeViewUrl
      .mockResolvedValueOnce("https://view.example/submitted")
      .mockRejectedValueOnce(new Error("reference storage unavailable"));

    const res = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-reviews",
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      similarity_review_queue: {
        items: [
          {
            preview_url: "https://view.example/submitted",
            preview_status: "ready",
            reference_preview_url: null,
            reference_preview_status: "unavailable",
          },
        ],
      },
    });
  });

  it("blocks non-admin users from the image similarity review queue", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-reviews",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(403);
    expect(mockListDisputeEvidenceSimilarityReviews).not.toHaveBeenCalled();
  });

  it("returns aggregate similarity review SLA health only to admins", async () => {
    mockGetDisputeEvidenceSimilarityReviewHealth.mockResolvedValueOnce({
      status: "attention",
      pendingReviews: 3,
      overdueSla: 2,
      dueSoon: 1,
      expiredUnresolved: 0,
      oldestPendingAgeSeconds: 1200,
      recordedAt: "2026-07-12T01:00:00.000Z",
      autoExpiredLast24Hours: 4,
      lastAutoExpiredAt: "2026-07-12T00:30:00.000Z",
    });
    const res = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-reviews/health",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      similarity_review_health: {
        status: "attention",
        pendingReviews: 3,
        overdueSla: 2,
        dueSoon: 1,
        expiredUnresolved: 0,
        oldestPendingAgeSeconds: 1200,
        autoExpiredLast24Hours: 4,
        lastAutoExpiredAt: "2026-07-12T00:30:00.000Z",
      },
    });
    expect(res.body).not.toContain("upload_id");
    expect(res.body).not.toContain("storage");

    const denied = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-reviews/health",
      headers: AUTH_HEADERS,
    });
    expect(denied.statusCode).toBe(403);
  });

  it("lists safe automatic expiry history only to admins", async () => {
    mockListDisputeSimilarityReviewExpiryEvents.mockResolvedValueOnce({
      items: [
        {
          eventId: "11111111-1111-4111-8111-111111111111",
          uploadId: "22222222-2222-4222-8222-222222222222",
          disputeId: "33333333-3333-4333-8333-333333333333",
          eventType: "AUTO_EXPIRED",
          actorKind: "system",
          reason: "REVIEW_WINDOW_EXPIRED",
          reviewExpiresAt: "2026-07-12T00:00:00.000Z",
          createdAt: "2026-07-12T00:01:00.000Z",
        },
      ],
      nextCursor: "opaque-next",
    });
    const res = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-review-events?limit=20",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      similarity_review_expiry_events: {
        items: [
          { event_type: "AUTO_EXPIRED", actor_kind: "system", reason: "REVIEW_WINDOW_EXPIRED" },
        ],
        next_cursor: "opaque-next",
      },
    });
    expect(res.body).not.toContain("storage_path");
    expect(res.body).not.toContain("metadata");

    const denied = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-review-events",
      headers: AUTH_HEADERS,
    });
    expect(denied.statusCode).toBe(403);
  });

  it("exports only a valid sealed automatic expiry event", async () => {
    const hashable = {
      schema: "haggle.dispute-similarity-review-event.v1",
      event_id: "11111111-1111-4111-8111-111111111111",
      upload_id: "22222222-2222-4222-8222-222222222222",
      dispute_id: "33333333-3333-4333-8333-333333333333",
      event_type: "AUTO_EXPIRED",
      actor_id: null,
      reason: "REVIEW_WINDOW_EXPIRED",
      review_expires_at: "2026-07-12T00:00:00.000Z",
      created_at: "2026-07-12T00:01:00.000Z",
    };
    mockGetDisputeSimilarityReviewExpiryEventById.mockResolvedValueOnce({
      eventId: hashable.event_id,
      uploadId: hashable.upload_id,
      disputeId: hashable.dispute_id,
      eventType: "AUTO_EXPIRED",
      actorKind: "system",
      reason: "REVIEW_WINDOW_EXPIRED",
      reviewExpiresAt: hashable.review_expires_at,
      createdAt: hashable.created_at,
      eventHash: "a".repeat(64),
      integrity: "valid",
      hashable,
    });
    mockCreateSignedDisputeSimilarityReviewAuditExport.mockReturnValueOnce({
      manifest: {
        schema: "haggle.dispute-similarity-review-audit.v1",
        event_id: hashable.event_id,
        integrity_valid: true,
      },
      event: hashable,
      signature: {
        algorithm: "Ed25519",
        key_id: "key-1",
        public_key_spki_base64: "public",
        value_base64: "signed",
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `/admin/disputes/evidence-similarity-review-events/${hashable.event_id}/export`,
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      similarity_review_audit_export: {
        manifest: { event_id: hashable.event_id, integrity_valid: true },
        signature: { algorithm: "Ed25519" },
      },
    });

    mockGetDisputeSimilarityReviewExpiryEventById.mockResolvedValueOnce({
      eventHash: "a".repeat(64),
      integrity: "invalid",
      hashable,
    });
    const invalid = await app.inject({
      method: "GET",
      url: `/admin/disputes/evidence-similarity-review-events/${hashable.event_id}/export`,
      headers: ADMIN_HEADERS,
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json()).toEqual({
      error: "SIMILARITY_REVIEW_AUDIT_INTEGRITY_INVALID",
      integrity: "invalid",
    });
  });

  it("returns aggregate archive health and a payload-free failure queue to admins", async () => {
    mockGetDisputeSimilarityReviewAuditArchiveHealth.mockResolvedValueOnce({
      status: "critical",
      pending: 0,
      processing: 0,
      failed: 0,
      deadLetter: 1,
      staleProcessing: 0,
      retryReady: 0,
      overdueUnfinished: 1,
      unfinishedMaxAgeMinutes: 15,
      oldestUnfinishedAgeSeconds: 1200,
      recordedAt: "2026-07-12T01:00:00.000Z",
    });
    mockListDisputeSimilarityReviewAuditArchiveFailures.mockResolvedValueOnce({
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          eventId: "22222222-2222-4222-8222-222222222222",
          payloadSha256: "a".repeat(64),
          status: "DEAD_LETTER",
          attemptCount: 3,
          nextAttemptAt: "2026-07-12T01:00:00.000Z",
          lastError: "ARCHIVE_RECEIPT_HASH_MISMATCH",
          httpStatus: 201,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:30:00.000Z",
          failureAgeSeconds: 1800,
        },
      ],
      nextCursor: null,
      recordedAt: "2026-07-12T01:00:00.000Z",
    });
    const health = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-review-audit-archives/health",
      headers: ADMIN_HEADERS,
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      similarity_review_audit_archive_health: { status: "critical", deadLetter: 1 },
      alerting: {
        wouldAlert: true,
        severity: "critical",
        reasons: expect.arrayContaining(["similarity_audit_archive_dead_letter"]),
      },
    });
    const failures = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-review-audit-archives/failures",
      headers: ADMIN_HEADERS,
    });
    expect(failures.statusCode).toBe(200);
    expect(failures.json()).toMatchObject({
      similarity_review_audit_archive_failures: {
        items: [{ status: "DEAD_LETTER", attempt_count: 3 }],
      },
    });
    expect(failures.body).not.toContain('payload"');
    expect(failures.body).not.toContain("archive_key");
    const denied = await app.inject({
      method: "GET",
      url: "/admin/disputes/evidence-similarity-review-audit-archives/health",
      headers: AUTH_HEADERS,
    });
    expect(denied.statusCode).toBe(403);
  });

  it("requeues a failed archive with an operator reason", async () => {
    mockRequeueDisputeSimilarityReviewAuditArchive.mockResolvedValueOnce({
      outcome: "requeued",
      archive: { status: "PENDING" },
    });
    const eventId = "22222222-2222-4222-8222-222222222222";
    const res = await app.inject({
      method: "POST",
      url: `/admin/disputes/evidence-similarity-review-audit-archives/${eventId}/requeue`,
      headers: ADMIN_HEADERS,
      payload: { reason: "The WORM endpoint recovered after operator verification." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ event_id: eventId, outcome: "requeued", status: "PENDING" });
    expect(mockRequeueDisputeSimilarityReviewAuditArchive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId,
        actorId: "test-admin-001",
      }),
    );
  });

  it("lets an admin reject a reused-looking camera image", async () => {
    mockDecideDisputeEvidenceSimilarityReview.mockResolvedValueOnce({ outcome: "rejected" });
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetDisputeEvidenceUploadById.mockResolvedValue(
      fakeEvidenceUpload({
        id: "22222222-2222-4222-8222-222222222222",
        status: "QUARANTINED",
        cameraSessionId: "cam_review_reject",
        perceptualHash: "10".repeat(32),
        similarityStatus: "REVIEW_REQUIRED",
        similarityDistance: 1,
      }),
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/disputes/some-id/evidence-uploads/22222222-2222-4222-8222-222222222222/similarity-review",
      headers: ADMIN_HEADERS,
      payload: { decision: "reject", note: "Prior image reuse confirmed" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      similarity_status: "REJECTED",
      next_action: "capture_new_photo",
    });
    expect(mockDecideDisputeEvidenceSimilarityReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disputeId: "some-id",
        uploadId: "22222222-2222-4222-8222-222222222222",
        reviewerId: "test-admin-001",
        decision: "reject",
      }),
    );
  });

  it("returns conflict when another admin wins the similarity review race", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetDisputeEvidenceUploadById.mockResolvedValue(
      fakeEvidenceUpload({
        status: "QUARANTINED",
        similarityStatus: "REVIEW_REQUIRED",
      }),
    );
    mockDecideDisputeEvidenceSimilarityReview.mockResolvedValueOnce({ outcome: "not_pending" });

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/disputes/some-id/evidence-uploads/11111111-1111-4111-8111-111111111111/similarity-review",
      headers: ADMIN_HEADERS,
      payload: { decision: "approve", note: "Concurrent reviewer" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "SIMILARITY_REVIEW_NOT_PENDING" });
  });

  it("returns an admin evidence retention and legal hold summary", async () => {
    mockGetDisputeEvidenceRetentionSummary.mockResolvedValueOnce({
      legalHold: true,
      legalHoldReason: "Regulatory request",
      total: 3,
      active: 2,
      deleting: 0,
      failed: 0,
      deleted: 1,
      nextRetentionAt: new Date("2026-10-01T00:00:00.000Z"),
    });
    const res = await app.inject({
      method: "GET",
      url: "/admin/disputes/some-id/evidence-retention",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      policy: { committed_days_after_resolution: 90, orphan_days_after_expiry: 7 },
      retention: { legalHold: true, total: 3, deleted: 1 },
    });
  });

  it("sets an evidence legal hold before deletion is claimed", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/disputes/some-id/evidence-legal-hold",
      headers: ADMIN_HEADERS,
      payload: { active: true, reason: "Chargeback investigation in progress" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ legal_hold: true });
    expect(mockSetDisputeEvidenceLegalHold).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disputeId: "some-id",
        active: true,
        actorId: "test-admin-001",
      }),
    );
  });

  it("refuses a legal hold that races after deletion claim", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockSetDisputeEvidenceLegalHold.mockResolvedValueOnce(false);
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/disputes/some-id/evidence-legal-hold",
      headers: ADMIN_HEADERS,
      payload: { active: true, reason: "Late preservation request" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("EVIDENCE_DELETION_IN_PROGRESS");
  });

  it("runs evidence retention as dry-run by default", async () => {
    mockRunDisputeEvidenceRetention.mockResolvedValueOnce({
      dry_run: true,
      eligible: 4,
      claimed: 0,
      deleted: 0,
      failed: 0,
      held: 0,
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/disputes/evidence-retention/run",
      headers: ADMIN_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: { dry_run: true, eligible: 4, deleted: 0 } });
    expect(mockRunDisputeEvidenceRetention).toHaveBeenCalledWith(expect.anything(), {
      dryRun: true,
    });
  });

  it("returns 410 instead of signing a URL after retained evidence bytes are deleted", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByEvidenceId.mockResolvedValueOnce(
      fakeEvidenceUpload({
        retentionStatus: "DELETED",
        deletedAt: new Date("2026-07-11T12:00:00.000Z"),
      }),
    );
    (
      globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] }
    ).__HAGGLE_TEST_DB_SELECT_ROWS__ = [
      [
        {
          id: "44444444-4444-4444-8444-444444444444",
          disputeId: "some-id",
          uri: "dispute-evidence/some-id/deleted.jpg",
        },
      ],
    ];

    const res = await app.inject({
      method: "GET",
      url: "/disputes/some-id/evidence/44444444-4444-4444-8444-444444444444/view",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe("EVIDENCE_RETAINED_RECORD_FILE_DELETED");
    expect(mockCreateDisputeViewUrl).not.toHaveBeenCalled();
  });

  it("keeps real camera evidence quarantined until server challenge verification succeeds", async () => {
    const session = {
      id: "cam_pending_vision",
      dispute_id: "some-id",
      party: "buyer" as const,
      user_id: "test-user-001",
      device_mode: "mobile" as const,
      challenge_code: "HAGGLE-VERIFY-789",
      status: "UPLOAD_URL_ISSUED" as const,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_pending_vision",
      qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_pending_vision",
      storage_path: "dispute-evidence/some-id/pending-vision.png",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: { tier: 1, camera_capture_sessions: { cam_pending_vision: session } },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(
      fakeEvidenceUpload({
        storagePath: "dispute-evidence/some-id/pending-vision.png",
        cameraSessionId: "cam_pending_vision",
        captureDeclaredSha256: "a".repeat(64),
      }),
    );
    mockVerifyCameraChallenge.mockResolvedValueOnce({
      status: "PENDING",
      provider: "not-configured",
      detail: "CAMERA_CHALLENGE_VERIFIER_NOT_CONFIGURED",
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/pending-vision.png",
        type: "image",
        camera_session_id: "cam_pending_vision",
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      status: "CAMERA_CHALLENGE_VERIFICATION_PENDING",
      challenge_verification: { status: "PENDING" },
      retryable: true,
    });
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
    expect(mockMarkDisputeEvidenceUploadCommitted).not.toHaveBeenCalled();
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          camera_capture_sessions: expect.objectContaining({
            cam_pending_vision: expect.objectContaining({
              challenge_verification: expect.objectContaining({ status: "PENDING" }),
            }),
          }),
        }),
      }),
    );
  });

  it("rejects camera evidence when the server verifier cannot find the session challenge", async () => {
    const session = {
      id: "cam_rejected_vision",
      dispute_id: "some-id",
      party: "buyer" as const,
      user_id: "test-user-001",
      device_mode: "mobile" as const,
      challenge_code: "HAGGLE-VERIFY-999",
      status: "UPLOAD_URL_ISSUED" as const,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      capture_url:
        "https://api.test/disputes/some-id/camera-capture?session_id=cam_rejected_vision",
      qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_rejected_vision",
      storage_path: "dispute-evidence/some-id/rejected-vision.png",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: { tier: 1, camera_capture_sessions: { cam_rejected_vision: session } },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(
      fakeEvidenceUpload({
        storagePath: "dispute-evidence/some-id/rejected-vision.png",
        cameraSessionId: "cam_rejected_vision",
        captureDeclaredSha256: "a".repeat(64),
      }),
    );
    mockVerifyCameraChallenge.mockResolvedValueOnce({
      status: "REJECTED",
      provider: "test-vision",
      detail: "CHALLENGE_NOT_FOUND",
      confidence: 0.95,
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/rejected-vision.png",
        type: "image",
        camera_session_id: "cam_rejected_vision",
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: "CAMERA_CHALLENGE_REJECTED",
      challenge_verification: { status: "REJECTED" },
    });
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("commits a test-only camera capture without adding it to dispute evidence", async () => {
    const session = {
      id: "cam_test_only",
      dispute_id: "some-id",
      party: "buyer" as const,
      user_id: "test-user-001",
      device_mode: "mobile" as const,
      test_only: true,
      challenge_code: "HAGGLE-VERIFY-456",
      status: "UPLOAD_URL_ISSUED" as const,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_test_only",
      qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_test_only",
      storage_path: "dispute-evidence/some-id/test-only.png",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: {
          tier: 1,
          camera_capture_sessions: { cam_test_only: session },
          ai_resolution_assessor: {
            status: "COMPLETED",
            assessment_id: "asm_unchanged_by_test_capture",
            evidence_snapshot_hash: createHash("sha256").update(JSON.stringify([])).digest("hex"),
          },
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      disputeId: "some-id",
      uploadedBy: "buyer",
      evidenceType: "image",
      contentType: "image/png",
      fileSizeBytes: 1234,
      storagePath: "dispute-evidence/some-id/test-only.png",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      committedEvidenceId: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/test-only.png",
        type: "image",
        description: "Camera hardware checkpoint",
        camera_session_id: "cam_test_only",
        captured_at: "2026-07-02T12:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().evidence).toBeNull();
    expect(res.json().test_capture).toEqual(
      expect.objectContaining({
        used_for_dispute: false,
      }),
    );
    expect(res.json().camera_session).toEqual(
      expect.objectContaining({
        status: "COMMITTED",
        test_only: true,
        used_for_dispute: false,
      }),
    );
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
    expect(mockVerifyCameraChallenge).not.toHaveBeenCalled();
    const persisted = mockUpdateDisputeRecord.mock.calls.at(-1)?.[1] as {
      metadata?: Record<string, unknown>;
    };
    expect(persisted.metadata?.ai_assessment_stale).toBeUndefined();
  });

  it("POST /disputes/:id/ai/assess waits for active camera collection unless forced", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: {
          tier: 1,
          camera_capture_sessions: {
            cam_123: {
              id: "cam_123",
              dispute_id: "some-id",
              party: "buyer",
              user_id: "test-user-001",
              device_mode: "mobile",
              challenge_code: "HAGGLE-VERIFY-123",
              status: "PENDING",
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
              qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
            },
          },
        },
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("EVIDENCE_COLLECTION_STILL_OPEN");
    expect(mockRunResolutionAssessor).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/ai/assess blocks quarantined evidence even when force is requested", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute({ status: "UNDER_REVIEW" }));
    mockListBlockingDisputeEvidenceUploads.mockResolvedValueOnce([
      fakeEvidenceUpload({ status: "QUARANTINED", scanStatus: "FAILED" }),
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: { force: true, reassessment_reason: "Operator retry" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("EVIDENCE_SCAN_PENDING");
    expect(mockRunResolutionAssessor).not.toHaveBeenCalled();
    expect(mockAcquireDisputeAiAssessmentLease).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/ai/assess stores the AI judge conclusion after collection closes", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        evidence: [
          {
            id: "ev_1",
            dispute_id: "some-id",
            submitted_by: "buyer",
            type: "image",
            uri: "dispute-evidence/some-id/uploaded.png",
            text: "[Verified Haggle Camera Evidence]\nChallenge confirmed: yes",
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
        metadata: {
          tier: 1,
          camera_capture_sessions: {
            cam_123: {
              id: "cam_123",
              dispute_id: "some-id",
              party: "buyer",
              user_id: "test-user-001",
              device_mode: "mobile",
              challenge_code: "HAGGLE-VERIFY-123",
              status: "COMMITTED",
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              capture_url: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
              qr_payload: "https://api.test/disputes/some-id/camera-capture?session_id=cam_123",
              committed_evidence_id: "ev_1",
            },
          },
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ai_assessment.conclusion).toBe("buyer_favor");
    expect(mockRunResolutionAssessor).toHaveBeenCalledOnce();
    expect(mockReleaseDisputeAiAssessmentLease).toHaveBeenCalledWith(
      expect.anything(),
      "some-id",
      expect.any(String),
    );
    expect(mockAppendDisputeAiAssessmentEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disputeId: "some-id",
        eventType: "COMPLETED",
        revision: 1,
        evidenceSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        payload: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          ai_resolution_assessor: expect.objectContaining({
            status: "COMPLETED",
            conclusion: "buyer_favor",
            auto_applied: false,
          }),
        }),
      }),
    );
  });

  it("POST /disputes/:id/ai/assess does not alone refund or release money (B5)", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        evidence: [
          {
            id: "ev_1",
            dispute_id: "some-id",
            submitted_by: "buyer",
            type: "image",
            uri: "dispute-evidence/some-id/uploaded.png",
            text: "[Verified Haggle Camera Evidence]\nChallenge confirmed: yes",
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
        metadata: { tier: 1 },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ai_assessment).toMatchObject({
      status: "COMPLETED",
      conclusion: "buyer_favor",
      auto_applied: false,
    });
    expect(body.auto_refund).toBeUndefined();
    expect(body.deposit_refund).toBeUndefined();
    expect(body.settlement_release).toBeUndefined();

    // Assessment may persist metadata / audit events, but must not change case
    // status into a money-moving terminal resolution.
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "UNDER_REVIEW",
        metadata: expect.objectContaining({
          ai_resolution_assessor: expect.objectContaining({
            auto_applied: false,
            conclusion: "buyer_favor",
          }),
        }),
      }),
    );

    // Forbidden money side-effects for L1 AI assessment alone.
    expect(mockFinalizeDisputeResolution).not.toHaveBeenCalled();
    expect(mockCreateRefundRecord).not.toHaveBeenCalled();
    expect(mockCreateSettlementReleaseRecord).not.toHaveBeenCalled();
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalled();
    expect(mockCreateDisputeResolutionRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/ai/assess supplies only approved precedents and audits the snapshot", async () => {
    const approvedPrecedent = {
      id: "precedent-approved-1",
      reason_code: "ITEM_NOT_AS_DESCRIBED",
      analysis_version: "analysis-v1",
      policy_version: "policy-v2",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        evidence: [
          {
            id: "ev_image",
            dispute_id: "some-id",
            submitted_by: "buyer",
            type: "image",
            created_at: "2026-07-18T12:00:00.000Z",
          },
        ],
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockListApprovedDisputePrecedents.mockResolvedValue([approvedPrecedent]);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mockListApprovedDisputePrecedents).toHaveBeenCalledWith(
      expect.anything(),
      "ITEM_NOT_AS_DESCRIBED",
      { limit: 5, evidenceTypes: ["image"] },
    );
    expect(mockBuildDisputeAiCaseContextFromDispute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        policy: expect.objectContaining({
          precedent_examples: [{ id: "precedent-approved-1" }],
        }),
      }),
    );
    expect(res.json().ai_assessment).toMatchObject({
      precedent_snapshot: {
        ids: ["precedent-approved-1"],
        analysis_versions: ["analysis-v1"],
        policy_versions: ["policy-v2"],
      },
      precedent_snapshot_hash: "a".repeat(64),
    });
  });

  it("GET /disputes/:id/ai/assessments returns append-only events in chronological order", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute({ status: "UNDER_REVIEW" }));
    mockListDisputeAiAssessmentEvents.mockResolvedValue([
      {
        id: "event_failed",
        disputeId: "some-id",
        eventType: "FAILED",
        revision: null,
        createdAt: new Date("2026-07-11T02:00:00.000Z"),
      },
      {
        id: "event_completed",
        disputeId: "some-id",
        eventType: "COMPLETED",
        revision: 1,
        createdAt: new Date("2026-07-11T01:00:00.000Z"),
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/disputes/some-id/ai/assessments?limit=20",
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().events.map((event: { id: string }) => event.id)).toEqual([
      "event_completed",
      "event_failed",
    ]);
    expect(res.json().summary).toEqual({
      returned: 2,
      completed: 1,
      failed: 1,
      chain_valid: true,
      chain_complete: true,
      chain_genesis_verified: true,
      sealed_events: 0,
      legacy_unsealed_events: 2,
      head_event_hash: null,
    });
    expect(mockListDisputeAiAssessmentEvents).toHaveBeenCalledWith(
      expect.anything(),
      "some-id",
      21,
    );
  });

  it("GET /disputes/:id/ai/assessments/export returns a signed complete audit manifest", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute({ status: "UNDER_REVIEW" }));
    mockListDisputeAiAssessmentEvents.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/disputes/some-id/ai/assessments/export",
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("haggle-dispute-some-id-ai-audit.json");
    expect(res.json()).toMatchObject({
      manifest: { schema: "haggle.dispute-ai-audit.v1", dispute_id: "some-id" },
      signature: { algorithm: "Ed25519" },
    });
    expect(mockListDisputeAiAssessmentEvents).toHaveBeenCalledWith(
      expect.anything(),
      "some-id",
      10_001,
    );
    expect(mockCreateSignedDisputeAiAuditExport).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: "some-id",
        events: [],
        chain: expect.objectContaining({ valid: true, complete: true }),
      }),
    );
  });

  it("queues and reads an AI audit archive without returning its signed payload", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute({ status: "UNDER_REVIEW" }));
    const archive = {
      id: "22222222-2222-4222-8222-222222222222",
      status: "PENDING",
      eventCount: 2,
      eventsSha256: "a".repeat(64),
      chainHeadEventHash: "b".repeat(64),
      payloadSha256: "c".repeat(64),
      attemptCount: 0,
      receiptId: null,
      receiptSha256: null,
      deliveredAt: null,
      lastError: null,
      httpStatus: null,
      createdAt: "2026-07-12T15:00:00.000Z",
      updatedAt: "2026-07-12T15:00:00.000Z",
      payload: { secret: "must-not-leak" },
    };
    mockEnqueueDisputeAiAuditArchive.mockResolvedValueOnce({ outcome: "enqueued", archive });
    const queued = await app.inject({
      method: "POST",
      url: "/admin/disputes/some-id/ai/assessments/archive",
      headers: ADMIN_HEADERS,
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({
      outcome: "enqueued",
      ai_audit_archive: { status: "PENDING", event_count: 2, receipt_matches: false },
    });
    expect(queued.body).not.toContain("must-not-leak");

    mockGetLatestDisputeAiAuditArchive.mockResolvedValueOnce({
      ...archive,
      status: "DELIVERED",
      receiptId: "receipt-1",
      receiptSha256: archive.payloadSha256,
      deliveredAt: archive.updatedAt,
    });
    const loaded = await app.inject({
      method: "GET",
      url: "/admin/disputes/some-id/ai/assessments/archive",
      headers: ADMIN_HEADERS,
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toMatchObject({
      ai_audit_archive: { status: "DELIVERED", receipt_matches: true },
    });
    expect(loaded.body).not.toContain("must-not-leak");
  });

  it("restricts AI audit archive operations to admins and valid chains", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute({ status: "UNDER_REVIEW" }));
    mockEnqueueDisputeAiAuditArchive.mockRejectedValueOnce(new Error("AI_AUDIT_CHAIN_INVALID"));
    const invalid = await app.inject({
      method: "POST",
      url: "/admin/disputes/some-id/ai/assessments/archive",
      headers: ADMIN_HEADERS,
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json()).toEqual({ error: "AI_AUDIT_CHAIN_INVALID" });
    const denied = await app.inject({
      method: "POST",
      url: "/admin/disputes/some-id/ai/assessments/archive",
      headers: AUTH_HEADERS,
    });
    expect(denied.statusCode).toBe(403);
  });

  it("returns aggregate AI archive health and payload-free failures to admins", async () => {
    mockGetDisputeAiAuditArchiveHealth.mockResolvedValueOnce({
      status: "critical",
      pending: 0,
      processing: 0,
      failed: 0,
      deadLetter: 1,
      staleProcessing: 0,
      retryReady: 0,
      overdueUnfinished: 1,
      unfinishedMaxAgeMinutes: 15,
      oldestUnfinishedAgeSeconds: 1200,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    mockListDisputeAiAuditArchiveFailures.mockResolvedValueOnce({
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          disputeId: "some-id",
          eventCount: 2,
          eventsSha256: "a".repeat(64),
          payloadSha256: "b".repeat(64),
          status: "DEAD_LETTER",
          attemptCount: 3,
          nextAttemptAt: "2026-07-12T00:00:00.000Z",
          lastError: "receipt mismatch",
          httpStatus: 201,
          failureAgeSeconds: 60,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      nextCursor: null,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    const health = await app.inject({
      method: "GET",
      url: "/admin/disputes/ai-assessment-audit-archives/health",
      headers: ADMIN_HEADERS,
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().ai_audit_archive_health).toMatchObject({
      status: "critical",
      deadLetter: 1,
    });
    const failures = await app.inject({
      method: "GET",
      url: "/admin/disputes/ai-assessment-audit-archives/failures",
      headers: ADMIN_HEADERS,
    });
    expect(failures.statusCode).toBe(200);
    expect(failures.json().ai_audit_archive_failures.items[0]).toMatchObject({
      status: "DEAD_LETTER",
      event_count: 2,
    });
    expect(failures.body).not.toContain("manifest");
    expect(failures.body).not.toContain("archive_key");
  });

  it("requeues an exact failed AI archive with an operator reason", async () => {
    mockRequeueDisputeAiAuditArchive.mockResolvedValueOnce({
      outcome: "requeued",
      archive: { status: "PENDING" },
    });
    const archiveId = "22222222-2222-4222-8222-222222222222";
    const res = await app.inject({
      method: "POST",
      url: `/admin/disputes/ai-assessment-audit-archives/${archiveId}/requeue`,
      headers: ADMIN_HEADERS,
      payload: { reason: "The WORM receipt endpoint recovered and was verified." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ archive_id: archiveId, outcome: "requeued", status: "PENDING" });
    expect(mockRequeueDisputeAiAuditArchive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ archiveId, actorId: expect.any(String) }),
    );
    const invalid = await app.inject({
      method: "POST",
      url: "/admin/disputes/ai-assessment-audit-archives/not-a-uuid/requeue",
      headers: ADMIN_HEADERS,
      payload: { reason: "The WORM receipt endpoint recovered and was verified." },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "INVALID_AI_AUDIT_ARCHIVE_ID" });
  });

  it("lists payload-free discovery failures and enables one audited retry", async () => {
    mockListDisputeAiAuditDiscoveryFailures.mockResolvedValueOnce({
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          disputeId: "11111111-1111-4111-8111-111111111111",
          eventCount: 3,
          failureCode: "AI_AUDIT_CHAIN_INVALID",
          status: "OPEN",
          attemptCount: 1,
          firstFailedAt: "2026-07-12T00:00:00.000Z",
          lastFailedAt: "2026-07-12T00:00:00.000Z",
          ageSeconds: 60,
        },
      ],
      nextCursor: null,
      recordedAt: "2026-07-12T00:01:00.000Z",
    });
    const listed = await app.inject({
      method: "GET",
      url: "/admin/disputes/ai-assessment-audit-archives/discovery-failures",
      headers: ADMIN_HEADERS,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().ai_audit_discovery_failures.items[0]).toMatchObject({
      event_count: 3,
      failure_code: "AI_AUDIT_CHAIN_INVALID",
      status: "OPEN",
      attempt_count: 1,
    });
    expect(listed.body).not.toContain("payload");
    mockRetryDisputeAiAuditDiscoveryFailure.mockResolvedValueOnce({ outcome: "retry_enabled" });
    const retried = await app.inject({
      method: "POST",
      url: "/admin/disputes/ai-assessment-audit-archives/discovery-failures/11111111-1111-4111-8111-111111111111/retry",
      headers: ADMIN_HEADERS,
      payload: {
        event_count: 3,
        reason: "The chain repair was independently verified before retry.",
      },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ event_count: 3, outcome: "retry_enabled" });
    mockRetryDisputeAiAuditDiscoveryFailure.mockResolvedValueOnce({
      outcome: "retry_already_requested",
    });
    const duplicateRetry = await app.inject({
      method: "POST",
      url: "/admin/disputes/ai-assessment-audit-archives/discovery-failures/11111111-1111-4111-8111-111111111111/retry",
      headers: ADMIN_HEADERS,
      payload: {
        event_count: 3,
        reason: "The chain repair was independently verified before retry.",
      },
    });
    expect(duplicateRetry.statusCode).toBe(409);
    expect(duplicateRetry.json()).toEqual({ error: "AI_AUDIT_DISCOVERY_RETRY_ALREADY_REQUESTED" });
  });

  it("rejects malformed discovery retry identifiers before DB access", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/disputes/ai-assessment-audit-archives/discovery-failures/not-a-uuid/retry",
      headers: ADMIN_HEADERS,
      payload: {
        event_count: 1,
        reason: "The chain repair was independently verified before retry.",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(mockRetryDisputeAiAuditDiscoveryFailure).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/ai/assess reuses a completed assessment unless force is requested", async () => {
    const emptyEvidenceHash = createHash("sha256").update(JSON.stringify([])).digest("hex");
    const completedAssessment = {
      status: "COMPLETED",
      assessed_at: "2026-07-10T00:00:00.000Z",
      context_hash: "ctx_cached",
      model: "deepseek-v4-pro",
      conclusion: "seller_favor",
      confidence: "high",
      evidence_snapshot_hash: emptyEvidenceHash,
      policy_version: "l1-resolution-policy-v2",
      precedent_snapshot_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        metadata: {
          tier: 1,
          ai_resolution_assessor: completedAssessment,
        },
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      dispute_id: "some-id",
      idempotent: true,
      ai_assessment: completedAssessment,
    });
    expect(mockRunResolutionAssessor).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/ai/assess reruns automatically when the evidence snapshot changed", async () => {
    const previousAssessment = {
      assessment_id: "asm_before_evidence",
      version_id: "version_before_evidence",
      revision: 1,
      status: "COMPLETED",
      assessed_at: "2026-07-10T00:00:00.000Z",
      context_hash: "ctx_before_evidence",
      model: "deepseek-v4-pro",
      conclusion: "seller_favor",
      confidence: "high",
      evidence_snapshot_hash: createHash("sha256").update(JSON.stringify([])).digest("hex"),
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        evidence: [
          {
            id: "ev_new",
            dispute_id: "some-id",
            submitted_by: "buyer",
            type: "text",
            text: "New evidence submitted after the first assessment.",
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
        metadata: {
          tier: 1,
          ai_resolution_assessor: previousAssessment,
          ai_resolution_assessment_history: [previousAssessment],
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      idempotent: false,
      ai_assessment: {
        revision: 2,
        supersedes_assessment_id: "asm_before_evidence",
        reassessment_reason: "Evidence snapshot changed after the previous assessment",
      },
    });
    expect(mockRunResolutionAssessor).toHaveBeenCalledOnce();
  });

  it("POST /disputes/:id/ai/assess reruns when the approved precedent snapshot changed", async () => {
    const emptyEvidenceHash = createHash("sha256").update(JSON.stringify([])).digest("hex");
    const previousAssessment = {
      assessment_id: "asm_before_precedent",
      revision: 1,
      status: "COMPLETED",
      assessed_at: "2026-07-10T00:00:00.000Z",
      context_hash: "ctx_before_precedent",
      model: "deepseek-v4-pro",
      policy_version: "l1-resolution-policy-v2",
      evidence_snapshot_hash: emptyEvidenceHash,
      precedent_snapshot_hash: "b".repeat(64),
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          ai_resolution_assessor: previousAssessment,
          ai_resolution_assessment_history: [previousAssessment],
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockListApprovedDisputePrecedents.mockResolvedValue([
      {
        id: "precedent-new",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        analysis_version: "analysis-v1",
        policy_version: "policy-v2",
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ai_assessment.reassessment_reason).toBe(
      "Approved precedent snapshot changed after the previous assessment",
    );
    expect(res.json().ai_assessment.precedent_snapshot_hash).toBe("a".repeat(64));
    expect(mockRunResolutionAssessor).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "policy",
      "legacy-policy-v0",
      "deepseek-v4-pro",
      "AI assessment policy changed after the previous assessment",
    ],
    [
      "model",
      "l1-resolution-policy-v2",
      "deepseek-v4-flash",
      "AI assessment model changed after the previous assessment",
    ],
  ])("POST /disputes/:id/ai/assess reruns automatically when the %s changed", async (_dimension, policyVersion, model, expectedReason) => {
    const emptyEvidenceHash = createHash("sha256").update(JSON.stringify([])).digest("hex");
    const previousAssessment = {
      assessment_id: `asm_previous_${_dimension}`,
      revision: 1,
      status: "COMPLETED",
      assessed_at: "2026-07-10T00:00:00.000Z",
      context_hash: `ctx_previous_${_dimension}`,
      model,
      policy_version: policyVersion,
      evidence_snapshot_hash: emptyEvidenceHash,
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          ai_resolution_assessor: previousAssessment,
          ai_resolution_assessment_history: [previousAssessment],
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().idempotent).toBe(false);
    expect(res.json().ai_assessment.reassessment_reason).toBe(expectedReason);
    expect(mockRunResolutionAssessor).toHaveBeenCalledOnce();
  });

  it("POST /disputes/:id/ai/assess requires a reason for forced reassessment", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: { force: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_AI_ASSESSMENT_REQUEST");
    expect(mockRunResolutionAssessor).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/ai/assess rejects a lease held by another API instance", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute({ status: "UNDER_REVIEW" }));
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockAcquireDisputeAiAssessmentLease.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("AI_ASSESSMENT_IN_PROGRESS");
    expect(mockRunResolutionAssessor).not.toHaveBeenCalled();
    expect(mockReleaseDisputeAiAssessmentLease).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/ai/assess appends a versioned forced reassessment", async () => {
    const previousAssessment = {
      assessment_id: "asm_previous",
      version_id: "version_previous",
      revision: 1,
      status: "COMPLETED",
      assessed_at: "2026-07-11T00:00:00.000Z",
      context_hash: "ctx_previous",
      model: "deepseek-v4-pro",
      conclusion: "seller_favor",
      confidence: "medium",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        evidence: [
          {
            id: "ev_1",
            dispute_id: "some-id",
            submitted_by: "buyer",
            type: "image",
            text: "New evidence snapshot",
            created_at: "2026-07-12T00:00:00.000Z",
          },
        ],
        metadata: {
          tier: 1,
          ai_resolution_assessor: previousAssessment,
          ai_resolution_assessment_history: [previousAssessment],
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {
        force: true,
        reassessment_reason: "New verified evidence was added after the first assessment.",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ai_assessment).toMatchObject({
      status: "COMPLETED",
      revision: 2,
      supersedes_assessment_id: "asm_previous",
      reassessment_reason: "New verified evidence was added after the first assessment.",
      policy_version: "l1-resolution-policy-v2",
    });
    expect(res.json().ai_assessment.assessment_id).toBeTruthy();
    expect(res.json().ai_assessment.version_id).toMatch(/^[a-f0-9]{64}$/);
    expect(res.json().ai_assessment.evidence_snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
    const persisted = mockUpdateDisputeRecord.mock.calls.at(-1)?.[1] as {
      metadata?: Record<string, unknown>;
    };
    expect(persisted.metadata?.ai_resolution_assessor).toEqual(
      expect.objectContaining({
        revision: 2,
        supersedes_assessment_id: "asm_previous",
      }),
    );
    expect(persisted.metadata).not.toHaveProperty("ai_resolution_assessment_history");
    expect(mockAppendDisputeAiAssessmentEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "COMPLETED",
        revision: 2,
        supersedesAssessmentId: "asm_previous",
      }),
    );
  });

  it("POST /disputes/:id/ai/assess preserves the last completed judgment when reassessment fails", async () => {
    const previousAssessment = {
      assessment_id: "asm_stable",
      version_id: "version_stable",
      revision: 1,
      status: "COMPLETED",
      assessed_at: "2026-07-11T00:00:00.000Z",
      context_hash: "ctx_stable",
      model: "deepseek-v4-pro",
      conclusion: "buyer_favor",
      confidence: "high",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          ai_resolution_assessor: previousAssessment,
          ai_resolution_assessment_history: [previousAssessment],
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockRunResolutionAssessor.mockResolvedValueOnce({
      ok: false,
      role: "resolution_assessor",
      displayName: "Resolution Assessor",
      schemaName: "dispute_ai_resolution_assessor_v2",
      contextHash: "ctx_failed_retry",
      error: "PROVIDER_ERROR",
      message: "provider unavailable",
      model: "deepseek-v4-pro",
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {
        force: true,
        reassessment_reason: "Operator requested a consistency check.",
      },
    });

    expect(res.statusCode).toBe(502);
    const persisted = mockUpdateDisputeRecord.mock.calls.at(-1)?.[1] as {
      metadata?: Record<string, unknown>;
    };
    expect(persisted.metadata?.ai_resolution_assessor).toEqual(previousAssessment);
    expect(persisted.metadata?.ai_resolution_assessor_last_failure).toEqual(
      expect.objectContaining({
        status: "FAILED",
        reassessment_reason: "Operator requested a consistency check.",
      }),
    );
    expect(persisted.metadata).not.toHaveProperty("ai_resolution_assessment_attempt_history");
    expect(mockAppendDisputeAiAssessmentEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disputeId: "some-id",
        eventType: "FAILED",
        payload: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("POST /disputes/:id/ai/assess backfills a legacy current judgment before appending", async () => {
    const legacyAssessment = {
      status: "COMPLETED",
      assessed_at: "2026-07-10T00:00:00.000Z",
      context_hash: "ctx_legacy",
      model: "deepseek-v4-pro",
      conclusion: "seller_favor",
      confidence: "medium",
    };
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          ai_resolution_assessor: legacyAssessment,
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {
        force: true,
        reassessment_reason: "Migrate the legacy judgment while rechecking consistency.",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ai_assessment.revision).toBe(2);
    expect(res.json().ai_assessment.supersedes_assessment_id).toMatch(/^legacy_[a-f0-9]{24}$/);
    const persisted = mockUpdateDisputeRecord.mock.calls.at(-1)?.[1] as {
      metadata?: Record<string, unknown>;
    };
    expect(persisted.metadata?.ai_resolution_assessor).toEqual(
      expect.objectContaining({ revision: 2 }),
    );
    expect(persisted.metadata).not.toHaveProperty("ai_resolution_assessment_history");
    expect(mockAppendDisputeAiAssessmentEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "COMPLETED",
        revision: 2,
        supersedesAssessmentId: expect.stringMatching(/^legacy_[a-f0-9]{24}$/),
      }),
    );
  });

  it("POST /disputes/:id/appeal rejects a submission lease held by another API instance", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute({ status: "UNDER_REVIEW" }));
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockAcquireDisputeOperationLease.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/appeal",
      headers: AUTH_HEADERS,
      payload: {
        reason: "The assessment missed material evidence.",
        client_request_id: "appeal-lease-test",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("APPEAL_SUBMISSION_IN_PROGRESS");
    expect(mockUpdateDisputeRecord).not.toHaveBeenCalled();
    expect(mockReleaseDisputeOperationLease).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/appeal records a party appeal and makes retries idempotent", async () => {
    const assessedDispute = fakeDispute({
      status: "UNDER_REVIEW",
      evidence: [
        {
          id: "ev_battery_report",
          dispute_id: "some-id",
          submitted_by: "buyer",
          type: "image",
          created_at: "2026-07-11T00:00:00.000Z",
        },
      ],
      metadata: {
        tier: 1,
        ai_resolution_assessor: { status: "COMPLETED", conclusion: "seller_favor" },
      },
    });
    mockGetDisputeById.mockResolvedValue(assessedDispute);
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const first = await app.inject({
      method: "POST",
      url: "/disputes/some-id/appeal",
      headers: AUTH_HEADERS,
      payload: {
        reason: "The assessment did not account for the verified battery report.",
        client_request_id: "appeal-001",
        evidence_ids: ["ev_battery_report"],
      },
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      dispute_id: "some-id",
      idempotent: false,
      appeal: { status: "OPEN", appealed_by: "buyer", client_request_id: "appeal-001" },
    });
    const persisted = mockUpdateDisputeRecord.mock.calls.at(-1)?.[1] as {
      metadata?: Record<string, unknown>;
    };
    expect(persisted.metadata).toMatchObject({
      appeal_review: { status: "OPEN", appealed_by: "buyer" },
      appeal_history: [expect.objectContaining({ event: "APPEAL_SUBMITTED" })],
    });

    const appeal = (persisted.metadata?.appeal_review ?? {}) as Record<string, unknown>;
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: { ...assessedDispute.metadata, appeal_review: appeal },
      }),
    );
    const retry = await app.inject({
      method: "POST",
      url: "/disputes/some-id/appeal",
      headers: AUTH_HEADERS,
      payload: {
        reason: "Retry with the same request id.",
        client_request_id: "appeal-001",
        evidence_ids: [],
      },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().idempotent).toBe(true);
  });

  it("POST /disputes/:id/resolve rejects a resolution lease held by another API instance", async () => {
    mockAcquireDisputeOperationLease.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/resolve",
      headers: ADMIN_HEADERS,
      payload: {
        outcome: "buyer_favor",
        summary: "Lease contention test",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DISPUTE_RESOLUTION_IN_PROGRESS");
    expect(mockGetDisputeById).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/resolve blocks money finalization while an appeal is open", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          appeal_review: {
            id: "apl_1",
            status: "OPEN",
            appealed_by: "buyer",
            appealed_by_user_id: "test-user-001",
            reason: "Relevant evidence was missed.",
            evidence_ids: [],
            client_request_id: "appeal-001",
            created_at: "2026-07-11T00:00:00.000Z",
          },
        },
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/resolve",
      headers: ADMIN_HEADERS,
      payload: { outcome: "seller_favor", summary: "Apply recommendation." },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("APPEAL_REVIEW_REQUIRED");
  });

  it("PATCH /disputes/:id/appeal/review rejects a review lease held by another API instance", async () => {
    mockAcquireDisputeOperationLease.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "PATCH",
      url: "/disputes/some-id/appeal/review",
      headers: ADMIN_HEADERS,
      payload: { decision: "dismiss", notes: "Lease contention test" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("APPEAL_REVIEW_IN_PROGRESS");
    expect(mockGetDisputeById).not.toHaveBeenCalled();
  });

  it("PATCH /disputes/:id/appeal/review reopens a case and marks the assessment stale", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          ai_resolution_assessor: { status: "COMPLETED", conclusion: "seller_favor" },
          appeal_review: {
            id: "apl_1",
            status: "OPEN",
            appealed_by: "buyer",
            appealed_by_user_id: "test-user-001",
            reason: "Relevant evidence was missed.",
            evidence_ids: ["ev_1"],
            client_request_id: "appeal-001",
            created_at: "2026-07-11T00:00:00.000Z",
          },
        },
      }),
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/disputes/some-id/appeal/review",
      headers: ADMIN_HEADERS,
      payload: {
        decision: "reopen_review",
        notes: "The cited evidence warrants a fresh assessment.",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      requires_new_ai_assessment: true,
      appeal: { status: "REOPENED" },
    });
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          ai_assessment_stale: true,
          appeal_review: expect.objectContaining({ status: "REOPENED" }),
          appeal_history: [expect.objectContaining({ event: "APPEAL_REOPENED" })],
        }),
      }),
    );
  });

  it("POST /disputes/:id/ai/assess refreshes a reopened appeal before resolution", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          ai_assessment_stale: true,
          ai_resolution_assessor: { status: "COMPLETED", conclusion: "seller_favor" },
          appeal_review: {
            id: "apl_1",
            status: "REOPENED",
            appealed_by: "buyer",
            appealed_by_user_id: "test-user-001",
            reason: "Relevant evidence was missed.",
            evidence_ids: ["ev_1"],
            client_request_id: "appeal-001",
            created_at: "2026-07-11T00:00:00.000Z",
          },
        },
      }),
    );
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/ai/assess",
      headers: ADMIN_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mockRunResolutionAssessor).toHaveBeenCalledOnce();
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          ai_assessment_stale: false,
          appeal_review: expect.objectContaining({ status: "REASSESSED" }),
          appeal_history: [expect.objectContaining({ event: "APPEAL_REASSESSED" })],
        }),
      }),
    );
  });

  it("derives appeal SLA states at assignment and deadline boundaries", () => {
    const now = Date.parse("2026-07-12T00:00:00.000Z");
    expect(
      deriveAppealSlaState({ status: "OPEN", sla_due_at: "2026-07-13T00:00:00.000Z" }, now),
    ).toBe("UNASSIGNED");
    expect(
      deriveAppealSlaState({ status: "OPEN", sla_due_at: "2026-07-11T23:59:59.000Z" }, now),
    ).toBe("OVERDUE");
    expect(
      deriveAppealSlaState(
        {
          status: "OPEN",
          assigned_to: "99999999-9999-4999-8999-999999999999",
          sla_due_at: "2026-07-12T12:00:00.000Z",
        },
        now,
      ),
    ).toBe("ON_TRACK");
    expect(
      deriveAppealSlaState(
        {
          status: "OPEN",
          assigned_to: "99999999-9999-4999-8999-999999999999",
          sla_due_at: "2026-07-12T03:00:00.000Z",
        },
        now,
      ),
    ).toBe("DUE_SOON");
    expect(
      deriveAppealSlaState(
        {
          status: "REOPENED",
          assigned_to: "99999999-9999-4999-8999-999999999999",
          sla_due_at: "2026-07-11T23:59:59.000Z",
        },
        now,
      ),
    ).toBe("OVERDUE");
    expect(deriveAppealSlaState({ status: "DISMISSED" }, now)).toBe("COMPLETED");
  });

  it("PATCH /disputes/:id/appeal/assignment rejects a lease held by another API instance", async () => {
    mockAcquireDisputeOperationLease.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "PATCH",
      url: "/disputes/some-id/appeal/assignment",
      headers: ADMIN_HEADERS,
      payload: {
        expected_appeal_id: "appeal-current",
        priority: "high",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("APPEAL_ASSIGNMENT_IN_PROGRESS");
    expect(mockGetDisputeById).not.toHaveBeenCalled();
    expect(mockReleaseDisputeOperationLease).not.toHaveBeenCalled();
  });

  it("PATCH /disputes/:id/appeal/assignment assigns an active appeal with a priority SLA", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          appeal_review: {
            id: "apl_queue_1",
            status: "OPEN",
            appealed_by: "buyer",
            appealed_by_user_id: "test-user-001",
            reason: "Relevant evidence was missed.",
            evidence_ids: [],
            client_request_id: "appeal-queue-001",
            created_at: "2026-07-12T00:00:00.000Z",
            priority: "normal",
            sla_due_at: "2026-07-13T00:00:00.000Z",
          },
        },
      }),
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/disputes/some-id/appeal/assignment",
      headers: ADMIN_HEADERS,
      payload: {
        expected_appeal_id: "apl_queue_1",
        priority: "urgent",
        sla_hours: 4,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      dispute_id: "some-id",
      idempotent: false,
      sla_state: "DUE_SOON",
      appeal: {
        id: "apl_queue_1",
        status: "OPEN",
        assigned_to: "test-admin-001",
        priority: "urgent",
      },
    });
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          appeal_review: expect.objectContaining({
            assigned_to: "test-admin-001",
            priority: "urgent",
          }),
          appeal_history: [expect.objectContaining({ event: "APPEAL_ASSIGNED" })],
        }),
      }),
    );
  });

  it("PATCH /disputes/:id/appeal/assignment rejects a stale appeal queue item", async () => {
    mockGetDisputeById.mockResolvedValue(
      fakeDispute({
        status: "UNDER_REVIEW",
        metadata: {
          tier: 1,
          appeal_review: {
            id: "apl_current",
            status: "OPEN",
            appealed_by: "buyer",
            appealed_by_user_id: "test-user-001",
            reason: "Relevant evidence was missed.",
            evidence_ids: [],
            client_request_id: "appeal-current",
            created_at: "2026-07-12T00:00:00.000Z",
          },
        },
      }),
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/disputes/some-id/appeal/assignment",
      headers: ADMIN_HEADERS,
      payload: {
        expected_appeal_id: "apl_stale",
        priority: "normal",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("STALE_APPEAL_ASSIGNMENT");
    expect(mockUpdateDisputeRecord).not.toHaveBeenCalled();
  });

  it("GET /admin/disputes/appeals returns active appeals with overdue items first", async () => {
    const now = Date.now();
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "dsp_unassigned",
          order_id: "ord_unassigned",
          status: "UNDER_REVIEW",
          reason_code: "ITEM_NOT_AS_DESCRIBED",
          opened_at: new Date(now - 60_000).toISOString(),
          amount_minor: "100000",
          metadata: {
            appeal_review: {
              id: "apl_unassigned",
              status: "OPEN",
              appealed_by: "buyer",
              appealed_by_user_id: "buyer-1",
              reason: "Needs review",
              evidence_ids: [],
              client_request_id: "req-1",
              created_at: new Date(now - 60_000).toISOString(),
              priority: "normal",
              sla_due_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
            },
          },
        },
        {
          id: "dsp_overdue",
          order_id: "ord_overdue",
          status: "UNDER_REVIEW",
          reason_code: "ITEM_NOT_RECEIVED",
          opened_at: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
          amount_minor: "200000",
          metadata: {
            appeal_review: {
              id: "apl_overdue",
              status: "REOPENED",
              appealed_by: "seller",
              appealed_by_user_id: "seller-1",
              reason: "Reassessment overdue",
              evidence_ids: [],
              client_request_id: "req-2",
              created_at: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
              assigned_to: "99999999-9999-4999-8999-999999999999",
              priority: "urgent",
              sla_due_at: new Date(now - 60_000).toISOString(),
            },
          },
        },
        {
          id: "dsp_completed",
          order_id: "ord_completed",
          status: "UNDER_REVIEW",
          reason_code: "ITEM_NOT_AS_DESCRIBED",
          opened_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
          amount_minor: "300000",
          metadata: {
            appeal_review: {
              id: "apl_completed",
              status: "DISMISSED",
              appealed_by: "buyer",
              appealed_by_user_id: "buyer-2",
              reason: "Already handled",
              evidence_ids: [],
              client_request_id: "req-3",
              created_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
            },
          },
        },
      ],
    });
    const queueApp = Fastify();
    queueApp.addHook("onRequest", async (request) => {
      request.user = { id: "test-admin-001", email: "admin@haggle.ai", role: "admin" };
    });
    registerDisputeRoutes(queueApp, { execute } as unknown as Database);

    const res = await queueApp.inject({
      method: "GET",
      url: "/admin/disputes/appeals?status=open",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      summary: {
        total: 3,
        open: 2,
        unassigned: 1,
        overdue: 1,
      },
      items: [
        { dispute_id: "dsp_overdue", sla: { state: "OVERDUE" } },
        { dispute_id: "dsp_unassigned", sla: { state: "UNASSIGNED" } },
      ],
    });
    await queueApp.close();
  });

  // POST /disputes/deposits/expire (requireAdmin)
  it("POST /disputes/deposits/expire returns 200 with forfeited count", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/deposits/expire",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.forfeited_count).toBeDefined();
    expect(typeof body.forfeited_count).toBe("number");
    // With mock returning empty array, count should be 0
    expect(body.forfeited_count).toBe(0);
  });

  // POST /disputes/:id/escalate
  it("POST /disputes/:id/escalate returns 404 for nonexistent dispute", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/nonexistent/escalate",
      headers: AUTH_HEADERS,
      payload: { escalated_by: "buyer" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  it("POST /disputes/:id/escalate returns 400 with invalid body", async () => {
    // requireDisputeParty middleware needs dispute + order to exist
    mockGetDisputeById.mockResolvedValueOnce(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/escalate",
      headers: AUTH_HEADERS,
      payload: { escalated_by: "invalid_role" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_ESCALATE_REQUEST");
  });

  it("POST /disputes/:id/escalate rejects escalated_by spoofing for non-admin parties", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/escalate",
      headers: AUTH_HEADERS,
      payload: { escalated_by: "seller" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ESCALATION_PARTY_MISMATCH");
    expect(mockUpdateDisputeRecord).not.toHaveBeenCalled();
    expect(mockCreateDeposit).not.toHaveBeenCalled();
  });

  // POST /disputes/:id/deposit
  it("POST /disputes/:id/deposit returns 404 when no deposit exists", async () => {
    // requireDisputeParty middleware needs dispute + order to exist
    mockGetDisputeById.mockResolvedValueOnce(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/deposit",
      headers: AUTH_HEADERS,
      payload: { amount_cents: 500 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DEPOSIT_NOT_FOUND");
  });
});
