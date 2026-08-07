import { createHash } from "node:crypto";
import { parseEasyPostInvoicePayload } from "@haggle/shipping-core";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDisputeRecord, getDisputeByOrderId } from "../services/dispute-record.service.js";
import {
  getCommerceOrderByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import { getSettlementReleaseByOrderId } from "../services/settlement-release.service.js";
import {
  claimShipmentApvAdjustment,
  completeShipmentApvAdjustment,
  failShipmentApvAdjustment,
} from "../services/shipment-apv-adjustment.service.js";
import { bindShipmentApvRevisionEvidence } from "../services/shipment-apv-evidence.service.js";
import {
  getShipmentApvInvoiceDocumentStorageHealth,
  runShipmentApvInvoiceDocumentReconciliationDryRun,
  storeShipmentApvInvoiceDocument,
} from "../services/shipment-apv-invoice-document.service.js";
import {
  decideShipmentApvInvoiceReconciliation,
  discoverShipmentApvInvoiceReconciliationCandidates,
  getShipmentApvInvoiceReconciliationTimeline,
  listPendingShipmentApvInvoiceReconciliations,
  requestShipmentApvInvoiceReconciliation,
} from "../services/shipment-apv-invoice-reconciliation.service.js";
import {
  decideShipmentApvInvoiceRestoration,
  getShipmentApvInvoiceRestorationStagingHealth,
  getShipmentApvInvoiceRestorationTimeline,
  listPendingShipmentApvInvoiceRestorations,
  listShipmentApvInvoiceRestorationCandidates,
  maintainShipmentApvInvoiceRestorationStaging,
  requestShipmentApvInvoiceRestoration,
} from "../services/shipment-apv-invoice-restoration.service.js";
import {
  decideShipmentApvInvoiceRestorationRemediation,
  getShipmentApvInvoiceRestorationRemediationHealth,
  getShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth,
  getShipmentApvInvoiceRestorationRemediationTimeline,
  listPendingShipmentApvInvoiceRestorationRemediations,
  listShipmentApvInvoiceRestorationRemediationCandidates,
  listStaleShipmentApvInvoiceRestorationRemediationRecoveries,
  maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics,
  recordShipmentApvInvoiceRestorationRemediationAcknowledgment,
  recordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection,
  requestShipmentApvInvoiceRestorationRemediation,
} from "../services/shipment-apv-invoice-restoration-remediation.service.js";
import { listShipmentApvSellerLiabilities } from "../services/shipment-apv-payout-offset.service.js";
import {
  decideShipmentApvReview,
  getShipmentApvReview,
  submitShipmentApvSellerReview,
} from "../services/shipment-apv-review.service.js";
import {
  listShipmentApvInvoiceRevisions,
  recordShipmentApvInvoiceRevision,
} from "../services/shipment-apv-revision.service.js";
import { applyShipmentApvInvoiceRevision } from "../services/shipment-apv-revision-application.service.js";
import {
  applyCarrierShipmentEvent,
  claimShipmentLabelRefund,
  completeShipmentLabelRefund,
  createShipmentRecord,
  failShipmentLabelRefund,
  getShipmentById,
  getShipmentByOrderId,
  getShipmentByTrackingNumber,
  insertShipmentEvent,
  type ShipmentRow,
  syncSubmittedShipmentLabelRefund,
  updateShipmentRecord,
} from "../services/shipment-record.service.js";
import { consumeShippingRateMissBudget } from "../services/shipping-rate-limit.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../services/webhook-event-claim.service.js";
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

vi.mock("../services/shipment-record.service.js", () => ({
  createShipmentRecord: vi.fn().mockResolvedValue(null),
  createShipmentOperationInProgress: vi.fn().mockResolvedValue(null),
  completeShipmentOperationIdempotency: vi.fn().mockResolvedValue(null),
  getShipmentById: vi.fn().mockResolvedValue(null),
  getShipmentByOrderId: vi.fn().mockResolvedValue(null),
  getShipmentByTrackingNumber: vi.fn().mockResolvedValue(null),
  getShipmentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
  updateShipmentRecord: vi.fn().mockResolvedValue(null),
  insertShipmentEvent: vi.fn().mockResolvedValue(null),
  applyCarrierShipmentEvent: vi.fn().mockResolvedValue(null),
  claimShipmentLabelRefund: vi
    .fn()
    .mockResolvedValue({ outcome: "invalid_status", shipmentId: "shipment" }),
  completeShipmentLabelRefund: vi.fn().mockResolvedValue(true),
  failShipmentLabelRefund: vi.fn().mockResolvedValue(undefined),
  normalizeProviderLabelRefundStatus: vi.fn((value: unknown) =>
    typeof value === "string" ? value.toUpperCase() : null,
  ),
  syncSubmittedShipmentLabelRefund: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/admin-action-log.service.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/shipping-rate-limit.service.js", () => ({
  consumeShippingRateMissBudget: vi.fn().mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    requestCount: 1,
    windowStartedAt: new Date(),
  }),
}));

vi.mock("../services/shipment-apv-adjustment.service.js", () => ({
  claimShipmentApvAdjustment: vi.fn(),
  completeShipmentApvAdjustment: vi.fn(),
  failShipmentApvAdjustment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/shipment-apv-review.service.js", () => ({
  getShipmentApvReview: vi.fn(),
  submitShipmentApvSellerReview: vi.fn(),
  decideShipmentApvReview: vi.fn(),
}));

vi.mock("../services/shipment-apv-revision.service.js", () => ({
  recordShipmentApvInvoiceRevision: vi.fn(),
  listShipmentApvInvoiceRevisions: vi.fn(),
}));

vi.mock("../services/shipment-apv-revision-application.service.js", () => ({
  applyShipmentApvInvoiceRevision: vi.fn(),
}));

vi.mock("../services/shipment-apv-evidence.service.js", () => ({
  bindShipmentApvRevisionEvidence: vi.fn(),
}));

vi.mock("../services/shipment-apv-invoice-document.service.js", () => ({
  getShipmentApvInvoiceDocumentStorageHealth: vi.fn(),
  runShipmentApvInvoiceDocumentReconciliationDryRun: vi.fn(),
  storeShipmentApvInvoiceDocument: vi.fn(),
}));

vi.mock("../services/shipment-apv-invoice-reconciliation.service.js", () => ({
  decideShipmentApvInvoiceReconciliation: vi.fn(),
  discoverShipmentApvInvoiceReconciliationCandidates: vi.fn(),
  getShipmentApvInvoiceReconciliationTimeline: vi.fn(),
  listPendingShipmentApvInvoiceReconciliations: vi.fn(),
  requestShipmentApvInvoiceReconciliation: vi.fn(),
}));

vi.mock("../services/shipment-apv-invoice-restoration.service.js", () => ({
  decideShipmentApvInvoiceRestoration: vi.fn(),
  getShipmentApvInvoiceRestorationTimeline: vi.fn(),
  getShipmentApvInvoiceRestorationStagingHealth: vi.fn(),
  listPendingShipmentApvInvoiceRestorations: vi.fn(),
  listShipmentApvInvoiceRestorationCandidates: vi.fn(),
  maintainShipmentApvInvoiceRestorationStaging: vi.fn(),
  requestShipmentApvInvoiceRestoration: vi.fn(),
}));

vi.mock("../services/shipment-apv-invoice-restoration-remediation.service.js", () => ({
  decideShipmentApvInvoiceRestorationRemediation: vi.fn(),
  getShipmentApvInvoiceRestorationRemediationHealth: vi.fn(),
  getShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth: vi.fn(),
  getShipmentApvInvoiceRestorationRemediationTimeline: vi.fn(),
  listPendingShipmentApvInvoiceRestorationRemediations: vi.fn(),
  listStaleShipmentApvInvoiceRestorationRemediationRecoveries: vi.fn(),
  maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics: vi.fn(),
  recordShipmentApvInvoiceRestorationRemediationAcknowledgment: vi.fn(),
  recordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection: vi.fn(),
  listShipmentApvInvoiceRestorationRemediationCandidates: vi.fn(),
  requestShipmentApvInvoiceRestorationRemediation: vi.fn(),
}));

vi.mock("../services/shipment-apv-payout-offset.service.js", () => ({
  listShipmentApvSellerLiabilities: vi.fn(),
}));

vi.mock("../services/webhook-event-claim.service.js", () => ({
  webhookPayloadSha256: vi.fn(() => "a".repeat(64)),
  claimWebhookEvent: vi.fn().mockResolvedValue({
    outcome: "acquired",
    source: "easypost",
    eventId: "event",
    claimId: "11111111-1111-4111-8111-111111111111",
    attemptCount: 1,
  }),
  completeWebhookEvent: vi.fn().mockResolvedValue(true),
  failWebhookEvent: vi.fn().mockResolvedValue(undefined),
  startWebhookClaimHeartbeat: vi.fn(() => vi.fn()),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-record.service.js", () => ({
  createDisputeRecord: vi.fn().mockResolvedValue(null),
  getDisputeById: vi.fn().mockResolvedValue(null),
  getDisputeByOrderId: vi.fn().mockResolvedValue(null),
  updateDisputeRecord: vi.fn().mockResolvedValue(null),
  addDisputeEvidenceRecord: vi.fn().mockResolvedValue(null),
  createDisputeResolutionRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-deposit.service.js", () => ({
  getDepositByDisputeId: vi.fn().mockResolvedValue(null),
  createDeposit: vi.fn().mockResolvedValue(null),
  getPendingExpiredDeposits: vi.fn().mockResolvedValue([]),
  updateDepositStatus: vi.fn().mockResolvedValue(null),
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

const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockCreateShipmentRecord = vi.mocked(createShipmentRecord);
const mockGetShipmentById = vi.mocked(getShipmentById);
const mockGetShipmentByOrderId = vi.mocked(getShipmentByOrderId);
const mockGetShipmentByTrackingNumber = vi.mocked(getShipmentByTrackingNumber);
const mockInsertShipmentEvent = vi.mocked(insertShipmentEvent);
const mockUpdateShipmentRecord = vi.mocked(updateShipmentRecord);
const mockApplyCarrierShipmentEvent = vi.mocked(applyCarrierShipmentEvent);
const mockClaimShipmentLabelRefund = vi.mocked(claimShipmentLabelRefund);
const mockCompleteShipmentLabelRefund = vi.mocked(completeShipmentLabelRefund);
const mockFailShipmentLabelRefund = vi.mocked(failShipmentLabelRefund);
const mockSyncSubmittedShipmentLabelRefund = vi.mocked(syncSubmittedShipmentLabelRefund);
const mockCreateDisputeRecord = vi.mocked(createDisputeRecord);
const mockGetDisputeByOrderId = vi.mocked(getDisputeByOrderId);
const mockUpdateCommerceOrderStatus = vi.mocked(updateCommerceOrderStatus);
const mockConsumeShippingRateMissBudget = vi.mocked(consumeShippingRateMissBudget);
const mockParseEasyPostInvoicePayload = vi.mocked(parseEasyPostInvoicePayload);
const mockClaimShipmentApvAdjustment = vi.mocked(claimShipmentApvAdjustment);
const mockCompleteShipmentApvAdjustment = vi.mocked(completeShipmentApvAdjustment);
const mockFailShipmentApvAdjustment = vi.mocked(failShipmentApvAdjustment);
const mockGetShipmentApvReview = vi.mocked(getShipmentApvReview);
const mockSubmitShipmentApvSellerReview = vi.mocked(submitShipmentApvSellerReview);
const mockDecideShipmentApvReview = vi.mocked(decideShipmentApvReview);
const mockRecordShipmentApvInvoiceRevision = vi.mocked(recordShipmentApvInvoiceRevision);
const mockListShipmentApvInvoiceRevisions = vi.mocked(listShipmentApvInvoiceRevisions);
const mockApplyShipmentApvInvoiceRevision = vi.mocked(applyShipmentApvInvoiceRevision);
const mockBindShipmentApvRevisionEvidence = vi.mocked(bindShipmentApvRevisionEvidence);
const mockStoreShipmentApvInvoiceDocument = vi.mocked(storeShipmentApvInvoiceDocument);
const mockGetShipmentApvInvoiceDocumentStorageHealth = vi.mocked(
  getShipmentApvInvoiceDocumentStorageHealth,
);
const mockRunShipmentApvInvoiceDocumentReconciliationDryRun = vi.mocked(
  runShipmentApvInvoiceDocumentReconciliationDryRun,
);
const mockDecideShipmentApvInvoiceReconciliation = vi.mocked(
  decideShipmentApvInvoiceReconciliation,
);
const mockDiscoverShipmentApvInvoiceReconciliationCandidates = vi.mocked(
  discoverShipmentApvInvoiceReconciliationCandidates,
);
const mockGetShipmentApvInvoiceReconciliationTimeline = vi.mocked(
  getShipmentApvInvoiceReconciliationTimeline,
);
const mockListPendingShipmentApvInvoiceReconciliations = vi.mocked(
  listPendingShipmentApvInvoiceReconciliations,
);
const mockRequestShipmentApvInvoiceReconciliation = vi.mocked(
  requestShipmentApvInvoiceReconciliation,
);
const mockDecideShipmentApvInvoiceRestoration = vi.mocked(decideShipmentApvInvoiceRestoration);
const mockGetShipmentApvInvoiceRestorationTimeline = vi.mocked(
  getShipmentApvInvoiceRestorationTimeline,
);
const mockGetShipmentApvInvoiceRestorationStagingHealth = vi.mocked(
  getShipmentApvInvoiceRestorationStagingHealth,
);
const mockListPendingShipmentApvInvoiceRestorations = vi.mocked(
  listPendingShipmentApvInvoiceRestorations,
);
const mockListShipmentApvInvoiceRestorationCandidates = vi.mocked(
  listShipmentApvInvoiceRestorationCandidates,
);
const mockMaintainShipmentApvInvoiceRestorationStaging = vi.mocked(
  maintainShipmentApvInvoiceRestorationStaging,
);
const mockRequestShipmentApvInvoiceRestoration = vi.mocked(requestShipmentApvInvoiceRestoration);
const mockDecideShipmentApvInvoiceRestorationRemediation = vi.mocked(
  decideShipmentApvInvoiceRestorationRemediation,
);
const mockGetShipmentApvInvoiceRestorationRemediationHealth = vi.mocked(
  getShipmentApvInvoiceRestorationRemediationHealth,
);
const mockGetShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth = vi.mocked(
  getShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth,
);
const mockGetShipmentApvInvoiceRestorationRemediationTimeline = vi.mocked(
  getShipmentApvInvoiceRestorationRemediationTimeline,
);
const mockListPendingShipmentApvInvoiceRestorationRemediations = vi.mocked(
  listPendingShipmentApvInvoiceRestorationRemediations,
);
const mockListStaleShipmentApvInvoiceRestorationRemediationRecoveries = vi.mocked(
  listStaleShipmentApvInvoiceRestorationRemediationRecoveries,
);
const mockMaintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics = vi.mocked(
  maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics,
);
const mockRecordShipmentApvInvoiceRestorationRemediationAcknowledgment = vi.mocked(
  recordShipmentApvInvoiceRestorationRemediationAcknowledgment,
);
const mockRecordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection = vi.mocked(
  recordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection,
);
const mockListShipmentApvInvoiceRestorationRemediationCandidates = vi.mocked(
  listShipmentApvInvoiceRestorationRemediationCandidates,
);
const mockRequestShipmentApvInvoiceRestorationRemediation = vi.mocked(
  requestShipmentApvInvoiceRestorationRemediation,
);
const mockListShipmentApvSellerLiabilities = vi.mocked(listShipmentApvSellerLiabilities);
const mockGetSettlementReleaseByOrderId = vi.mocked(getSettlementReleaseByOrderId);
const mockClaimWebhookEvent = vi.mocked(claimWebhookEvent);
const mockCompleteWebhookEvent = vi.mocked(completeWebhookEvent);
const mockFailWebhookEvent = vi.mocked(failWebhookEvent);

describe("Shipment routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimWebhookEvent.mockResolvedValue({
      outcome: "acquired",
      source: "easypost",
      eventId: "event",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    mockCompleteWebhookEvent.mockResolvedValue(true);
    mockFailWebhookEvent.mockResolvedValue(undefined);
    mockGetShipmentByTrackingNumber.mockResolvedValue(null);
    mockParseEasyPostInvoicePayload.mockReturnValue(null);
    mockGetSettlementReleaseByOrderId.mockResolvedValue(null);
    mockApplyCarrierShipmentEvent.mockResolvedValue(null);
    mockClaimShipmentLabelRefund.mockResolvedValue({
      outcome: "invalid_status",
      shipmentId: "shipment",
    });
    mockCompleteShipmentLabelRefund.mockResolvedValue(true);
    mockFailShipmentLabelRefund.mockResolvedValue(undefined);
    mockSyncSubmittedShipmentLabelRefund.mockResolvedValue(true);
    mockGetShipmentApvReview.mockResolvedValue(null);
    mockRecordShipmentApvInvoiceRevision.mockReset();
    mockListShipmentApvInvoiceRevisions.mockResolvedValue([]);
    mockApplyShipmentApvInvoiceRevision.mockReset();
    mockBindShipmentApvRevisionEvidence.mockReset();
    mockStoreShipmentApvInvoiceDocument.mockReset();
    mockGetShipmentApvInvoiceDocumentStorageHealth.mockReset();
    mockRunShipmentApvInvoiceDocumentReconciliationDryRun.mockReset();
    mockDecideShipmentApvInvoiceReconciliation.mockReset();
    mockDiscoverShipmentApvInvoiceReconciliationCandidates.mockReset();
    mockGetShipmentApvInvoiceReconciliationTimeline.mockReset();
    mockListPendingShipmentApvInvoiceReconciliations.mockResolvedValue([]);
    mockRequestShipmentApvInvoiceReconciliation.mockReset();
    mockDecideShipmentApvInvoiceRestoration.mockReset();
    mockGetShipmentApvInvoiceRestorationTimeline.mockReset();
    mockGetShipmentApvInvoiceRestorationStagingHealth.mockReset();
    mockListPendingShipmentApvInvoiceRestorations.mockResolvedValue([]);
    mockListShipmentApvInvoiceRestorationCandidates.mockResolvedValue({
      candidates: [],
      truncated: false,
    });
    mockMaintainShipmentApvInvoiceRestorationStaging.mockReset();
    mockRequestShipmentApvInvoiceRestoration.mockReset();
    mockDecideShipmentApvInvoiceRestorationRemediation.mockReset();
    mockGetShipmentApvInvoiceRestorationRemediationHealth.mockResolvedValue({
      status: "healthy",
      pendingRequests: 0,
      applyingRequests: 0,
      expiringSoonRequests: 0,
      overduePendingRequests: 0,
      staleApplyingRequests: 0,
      staleApplyingOver15Minutes: 0,
      staleApplyingOver60Minutes: 0,
      unacknowledgedStaleOver60Minutes: 0,
      incidentUnlinkedStaleOver60Minutes: 0,
      acknowledgedStillApplyingOver30Minutes: 0,
      incidentLinkedStillApplyingOver30Minutes: 0,
      incidentLinkOverdueAfterAcknowledgment: 0,
      oldestPendingAgeSeconds: null,
      oldestApplyingAgeSeconds: null,
      staleApplyingAgeBucket: "none",
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    mockGetShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth.mockResolvedValue({
      windowHours: 24,
      expired: 0,
      invalid: 0,
      total: 0,
      lastSeenAt: null,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    mockGetShipmentApvInvoiceRestorationRemediationTimeline.mockReset();
    mockListPendingShipmentApvInvoiceRestorationRemediations.mockResolvedValue([]);
    mockListStaleShipmentApvInvoiceRestorationRemediationRecoveries.mockResolvedValue({
      items: [],
      truncated: false,
      nextCursor: null,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    mockMaintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics.mockResolvedValue({
      dryRun: true,
      retentionDays: 30,
      limit: 1000,
      eligibleBuckets: 0,
      deletedBuckets: undefined,
      expiredBuckets: 0,
      invalidBuckets: 0,
      truncated: false,
      cutoffAt: "2026-06-12T00:00:00.000Z",
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    mockRecordShipmentApvInvoiceRestorationRemediationAcknowledgment.mockReset();
    mockRecordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection.mockResolvedValue(
      undefined,
    );
    mockListShipmentApvInvoiceRestorationRemediationCandidates.mockResolvedValue({
      candidates: [],
      truncated: false,
    });
    mockRequestShipmentApvInvoiceRestorationRemediation.mockReset();
    mockListShipmentApvSellerLiabilities.mockResolvedValue([]);
    mockConsumeShippingRateMissBudget.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      requestCount: 1,
      windowStartedAt: new Date(),
    });
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it("allows the shipment seller to submit one idempotent APV liability review", async () => {
    const adjustment = {
      id: "77777777-7777-4777-8777-777777777777",
      shipment_id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      seller_id: "test-user-001",
      buyer_id: "buyer-user-001",
      status: "REVIEW_REQUIRED",
      review_status: "PENDING" as const,
      review_request_id: "88888888-8888-4888-8888-888888888888",
      review_version: 1,
      assessed_seller_liability_minor: 250,
      seller_liability_minor: 250,
      platform_liability_minor: 0,
      buyer_effect_minor: 0 as const,
    };
    mockSubmitShipmentApvSellerReview.mockResolvedValueOnce({
      outcome: "updated",
      record: adjustment,
    });
    const res = await app.inject({
      method: "POST",
      url: `/shipments/apv-adjustments/${adjustment.id}/seller-review`,
      headers: AUTH_HEADERS,
      payload: {
        request_id: adjustment.review_request_id,
        reason:
          "The carrier correction does not match the address supplied for the purchased label.",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      adjustment: { review_status: "PENDING", buyer_effect_minor: 0 },
      idempotent: false,
    });
    expect(mockSubmitShipmentApvSellerReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sellerId: "test-user-001",
        requestId: adjustment.review_request_id,
      }),
    );
  });

  it("allows only an admin to waive an APV seller liability with optimistic locking", async () => {
    const adjustment = {
      id: "77777777-7777-4777-8777-777777777777",
      shipment_id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      seller_id: "seller-user-001",
      buyer_id: "buyer-user-001",
      status: "REVIEW_REQUIRED",
      review_status: "WAIVED" as const,
      review_version: 2,
      assessed_seller_liability_minor: 250,
      seller_liability_minor: 0,
      platform_liability_minor: 250,
      buyer_effect_minor: 0 as const,
    };
    mockDecideShipmentApvReview.mockResolvedValueOnce({ outcome: "updated", record: adjustment });
    const payload = {
      request_id: "99999999-9999-4999-8999-999999999999",
      decision: "WAIVED",
      reason: "The carrier record is insufficient to assign this correction charge to the seller.",
      expected_version: 1,
    };
    const forbidden = await app.inject({
      method: "POST",
      url: `/shipments/apv-adjustments/${adjustment.id}/decision`,
      headers: AUTH_HEADERS,
      payload,
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "POST",
      url: `/shipments/apv-adjustments/${adjustment.id}/decision`,
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      adjustment: {
        review_status: "WAIVED",
        seller_liability_minor: 0,
        platform_liability_minor: 250,
        buyer_effect_minor: 0,
      },
    });
  });

  it("allows an order party to list append-only APV invoice revisions", async () => {
    const adjustmentId = "77777777-7777-4777-8777-777777777777";
    mockGetShipmentApvReview.mockResolvedValueOnce({
      id: adjustmentId,
      shipment_id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      seller_id: "test-user-001",
      buyer_id: "buyer-user-001",
      status: "REVIEW_REQUIRED",
      review_status: "NONE",
      review_version: 0,
      assessed_seller_liability_minor: 250,
      seller_liability_minor: 250,
      platform_liability_minor: 0,
      buyer_effect_minor: 0,
    });
    mockListShipmentApvInvoiceRevisions.mockResolvedValueOnce([
      {
        id: "88888888-8888-4888-8888-888888888888",
        adjustment_id: adjustmentId,
        provider: "easypost",
        provider_invoice_id: "shinv_revision_list",
        revision_number: 2,
        invoice_event: "updated",
        payload_sha256: "a".repeat(64),
        webhook_event_id: "evt_revision_list",
        prior_adjusted_rate_minor: 1025,
        adjusted_rate_minor: 1125,
        delta_minor: 100,
        status: "PENDING_REVIEW",
        buyer_effect_minor: 0,
        buffer_applied_minor: 0,
        seller_liability_minor: 0,
        platform_liability_minor: 0,
        carrier_credit_minor: 0,
        apply_version: 0,
      },
    ]);
    const res = await app.inject({
      method: "GET",
      url: `/shipments/apv-adjustments/${adjustmentId}/revisions`,
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      revisions: [{ revision_number: 2, delta_minor: 100, status: "PENDING_REVIEW" }],
    });
  });

  it("allows only an admin to apply an APV revision decision", async () => {
    const revisionId = "88888888-8888-4888-8888-888888888888";
    const payload = {
      request_id: "99999999-9999-4999-8999-999999999999",
      decision: "UPHELD",
      reason: "The carrier evidence supports assigning this revised package charge to the seller.",
      expected_version: 0,
    };
    const forbidden = await app.inject({
      method: "POST",
      url: `/shipments/apv-revisions/${revisionId}/decision`,
      headers: AUTH_HEADERS,
      payload,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(mockApplyShipmentApvInvoiceRevision).not.toHaveBeenCalled();

    mockApplyShipmentApvInvoiceRevision.mockResolvedValueOnce({
      outcome: "applied",
      revision: {
        id: revisionId,
        adjustment_id: "77777777-7777-4777-8777-777777777777",
        revision_number: 2,
        delta_minor: 100,
        status: "APPLIED",
        decision: "UPHELD",
        decision_request_id: payload.request_id,
        buffer_applied_minor: 0,
        seller_liability_minor: 100,
        platform_liability_minor: 0,
        carrier_credit_minor: 0,
        buyer_effect_minor: 0,
        apply_version: 1,
      },
    });
    const allowed = await app.inject({
      method: "POST",
      url: `/shipments/apv-revisions/${revisionId}/decision`,
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      revision: { status: "APPLIED", seller_liability_minor: 100, buyer_effect_minor: 0 },
    });
  });

  it("allows only an admin to bind immutable carrier evidence to an APV revision", async () => {
    const revisionId = "88888888-8888-4888-8888-888888888888";
    const payload = {
      document_sha256: "a".repeat(64),
      provider_document_id: "shinv_001:revision-2",
      surcharge_category: "ADDRESS_CORRECTION",
      surcharge_type: "ADDRESS_CORRECTION",
      amount_minor: 100,
      currency: "USD",
    };
    const forbidden = await app.inject({
      method: "POST",
      url: `/shipments/apv-revisions/${revisionId}/evidence`,
      headers: AUTH_HEADERS,
      payload,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(mockBindShipmentApvRevisionEvidence).not.toHaveBeenCalled();

    mockBindShipmentApvRevisionEvidence.mockResolvedValueOnce({
      outcome: "bound",
      evidence: {
        revision_id: revisionId,
        evidence_sha256: payload.document_sha256,
        provider_document_id: payload.provider_document_id,
        surcharge_category: payload.surcharge_category,
        surcharge_type: payload.surcharge_type,
        evidence_amount_minor: payload.amount_minor,
        evidence_currency: payload.currency,
      },
    });
    const allowed = await app.inject({
      method: "POST",
      url: `/shipments/apv-revisions/${revisionId}/evidence`,
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      evidence: { surcharge_category: "ADDRESS_CORRECTION", evidence_amount_minor: 100 },
      idempotent: false,
    });
  });

  it("allows only an admin to store invoice bytes already bound to an APV revision", async () => {
    const revisionId = "88888888-8888-4888-8888-888888888888";
    const bytes = Buffer.from(JSON.stringify({ invoice_id: "shinv_001", total: 7.25 }));
    const payload = {
      provider_document_id: "shinv_001:revision-2",
      content_type: "application/json",
      content_base64: bytes.toString("base64"),
    };
    const forbidden = await app.inject({
      method: "POST",
      url: `/shipments/apv-revisions/${revisionId}/invoice-document`,
      headers: AUTH_HEADERS,
      payload,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(mockStoreShipmentApvInvoiceDocument).not.toHaveBeenCalled();

    mockStoreShipmentApvInvoiceDocument.mockResolvedValueOnce({
      outcome: "stored",
      document: {
        id: "77777777-7777-4777-8777-777777777777",
        revision_id: revisionId,
        provider_document_id: payload.provider_document_id,
        content_type: "application/json",
        byte_size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    const allowed = await app.inject({
      method: "POST",
      url: `/shipments/apv-revisions/${revisionId}/invoice-document`,
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json()).toMatchObject({
      document: {
        revision_id: revisionId,
        provider_document_id: payload.provider_document_id,
        byte_size: bytes.length,
      },
      idempotent: false,
    });
    expect(mockStoreShipmentApvInvoiceDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        revisionId,
        contentType: "application/json",
        bytes,
      }),
    );
  });

  it("rejects invoice bytes that do not match the bound revision evidence", async () => {
    const revisionId = "88888888-8888-4888-8888-888888888888";
    mockStoreShipmentApvInvoiceDocument.mockResolvedValueOnce({ outcome: "evidence_mismatch" });
    const response = await app.inject({
      method: "POST",
      url: `/shipments/apv-revisions/${revisionId}/invoice-document`,
      headers: ADMIN_HEADERS,
      payload: {
        provider_document_id: "shinv_001:revision-2",
        content_type: "application/json",
        content_base64: Buffer.from('{"different":true}').toString("base64"),
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "APV_INVOICE_DOCUMENT_EVIDENCE_MISMATCH" });
  });

  it("exposes aggregate-only invoice storage health to admins", async () => {
    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/health",
      headers: AUTH_HEADERS,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(mockGetShipmentApvInvoiceDocumentStorageHealth).not.toHaveBeenCalled();

    const health = {
      status: "warning" as const,
      totalDocuments: 3,
      checkedDocuments: 3,
      missingFiles: 0,
      sizeMismatches: 0,
      hashMismatches: 0,
      orphanFiles: 1,
      invalidEntries: 0,
      scanTruncated: false,
      checkedBytes: 128,
      recordedAt: "2026-07-12T00:00:00.000Z",
    };
    mockGetShipmentApvInvoiceDocumentStorageHealth.mockResolvedValueOnce(health);
    const allowed = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/health",
      headers: ADMIN_HEADERS,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ health });
  });

  it("requires an admin and explicit dry-run for invoice storage reconciliation", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/reconcile",
      headers: AUTH_HEADERS,
      payload: { dry_run: true },
    });
    expect(forbidden.statusCode).toBe(403);

    const unsafe = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/reconcile",
      headers: ADMIN_HEADERS,
      payload: { dry_run: false },
    });
    expect(unsafe.statusCode).toBe(400);
    expect(mockRunShipmentApvInvoiceDocumentReconciliationDryRun).not.toHaveBeenCalled();

    const reconciliation = {
      dryRun: true as const,
      mutated: false as const,
      health: {
        status: "healthy" as const,
        totalDocuments: 1,
        checkedDocuments: 1,
        missingFiles: 0,
        sizeMismatches: 0,
        hashMismatches: 0,
        orphanFiles: 0,
        invalidEntries: 0,
        scanTruncated: false,
        checkedBytes: 128,
        recordedAt: "2026-07-12T00:00:00.000Z",
      },
      wouldMarkMissingOrCorrupt: 0,
      wouldQuarantineOrphans: 0,
    };
    mockRunShipmentApvInvoiceDocumentReconciliationDryRun.mockResolvedValueOnce(reconciliation);
    const allowed = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/reconcile",
      headers: ADMIN_HEADERS,
      payload: { dry_run: true },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ reconciliation });
  });

  it("exposes only opaque invoice reconciliation candidates to admins", async () => {
    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/reconciliation-candidates",
      headers: AUTH_HEADERS,
    });
    expect(forbidden.statusCode).toBe(403);
    mockDiscoverShipmentApvInvoiceReconciliationCandidates.mockResolvedValueOnce({
      candidates: [
        { candidateId: "a".repeat(64), anomalyType: "ORPHAN_FILE", documentBound: false },
      ],
      scanTruncated: false,
      checkedDocuments: 1,
      totalDocuments: 1,
    });
    const allowed = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/reconciliation-candidates",
      headers: ADMIN_HEADERS,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({
      reconciliation_candidates: {
        candidates: [
          { candidateId: "a".repeat(64), anomalyType: "ORPHAN_FILE", documentBound: false },
        ],
        scanTruncated: false,
        checkedDocuments: 1,
        totalDocuments: 1,
      },
    });
    expect(JSON.stringify(allowed.json())).not.toContain("storage_key");
  });

  it("creates an idempotent admin reconciliation request from an opaque candidate", async () => {
    const requestId = "77777777-7777-4777-8777-777777777777";
    const payload = {
      client_request_id: "66666666-6666-4666-8666-666666666666",
      candidate_id: "a".repeat(64),
      reason: "Quarantine the verified orphan without deleting evidence.",
    };
    const request = {
      id: requestId,
      client_request_id: payload.client_request_id,
      anomaly_type: "ORPHAN_FILE" as const,
      target_fingerprint: payload.candidate_id,
      document_bound: false,
      requester_id: "99999999-9999-4999-8999-999999999999",
      reason: payload.reason,
      status: "PENDING" as const,
      version: 0,
      expires_at: "2026-07-12T00:30:00.000Z",
      created_at: "2026-07-12T00:00:00.000Z",
    };
    mockRequestShipmentApvInvoiceReconciliation.mockResolvedValueOnce({
      outcome: "requested",
      request,
    });
    const response = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/reconciliation-requests",
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      reconciliation_request: { id: requestId, anomaly_type: "ORPHAN_FILE", document_bound: false },
      idempotent: false,
    });
  });

  it("enforces maker-checker separation on invoice reconciliation decisions", async () => {
    const requestId = "77777777-7777-4777-8777-777777777777";
    const payload = {
      decision_request_id: "55555555-5555-4555-8555-555555555555",
      decision: "APPROVE",
      reason: "Checker verified that the orphan remains safe to quarantine.",
      expected_version: 0,
    };
    mockDecideShipmentApvInvoiceReconciliation.mockResolvedValueOnce({
      outcome: "self_approval_forbidden",
    });
    const blocked = await app.inject({
      method: "POST",
      url: `/admin/shipments/apv-invoice-documents/reconciliation-requests/${requestId}/decision`,
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: "APV_INVOICE_RECONCILIATION_SELF_APPROVAL_FORBIDDEN" });
  });

  it("returns the pending reconciliation queue and immutable timeline", async () => {
    const requestId = "77777777-7777-4777-8777-777777777777";
    const request = {
      id: requestId,
      client_request_id: "66666666-6666-4666-8666-666666666666",
      anomaly_type: "ORPHAN_FILE" as const,
      target_fingerprint: "a".repeat(64),
      document_bound: false,
      requester_id: "99999999-9999-4999-8999-999999999999",
      reason: "Quarantine verified orphan evidence.",
      status: "PENDING" as const,
      version: 0,
      expires_at: "2026-07-12T00:30:00.000Z",
      created_at: "2026-07-12T00:00:00.000Z",
    };
    mockListPendingShipmentApvInvoiceReconciliations.mockResolvedValueOnce([request]);
    mockGetShipmentApvInvoiceReconciliationTimeline.mockResolvedValueOnce({
      request,
      events: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          event_type: "REQUESTED",
          actor_id: request.requester_id,
          request_version: 0,
          metadata: { anomaly_type: "ORPHAN_FILE" },
          created_at: "2026-07-12T00:00:00.000Z",
        },
      ],
    });
    const queue = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/reconciliation-requests/pending",
      headers: ADMIN_HEADERS,
    });
    const timeline = await app.inject({
      method: "GET",
      url: `/admin/shipments/apv-invoice-documents/reconciliation-requests/${requestId}/timeline`,
      headers: ADMIN_HEADERS,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      reconciliation_requests: [{ id: requestId, status: "PENDING" }],
    });
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json()).toMatchObject({
      reconciliation_timeline: {
        events: [{ event_type: "REQUESTED", request_version: 0 }],
      },
    });
  });

  it("lists opaque invoice restoration candidates only for admins", async () => {
    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-candidates",
      headers: AUTH_HEADERS,
    });
    expect(forbidden.statusCode).toBe(403);
    mockListShipmentApvInvoiceRestorationCandidates.mockResolvedValueOnce({
      candidates: [{ candidateId: "b".repeat(64), integrityStatus: "QUARANTINED" }],
      truncated: false,
    });
    const allowed = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-candidates",
      headers: ADMIN_HEADERS,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({
      restoration_candidates: {
        candidates: [{ candidateId: "b".repeat(64), integrityStatus: "QUARANTINED" }],
        truncated: false,
      },
    });
    expect(JSON.stringify(allowed.json())).not.toContain("document_id");
    expect(JSON.stringify(allowed.json())).not.toContain("storage_key");
  });

  it("stages only a hash-bound replacement for an admin restoration request", async () => {
    const bytes = Buffer.from('{"invoice":"restored"}');
    const payload = {
      client_request_id: "66666666-6666-4666-8666-666666666666",
      candidate_id: "b".repeat(64),
      content_type: "application/json",
      content_base64: bytes.toString("base64"),
      reason: "Stage a re-collected invoice that matches the immutable evidence hash.",
    };
    mockRequestShipmentApvInvoiceRestoration.mockResolvedValueOnce({
      outcome: "replacement_mismatch",
    });
    const mismatch = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/restoration-requests",
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toEqual({ error: "APV_INVOICE_RESTORATION_REPLACEMENT_MISMATCH" });

    const request = {
      id: payload.client_request_id,
      client_request_id: payload.client_request_id,
      candidate_fingerprint: payload.candidate_id,
      source_integrity_status: "QUARANTINED" as const,
      replacement_sha256: createHash("sha256").update(bytes).digest("hex"),
      replacement_byte_size: bytes.length,
      requester_id: "99999999-9999-4999-8999-999999999999",
      reason: payload.reason,
      status: "PENDING" as const,
      version: 0,
      staging_status: "STAGED" as const,
      expires_at: "2026-07-12T00:30:00.000Z",
      created_at: "2026-07-12T00:00:00.000Z",
    };
    mockRequestShipmentApvInvoiceRestoration.mockResolvedValueOnce({
      outcome: "requested",
      request,
    });
    const created = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/restoration-requests",
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      restoration_request: { status: "PENDING", source_integrity_status: "QUARANTINED" },
      idempotent: false,
    });
    expect(mockRequestShipmentApvInvoiceRestoration).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ bytes, contentType: "application/json" }),
    );
  });

  it("blocks restoration self-approval before any file restore", async () => {
    const requestId = "66666666-6666-4666-8666-666666666666";
    mockDecideShipmentApvInvoiceRestoration.mockResolvedValueOnce({
      outcome: "self_approval_forbidden",
    });
    const response = await app.inject({
      method: "POST",
      url: `/admin/shipments/apv-invoice-documents/restoration-requests/${requestId}/decision`,
      headers: ADMIN_HEADERS,
      payload: {
        decision_request_id: "55555555-5555-4555-8555-555555555555",
        decision: "RESTORE",
        reason: "The restoration maker cannot approve the same replacement.",
        expected_version: 0,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "APV_INVOICE_RESTORATION_SELF_APPROVAL_FORBIDDEN" });
  });

  it("returns pending restoration work and its version-ordered timeline", async () => {
    const requestId = "66666666-6666-4666-8666-666666666666";
    const request = {
      id: requestId,
      client_request_id: requestId,
      candidate_fingerprint: "b".repeat(64),
      source_integrity_status: "QUARANTINED" as const,
      replacement_sha256: "a".repeat(64),
      replacement_byte_size: 20,
      requester_id: "99999999-9999-4999-8999-999999999999",
      reason: "Stage a matching replacement for checker review.",
      status: "PENDING" as const,
      version: 0,
      staging_status: "STAGED" as const,
      expires_at: "2026-07-12T00:30:00.000Z",
      created_at: "2026-07-12T00:00:00.000Z",
    };
    mockListPendingShipmentApvInvoiceRestorations.mockResolvedValueOnce([request]);
    mockGetShipmentApvInvoiceRestorationTimeline.mockResolvedValueOnce({
      request,
      events: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          event_type: "REQUESTED",
          actor_id: request.requester_id,
          request_version: 0,
          metadata: {},
          created_at: "2026-07-12T00:00:00.000Z",
        },
      ],
    });
    const queue = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-requests/pending",
      headers: ADMIN_HEADERS,
    });
    const timeline = await app.inject({
      method: "GET",
      url: `/admin/shipments/apv-invoice-documents/restoration-requests/${requestId}/timeline`,
      headers: ADMIN_HEADERS,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      restoration_requests: [{ id: requestId, status: "PENDING" }],
    });
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json()).toMatchObject({
      restoration_timeline: { events: [{ event_type: "REQUESTED" }] },
    });
  });

  it("dry-runs and applies terminal restoration staging preservation only for admins", async () => {
    const url = "/admin/shipments/apv-invoice-documents/restoration-staging/maintenance";
    const forbidden = await app.inject({
      method: "POST",
      url,
      headers: AUTH_HEADERS,
      payload: { mode: "dry_run" },
    });
    expect(forbidden.statusCode).toBe(403);
    mockMaintainShipmentApvInvoiceRestorationStaging.mockResolvedValueOnce({
      mode: "dry_run",
      scanned: 2,
      eligible: 2,
      expired: 0,
      preserved: 0,
      resumed: 0,
      sourceMissing: 0,
      conflicts: 0,
      truncated: false,
    });
    const dryRun = await app.inject({
      method: "POST",
      url,
      headers: ADMIN_HEADERS,
      payload: { mode: "dry_run", limit: 100 },
    });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json()).toMatchObject({
      restoration_staging_maintenance: { mode: "dry_run", eligible: 2 },
    });
    mockMaintainShipmentApvInvoiceRestorationStaging.mockResolvedValueOnce({
      mode: "apply",
      scanned: 2,
      eligible: 2,
      expired: 1,
      preserved: 2,
      resumed: 1,
      sourceMissing: 0,
      conflicts: 0,
      truncated: false,
    });
    const applied = await app.inject({
      method: "POST",
      url,
      headers: ADMIN_HEADERS,
      payload: { mode: "apply" },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({
      restoration_staging_maintenance: {
        mode: "apply",
        expired: 1,
        preserved: 2,
        sourceMissing: 0,
        conflicts: 0,
      },
    });
  });

  it("returns aggregate restoration staging health only for admins", async () => {
    const url = "/admin/shipments/apv-invoice-documents/restoration-staging/health";
    const forbidden = await app.inject({ method: "GET", url, headers: AUTH_HEADERS });
    expect(forbidden.statusCode).toBe(403);
    mockGetShipmentApvInvoiceRestorationStagingHealth.mockResolvedValueOnce({
      status: "warning",
      trackedStaging: 2,
      pendingDisposition: 1,
      staleMoving: 1,
      missingSources: 0,
      hashMismatches: 0,
      invalidEntries: 0,
      checkedBytes: 256,
      scanTruncated: false,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    const response = await app.inject({ method: "GET", url, headers: ADMIN_HEADERS });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      restoration_staging_health: {
        status: "warning",
        trackedStaging: 2,
        pendingDisposition: 1,
        staleMoving: 1,
      },
      restoration_staging_maintenance: {
        jobEnabled: false,
        intervalSeconds: 60,
        staleResumeSeconds: 300,
      },
      restoration_remediation_health: {
        status: "healthy",
        pendingRequests: 0,
        staleApplyingRequests: 0,
      },
      restoration_remediation_expiry: {
        jobEnabled: false,
        intervalSeconds: 60,
        staleApplyingSeconds: 300,
      },
    });
    expect(JSON.stringify(response.json())).not.toContain("requestId");
    expect(JSON.stringify(response.json())).not.toContain("staging_key");
  });

  it("lists only opaque restoration remediation candidates for admins", async () => {
    const url = "/admin/shipments/apv-invoice-documents/restoration-remediation-candidates";
    const forbidden = await app.inject({ method: "GET", url, headers: AUTH_HEADERS });
    expect(forbidden.statusCode).toBe(403);
    mockListShipmentApvInvoiceRestorationRemediationCandidates.mockResolvedValueOnce({
      candidates: [{ candidateId: "c".repeat(64), issueType: "HASH_MISMATCH" }],
      truncated: false,
    });
    const response = await app.inject({ method: "GET", url, headers: ADMIN_HEADERS });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      restoration_remediation_candidates: {
        candidates: [{ candidateId: "c".repeat(64), issueType: "HASH_MISMATCH" }],
        truncated: false,
      },
    });
    expect(JSON.stringify(response.json())).not.toContain("staging_key");
    expect(JSON.stringify(response.json())).not.toContain("sha256");
    expect(JSON.stringify(response.json())).not.toContain("restoration_request_id");
  });

  it("creates an idempotent remediation request and blocks maker self-approval", async () => {
    const requestId = "12121212-1212-4212-8212-121212121212";
    const payload = {
      client_request_id: requestId,
      candidate_id: "c".repeat(64),
      reason: "Quarantine the verified mismatched staging bytes without deleting evidence.",
    };
    const remediationRequest = {
      id: requestId,
      client_request_id: requestId,
      candidate_fingerprint: payload.candidate_id,
      issue_type: "HASH_MISMATCH" as const,
      requester_id: "99999999-9999-4999-8999-999999999999",
      reason: payload.reason,
      status: "PENDING" as const,
      version: 0,
      expires_at: "2026-07-12T00:30:00.000Z",
      created_at: "2026-07-12T00:00:00.000Z",
    };
    mockRequestShipmentApvInvoiceRestorationRemediation.mockResolvedValueOnce({
      outcome: "requested",
      request: remediationRequest,
    });
    const created = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-requests",
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      restoration_remediation_request: {
        id: requestId,
        status: "PENDING",
        issue_type: "HASH_MISMATCH",
      },
      idempotent: false,
    });
    mockDecideShipmentApvInvoiceRestorationRemediation.mockResolvedValueOnce({
      outcome: "self_approval_forbidden",
    });
    const blocked = await app.inject({
      method: "POST",
      url: `/admin/shipments/apv-invoice-documents/restoration-remediation-requests/${requestId}/decision`,
      headers: ADMIN_HEADERS,
      payload: {
        decision_request_id: "13131313-1313-4313-8313-131313131313",
        decision: "APPROVE",
        reason: "A separate checker must approve evidence quarantine.",
        expected_version: 0,
      },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({
      error: "APV_INVOICE_RESTORATION_REMEDIATION_SELF_APPROVAL_FORBIDDEN",
    });
  });

  it("returns the remediation queue and immutable lifecycle timeline", async () => {
    const requestId = "12121212-1212-4212-8212-121212121212";
    const remediationRequest = {
      id: requestId,
      client_request_id: requestId,
      candidate_fingerprint: "c".repeat(64),
      issue_type: "HASH_MISMATCH" as const,
      requester_id: "99999999-9999-4999-8999-999999999999",
      reason: "Quarantine the verified mismatched staging bytes without deleting evidence.",
      status: "PENDING" as const,
      version: 0,
      expires_at: "2026-07-12T00:30:00.000Z",
      created_at: "2026-07-12T00:00:00.000Z",
    };
    mockListPendingShipmentApvInvoiceRestorationRemediations.mockResolvedValueOnce([
      remediationRequest,
    ]);
    mockGetShipmentApvInvoiceRestorationRemediationTimeline.mockResolvedValueOnce({
      request: remediationRequest,
      events: [
        {
          id: "14141414-1414-4414-8414-141414141414",
          event_type: "REQUESTED",
          actor_id: remediationRequest.requester_id,
          request_version: 0,
          metadata: { issue_type: "HASH_MISMATCH" },
          created_at: "2026-07-12T00:00:00.000Z",
        },
      ],
    });
    const queue = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-requests/pending",
      headers: ADMIN_HEADERS,
    });
    const timeline = await app.inject({
      method: "GET",
      url: `/admin/shipments/apv-invoice-documents/restoration-remediation-requests/${requestId}/timeline`,
      headers: ADMIN_HEADERS,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      restoration_remediation_requests: [{ id: requestId, status: "PENDING" }],
    });
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json()).toMatchObject({
      restoration_remediation_timeline: {
        events: [{ event_type: "REQUESTED", request_version: 0 }],
      },
    });
  });

  it("returns only the current checker's opaque stale remediation recovery queue", async () => {
    const requestId = "12121212-1212-4212-8212-121212121212";
    const decisionRequestId = "13131313-1313-4313-8313-131313131313";
    const cursor = "eyJ2IjoxfQ";
    mockListStaleShipmentApvInvoiceRestorationRemediationRecoveries
      .mockResolvedValueOnce({
        items: [
          {
            requestId,
            decisionRequestId,
            issueType: "SOURCE_MISSING",
            version: 1,
            stalledForSeconds: 360,
            applyErrorCode: null,
            updatedAt: "2026-07-12T00:00:00.000Z",
            acknowledged: false,
            incidentConnected: false,
            acknowledgedAt: null,
            incidentConnectedAt: null,
          },
        ],
        truncated: false,
        nextCursor: null,
        recordedAt: "2026-07-12T00:06:00.000Z",
      })
      .mockRejectedValueOnce(
        new Error("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR"),
      )
      .mockRejectedValueOnce(
        new Error("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR_EXPIRED"),
      );
    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-queue",
      headers: AUTH_HEADERS,
    });
    const response = await app.inject({
      method: "GET",
      url: `/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-queue?limit=10&cursor=${cursor}`,
      headers: ADMIN_HEADERS,
    });
    const invalidLimit = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-queue?limit=101",
      headers: ADMIN_HEADERS,
    });
    const invalidCursor = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-queue?cursor=e30",
      headers: ADMIN_HEADERS,
    });
    const expiredCursor = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-queue?cursor=ZXhwaXJlZA",
      headers: ADMIN_HEADERS,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(response.statusCode).toBe(200);
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidCursor.statusCode).toBe(400);
    expect(expiredCursor.statusCode).toBe(400);
    expect(invalidCursor.json()).toEqual({
      error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR",
    });
    expect(expiredCursor.json()).toEqual({
      error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR_EXPIRED",
    });
    expect(
      mockRecordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection,
    ).toHaveBeenNthCalledWith(1, expect.anything(), { reason: "INVALID" });
    expect(
      mockRecordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection,
    ).toHaveBeenNthCalledWith(2, expect.anything(), { reason: "EXPIRED" });
    expect(invalidLimit.json()).toEqual({
      error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_QUERY",
    });
    expect(mockListStaleShipmentApvInvoiceRestorationRemediationRecoveries).toHaveBeenCalledWith(
      expect.anything(),
      { approverId: "test-admin-001", limit: 10, cursor },
    );
    expect(response.json()).toMatchObject({
      restoration_remediation_recovery_queue: {
        items: [
          {
            requestId,
            decisionRequestId,
            issueType: "SOURCE_MISSING",
            version: 1,
            stalledForSeconds: 360,
            applyErrorCode: null,
            updatedAt: "2026-07-12T00:00:00.000Z",
            acknowledged: false,
            incidentConnected: false,
            acknowledgedAt: null,
            incidentConnectedAt: null,
          },
        ],
        truncated: false,
        nextCursor: null,
        recordedAt: "2026-07-12T00:06:00.000Z",
      },
      restoration_remediation_recovery_cursor_health: {
        windowHours: 24,
        expired: 0,
        invalid: 0,
        total: 0,
        lastSeenAt: null,
        recordedAt: "2026-07-12T00:00:00.000Z",
      },
      restoration_remediation_recovery_cursor_retention_job: {
        jobEnabled: false,
        configured: false,
        retentionDays: 30,
        limit: 1000,
        intervalSeconds: 86_400,
        health: {
          lastRunStatus: "NEVER",
          leaseStale: false,
          lastDeletedBuckets: 0,
          lastExpiredBuckets: 0,
          lastInvalidBuckets: 0,
          lastFailureCode: null,
        },
        alertAssessment: { wouldAlert: false, severity: null, reasons: [] },
      },
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /path|sha256|candidate|restorationRequestId|requesterId|remediationReason|decisionReason|claimId|leaseExpires/i,
    );

    mockGetShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth.mockRejectedValueOnce(
      new Error("migration not applied"),
    );
    const queueWithoutMetrics = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-queue",
      headers: ADMIN_HEADERS,
    });
    expect(queueWithoutMetrics.statusCode).toBe(200);
    expect(queueWithoutMetrics.json()).toMatchObject({
      restoration_remediation_recovery_cursor_health: null,
    });

    mockListStaleShipmentApvInvoiceRestorationRemediationRecoveries.mockRejectedValueOnce(
      new Error("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR"),
    );
    mockRecordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection.mockRejectedValueOnce(
      new Error("migration not applied"),
    );
    const invalidWithoutMetrics = await app.inject({
      method: "GET",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-queue?cursor=e30",
      headers: ADMIN_HEADERS,
    });
    expect(invalidWithoutMetrics.statusCode).toBe(400);
    expect(invalidWithoutMetrics.json()).toEqual({
      error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR",
    });
  });

  it("runs bounded admin-only cursor metric retention maintenance", async () => {
    mockMaintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics.mockResolvedValueOnce(
      {
        dryRun: false,
        retentionDays: 30,
        limit: 1000,
        eligibleBuckets: undefined,
        deletedBuckets: 2,
        expiredBuckets: 1,
        invalidBuckets: 1,
        truncated: false,
        cutoffAt: "2026-06-12T00:00:00.000Z",
        recordedAt: "2026-07-12T00:00:00.000Z",
      },
    );
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-cursor-metrics/maintenance",
      headers: AUTH_HEADERS,
      payload: { retention_days: 30, limit: 1000, dry_run: false },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-cursor-metrics/maintenance",
      headers: ADMIN_HEADERS,
      payload: { retention_days: 1, limit: 1001, dry_run: false },
    });
    const response = await app.inject({
      method: "POST",
      url: "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-cursor-metrics/maintenance",
      headers: ADMIN_HEADERS,
      payload: { retention_days: 30, limit: 1000, dry_run: false },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(400);
    expect(response.statusCode).toBe(200);
    expect(
      mockMaintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics,
    ).toHaveBeenCalledWith(expect.anything(), { retentionDays: 30, limit: 1000, dryRun: false });
    expect(response.json()).toMatchObject({
      restoration_remediation_recovery_cursor_maintenance: {
        dryRun: false,
        deletedBuckets: 2,
        expiredBuckets: 1,
        invalidBuckets: 1,
      },
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /user|checker|cursor.*value|requestId|bucket_start/i,
    );
  });

  it("records only a 60-minute stale recovery action for the bound checker", async () => {
    const requestId = "12121212-1212-4212-8212-121212121212";
    const payload = {
      client_request_id: "14141414-1414-4414-8414-141414141414",
      decision_request_id: "13131313-1313-4313-8313-131313131313",
      action: "ACKNOWLEDGED",
      expected_version: 1,
    } as const;
    mockRecordShipmentApvInvoiceRestorationRemediationAcknowledgment.mockResolvedValueOnce({
      outcome: "recorded",
      acknowledgment: {
        id: "15151515-1515-4515-8515-151515151515",
        action: "ACKNOWLEDGED",
        requestVersion: 1,
        incidentReferenceBound: false,
        createdAt: "2026-07-13T00:00:00.000Z",
      },
    });
    const forbidden = await app.inject({
      method: "POST",
      url: `/admin/shipments/apv-invoice-documents/restoration-remediation-requests/${requestId}/recovery-actions`,
      headers: AUTH_HEADERS,
      payload,
    });
    const response = await app.inject({
      method: "POST",
      url: `/admin/shipments/apv-invoice-documents/restoration-remediation-requests/${requestId}/recovery-actions`,
      headers: ADMIN_HEADERS,
      payload,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(response.statusCode).toBe(201);
    expect(mockRecordShipmentApvInvoiceRestorationRemediationAcknowledgment).toHaveBeenCalledWith(
      expect.anything(),
      {
        requestId,
        clientRequestId: payload.client_request_id,
        decisionRequestId: payload.decision_request_id,
        checkerId: "test-admin-001",
        action: "ACKNOWLEDGED",
        expectedVersion: 1,
        incidentReference: undefined,
      },
    );
    expect(response.json()).toEqual({
      restoration_remediation_acknowledgment: {
        id: "15151515-1515-4515-8515-151515151515",
        action: "ACKNOWLEDGED",
        requestVersion: 1,
        incidentReferenceBound: false,
        createdAt: "2026-07-13T00:00:00.000Z",
      },
      idempotent: false,
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /checker|decisionRequest|incident_reference_hash|path|sha256/i,
    );
    const invalidIncident = await app.inject({
      method: "POST",
      url: `/admin/shipments/apv-invoice-documents/restoration-remediation-requests/${requestId}/recovery-actions`,
      headers: ADMIN_HEADERS,
      payload: {
        ...payload,
        client_request_id: "16161616-1616-4616-8616-161616161616",
        action: "INCIDENT_LINKED",
      },
    });
    expect(invalidIncident.statusCode).toBe(400);
    mockRecordShipmentApvInvoiceRestorationRemediationAcknowledgment.mockResolvedValueOnce({
      outcome: "not_stale_enough",
    });
    const tooFresh = await app.inject({
      method: "POST",
      url: `/admin/shipments/apv-invoice-documents/restoration-remediation-requests/${requestId}/recovery-actions`,
      headers: ADMIN_HEADERS,
      payload: { ...payload, client_request_id: "17171717-1717-4717-8717-171717171717" },
    });
    expect(tooFresh.statusCode).toBe(409);
    expect(tooFresh.json()).toEqual({
      error: "APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_NOT_STALE_ENOUGH",
    });
    mockRecordShipmentApvInvoiceRestorationRemediationAcknowledgment.mockResolvedValueOnce({
      outcome: "acknowledgment_required",
    });
    const acknowledgmentRequired = await app.inject({
      method: "POST",
      url: `/admin/shipments/apv-invoice-documents/restoration-remediation-requests/${requestId}/recovery-actions`,
      headers: ADMIN_HEADERS,
      payload: {
        ...payload,
        client_request_id: "18181818-1818-4818-8818-181818181818",
        action: "INCIDENT_LINKED",
        incident_reference: "INCIDENT-ORDER-TEST",
      },
    });
    expect(acknowledgmentRequired.statusCode).toBe(409);
    expect(acknowledgmentRequired.json()).toEqual({
      error: "APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_ACKNOWLEDGMENT_REQUIRED",
    });
  });

  it("lists only the authenticated seller's APV liability queue", async () => {
    mockListShipmentApvSellerLiabilities.mockResolvedValueOnce([
      {
        id: "77777777-7777-4777-8777-777777777777",
        seller_id: "test-user-001",
        source_settlement_release_id: "88888888-8888-4888-8888-888888888888",
        source_order_id: "99999999-9999-4999-8999-999999999999",
        currency: "USDC",
        original_amount_minor: 100,
        remaining_amount_minor: 40,
        status: "PARTIAL",
        evidence_manifest_sha256: "a".repeat(64),
        version: 1,
      },
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/shipments/apv-liabilities",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      seller_id: "test-user-001",
      liabilities: [{ status: "PARTIAL", original_amount_minor: 100, remaining_amount_minor: 40 }],
    });
    expect(mockListShipmentApvSellerLiabilities).toHaveBeenCalledWith(
      expect.anything(),
      "test-user-001",
    );
  });

  it("allows only admins to inspect another seller's APV liability queue", async () => {
    const sellerId = "33333333-3333-4333-8333-333333333333";
    const forbidden = await app.inject({
      method: "GET",
      url: `/shipments/apv-liabilities?seller_id=${sellerId}`,
      headers: AUTH_HEADERS,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(mockListShipmentApvSellerLiabilities).not.toHaveBeenCalled();

    const allowed = await app.inject({
      method: "GET",
      url: `/shipments/apv-liabilities?seller_id=${sellerId}`,
      headers: ADMIN_HEADERS,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ seller_id: sellerId, liabilities: [] });
    expect(mockListShipmentApvSellerLiabilities).toHaveBeenCalledWith(expect.anything(), sellerId);
  });

  // POST /shipments - schema validation
  it("POST /shipments returns 400 without body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: AUTH_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_SHIPMENT_REQUEST");
  });

  it("POST /shipments returns 400 with partial body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: AUTH_HEADERS,
      payload: { order_id: "ord_123" }, // missing seller_id and buyer_id
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_SHIPMENT_REQUEST");
    expect(res.json().issues).toBeDefined();
  });

  it("POST /shipments derives buyer and seller from the order instead of trusting the request body", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({
      id: "ord_123",
      buyerId: "order-buyer-001",
      sellerId: "test-user-001",
      status: "PAID",
      amountMinor: "50000",
      currency: "USD",
      orderSnapshot: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    mockGetShipmentByOrderId.mockResolvedValueOnce(null);
    mockCreateShipmentRecord.mockResolvedValueOnce({
      id: "shp_123",
      order_id: "ord_123",
      seller_id: "test-user-001",
      buyer_id: "order-buyer-001",
      status: "LABEL_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: AUTH_HEADERS,
      payload: {
        order_id: "ord_123",
        seller_id: "spoofed-seller",
        buyer_id: "spoofed-buyer",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateShipmentRecord).toHaveBeenCalledWith(
      expect.anything(),
      "ord_123",
      "test-user-001",
      "order-buyer-001",
      undefined,
      {
        metadata: expect.objectContaining({
          shipping_execution_mode: "integration_manual",
          shipping_provider_environment: "test",
        }),
      },
    );
    expect(res.json().shipment).toMatchObject({
      seller_id: "test-user-001",
      buyer_id: "order-buyer-001",
    });
  });

  it("does not let the seller change a shipping mode locked during checkout", async () => {
    const shipment = {
      id: "shp_checkout_locked",
      order_id: "ord_checkout_locked",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      carrier: "unknown",
      status: "LABEL_PENDING",
      metadata: {
        shipping_execution_mode: "integration_manual",
        shipping_execution_mode_source: "payment_checkout",
        shipping_execution_mode_payment_locked: true,
      },
      events: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);

    const res = await app.inject({
      method: "POST",
      url: "/shipments/shp_checkout_locked/execution-mode",
      headers: AUTH_HEADERS,
      payload: { execution_mode: "physical_live" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "SHIPMENT_EXECUTION_MODE_PAYMENT_LOCKED",
      current_mode: "integration_manual",
    });
  });

  // GET /shipments/:id
  it("GET /shipments/:id returns 404 for nonexistent shipment", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/shipments/nonexistent-id",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("SHIPMENT_NOT_FOUND");
  });

  // GET /shipments/by-order/:orderId
  it("GET /shipments/by-order/:orderId returns 404 for unknown order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/shipments/by-order/ord_unknown",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("SHIPMENT_NOT_FOUND");
  });

  // POST /shipments/:id/event - validation
  it("blocks manual carrier events for physical shipping rehearsals", async () => {
    const shipment = {
      id: "shp_physical_live",
      order_id: "ord_physical_live",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      status: "LABEL_CREATED",
      carrier: "USPS",
      events: [],
      metadata: {
        shipping_execution_mode: "physical_live",
        shipping_provider_environment: "live",
      },
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);

    const res = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/event`,
      headers: ADMIN_HEADERS,
      payload: { event_type: "ship" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: "MANUAL_SHIPMENT_EVENTS_DISABLED",
    });
    expect(mockUpdateShipmentRecord).not.toHaveBeenCalled();
  });

  it("POST /shipments/:id/event returns 404 for nonexistent shipment", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shipments/nonexistent/event",
      headers: AUTH_HEADERS,
      payload: { event_type: "ship" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("SHIPMENT_NOT_FOUND");
  });

  it("POST /shipments/:id/event rejects unknown event types before transition", async () => {
    const shipment = {
      id: "shp_event_invalid",
      order_id: "ord_event_invalid",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      carrier: "mock",
      status: "IN_TRANSIT",
      events: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);

    const res = await app.inject({
      method: "POST",
      url: "/shipments/shp_event_invalid/event",
      headers: AUTH_HEADERS,
      payload: { event_type: "teleport" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_EVENT");
  });

  it("records raw carrier status and auto-opens a dispute for a delivery exception", async () => {
    const shipment = {
      id: "shp_exception",
      order_id: "ord_exception",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      carrier: "mock",
      tracking_number: "TRACK_EXCEPTION",
      status: "IN_TRANSIT",
      events: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);
    mockInsertShipmentEvent.mockClear();
    mockCreateDisputeRecord.mockClear();
    mockUpdateCommerceOrderStatus.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/shipments/shp_exception/event",
      headers: AUTH_HEADERS,
      payload: {
        event_id: "carrier_evt_exception_1",
        event_type: "exception",
        raw_status: "delivery_attempted_no_access",
        payload: {
          message: "Carrier could not access the building",
          location: "Redondo Beach, CA",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      idempotent: false,
      shipment: { status: "DELIVERY_EXCEPTION" },
    });
    expect(mockInsertShipmentEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: expect.stringMatching(/^evt_manual_[a-f0-9]{64}$/),
        carrier_raw_status: "delivery_attempted_no_access",
        status: "DELIVERY_EXCEPTION",
      }),
    );
    expect(mockCreateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        order_id: "ord_exception",
        reason_code: "DELIVERY_EXCEPTION",
        opened_by: "system",
        metadata: expect.objectContaining({ auto_opened: true, shipment_id: "shp_exception" }),
      }),
    );
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
      expect.anything(),
      "ord_exception",
      "IN_DISPUTE",
    );
  });

  it("replays a manual shipment event with the same event id without another transition", async () => {
    const internalEventId = `evt_manual_${createHash("sha256").update("shp_event_replay:carrier_evt_exception_replay").digest("hex")}`;
    const shipment = {
      id: "shp_event_replay",
      order_id: "ord_event_replay",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      carrier: "mock",
      status: "DELIVERY_EXCEPTION",
      events: [
        {
          id: internalEventId,
          shipment_id: "shp_event_replay",
          status: "DELIVERY_EXCEPTION",
          occurred_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);
    mockUpdateShipmentRecord.mockClear();
    mockInsertShipmentEvent.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/shipments/shp_event_replay/event",
      headers: AUTH_HEADERS,
      payload: {
        event_id: "carrier_evt_exception_replay",
        event_type: "exception",
        raw_status: "delivery_attempted_no_access",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().idempotent).toBe(true);
    expect(mockUpdateShipmentRecord).not.toHaveBeenCalled();
    expect(mockInsertShipmentEvent).not.toHaveBeenCalled();
  });

  // POST /shipments/:id/label
  it("blocks the legacy label endpoint for physical shipping", async () => {
    const shipment = {
      id: "shp_physical_legacy_label",
      order_id: "ord_physical_legacy_label",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      status: "LABEL_PENDING",
      carrier: "easypost",
      events: [],
      metadata: {
        shipping_execution_mode: "physical_live",
        shipping_provider_environment: "live",
      },
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);

    const res = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/label`,
      headers: ADMIN_HEADERS,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "LIVE_LABEL_REQUIRES_RATE_SELECTION" });
  });

  it("requires an explicit real-charge acknowledgement before buying a physical label", async () => {
    const shipment = {
      id: "shp_physical_label",
      order_id: "ord_physical_label",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      status: "LABEL_PENDING",
      carrier: "easypost",
      events: [],
      metadata: {
        shipping_execution_mode: "physical_live",
        shipping_provider_environment: "live",
      },
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);

    const res = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/purchase-label`,
      headers: ADMIN_HEADERS,
      payload: { rate_id: "rate_live_1" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "LIVE_LABEL_CHARGE_ACKNOWLEDGEMENT_REQUIRED",
    });
  });

  it("POST /shipments/:id/label returns 404 for nonexistent shipment", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shipments/nonexistent/label",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("SHIPMENT_NOT_FOUND");
  });

  it("refunds an unused mock label without changing buyer money", async () => {
    const shipment = {
      id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      shipment_type: "outbound",
      carrier: "mock",
      tracking_number: "MOCK_LABEL_1",
      label_url: "https://mock-labels.example/label.pdf",
      label_refund_status: "NONE",
      status: "LABEL_CREATED",
      events: [],
      created_at: "2026-07-12T00:00:00.000Z",
      updated_at: "2026-07-12T00:00:00.000Z",
    } as unknown as ShipmentRow;
    const refunded = {
      ...shipment,
      status: "LABEL_PENDING",
      tracking_number: undefined,
      label_url: undefined,
      label_refund_status: "REFUNDED",
    } as ShipmentRow;
    mockGetShipmentById
      .mockResolvedValueOnce(shipment)
      .mockResolvedValueOnce(shipment)
      .mockResolvedValueOnce(refunded);
    mockClaimShipmentLabelRefund.mockResolvedValueOnce({
      outcome: "acquired",
      shipmentId: shipment.id,
      claimId: "55555555-5555-4555-8555-555555555555",
      attemptCount: 1,
    });

    const res = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/refund-label`,
      headers: AUTH_HEADERS,
      payload: { reason: "Wrong service level selected" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      refund_status: "REFUNDED",
      provider: "mock",
      money_effect: "NONE",
      shipment: { status: "LABEL_PENDING", label_refund_status: "REFUNDED" },
    });
    expect(mockCompleteShipmentLabelRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "acquired" }),
      "REFUNDED",
      `mock:${shipment.id}`,
    );
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
      expect.anything(),
      shipment.order_id,
      "FULFILLMENT_PENDING",
    );
  });

  it("rejects label refund after the shipment has been scanned", async () => {
    const shipment = {
      id: "11111111-1111-4111-8111-111111111112",
      order_id: "22222222-2222-4222-8222-222222222223",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      shipment_type: "outbound",
      carrier: "mock",
      status: "IN_TRANSIT",
      label_refund_status: "NONE",
      events: [],
      created_at: "2026-07-12T00:00:00.000Z",
      updated_at: "2026-07-12T00:00:00.000Z",
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);
    mockClaimShipmentLabelRefund.mockResolvedValueOnce({
      outcome: "invalid_status",
      shipmentId: shipment.id,
    });

    const res = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/refund-label`,
      headers: AUTH_HEADERS,
      payload: { reason: "Attempt after carrier scan" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("LABEL_REFUND_NOT_ALLOWED");
    expect(mockCompleteShipmentLabelRefund).not.toHaveBeenCalled();
  });

  it("blocks manual shipment advancement while a label refund is submitted", async () => {
    const shipment = {
      id: "11111111-1111-4111-8111-111111111113",
      order_id: "22222222-2222-4222-8222-222222222224",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      shipment_type: "outbound",
      carrier: "mock",
      status: "LABEL_CREATED",
      label_refund_status: "SUBMITTED",
      events: [],
      created_at: "2026-07-12T00:00:00.000Z",
      updated_at: "2026-07-12T00:00:00.000Z",
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);
    const res = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/event`,
      headers: AUTH_HEADERS,
      payload: { event_type: "ship" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("LABEL_REFUND_BLOCKS_SHIPMENT_EVENT");
    expect(mockUpdateShipmentRecord).not.toHaveBeenCalled();
  });

  it("returns local label refund status without a provider call when no refresh is pending", async () => {
    const shipment = {
      id: "11111111-1111-4111-8111-111111111114",
      order_id: "22222222-2222-4222-8222-222222222225",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      shipment_type: "outbound",
      carrier: "mock",
      status: "LABEL_PENDING",
      label_refund_status: "REFUNDED",
      events: [],
      created_at: "2026-07-12T00:00:00.000Z",
      updated_at: "2026-07-12T00:00:00.000Z",
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);
    const res = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/refund-label/status`,
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ refund_status: "REFUNDED", refreshed: false });
    expect(mockSyncSubmittedShipmentLabelRefund).not.toHaveBeenCalled();
  });

  // POST /shipments/rates - validation
  it("POST /shipments/rates returns 400 without body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shipments/rates",
      headers: AUTH_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_RATE_REQUEST");
  });

  it("POST /shipments/rates rejects oversized address fields", async () => {
    const address = {
      name: "x".repeat(513),
      street1: "1 Market St",
      city: "San Francisco",
      state: "CA",
      zip: "94105",
      country: "US",
    };

    const res = await app.inject({
      method: "POST",
      url: "/shipments/rates",
      headers: AUTH_HEADERS,
      payload: {
        from_address: address,
        to_address: { ...address, name: "Buyer" },
        parcel: { weight_oz: 16 },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_RATE_REQUEST");
  });

  it("advances a seller shipment only after EasyPost verifies the staging test status", async () => {
    const previous = {
      haggleEnv: process.env.HAGGLE_ENV,
      network: process.env.HAGGLE_X402_NETWORK,
      easypostKey: process.env.EASYPOST_API_KEY,
    };
    process.env.HAGGLE_ENV = "staging";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.EASYPOST_API_KEY = "EZTK_test_key";

    const shipment = {
      id: "shipment_test_tracker",
      order_id: "order_test_tracker",
      seller_id: "test-user-001",
      buyer_id: "buyer_test_tracker",
      shipment_type: "outbound",
      carrier: "easypost",
      tracking_number: "EZ_LABEL_TRACKING",
      label_url: "https://easypost.test/label.pdf",
      status: "LABEL_CREATED",
      metadata: { easypost_shipment_id: "shp_test_tracker" },
      events: [],
      created_at: "2026-07-21T12:00:00.000Z",
      updated_at: "2026-07-21T12:00:00.000Z",
    } as unknown as ShipmentRow;
    const advancedShipment = { ...shipment, status: "IN_TRANSIT" } as ShipmentRow;
    mockGetShipmentById.mockResolvedValue(shipment);
    vi.mocked(applyCarrierShipmentEvent).mockResolvedValueOnce({
      shipment: advancedShipment,
      stateChanged: true,
      effectsRequired: true,
      disposition: "applied",
    } as never);

    try {
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/test-tracker`,
        headers: AUTH_HEADERS,
        payload: { status: "in_transit" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        shipment: {
          status: "IN_TRANSIT",
          metadata: {
            easypost_test_tracker: {
              fixture_type: "canned_tracking_code",
              linked_label_tracking_number: "EZ_LABEL_TRACKING",
            },
          },
        },
        provider_verification: {
          provider: "easypost",
          mode: "test",
          status: "in_transit",
          tracking_code: "EZ2000000002",
          fixture_type: "canned_tracking_code",
        },
      });
      expect(applyCarrierShipmentEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          shipmentId: shipment.id,
          incomingStatus: "IN_TRANSIT",
          carrierRawStatus: "in_transit",
        }),
      );
      expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
        expect.anything(),
        shipment.order_id,
        "FULFILLMENT_ACTIVE",
      );
    } finally {
      if (previous.haggleEnv === undefined) delete process.env.HAGGLE_ENV;
      else process.env.HAGGLE_ENV = previous.haggleEnv;
      if (previous.network === undefined) delete process.env.HAGGLE_X402_NETWORK;
      else process.env.HAGGLE_X402_NETWORK = previous.network;
      if (previous.easypostKey === undefined) delete process.env.EASYPOST_API_KEY;
      else process.env.EASYPOST_API_KEY = previous.easypostKey;
    }
  });

  it("hides EasyPost test tracking outside the staging test runtime", async () => {
    const previousHaggleEnv = process.env.HAGGLE_ENV;
    delete process.env.HAGGLE_ENV;
    const shipment = {
      id: "shipment_test_tracker_hidden",
      order_id: "order_test_tracker_hidden",
      seller_id: "test-user-001",
      buyer_id: "buyer_test_tracker",
      status: "LABEL_CREATED",
      events: [],
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValue(shipment);

    try {
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/test-tracker`,
        headers: AUTH_HEADERS,
        payload: { status: "in_transit" },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: "EASYPOST_TEST_TRACKING_NOT_AVAILABLE" });
      expect(applyCarrierShipmentEvent).not.toHaveBeenCalled();
    } finally {
      if (previousHaggleEnv === undefined) delete process.env.HAGGLE_ENV;
      else process.env.HAGGLE_ENV = previousHaggleEnv;
    }
  });

  it("claims an EasyPost webhook before acknowledging an unsupported event", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: { id: "evt_easypost_unknown", description: "unknown.event", result: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true, skipped: true });
    expect(mockClaimWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "easypost",
        eventId: "evt_easypost_unknown",
      }),
    );
    expect(mockCompleteWebhookEvent).toHaveBeenCalled();
  });

  it("returns duplicate for an already completed EasyPost webhook", async () => {
    mockClaimWebhookEvent.mockResolvedValueOnce({
      outcome: "duplicate",
      source: "easypost",
      eventId: "evt_easypost_duplicate",
    });
    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: { id: "evt_easypost_duplicate", description: "tracker.updated", result: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe("duplicate");
  });

  it("asks EasyPost to retry while another server owns the event", async () => {
    mockClaimWebhookEvent.mockResolvedValueOnce({
      outcome: "in_progress",
      source: "easypost",
      eventId: "evt_easypost_busy",
    });
    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: { id: "evt_easypost_busy", description: "tracker.updated", result: {} },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("WEBHOOK_PROCESSING_IN_PROGRESS");
  });

  it("rejects a changed EasyPost payload for the same event id", async () => {
    mockClaimWebhookEvent.mockResolvedValueOnce({
      outcome: "payload_conflict",
      source: "easypost",
      eventId: "evt_easypost_changed",
    });
    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: {
        id: "evt_easypost_changed",
        description: "tracker.updated",
        result: { status: "delivered" },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("WEBHOOK_PAYLOAD_CONFLICT");
  });

  it("applies a signed EasyPost invoice through the fair APV ledger", async () => {
    const shipment = {
      id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      seller_id: "33333333-3333-4333-8333-333333333333",
      buyer_id: "44444444-4444-4444-8444-444444444444",
      shipment_type: "outbound",
      carrier: "easypost",
      tracking_number: "APVTRACK1",
      status: "DELIVERED",
      metadata: { easypost_shipment_id: "shp_apv_1" },
      events: [],
      created_at: "2026-07-12T00:00:00.000Z",
      updated_at: "2026-07-12T00:00:00.000Z",
    } as unknown as ShipmentRow;
    const claim = {
      outcome: "acquired" as const,
      provider: "easypost",
      providerInvoiceId: "shinv_apv_1",
      claimId: "55555555-5555-4555-8555-555555555555",
      attemptCount: 1,
    };
    mockParseEasyPostInvoicePayload.mockReturnValueOnce({
      invoice_event: "created",
      invoice_id: "shinv_apv_1",
      shipment_id: "shp_apv_1",
      tracking_code: "APVTRACK1",
      original_rate_minor: 625,
      adjusted_rate_minor: 1025,
      adjustment_minor: 400,
    });
    mockGetShipmentByTrackingNumber.mockResolvedValueOnce(shipment);
    mockGetSettlementReleaseByOrderId.mockResolvedValueOnce({
      id: "66666666-6666-4666-8666-666666666666",
    } as never);
    mockClaimShipmentApvAdjustment.mockResolvedValueOnce(claim);
    mockCompleteShipmentApvAdjustment.mockResolvedValueOnce({
      id: "77777777-7777-4777-8777-777777777777",
      provider: "easypost",
      provider_invoice_id: "shinv_apv_1",
      shipment_id: shipment.id,
      order_id: shipment.order_id,
      settlement_release_id: "66666666-6666-4666-8666-666666666666",
      status: "REVIEW_REQUIRED",
      original_rate_minor: 625,
      adjusted_rate_minor: 1025,
      adjustment_minor: 400,
      buffer_applied_minor: 150,
      assessed_seller_liability_minor: 250,
      seller_liability_minor: 250,
      platform_liability_minor: 0,
      carrier_credit_minor: 0,
      buyer_effect_minor: 0,
      review_status: "NONE",
      review_version: 0,
      attempt_count: 1,
    });

    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: { id: "evt_apv_1", description: "shipment_invoice.created", result: {} },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accepted: true,
      idempotent: false,
      adjustment: {
        status: "REVIEW_REQUIRED",
        buffer_applied_minor: 150,
        seller_liability_minor: 250,
        buyer_effect_minor: 0,
      },
      fairness: { buyer_effect_minor: 0, seller_declared_package_responsibility: true },
    });
    expect(mockClaimShipmentApvAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerInvoiceId: "shinv_apv_1",
        adjustmentMinor: 400,
      }),
    );
    expect(mockCompleteShipmentApvAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      claim,
      expect.anything(),
    );
    expect(mockFailShipmentApvAdjustment).not.toHaveBeenCalled();
  });

  it("rejects an EasyPost invoice when the provider shipment binding is missing", async () => {
    mockParseEasyPostInvoicePayload.mockReturnValueOnce({
      invoice_event: "created",
      invoice_id: "shinv_apv_unbound",
      shipment_id: "shp_apv_unbound",
      tracking_code: "APVTRACKUNBOUND",
      original_rate_minor: 625,
      adjusted_rate_minor: 725,
      adjustment_minor: 100,
    });
    mockGetShipmentByTrackingNumber.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      metadata: {},
    } as unknown as ShipmentRow);
    mockGetSettlementReleaseByOrderId.mockResolvedValueOnce({
      id: "66666666-6666-4666-8666-666666666666",
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: { id: "evt_apv_unbound", description: "shipment_invoice.created", result: {} },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      accepted: false,
      error: "APV_PROVIDER_SHIPMENT_ID_MISSING",
    });
    expect(mockClaimShipmentApvAdjustment).not.toHaveBeenCalled();
  });

  it("records an official updated invoice as an append-only delta without moving money", async () => {
    const shipment = {
      id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      metadata: { easypost_shipment_id: "shp_apv_revision" },
    } as unknown as ShipmentRow;
    mockParseEasyPostInvoicePayload.mockReturnValueOnce({
      invoice_event: "updated",
      invoice_id: "shinv_apv_revision",
      shipment_id: "shp_apv_revision",
      tracking_code: "APVREVISION1",
      original_rate_minor: 625,
      adjusted_rate_minor: 1125,
      adjustment_minor: 500,
    });
    mockGetShipmentByTrackingNumber.mockResolvedValueOnce(shipment);
    mockGetSettlementReleaseByOrderId.mockResolvedValueOnce({
      id: "66666666-6666-4666-8666-666666666666",
    } as never);
    mockRecordShipmentApvInvoiceRevision.mockResolvedValueOnce({
      outcome: "recorded",
      revision: {
        id: "77777777-7777-4777-8777-777777777777",
        adjustment_id: "88888888-8888-4888-8888-888888888888",
        provider: "easypost",
        provider_invoice_id: "shinv_apv_revision",
        revision_number: 2,
        invoice_event: "updated",
        payload_sha256: "a".repeat(64),
        webhook_event_id: "evt_apv_revision",
        prior_adjusted_rate_minor: 1025,
        adjusted_rate_minor: 1125,
        delta_minor: 100,
        status: "PENDING_REVIEW",
        buyer_effect_minor: 0,
        buffer_applied_minor: 0,
        seller_liability_minor: 0,
        platform_liability_minor: 0,
        carrier_credit_minor: 0,
        apply_version: 0,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: { id: "evt_apv_revision", description: "shipment.invoice.updated", result: {} },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      accepted: true,
      manual_review_required: true,
      money_effect: "NONE_PENDING_REVIEW",
      revision: { revision_number: 2, delta_minor: 100, buyer_effect_minor: 0 },
    });
    expect(mockClaimShipmentApvAdjustment).not.toHaveBeenCalled();
    expect(mockCompleteShipmentApvAdjustment).not.toHaveBeenCalled();
  });

  it("retries an updated invoice that arrives before its base revision without applying money", async () => {
    mockParseEasyPostInvoicePayload.mockReturnValueOnce({
      invoice_event: "updated",
      invoice_id: "shinv_early_update",
      shipment_id: "shp_early_update",
      tracking_code: "APVEARLYUPDATE",
      original_rate_minor: 625,
      adjusted_rate_minor: 725,
      adjustment_minor: 100,
    });
    mockGetShipmentByTrackingNumber.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      metadata: { easypost_shipment_id: "shp_early_update" },
    } as unknown as ShipmentRow);
    mockGetSettlementReleaseByOrderId.mockResolvedValueOnce({
      id: "66666666-6666-4666-8666-666666666666",
    } as never);
    mockRecordShipmentApvInvoiceRevision.mockResolvedValueOnce({ outcome: "not_found" });

    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: { id: "evt_early_update", description: "shipment.invoice.updated", result: {} },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ accepted: false, error: "APV_REVISION_BASE_NOT_READY" });
    expect(mockClaimShipmentApvAdjustment).not.toHaveBeenCalled();
    expect(mockCompleteShipmentApvAdjustment).not.toHaveBeenCalled();
    expect(mockFailWebhookEvent).toHaveBeenCalled();
  });

  it("applies an EasyPost carrier event using its occurrence time and audit fields", async () => {
    const shipment = {
      id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      seller_id: "33333333-3333-4333-8333-333333333333",
      buyer_id: "44444444-4444-4444-8444-444444444444",
      shipment_type: "outbound",
      carrier: "easypost",
      tracking_number: "EZ_ORDERED_1",
      status: "IN_TRANSIT",
      events: [],
      created_at: "2026-07-12T09:00:00.000Z",
      updated_at: "2026-07-12T10:00:00.000Z",
    } as unknown as ShipmentRow;
    const delivered = {
      ...shipment,
      status: "DELIVERED",
      delivered_at: "2026-07-12T04:00:00.000Z",
    } as unknown as ShipmentRow;
    mockGetShipmentByTrackingNumber.mockResolvedValueOnce(shipment);
    mockApplyCarrierShipmentEvent.mockResolvedValueOnce({
      shipment: delivered,
      event: {} as never,
      disposition: "applied",
      stateChanged: true,
      effectsRequired: true,
    });

    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: {
        id: "evt_ordered_delivery",
        description: "tracker.updated",
        result: {
          tracking_code: "EZ_ORDERED_1",
          carrier: "USPS",
          status: "delivered",
          tracking_details: [
            {
              datetime: "2026-07-12T04:00:00.000Z",
              message: "Delivered at front door",
              tracking_location: { city: "Denver", state: "CO" },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accepted: true,
      event_status: "DELIVERED",
      new_status: "DELIVERED",
      state_changed: true,
      ordering_disposition: "applied",
      occurred_at: "2026-07-12T04:00:00.000Z",
      timestamp_source: "carrier",
    });
    expect(mockApplyCarrierShipmentEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventKey: "evt_ordered_delivery",
        incomingStatus: "DELIVERED",
        occurredAt: new Date("2026-07-12T04:00:00.000Z"),
        carrierRawStatus: "delivered",
        message: "Delivered at front door",
        location: "Denver, CO",
      }),
    );
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
      expect.anything(),
      shipment.order_id,
      "DELIVERED",
    );
  });

  it("acknowledges a stale EasyPost event without regressing terminal state or order effects", async () => {
    const delivered = {
      id: "11111111-1111-4111-8111-111111111111",
      order_id: "22222222-2222-4222-8222-222222222222",
      seller_id: "33333333-3333-4333-8333-333333333333",
      buyer_id: "44444444-4444-4444-8444-444444444444",
      shipment_type: "outbound",
      carrier: "easypost",
      tracking_number: "EZ_ORDERED_2",
      status: "DELIVERED",
      delivered_at: "2026-07-12T04:00:00.000Z",
      events: [],
      created_at: "2026-07-12T09:00:00.000Z",
      updated_at: "2026-07-12T04:00:00.000Z",
    } as unknown as ShipmentRow;
    mockGetShipmentByTrackingNumber.mockResolvedValueOnce(delivered);
    mockApplyCarrierShipmentEvent.mockResolvedValueOnce({
      shipment: delivered,
      event: {} as never,
      disposition: "stale",
      stateChanged: false,
      effectsRequired: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: {
        id: "evt_late_in_transit",
        description: "tracker.updated",
        result: {
          tracking_code: "EZ_ORDERED_2",
          carrier: "USPS",
          status: "in_transit",
          tracking_details: [
            { datetime: "2026-07-12T02:00:00.000Z", message: "Departed facility" },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accepted: true,
      event_status: "IN_TRANSIT",
      new_status: "DELIVERED",
      state_changed: false,
      ordering_disposition: "stale",
    });
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalled();
  });

  it("POST /shipments/rates rejects parcels outside supported carrier bounds", async () => {
    const address = {
      name: "Haggle Test",
      street1: "1 Market St",
      city: "San Francisco",
      state: "CA",
      zip: "94105",
      country: "US",
    };
    const res = await app.inject({
      method: "POST",
      url: "/shipments/rates",
      headers: AUTH_HEADERS,
      payload: {
        from_address: address,
        to_address: { ...address, zip: "90277" },
        parcel: { weight_oz: 2401, length_in: 121, width_in: 10, height_in: 10 },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_RATE_REQUEST");
  });

  it("POST /shipments/rates returns stable cache metadata for repeated quote requests", async () => {
    const payload = {
      from_address: {
        name: "Haggle Test Seller",
        street1: "417 Montgomery St",
        street2: "Floor 5",
        city: "San Francisco",
        state: "CA",
        zip: "94104",
        country: "US",
      },
      to_address: {
        name: "Haggle Test Buyer",
        street1: "179 N Harbor Dr",
        city: "Redondo Beach",
        state: "CA",
        zip: "90277",
        country: "US",
      },
      parcel: {
        length_in: 8,
        width_in: 5,
        height_in: 2,
        weight_oz: 12,
      },
    };

    const first = await app.inject({
      method: "POST",
      url: "/shipments/rates",
      headers: AUTH_HEADERS,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/shipments/rates",
      headers: AUTH_HEADERS,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstBody = first.json();
    const secondBody = second.json();

    expect(firstBody.quote_key).toMatch(/^shipping_quote:[a-f0-9]{64}$/);
    expect(firstBody.cache_hit).toBe(false);
    expect(firstBody.cache_scope).toBe("exact_address");
    expect(firstBody.cache_ttl_seconds).toBe(1800);
    expect(firstBody.expires_at).toEqual(expect.any(String));
    expect(secondBody.quote_key).toBe(firstBody.quote_key);
    expect(secondBody.cache_hit).toBe(true);
    expect(secondBody.quoted_at).toBe(firstBody.quoted_at);
    expect(secondBody.expires_at).toBe(firstBody.expires_at);
  });

  it("POST /shipments/rates limits uncached external quote requests per user", async () => {
    const originalLimit = process.env.SHIPPING_RATE_MAX_MISSES_PER_MINUTE;
    process.env.SHIPPING_RATE_MAX_MISSES_PER_MINUTE = "1";
    const address = {
      name: "Rate Limit Test",
      street1: "350 5th Ave",
      city: "New York",
      state: "NY",
      zip: "10001",
      country: "US",
    };

    try {
      mockConsumeShippingRateMissBudget
        .mockResolvedValueOnce({
          allowed: true,
          retryAfterSeconds: 0,
          requestCount: 1,
          windowStartedAt: new Date(),
        })
        .mockResolvedValueOnce({
          allowed: false,
          retryAfterSeconds: 17,
          requestCount: 2,
          windowStartedAt: new Date(),
        });
      const first = await app.inject({
        method: "POST",
        url: "/shipments/rates",
        headers: ADMIN_HEADERS,
        payload: {
          from_address: address,
          to_address: { ...address, zip: "10002" },
          parcel: { weight_oz: 8 },
        },
      });
      const second = await app.inject({
        method: "POST",
        url: "/shipments/rates",
        headers: ADMIN_HEADERS,
        payload: {
          from_address: address,
          to_address: { ...address, zip: "10003" },
          parcel: { weight_oz: 8 },
        },
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
      expect(second.json().error).toBe("SHIPPING_RATE_LIMITED");
      expect(second.headers["retry-after"]).toBe("17");
    } finally {
      if (originalLimit === undefined) delete process.env.SHIPPING_RATE_MAX_MISSES_PER_MINUTE;
      else process.env.SHIPPING_RATE_MAX_MISSES_PER_MINUTE = originalLimit;
    }
  });
});
