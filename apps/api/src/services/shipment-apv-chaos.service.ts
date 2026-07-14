import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commerceOrders,
  type Database,
  eq,
  settlementApprovals,
  settlementReleases,
  shipmentApvAdjustments,
  shipments,
  sql,
} from "@haggle/db";
import { runShipmentApvInvoiceRestorationRemediationExpiry } from "../jobs/shipment-apv-invoice-restoration-remediation-expiry.js";
import { runShipmentApvInvoiceRestorationStagingMaintenance } from "../jobs/shipment-apv-invoice-restoration-staging-maintenance.js";
import {
  claimShipmentApvAdjustment,
  completeShipmentApvAdjustment,
  failShipmentApvAdjustment,
  type ShipmentApvClaim,
  type ShipmentApvInput,
} from "./shipment-apv-adjustment.service.js";
import { bindShipmentApvRevisionEvidence } from "./shipment-apv-evidence.service.js";
import {
  deleteShipmentApvInvoiceDocumentForFixture,
  getShipmentApvInvoiceDocumentStorageHealth,
  readShipmentApvInvoiceDocumentBytes,
  runShipmentApvInvoiceDocumentReconciliationDryRun,
  storeShipmentApvInvoiceDocument,
} from "./shipment-apv-invoice-document.service.js";
import {
  decideShipmentApvInvoiceReconciliation,
  deleteShipmentApvInvoiceReconciliationFixtureRows,
  discoverShipmentApvInvoiceReconciliationCandidates,
  getShipmentApvInvoiceReconciliationTimeline,
  listPendingShipmentApvInvoiceReconciliations,
  requestShipmentApvInvoiceReconciliation,
} from "./shipment-apv-invoice-reconciliation.service.js";
import {
  decideShipmentApvInvoiceRestoration,
  deleteShipmentApvInvoiceRestorationFixtureRows,
  getShipmentApvInvoiceRestorationStagingHealth,
  getShipmentApvInvoiceRestorationTimeline,
  listShipmentApvInvoiceRestorationCandidates,
  maintainShipmentApvInvoiceRestorationStaging,
  requestShipmentApvInvoiceRestoration,
} from "./shipment-apv-invoice-restoration.service.js";
import {
  decideShipmentApvInvoiceRestorationRemediation,
  deleteShipmentApvInvoiceRestorationRemediationFixtureRows,
  getShipmentApvInvoiceRestorationRemediationHealth,
  getShipmentApvInvoiceRestorationRemediationTimeline,
  listPendingShipmentApvInvoiceRestorationRemediations,
  listShipmentApvInvoiceRestorationRemediationCandidates,
  listStaleShipmentApvInvoiceRestorationRemediationRecoveries,
  recordShipmentApvInvoiceRestorationRemediationAcknowledgment,
  requestShipmentApvInvoiceRestorationRemediation,
} from "./shipment-apv-invoice-restoration-remediation.service.js";
import { evaluateShipmentApvPayoutAlert } from "./shipment-apv-payout-alert.service.js";
import {
  decideShipmentApvPayoutCancellation,
  getShipmentApvPayoutCancellationApprovalHealth,
  getShipmentApvPayoutCancellationTimeline,
  listPendingShipmentApvPayoutCancellations,
  requestShipmentApvPayoutCancellation,
} from "./shipment-apv-payout-cancellation.service.js";
import {
  dispatchShipmentApvCancellationAuditArchives,
  enqueueShipmentApvCancellationAuditArchive,
  getShipmentApvCancellationAuditArchiveHealth,
  getShipmentApvCancellationAuditArchiveStatus,
  listShipmentApvCancellationAuditArchiveFailures,
  requeueShipmentApvCancellationAuditArchive,
} from "./shipment-apv-payout-cancellation-audit-archive.service.js";
import {
  createSignedShipmentApvPayoutCancellationAuditExport,
  verifySignedShipmentApvPayoutCancellationAuditExport,
} from "./shipment-apv-payout-cancellation-audit-export.service.js";
import {
  bindShipmentApvPayoutOffsetSignature,
  cancelExpiredShipmentApvPayoutOffset,
  completeShipmentApvPayoutOffset,
  getShipmentApvPayoutReservationHealth,
  listExpiredShipmentApvPayoutReservations,
  listShipmentApvSellerLiabilities,
  reserveShipmentApvPayoutOffset,
} from "./shipment-apv-payout-offset.service.js";
import { runShipmentApvRetentionAlertFixture } from "./shipment-apv-retention-alert-fixture.service.js";
import {
  decideShipmentApvReview,
  submitShipmentApvSellerReview,
} from "./shipment-apv-review.service.js";
import { recordShipmentApvInvoiceRevision } from "./shipment-apv-revision.service.js";
import { applyShipmentApvInvoiceRevision } from "./shipment-apv-revision-application.service.js";

export async function runShipmentApvChaos(db: Database) {
  const orderId = randomUUID();
  const approvalId = randomUUID();
  const listingId = randomUUID();
  const sellerId = randomUUID();
  const buyerId = randomUUID();
  const shipmentId = randomUUID();
  const releaseId = randomUUID();
  const carryApprovalId = randomUUID();
  const carryOrderId = randomUUID();
  const carryReleaseId = randomUUID();
  const carryListingId = randomUUID();
  const carryBuyerId = randomUUID();
  const paginationReleaseId = randomUUID();
  const paginationOffsetId = randomUUID();
  const paginationOrderId = randomUUID();
  const invoiceId = `shinv_chaos_${randomUUID()}`;
  const creditInvoiceId = `shinv_credit_${randomUUID()}`;
  const concurrentInvoiceId = `shinv_concurrent_${randomUUID()}`;
  const invoiceDocumentRoot = await mkdtemp(join(tmpdir(), "haggle-apv-invoice-chaos-"));
  let invoiceDocumentRevisionId: string | null = null;
  let invoiceReconciliationRequestId: string | null = null;
  let invoiceCorruptReconciliationRequestId: string | null = null;
  let invoicePreservationRequestId: string | null = null;
  let invoiceRemediatedRestorationRequestId: string | null = null;
  let invoiceRestorationRemediationRequestId: string | null = null;
  let invoiceExpiredRemediationRestorationRequestId: string | null = null;
  let invoiceExpiredRestorationRemediationRequestId: string | null = null;
  let invoiceExpiredRestorationRemediationCleanupRequestId: string | null = null;
  let invoicePaginationRestorationRemediationRequestId: string | null = null;
  let invoiceRejectedRestorationRequestId: string | null = null;
  let invoiceExpiredRestorationRequestId: string | null = null;
  let invoiceRestorationRequestId: string | null = null;
  let quarantinedOrphanVerified = false;
  const cleanup = {
    offsets: 0,
    audits: 0,
    cancellationRequests: 0,
    cancellationEvents: 0,
    auditArchives: 0,
    liabilities: 0,
    adjustments: 0,
    shipments: 0,
    releases: 0,
    orders: 0,
    approvals: 0,
    invoiceDocument: false,
    reconciliationRequests: 0,
    reconciliationEvents: 0,
    restorationRequests: 0,
    restorationEvents: 0,
    restorationRemediationRequests: 0,
    restorationRemediationEvents: 0,
    restorationRemediationAcknowledgments: 0,
    quarantinedOrphan: false,
    succeeded: false,
  };

  const baseInput: Omit<
    ShipmentApvInput,
    "providerInvoiceId" | "originalRateMinor" | "adjustedRateMinor" | "adjustmentMinor"
  > = {
    provider: "easypost-chaos",
    shipmentId,
    orderId,
    settlementReleaseId: releaseId,
  };

  try {
    const retentionAlertFixture = await runShipmentApvRetentionAlertFixture(db);
    await db.insert(settlementApprovals).values({
      id: approvalId,
      listingId,
      sellerId,
      buyerId,
      approvalState: "APPROVED",
      sellerApprovalMode: "AUTO_WITHIN_POLICY",
      selectedPaymentRail: "x402",
      currency: "USDC",
      finalAmountMinor: "10000",
      termsSnapshot: { fixture: "shipment_apv_chaos" },
    });
    await db.insert(commerceOrders).values({
      id: orderId,
      settlementApprovalId: approvalId,
      listingId,
      sellerId,
      buyerId,
      status: "DELIVERED",
      currency: "USDC",
      amountMinor: "10000",
      orderSnapshot: { fixture: "shipment_apv_chaos" },
    });
    await db.insert(settlementReleases).values({
      id: releaseId,
      paymentIntentId: randomUUID(),
      orderId,
      productAmountMinor: "10000",
      productCurrency: "USDC",
      productReleaseStatus: "RELEASED",
      bufferAmountMinor: "150",
      bufferCurrency: "USDC",
      bufferReleaseStatus: "HELD",
      apvAdjustmentMinor: "0",
    });
    await db.insert(shipments).values({
      id: shipmentId,
      orderId,
      sellerId,
      buyerId,
      status: "DELIVERED",
      shipmentType: "apv_chaos",
      carrier: "easypost",
      trackingNumber: `APV${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    });

    const overBufferInput: ShipmentApvInput = {
      ...baseInput,
      providerInvoiceId: invoiceId,
      originalRateMinor: 625,
      adjustedRateMinor: 1025,
      adjustmentMinor: 400,
    };
    const claim = await claimShipmentApvAdjustment(db, overBufferInput);
    if (claim.outcome !== "acquired") throw new Error(`APV_CHAOS_INITIAL_${claim.outcome}`);
    const overBuffer = await completeShipmentApvAdjustment(db, claim, overBufferInput);
    const duplicate = await claimShipmentApvAdjustment(db, overBufferInput);
    const conflict = await claimShipmentApvAdjustment(db, {
      ...overBufferInput,
      adjustedRateMinor: 1026,
      adjustmentMinor: 401,
    });

    const reviewRequestId = randomUUID();
    const sellerReview = await submitShipmentApvSellerReview(db, {
      adjustmentId: overBuffer.id,
      sellerId,
      requestId: reviewRequestId,
      reason:
        "The carrier adjustment does not match the package and address information supplied at purchase.",
    });
    const duplicateReview = await submitShipmentApvSellerReview(db, {
      adjustmentId: overBuffer.id,
      sellerId,
      requestId: reviewRequestId,
      reason:
        "The carrier adjustment does not match the package and address information supplied at purchase.",
    });
    const conflictingReview = await submitShipmentApvSellerReview(db, {
      adjustmentId: overBuffer.id,
      sellerId,
      requestId: randomUUID(),
      reason: "A conflicting second seller review must not replace the first review request.",
    });
    if (!("record" in sellerReview)) throw new Error(`APV_CHAOS_REVIEW_${sellerReview.outcome}`);
    const reviewDecisionRequestId = randomUUID();
    const reviewDecisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        decideShipmentApvReview(db, {
          adjustmentId: overBuffer.id,
          reviewerId: randomUUID(),
          requestId: reviewDecisionRequestId,
          decision: "WAIVED",
          reason:
            "The available carrier record is insufficient to hold the seller responsible for this correction fee.",
          expectedVersion: sellerReview.record.review_version,
        }),
      ),
    );
    const decisionWinners = reviewDecisions.filter((item) => item.outcome === "updated");
    const decisionDuplicates = reviewDecisions.filter((item) => item.outcome === "duplicate");
    const decisionConflicts = reviewDecisions.filter(
      (item) => item.outcome === "version_conflict" || item.outcome === "invalid_state",
    );
    const finalReview =
      decisionWinners[0] && "record" in decisionWinners[0] ? decisionWinners[0].record : null;
    const decisionReplay = await decideShipmentApvReview(db, {
      adjustmentId: overBuffer.id,
      reviewerId: randomUUID(),
      requestId: reviewDecisionRequestId,
      decision: "WAIVED",
      reason:
        "The available carrier record is insufficient to hold the seller responsible for this correction fee.",
      expectedVersion: sellerReview.record.review_version,
    });

    const revisionTwoInput = {
      ...overBufferInput,
      adjustedRateMinor: 1125,
      adjustmentMinor: 500,
      invoiceEvent: "updated" as const,
      webhookEventId: `evt_revision_2_${randomUUID()}`,
    };
    const revisionTwo = await recordShipmentApvInvoiceRevision(db, revisionTwoInput);
    const revisionTwoReplay = await recordShipmentApvInvoiceRevision(db, {
      ...revisionTwoInput,
      webhookEventId: `evt_revision_2_replay_${randomUUID()}`,
    });
    const revisionThree = await recordShipmentApvInvoiceRevision(db, {
      ...overBufferInput,
      adjustedRateMinor: 1075,
      adjustmentMinor: 450,
      invoiceEvent: "updated",
      webhookEventId: `evt_revision_3_${randomUUID()}`,
    });
    const concurrentRevisionInput = {
      ...overBufferInput,
      adjustedRateMinor: 1175,
      adjustmentMinor: 550,
      invoiceEvent: "updated" as const,
      webhookEventId: `evt_revision_concurrent_${randomUUID()}`,
    };
    const concurrentRevisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        recordShipmentApvInvoiceRevision(db, concurrentRevisionInput),
      ),
    );
    const recordedRevisions = concurrentRevisions.filter((item) => item.outcome === "recorded");
    const duplicateRevisions = concurrentRevisions.filter((item) => item.outcome === "duplicate");
    const revisionFour = recordedRevisions[0];
    if (
      !("revision" in revisionTwo) ||
      !("revision" in revisionThree) ||
      !revisionFour ||
      !("revision" in revisionFour)
    ) {
      throw new Error("APV_CHAOS_REVISION_RECORDING_FAILED");
    }
    const prematurePayout = await reserveShipmentApvPayoutOffset(db, {
      settlementReleaseId: releaseId,
      requestId: `apv-payout-premature:${releaseId}`,
      maxOffsetMinor: 60,
    });
    const revisionTwoDocumentBytes = Buffer.from(
      JSON.stringify({
        provider: "easypost",
        invoice_id: invoiceId,
        revision: 2,
        adjusted_rate_minor: 1125,
        currency: "USD",
      }),
    );
    const bindEvidence = (revisionId: string, amountMinor: number, suffix: string) =>
      bindShipmentApvRevisionEvidence(db, {
        revisionId,
        actorId: randomUUID(),
        documentSha256:
          suffix === "revision-2"
            ? createHash("sha256").update(revisionTwoDocumentBytes).digest("hex")
            : createHash("sha256").update(`carrier-invoice:${invoiceId}:${suffix}`).digest("hex"),
        providerDocumentId: `${invoiceId}:${suffix}`,
        surchargeCategory: "ADDRESS_CORRECTION",
        surchargeType: "ADDRESS_CORRECTION",
        amountMinor,
        currency: "USD",
      });
    const revisionTwoEvidence = await bindEvidence(revisionTwo.revision.id, 100, "revision-2");
    const revisionTwoEvidenceReplay = await bindEvidence(
      revisionTwo.revision.id,
      100,
      "revision-2",
    );
    const revisionTwoEvidenceConflict = await bindShipmentApvRevisionEvidence(db, {
      revisionId: revisionTwo.revision.id,
      actorId: randomUUID(),
      documentSha256: createHash("sha256").update("conflicting-document").digest("hex"),
      providerDocumentId: `${invoiceId}:revision-2-conflict`,
      surchargeCategory: "HANDLING",
      surchargeType: "OVER_DIMENSION",
      amountMinor: 100,
      currency: "USD",
    });
    const revisionThreeEvidence = await bindEvidence(revisionThree.revision.id, 50, "revision-3");
    const revisionFourEvidence = await bindEvidence(revisionFour.revision.id, 100, "revision-4");
    invoiceDocumentRevisionId = revisionTwo.revision.id;
    const invoiceDocumentInput = {
      revisionId: revisionTwo.revision.id,
      providerDocumentId: `${invoiceId}:revision-2`,
      contentType: "application/json" as const,
      bytes: revisionTwoDocumentBytes,
      uploadedBy: randomUUID(),
      storageRoot: invoiceDocumentRoot,
    };
    const invoiceDocumentStored = await storeShipmentApvInvoiceDocument(db, invoiceDocumentInput);
    const invoiceDocumentReplay = await storeShipmentApvInvoiceDocument(db, invoiceDocumentInput);
    const invoiceDocumentConflict = await storeShipmentApvInvoiceDocument(db, {
      ...invoiceDocumentInput,
      contentType: "text/csv",
    });
    const invoiceDocumentReadBytes = await readShipmentApvInvoiceDocumentBytes(
      db,
      revisionTwo.revision.id,
      invoiceDocumentRoot,
    );
    const invoiceDocumentHealthBefore = await getShipmentApvInvoiceDocumentStorageHealth(db, {
      revisionId: revisionTwo.revision.id,
      storageRoot: invoiceDocumentRoot,
    });
    const orphanBytes = Buffer.from('{"orphan":true}');
    const orphanHash = createHash("sha256").update(orphanBytes).digest("hex");
    const orphanPath = join(invoiceDocumentRoot, revisionTwo.revision.id, `${orphanHash}.json`);
    await mkdir(join(invoiceDocumentRoot, revisionTwo.revision.id), { recursive: true });
    await writeFile(orphanPath, orphanBytes, { flag: "wx", mode: 0o600 });
    const invoiceDocumentHealthWithOrphan = await getShipmentApvInvoiceDocumentStorageHealth(db, {
      revisionId: revisionTwo.revision.id,
      storageRoot: invoiceDocumentRoot,
    });
    const invoiceDocumentReconciliation = await runShipmentApvInvoiceDocumentReconciliationDryRun(
      db,
      {
        revisionId: revisionTwo.revision.id,
        storageRoot: invoiceDocumentRoot,
      },
    );
    const healthyPayout = {
      status: "healthy" as const,
      expiredReserved: 0,
      signedExpired: 0,
      unsignedExpired: 0,
      affectedSellers: 0,
      appliedOffsetMinor: 0,
      oldestExpiredAgeSeconds: null,
      recordedAt: new Date().toISOString(),
    };
    const invoiceDocumentAlert = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      invoiceDocumentHealthWithOrphan,
    );
    const reconciliationCandidates = await discoverShipmentApvInvoiceReconciliationCandidates(db, {
      storageRoot: invoiceDocumentRoot,
    });
    const orphanCandidate = reconciliationCandidates.candidates.find(
      (item) => item.anomalyType === "ORPHAN_FILE",
    );
    if (!orphanCandidate) throw new Error("APV_INVOICE_RECONCILIATION_FIXTURE_CANDIDATE_MISSING");
    const reconciliationMakerId = randomUUID();
    const reconciliationCheckerId = randomUUID();
    const reconciliationClientRequestId = randomUUID();
    const reconciliationRequest = await requestShipmentApvInvoiceReconciliation(db, {
      clientRequestId: reconciliationClientRequestId,
      candidateId: orphanCandidate.candidateId,
      requesterId: reconciliationMakerId,
      reason: "Quarantine the verified orphan invoice without deleting preserved evidence.",
      storageRoot: invoiceDocumentRoot,
    });
    if (!("request" in reconciliationRequest) || !reconciliationRequest.request) {
      throw new Error("APV_INVOICE_RECONCILIATION_FIXTURE_REQUEST_FAILED");
    }
    const reconciliationRequestRecord = reconciliationRequest.request;
    invoiceReconciliationRequestId = reconciliationRequestRecord.id;
    const pendingInvoiceReconciliations = await listPendingShipmentApvInvoiceReconciliations(db);
    const reconciliationSelfApproval = await decideShipmentApvInvoiceReconciliation(db, {
      requestId: reconciliationRequestRecord.id,
      decisionRequestId: randomUUID(),
      approverId: reconciliationMakerId,
      decision: "APPROVE",
      reason: "The request maker must not approve the same quarantine action.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    });
    const reconciliationDecisionRequestId = randomUUID();
    const reconciliationApprovalInput = {
      requestId: reconciliationRequestRecord.id,
      decisionRequestId: reconciliationDecisionRequestId,
      approverId: reconciliationCheckerId,
      decision: "APPROVE" as const,
      reason: "A separate checker verified the orphan and approved non-destructive quarantine.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    };
    const reconciliationApproval = await decideShipmentApvInvoiceReconciliation(
      db,
      reconciliationApprovalInput,
    );
    const reconciliationApprovalReplay = await decideShipmentApvInvoiceReconciliation(
      db,
      reconciliationApprovalInput,
    );
    const reconciliationTimeline = await getShipmentApvInvoiceReconciliationTimeline(
      db,
      reconciliationRequestRecord.id,
    );
    const quarantinePath = join(
      invoiceDocumentRoot,
      ".quarantine",
      reconciliationRequestRecord.id,
      `${orphanHash}.json`,
    );
    const quarantinedOrphanBytes = await readFile(quarantinePath).catch(() => null);
    quarantinedOrphanVerified = quarantinedOrphanBytes?.equals(orphanBytes) === true;
    const invoiceDocumentHealthAfter = await getShipmentApvInvoiceDocumentStorageHealth(db, {
      revisionId: revisionTwo.revision.id,
      storageRoot: invoiceDocumentRoot,
    });
    const invoiceDocumentAlertAfter = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      invoiceDocumentHealthAfter,
    );
    const invoiceDocumentSha256 = createHash("sha256")
      .update(revisionTwoDocumentBytes)
      .digest("hex");
    const invoiceDocumentPath = join(
      invoiceDocumentRoot,
      revisionTwo.revision.id,
      `${invoiceDocumentSha256}.json`,
    );
    const corruptedDocumentBytes = Buffer.alloc(revisionTwoDocumentBytes.length, 0x78);
    await writeFile(invoiceDocumentPath, corruptedDocumentBytes);
    const corruptedDocumentHealth = await getShipmentApvInvoiceDocumentStorageHealth(db, {
      revisionId: revisionTwo.revision.id,
      storageRoot: invoiceDocumentRoot,
    });
    const corruptedCandidates = await discoverShipmentApvInvoiceReconciliationCandidates(db, {
      storageRoot: invoiceDocumentRoot,
    });
    const corruptedCandidate = corruptedCandidates.candidates.find(
      (item) => item.anomalyType === "HASH_MISMATCH",
    );
    if (!corruptedCandidate) throw new Error("APV_INVOICE_CORRUPTION_FIXTURE_CANDIDATE_MISSING");
    const corruptRequest = await requestShipmentApvInvoiceReconciliation(db, {
      clientRequestId: randomUUID(),
      candidateId: corruptedCandidate.candidateId,
      requesterId: randomUUID(),
      reason: "Quarantine the verified hash-mismatched invoice while preserving all source bytes.",
      storageRoot: invoiceDocumentRoot,
    });
    if (!("request" in corruptRequest) || !corruptRequest.request) {
      throw new Error("APV_INVOICE_CORRUPTION_FIXTURE_REQUEST_FAILED");
    }
    invoiceCorruptReconciliationRequestId = corruptRequest.request.id;
    const corruptDecisionInput = {
      requestId: corruptRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: randomUUID(),
      decision: "APPROVE" as const,
      reason:
        "A separate checker verified the hash mismatch and approved non-destructive quarantine.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    };
    const corruptApproval = await decideShipmentApvInvoiceReconciliation(db, corruptDecisionInput);
    const corruptQuarantinePath = join(
      invoiceDocumentRoot,
      ".quarantine",
      corruptRequest.request.id,
      `${invoiceDocumentSha256}.json`,
    );
    const corruptQuarantineBytes = await readFile(corruptQuarantinePath).catch(() => null);
    const quarantinedDocumentHealth = await getShipmentApvInvoiceDocumentStorageHealth(db, {
      revisionId: revisionTwo.revision.id,
      storageRoot: invoiceDocumentRoot,
    });
    const restorationCandidates = await listShipmentApvInvoiceRestorationCandidates(db);
    const restorationCandidate = restorationCandidates.candidates.find(
      (item) => item.integrityStatus === "QUARANTINED",
    );
    if (!restorationCandidate) throw new Error("APV_INVOICE_RESTORATION_FIXTURE_CANDIDATE_MISSING");
    const restorationMismatch = await requestShipmentApvInvoiceRestoration(db, {
      clientRequestId: randomUUID(),
      candidateId: restorationCandidate.candidateId,
      requesterId: randomUUID(),
      reason: "Reject a replacement that does not match the immutable carrier evidence hash.",
      contentType: "application/json",
      bytes: Buffer.from('{"different":true}'),
      storageRoot: invoiceDocumentRoot,
    });
    const restorationMakerId = randomUUID();
    const restorationClientRequestId = randomUUID();
    const restorationInput = {
      clientRequestId: restorationClientRequestId,
      candidateId: restorationCandidate.candidateId,
      requesterId: restorationMakerId,
      reason:
        "Stage a re-collected invoice that exactly matches the immutable carrier evidence hash.",
      contentType: "application/json" as const,
      bytes: revisionTwoDocumentBytes,
      storageRoot: invoiceDocumentRoot,
    };
    const restorationRequest = await requestShipmentApvInvoiceRestoration(db, restorationInput);
    const restorationRequestReplay = await requestShipmentApvInvoiceRestoration(
      db,
      restorationInput,
    );
    if (!("request" in restorationRequest) || !restorationRequest.request) {
      throw new Error("APV_INVOICE_RESTORATION_FIXTURE_REQUEST_FAILED");
    }
    invoicePreservationRequestId = restorationRequest.request.id;
    const restorationSelfApproval = await decideShipmentApvInvoiceRestoration(db, {
      requestId: restorationRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: restorationMakerId,
      decision: "PRESERVE",
      reason: "The restoration maker must not approve the same replacement.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    });
    const preservationDecisionInput = {
      requestId: restorationRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: randomUUID(),
      decision: "PRESERVE" as const,
      reason:
        "A separate checker verified the replacement hash and approved permanent preservation.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    };
    const preservationApproval = await decideShipmentApvInvoiceRestoration(
      db,
      preservationDecisionInput,
    );
    const preservationApprovalReplay = await decideShipmentApvInvoiceRestoration(
      db,
      preservationDecisionInput,
    );
    const preservationTimeline = await getShipmentApvInvoiceRestorationTimeline(
      db,
      restorationRequest.request.id,
    );
    const preservedReplacementPath = join(
      invoiceDocumentRoot,
      ".quarantine",
      restorationRequest.request.id,
      `replacement-${invoiceDocumentSha256}.json`,
    );
    const preservedReplacementBytes = await readFile(preservedReplacementPath).catch(() => null);
    const restoreCandidateAfterPreserve = (
      await listShipmentApvInvoiceRestorationCandidates(db)
    ).candidates.find((item) => item.integrityStatus === "QUARANTINED");
    if (!restoreCandidateAfterPreserve)
      throw new Error("APV_INVOICE_RESTORE_AFTER_PRESERVE_CANDIDATE_MISSING");
    const remediatedRestorationMakerId = randomUUID();
    const remediatedRestorationRequest = await requestShipmentApvInvoiceRestoration(db, {
      clientRequestId: randomUUID(),
      candidateId: restoreCandidateAfterPreserve.candidateId,
      requesterId: remediatedRestorationMakerId,
      reason: "Stage an exact replacement before simulating terminal staging corruption.",
      contentType: "application/json",
      bytes: revisionTwoDocumentBytes,
      storageRoot: invoiceDocumentRoot,
    });
    if (!("request" in remediatedRestorationRequest) || !remediatedRestorationRequest.request) {
      throw new Error("APV_INVOICE_REMEDIATION_RESTORATION_FIXTURE_REQUEST_FAILED");
    }
    invoiceRemediatedRestorationRequestId = remediatedRestorationRequest.request.id;
    const remediatedStagingPath = join(
      invoiceDocumentRoot,
      ".restoration",
      remediatedRestorationRequest.request.id,
      `${invoiceDocumentSha256}.json`,
    );
    const corruptedStagingBytes = Buffer.from(revisionTwoDocumentBytes);
    corruptedStagingBytes[0] = corruptedStagingBytes[0]! ^ 1;
    await writeFile(remediatedStagingPath, corruptedStagingBytes);
    const remediatedRestorationRejection = await decideShipmentApvInvoiceRestoration(db, {
      requestId: remediatedRestorationRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: randomUUID(),
      decision: "REJECT",
      reason: "A checker rejected the replacement while preserving the staged evidence.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    });
    const remediationHealthBefore = await getShipmentApvInvoiceRestorationStagingHealth(db, {
      storageRoot: invoiceDocumentRoot,
    });
    const remediationCandidates = await listShipmentApvInvoiceRestorationRemediationCandidates(
      db,
      invoiceDocumentRoot,
    );
    const remediationCandidate = remediationCandidates.candidates.find(
      (item) => item.issueType === "HASH_MISMATCH",
    );
    if (!remediationCandidate) throw new Error("APV_INVOICE_REMEDIATION_FIXTURE_CANDIDATE_MISSING");
    const remediationMakerId = randomUUID();
    const remediationClientRequestId = randomUUID();
    const remediationInput = {
      clientRequestId: remediationClientRequestId,
      candidateId: remediationCandidate.candidateId,
      requesterId: remediationMakerId,
      reason: "Quarantine the verified mismatched staging bytes without deleting evidence.",
      storageRoot: invoiceDocumentRoot,
    };
    const remediationRequest = await requestShipmentApvInvoiceRestorationRemediation(
      db,
      remediationInput,
    );
    const remediationRequestReplay = await requestShipmentApvInvoiceRestorationRemediation(
      db,
      remediationInput,
    );
    if (!("request" in remediationRequest) || !remediationRequest.request) {
      throw new Error("APV_INVOICE_REMEDIATION_FIXTURE_REQUEST_FAILED");
    }
    invoiceRestorationRemediationRequestId = remediationRequest.request.id;
    const pendingRemediations = await listPendingShipmentApvInvoiceRestorationRemediations(db);
    const remediationSelfApproval = await decideShipmentApvInvoiceRestorationRemediation(db, {
      requestId: remediationRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: remediationMakerId,
      decision: "APPROVE",
      reason: "The remediation maker must not approve the same evidence disposition.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    });
    const remediationDecisionInput = {
      requestId: remediationRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: randomUUID(),
      decision: "APPROVE" as const,
      reason: "A separate checker verified the mismatch and approved non-destructive quarantine.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    };
    const remediationApproval = await decideShipmentApvInvoiceRestorationRemediation(
      db,
      remediationDecisionInput,
    );
    const remediationApprovalReplay = await decideShipmentApvInvoiceRestorationRemediation(
      db,
      remediationDecisionInput,
    );
    const remediationTimeline = await getShipmentApvInvoiceRestorationRemediationTimeline(
      db,
      remediationRequest.request.id,
    );
    const remediatedRestorationTimeline = await getShipmentApvInvoiceRestorationTimeline(
      db,
      remediatedRestorationRequest.request.id,
    );
    const remediatedQuarantinePath = join(
      invoiceDocumentRoot,
      ".quarantine",
      remediationRequest.request.id,
      `conflict-${invoiceDocumentSha256}.json`,
    );
    const remediatedQuarantineBytes = await readFile(remediatedQuarantinePath).catch(() => null);
    const remediationHealthAfter = await getShipmentApvInvoiceRestorationStagingHealth(db, {
      storageRoot: invoiceDocumentRoot,
    });
    const expiryRestorationRequest = await requestShipmentApvInvoiceRestoration(db, {
      clientRequestId: randomUUID(),
      candidateId: restoreCandidateAfterPreserve.candidateId,
      requesterId: randomUUID(),
      reason: "Stage an exact replacement before simulating a missing terminal source.",
      contentType: "application/json",
      bytes: revisionTwoDocumentBytes,
      storageRoot: invoiceDocumentRoot,
    });
    if (!("request" in expiryRestorationRequest) || !expiryRestorationRequest.request) {
      throw new Error("APV_INVOICE_REMEDIATION_EXPIRY_RESTORATION_REQUEST_FAILED");
    }
    invoiceExpiredRemediationRestorationRequestId = expiryRestorationRequest.request.id;
    const expiryStagingPath = join(
      invoiceDocumentRoot,
      ".restoration",
      expiryRestorationRequest.request.id,
      `${invoiceDocumentSha256}.json`,
    );
    await rm(expiryStagingPath, { force: true });
    const expiryRestorationRejection = await decideShipmentApvInvoiceRestoration(db, {
      requestId: expiryRestorationRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: randomUUID(),
      decision: "REJECT",
      reason: "A checker rejected the replacement after its source became unavailable.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    });
    const missingRemediationCandidate = (
      await listShipmentApvInvoiceRestorationRemediationCandidates(db, invoiceDocumentRoot)
    ).candidates.find((item) => item.issueType === "SOURCE_MISSING");
    if (!missingRemediationCandidate)
      throw new Error("APV_INVOICE_REMEDIATION_EXPIRY_CANDIDATE_MISSING");
    const expiryRemediationRequest = await requestShipmentApvInvoiceRestorationRemediation(db, {
      clientRequestId: randomUUID(),
      candidateId: missingRemediationCandidate.candidateId,
      requesterId: randomUUID(),
      reason: "Record the missing staging source for checker disposition.",
      storageRoot: invoiceDocumentRoot,
    });
    if (!("request" in expiryRemediationRequest) || !expiryRemediationRequest.request) {
      throw new Error("APV_INVOICE_REMEDIATION_EXPIRY_REQUEST_FAILED");
    }
    invoiceExpiredRestorationRemediationRequestId = expiryRemediationRequest.request.id;
    await db.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
      SET expires_at=now()-interval '1 minute'
      WHERE id=${expiryRemediationRequest.request.id}::uuid AND status='PENDING'`);
    const remediationQueueHealthBefore =
      await getShipmentApvInvoiceRestorationRemediationHealth(db);
    const remediationQueueAlertBefore = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      undefined,
      remediationHealthAfter,
      remediationQueueHealthBefore,
    );
    const remediationExpiryJob = await runShipmentApvInvoiceRestorationRemediationExpiry(db);
    const remediationExpiryReplay = await runShipmentApvInvoiceRestorationRemediationExpiry(db);
    const expiredRemediationTimeline = await getShipmentApvInvoiceRestorationRemediationTimeline(
      db,
      expiryRemediationRequest.request.id,
    );
    const cleanupRequestNow = new Date(Date.now() - 70 * 60_000);
    const cleanupRemediationRequest = await requestShipmentApvInvoiceRestorationRemediation(db, {
      clientRequestId: randomUUID(),
      candidateId: missingRemediationCandidate.candidateId,
      requesterId: randomUUID(),
      reason: "Finalize the still-missing staging source after request expiry.",
      storageRoot: invoiceDocumentRoot,
      now: cleanupRequestNow,
    });
    if (!("request" in cleanupRemediationRequest) || !cleanupRemediationRequest.request) {
      throw new Error("APV_INVOICE_REMEDIATION_EXPIRY_CLEANUP_REQUEST_FAILED");
    }
    invoiceExpiredRestorationRemediationCleanupRequestId = cleanupRemediationRequest.request.id;
    const cleanupCheckerId = randomUUID();
    const cleanupDecisionRequestId = randomUUID();
    const cleanupApplyingAt = new Date(Date.now() - 61 * 60_000);
    await db.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
      SET status='APPLYING', approver_id=${cleanupCheckerId}::uuid,
          decision_request_id=${cleanupDecisionRequestId}::uuid, decision='APPROVE',
          decision_reason='A separate checker started the safe missing-source disposition.',
          version=1, updated_at=${cleanupApplyingAt.toISOString()}::timestamptz
      WHERE id=${cleanupRemediationRequest.request.id}::uuid AND status='PENDING'`);
    await db.execute(sql`INSERT INTO shipment_apv_invoice_restoration_remediation_events
      (id, request_id, event_type, actor_id, request_version, metadata, created_at)
      VALUES (${randomUUID()}::uuid, ${cleanupRemediationRequest.request.id}::uuid, 'APPLYING',
        ${cleanupCheckerId}::uuid, 1, jsonb_build_object('issue_type','SOURCE_MISSING'),
        ${cleanupApplyingAt.toISOString()}::timestamptz)`);
    if (!invoiceRemediatedRestorationRequestId) {
      throw new Error("APV_INVOICE_REMEDIATION_PAGINATION_RESTORATION_MISSING");
    }
    invoicePaginationRestorationRemediationRequestId = randomUUID();
    const paginationRemediationDecisionRequestId = randomUUID();
    const paginationRemediationCreatedAt = new Date(Date.now() - 62 * 60_000);
    const paginationRemediationUpdatedAt = new Date(Date.now() - 60 * 60_000);
    await db.execute(sql`INSERT INTO shipment_apv_invoice_restoration_remediation_requests
      (id,client_request_id,candidate_fingerprint,restoration_request_id,issue_type,
        observed_sha256,observed_byte_size,requester_id,reason,status,version,expires_at,
        approver_id,decision_request_id,decision,decision_reason,created_at,updated_at)
      VALUES (${invoicePaginationRestorationRemediationRequestId}::uuid,
        ${invoicePaginationRestorationRemediationRequestId}::uuid,${"d".repeat(64)},
        ${invoiceRemediatedRestorationRequestId}::uuid,'SOURCE_MISSING',NULL,NULL,${randomUUID()}::uuid,
        'Verify bounded checker recovery pagination without touching staged evidence.','APPLYING',1,
        ${new Date(Date.now() + 30 * 60_000).toISOString()}::timestamptz,${cleanupCheckerId}::uuid,
        ${paginationRemediationDecisionRequestId}::uuid,'APPROVE',
        'A separate checker started a synthetic read-only pagination fixture.',
        ${paginationRemediationCreatedAt.toISOString()}::timestamptz,
        ${paginationRemediationUpdatedAt.toISOString()}::timestamptz)`);
    await db.execute(sql`INSERT INTO shipment_apv_invoice_restoration_remediation_events
      (id,request_id,event_type,actor_id,request_version,metadata,created_at) VALUES
      (${randomUUID()}::uuid,${invoicePaginationRestorationRemediationRequestId}::uuid,'REQUESTED',NULL,0,
        jsonb_build_object('fixture','pagination'),${paginationRemediationCreatedAt.toISOString()}::timestamptz),
      (${randomUUID()}::uuid,${invoicePaginationRestorationRemediationRequestId}::uuid,'APPLYING',
        ${cleanupCheckerId}::uuid,1,jsonb_build_object('fixture','pagination'),
        ${paginationRemediationUpdatedAt.toISOString()}::timestamptz)`);
    const paginationRecoveryFirstPage =
      await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
        approverId: cleanupCheckerId,
        limit: 1,
      });
    const paginationRecoverySecondPage =
      await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
        approverId: cleanupCheckerId,
        limit: 1,
        cursor: paginationRecoveryFirstPage.nextCursor ?? undefined,
      });
    let paginationInvalidCursorBlocked = false;
    try {
      await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
        approverId: cleanupCheckerId,
        cursor: Buffer.from("{}", "utf8").toString("base64url"),
      });
    } catch (error) {
      paginationInvalidCursorBlocked =
        error instanceof Error &&
        error.message === "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR";
    }
    let paginationExpiredCursorBlocked = false;
    try {
      await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
        approverId: cleanupCheckerId,
        cursor: paginationRecoveryFirstPage.nextCursor ?? undefined,
        now: new Date(new Date(paginationRecoveryFirstPage.recordedAt).getTime() + 16 * 60_000),
      });
    } catch (error) {
      paginationExpiredCursorBlocked =
        error instanceof Error &&
        error.message === "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR_EXPIRED";
    }
    const paginationRemediationCleanup =
      await deleteShipmentApvInvoiceRestorationRemediationFixtureRows(db, [
        invoicePaginationRestorationRemediationRequestId,
      ]);
    const cleanupRecoveryQueue = await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(
      db,
      {
        approverId: cleanupCheckerId,
      },
    );
    const foreignRecoveryQueue = await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(
      db,
      {
        approverId: randomUUID(),
      },
    );
    const cleanupRecoveryHealth = await getShipmentApvInvoiceRestorationRemediationHealth(db);
    const cleanupRecoveryAlert = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      undefined,
      remediationHealthAfter,
      cleanupRecoveryHealth,
    );
    const wrongCheckerAcknowledgment =
      await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(db, {
        requestId: cleanupRemediationRequest.request.id,
        clientRequestId: randomUUID(),
        decisionRequestId: cleanupDecisionRequestId,
        checkerId: randomUUID(),
        action: "ACKNOWLEDGED",
        expectedVersion: 1,
      });
    const incidentBeforeAcknowledgment =
      await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(db, {
        requestId: cleanupRemediationRequest.request.id,
        clientRequestId: randomUUID(),
        decisionRequestId: cleanupDecisionRequestId,
        checkerId: cleanupCheckerId,
        action: "INCIDENT_LINKED",
        expectedVersion: 1,
        incidentReference: `PREMATURE-${randomUUID()}`,
      });
    const acknowledgmentClientRequestId = randomUUID();
    const recoveryAcknowledgmentInput = {
      requestId: cleanupRemediationRequest.request.id,
      clientRequestId: acknowledgmentClientRequestId,
      decisionRequestId: cleanupDecisionRequestId,
      checkerId: cleanupCheckerId,
      action: "ACKNOWLEDGED" as const,
      expectedVersion: 1,
    };
    const recoveryAcknowledgment =
      await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(
        db,
        recoveryAcknowledgmentInput,
      );
    const recoveryAcknowledgmentReplay =
      await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(
        db,
        recoveryAcknowledgmentInput,
      );
    const acknowledgedOnlyRecoveryHealth =
      await getShipmentApvInvoiceRestorationRemediationHealth(db);
    const overdueIncidentNow = new Date(Date.now() + 16 * 60_000);
    const overdueIncidentRecoveryHealth = await getShipmentApvInvoiceRestorationRemediationHealth(
      db,
      overdueIncidentNow,
    );
    const overdueIncidentRecoveryAlert = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      undefined,
      remediationHealthAfter,
      overdueIncidentRecoveryHealth,
    );
    const incidentReference = `APV-INCIDENT-${randomUUID()}`;
    const incidentClientRequestId = randomUUID();
    const incidentLinkInput = {
      requestId: cleanupRemediationRequest.request.id,
      clientRequestId: incidentClientRequestId,
      decisionRequestId: cleanupDecisionRequestId,
      checkerId: cleanupCheckerId,
      action: "INCIDENT_LINKED" as const,
      expectedVersion: 1,
      incidentReference,
    };
    const recoveryIncidentLink = await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(
      db,
      incidentLinkInput,
    );
    const recoveryIncidentReplay =
      await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(db, incidentLinkInput);
    const recoveryIncidentAlreadyRecorded =
      await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(db, {
        ...incidentLinkInput,
        clientRequestId: randomUUID(),
      });
    const recoveryIncidentConflict =
      await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(db, {
        ...incidentLinkInput,
        clientRequestId: randomUUID(),
        incidentReference: `DIFFERENT-${randomUUID()}`,
      });
    const acknowledgedRecoveryQueue =
      await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
        approverId: cleanupCheckerId,
      });
    const acknowledgedRecoveryHealth = await getShipmentApvInvoiceRestorationRemediationHealth(db);
    const acknowledgedRecoveryAlert = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      undefined,
      remediationHealthAfter,
      acknowledgedRecoveryHealth,
    );
    const agedAcknowledgmentNow = new Date(Date.now() + 31 * 60_000);
    const agedAcknowledgmentRecoveryHealth =
      await getShipmentApvInvoiceRestorationRemediationHealth(db, agedAcknowledgmentNow);
    const agedAcknowledgmentRecoveryAlert = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      undefined,
      remediationHealthAfter,
      agedAcknowledgmentRecoveryHealth,
    );
    const recoveryAcknowledgmentRows = (await db.execute(sql`SELECT action,incident_reference_hash
      FROM shipment_apv_invoice_restoration_remediation_acknowledgments
      WHERE remediation_request_id=${cleanupRemediationRequest.request.id}::uuid
      ORDER BY action ASC`)) as unknown as Array<Record<string, unknown>>;
    const recoveryAcknowledgmentAuditRows = (await db.execute(sql`SELECT payload
      FROM admin_action_log
      WHERE action_type='shipment.apv_invoice_restoration_remediation_recovery_ack'
        AND target_id=${cleanupRemediationRequest.request.id}
      ORDER BY created_at ASC,id ASC`)) as unknown as Array<Record<string, unknown>>;
    const remediationStateAfterAcknowledgment = (await db.execute(sql`SELECT status,version
      FROM shipment_apv_invoice_restoration_remediation_requests
      WHERE id=${cleanupRemediationRequest.request.id}::uuid`)) as unknown as Array<
      Record<string, unknown>
    >;
    const cleanupWrongChecker = await decideShipmentApvInvoiceRestorationRemediation(db, {
      requestId: cleanupRemediationRequest.request.id,
      decisionRequestId: cleanupDecisionRequestId,
      approverId: randomUUID(),
      decision: "APPROVE",
      reason: "A different checker must not take over a stale applying decision.",
      expectedVersion: 1,
      storageRoot: invoiceDocumentRoot,
    });
    const cleanupRemediationApproval = await decideShipmentApvInvoiceRestorationRemediation(db, {
      requestId: cleanupRemediationRequest.request.id,
      decisionRequestId: cleanupDecisionRequestId,
      approverId: cleanupCheckerId,
      decision: "APPROVE",
      reason: "A separate checker confirmed the source remains missing and closed it safely.",
      expectedVersion: 1,
      storageRoot: invoiceDocumentRoot,
    });
    const cleanupRemediationTimeline = await getShipmentApvInvoiceRestorationRemediationTimeline(
      db,
      cleanupRemediationRequest.request.id,
    );
    const expiryRestorationTimeline = await getShipmentApvInvoiceRestorationTimeline(
      db,
      expiryRestorationRequest.request.id,
    );
    const remediationQueueHealthAfter = await getShipmentApvInvoiceRestorationRemediationHealth(db);
    const remediationStagingHealthAfter = await getShipmentApvInvoiceRestorationStagingHealth(db, {
      storageRoot: invoiceDocumentRoot,
    });
    const remediationQueueAlertAfter = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      undefined,
      remediationStagingHealthAfter,
      remediationQueueHealthAfter,
    );
    const rejectedRestorationMakerId = randomUUID();
    const rejectedRestorationRequest = await requestShipmentApvInvoiceRestoration(db, {
      clientRequestId: randomUUID(),
      candidateId: restoreCandidateAfterPreserve.candidateId,
      requesterId: rejectedRestorationMakerId,
      reason: "Stage an exact replacement so rejection staging retention can be verified.",
      contentType: "application/json",
      bytes: revisionTwoDocumentBytes,
      storageRoot: invoiceDocumentRoot,
    });
    if (!("request" in rejectedRestorationRequest) || !rejectedRestorationRequest.request) {
      throw new Error("APV_INVOICE_REJECTED_RESTORATION_FIXTURE_REQUEST_FAILED");
    }
    invoiceRejectedRestorationRequestId = rejectedRestorationRequest.request.id;
    const rejectedRestorationDecision = await decideShipmentApvInvoiceRestoration(db, {
      requestId: rejectedRestorationRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: randomUUID(),
      decision: "REJECT",
      reason: "A separate checker rejected restoration but retained supplied bytes for audit.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    });
    const stagingMaintenanceDryRun = await maintainShipmentApvInvoiceRestorationStaging(db, {
      mode: "dry_run",
      actorId: randomUUID(),
      storageRoot: invoiceDocumentRoot,
    });
    await db.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
      SET staging_status = 'MOVING', updated_at = now() - interval '6 minutes'
      WHERE id = ${rejectedRestorationRequest.request.id}::uuid AND status = 'REJECTED'`);
    const stagingHealthBefore = await getShipmentApvInvoiceRestorationStagingHealth(db, {
      storageRoot: invoiceDocumentRoot,
    });
    const stagingAlertBefore = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      undefined,
      stagingHealthBefore,
    );
    const stagingMaintenanceJob = await runShipmentApvInvoiceRestorationStagingMaintenance(db, {
      actorId: randomUUID(),
      storageRoot: invoiceDocumentRoot,
    });
    if (!stagingMaintenanceJob.maintenance) {
      throw new Error("APV_INVOICE_RESTORATION_MAINTENANCE_JOB_DID_NOT_RUN");
    }
    const stagingMaintenance = stagingMaintenanceJob.maintenance;
    const stagingMaintenanceReplayJob = await runShipmentApvInvoiceRestorationStagingMaintenance(
      db,
      {
        actorId: randomUUID(),
        storageRoot: invoiceDocumentRoot,
      },
    );
    if (!stagingMaintenanceReplayJob.maintenance) {
      throw new Error("APV_INVOICE_RESTORATION_MAINTENANCE_JOB_REPLAY_MISSING");
    }
    const stagingMaintenanceReplay = stagingMaintenanceReplayJob.maintenance;
    const rejectedRestorationTimeline = await getShipmentApvInvoiceRestorationTimeline(
      db,
      rejectedRestorationRequest.request.id,
    );
    const retainedRejectedPath = join(
      invoiceDocumentRoot,
      ".quarantine",
      rejectedRestorationRequest.request.id,
      `staged-${invoiceDocumentSha256}.json`,
    );
    const retainedRejectedBytes = await readFile(retainedRejectedPath).catch(() => null);
    const restoreCandidateAfterReject = (
      await listShipmentApvInvoiceRestorationCandidates(db)
    ).candidates.find((item) => item.integrityStatus === "QUARANTINED");
    if (!restoreCandidateAfterReject)
      throw new Error("APV_INVOICE_RESTORE_AFTER_REJECT_CANDIDATE_MISSING");
    const expiredRestorationRequest = await requestShipmentApvInvoiceRestoration(db, {
      clientRequestId: randomUUID(),
      candidateId: restoreCandidateAfterReject.candidateId,
      requesterId: randomUUID(),
      reason: "Stage an exact replacement so expired approval retention can be verified.",
      contentType: "application/json",
      bytes: revisionTwoDocumentBytes,
      storageRoot: invoiceDocumentRoot,
    });
    if (!("request" in expiredRestorationRequest) || !expiredRestorationRequest.request) {
      throw new Error("APV_INVOICE_EXPIRED_RESTORATION_FIXTURE_REQUEST_FAILED");
    }
    invoiceExpiredRestorationRequestId = expiredRestorationRequest.request.id;
    await db.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
      SET expires_at = now() - interval '1 minute'
      WHERE id = ${expiredRestorationRequest.request.id}::uuid AND status = 'PENDING'`);
    const expirationMaintenanceDryRun = await maintainShipmentApvInvoiceRestorationStaging(db, {
      mode: "dry_run",
      actorId: randomUUID(),
      storageRoot: invoiceDocumentRoot,
    });
    const expirationMaintenance = await maintainShipmentApvInvoiceRestorationStaging(db, {
      mode: "apply",
      actorId: randomUUID(),
      storageRoot: invoiceDocumentRoot,
    });
    const expiredRestorationTimeline = await getShipmentApvInvoiceRestorationTimeline(
      db,
      expiredRestorationRequest.request.id,
    );
    const retainedExpiredPath = join(
      invoiceDocumentRoot,
      ".quarantine",
      expiredRestorationRequest.request.id,
      `staged-${invoiceDocumentSha256}.json`,
    );
    const retainedExpiredBytes = await readFile(retainedExpiredPath).catch(() => null);
    const restoreCandidateAfterExpiry = (
      await listShipmentApvInvoiceRestorationCandidates(db)
    ).candidates.find((item) => item.integrityStatus === "QUARANTINED");
    if (!restoreCandidateAfterExpiry)
      throw new Error("APV_INVOICE_RESTORE_AFTER_EXPIRY_CANDIDATE_MISSING");
    const finalRestorationMakerId = randomUUID();
    const finalRestorationRequest = await requestShipmentApvInvoiceRestoration(db, {
      clientRequestId: randomUUID(),
      candidateId: restoreCandidateAfterExpiry.candidateId,
      requesterId: finalRestorationMakerId,
      reason: "Stage the same verified replacement for a separate restoration decision.",
      contentType: "application/json",
      bytes: revisionTwoDocumentBytes,
      storageRoot: invoiceDocumentRoot,
    });
    if (!("request" in finalRestorationRequest) || !finalRestorationRequest.request) {
      throw new Error("APV_INVOICE_FINAL_RESTORATION_FIXTURE_REQUEST_FAILED");
    }
    invoiceRestorationRequestId = finalRestorationRequest.request.id;
    const restorationDecisionInput = {
      requestId: finalRestorationRequest.request.id,
      decisionRequestId: randomUUID(),
      approverId: randomUUID(),
      decision: "RESTORE" as const,
      reason: "A separate checker verified the replacement hash and approved restoration.",
      expectedVersion: 0,
      storageRoot: invoiceDocumentRoot,
    };
    const restorationApproval = await decideShipmentApvInvoiceRestoration(
      db,
      restorationDecisionInput,
    );
    const restorationApprovalReplay = await decideShipmentApvInvoiceRestoration(
      db,
      restorationDecisionInput,
    );
    const restorationTimeline = await getShipmentApvInvoiceRestorationTimeline(
      db,
      finalRestorationRequest.request.id,
    );
    const restoredDocumentBytes = await readShipmentApvInvoiceDocumentBytes(
      db,
      revisionTwo.revision.id,
      invoiceDocumentRoot,
    );
    const restoredDocumentHealth = await getShipmentApvInvoiceDocumentStorageHealth(db, {
      revisionId: revisionTwo.revision.id,
      storageRoot: invoiceDocumentRoot,
    });
    const stagingHealthAfter = await getShipmentApvInvoiceRestorationStagingHealth(db, {
      storageRoot: invoiceDocumentRoot,
    });
    const stagingAlertAfter = evaluateShipmentApvPayoutAlert(
      healthyPayout,
      { expiredThreshold: 1 },
      undefined,
      undefined,
      stagingHealthAfter,
    );
    const revisionTwoDecisionRequestId = randomUUID();
    const revisionTwoApplication = await applyShipmentApvInvoiceRevision(db, {
      revisionId: revisionTwo.revision.id,
      requestId: revisionTwoDecisionRequestId,
      reviewerId: randomUUID(),
      decision: "WAIVED",
      reason:
        "The revised carrier charge is not supported by enough evidence to assign it to the seller.",
      expectedVersion: 0,
    });
    const revisionTwoApplicationReplay = await applyShipmentApvInvoiceRevision(db, {
      revisionId: revisionTwo.revision.id,
      requestId: revisionTwoDecisionRequestId,
      reviewerId: randomUUID(),
      decision: "WAIVED",
      reason:
        "The revised carrier charge is not supported by enough evidence to assign it to the seller.",
      expectedVersion: 0,
    });
    const revisionThreeApplication = await applyShipmentApvInvoiceRevision(db, {
      revisionId: revisionThree.revision.id,
      requestId: randomUUID(),
      reviewerId: randomUUID(),
      decision: "APPLY_CREDIT",
      reason:
        "Apply the carrier credit to the parties that currently bear the corresponding adjustment.",
      expectedVersion: 0,
    });
    const revisionFourDecisionRequestId = randomUUID();
    const concurrentApplications = await Promise.all(
      Array.from({ length: 10 }, () =>
        applyShipmentApvInvoiceRevision(db, {
          revisionId: revisionFour.revision.id,
          requestId: revisionFourDecisionRequestId,
          reviewerId: randomUUID(),
          decision: "UPHELD",
          reason:
            "The revised carrier evidence supports assigning this additional package charge to the seller.",
          expectedVersion: 0,
        }),
      ),
    );
    const appliedApplications = concurrentApplications.filter((item) => item.outcome === "applied");
    const duplicateApplications = concurrentApplications.filter(
      (item) => item.outcome === "duplicate",
    );
    const finalAdjustmentRows = (await db.execute(sql`
      SELECT adjusted_rate_minor, adjustment_minor, buffer_applied_minor,
             assessed_seller_liability_minor, seller_liability_minor,
             platform_liability_minor, buyer_effect_minor
        FROM shipment_apv_adjustments WHERE id = ${overBuffer.id}
    `)) as unknown as Array<Record<string, unknown>>;
    const finalAdjustment = finalAdjustmentRows[0];
    const finalReleaseRows = (await db.execute(sql`
      SELECT apv_adjustment_minor FROM settlement_releases WHERE id = ${releaseId}
    `)) as unknown as Array<Record<string, unknown>>;
    const finalRelease = finalReleaseRows[0];

    const creditInput: ShipmentApvInput = {
      ...baseInput,
      providerInvoiceId: creditInvoiceId,
      originalRateMinor: 625,
      adjustedRateMinor: 525,
      adjustmentMinor: -100,
    };
    const creditClaim = await claimShipmentApvAdjustment(db, creditInput);
    if (creditClaim.outcome !== "acquired")
      throw new Error(`APV_CHAOS_CREDIT_${creditClaim.outcome}`);
    const credit = await completeShipmentApvAdjustment(db, creditClaim, creditInput);

    const concurrentInput: ShipmentApvInput = {
      ...baseInput,
      providerInvoiceId: concurrentInvoiceId,
      originalRateMinor: 625,
      adjustedRateMinor: 625,
      adjustmentMinor: 0,
    };
    const concurrentClaims = await Promise.all(
      Array.from({ length: 20 }, () => claimShipmentApvAdjustment(db, concurrentInput)),
    );
    const acquiredClaims = concurrentClaims.filter(
      (item): item is ShipmentApvClaim => item.outcome === "acquired",
    );
    const blockedClaims = concurrentClaims.filter((item) => item.outcome === "in_progress");
    if (acquiredClaims[0]) await failShipmentApvAdjustment(db, acquiredClaims[0]);

    const payoutRequestId = `apv-payout:${releaseId}`;
    const payoutOffset = await reserveShipmentApvPayoutOffset(db, {
      settlementReleaseId: releaseId,
      requestId: payoutRequestId,
      maxOffsetMinor: 60,
    });
    const payoutOffsetReplay = await reserveShipmentApvPayoutOffset(db, {
      settlementReleaseId: releaseId,
      requestId: payoutRequestId,
      maxOffsetMinor: 60,
    });
    const payoutOffsetConflict = await reserveShipmentApvPayoutOffset(db, {
      settlementReleaseId: releaseId,
      requestId: `apv-payout-conflict:${releaseId}`,
      maxOffsetMinor: 60,
    });
    const payoutTxHash = `0x${"ab".repeat(32)}`;
    const payoutApplied = await completeShipmentApvPayoutOffset(db, {
      settlementReleaseId: releaseId,
      payoutOffsetId: payoutOffset.outcome === "reserved" ? payoutOffset.offset.id : "missing",
      releaseTxHash: payoutTxHash,
    });
    const payoutAppliedReplay = await completeShipmentApvPayoutOffset(db, {
      settlementReleaseId: releaseId,
      payoutOffsetId: payoutOffset.outcome === "reserved" ? payoutOffset.offset.id : "missing",
      releaseTxHash: payoutTxHash,
    });
    const payoutTxConflict = await completeShipmentApvPayoutOffset(db, {
      settlementReleaseId: releaseId,
      payoutOffsetId: payoutOffset.outcome === "reserved" ? payoutOffset.offset.id : "missing",
      releaseTxHash: `0x${"cd".repeat(32)}`,
    });
    const carryQueueBefore = await listShipmentApvSellerLiabilities(db, sellerId);
    await db.insert(settlementApprovals).values({
      id: carryApprovalId,
      listingId: carryListingId,
      sellerId,
      buyerId: carryBuyerId,
      approvalState: "APPROVED",
      sellerApprovalMode: "AUTO_WITHIN_POLICY",
      selectedPaymentRail: "x402",
      currency: "USDC",
      finalAmountMinor: "10000",
      termsSnapshot: { fixture: "shipment_apv_carry_forward" },
    });
    await db.insert(commerceOrders).values({
      id: carryOrderId,
      settlementApprovalId: carryApprovalId,
      listingId: carryListingId,
      sellerId,
      buyerId: carryBuyerId,
      status: "DELIVERED",
      currency: "USDC",
      amountMinor: "10000",
      orderSnapshot: { fixture: "shipment_apv_carry_forward" },
    });
    await db.insert(settlementReleases).values({
      id: carryReleaseId,
      paymentIntentId: randomUUID(),
      orderId: carryOrderId,
      productAmountMinor: "10000",
      productCurrency: "USDC",
      productReleaseStatus: "RELEASED",
      bufferAmountMinor: "0",
      bufferCurrency: "USDC",
      bufferReleaseStatus: "RELEASED",
      apvAdjustmentMinor: "0",
    });
    const recoveryReserve = await reserveShipmentApvPayoutOffset(db, {
      settlementReleaseId: carryReleaseId,
      requestId: `apv-payout-recovery:${carryReleaseId}`,
      maxOffsetMinor: 20,
    });
    if (recoveryReserve.outcome !== "reserved")
      throw new Error(`APV_RECOVERY_RESERVE_${recoveryReserve.outcome}`);
    const recoveryNotExpired = await cancelExpiredShipmentApvPayoutOffset(db, {
      settlementReleaseId: carryReleaseId,
      payoutOffsetId: recoveryReserve.offset.id,
      actorId: randomUUID(),
      reason:
        "A live payout reservation must remain unavailable for cancellation before its deadline.",
      onchainState: "FUNDED",
    });
    const expiredDeadline = Math.floor(Date.now() / 1000) - 1;
    const recoverySignature = await bindShipmentApvPayoutOffsetSignature(db, {
      settlementReleaseId: carryReleaseId,
      payoutOffsetId: recoveryReserve.offset.id,
      deadlineUnix: expiredDeadline,
    });
    const expiredReservationHealth = await getShipmentApvPayoutReservationHealth(db);
    const expiredRecoveryQueue = await listExpiredShipmentApvPayoutReservations(db, { limit: 20 });
    const recoveryStateBlocked = await cancelExpiredShipmentApvPayoutOffset(db, {
      settlementReleaseId: carryReleaseId,
      payoutOffsetId: recoveryReserve.offset.id,
      actorId: randomUUID(),
      reason:
        "The expired release signature was not executed and the chain state must be verified.",
      onchainState: "RELEASED",
    });
    const cancellationRequesterId = randomUUID();
    const cancellationApproverId = randomUUID();
    const cancellationClientRequestId = randomUUID();
    const cancellationReason =
      "The expired release signature was not executed and the settlement remains funded.";
    const cancellationRequest = await requestShipmentApvPayoutCancellation(db, {
      clientRequestId: cancellationClientRequestId,
      payoutOffsetId: recoveryReserve.offset.id,
      settlementReleaseId: carryReleaseId,
      requesterId: cancellationRequesterId,
      reason: cancellationReason,
    });
    const cancellationRequestReplay = await requestShipmentApvPayoutCancellation(db, {
      clientRequestId: cancellationClientRequestId,
      payoutOffsetId: recoveryReserve.offset.id,
      settlementReleaseId: carryReleaseId,
      requesterId: cancellationRequesterId,
      reason: cancellationReason,
    });
    const cancellationRequestConflict = await requestShipmentApvPayoutCancellation(db, {
      clientRequestId: cancellationClientRequestId,
      payoutOffsetId: recoveryReserve.offset.id,
      settlementReleaseId: carryReleaseId,
      requesterId: cancellationRequesterId,
      reason: "A conflicting reason must not replace the original cancellation request.",
    });
    if (!("request" in cancellationRequest))
      throw new Error(`APV_CANCEL_REQUEST_${cancellationRequest.outcome}`);
    const cancellationRequestRecord = cancellationRequest.request;
    if (!cancellationRequestRecord) throw new Error("APV_CANCEL_REQUEST_RECORD_MISSING");
    await db.execute(sql`
      INSERT INTO shipment_apv_payout_offsets
        (id, settlement_release_id, order_id, seller_id, currency,
         seller_liability_minor, applied_offset_minor, unapplied_liability_minor,
         evidence_manifest_sha256, request_id, allocation_version, status,
         signature_deadline, reservation_expires_at, created_at, updated_at)
      VALUES (${paginationOffsetId}::uuid, ${paginationReleaseId}::uuid, ${paginationOrderId}::uuid,
              ${sellerId}::uuid, 'USDC', 1, 1, 0, ${"9".repeat(64)},
              ${`apv-payout-pagination:${paginationReleaseId}`}, 0, 'RESERVED',
              now() - interval '2 hours', now() - interval '1 hour', now(), now())
    `);
    const paginationRequestNow = new Date(Date.now() + 1_000);
    const paginationRequest = await requestShipmentApvPayoutCancellation(db, {
      clientRequestId: randomUUID(),
      payoutOffsetId: paginationOffsetId,
      settlementReleaseId: paginationReleaseId,
      requesterId: cancellationRequesterId,
      reason:
        "A second pending request verifies stable opaque cursor pagination and automatic expiry auditing.",
      now: paginationRequestNow,
    });
    if (!("request" in paginationRequest))
      throw new Error(`APV_CANCEL_PAGINATION_${paginationRequest.outcome}`);
    const paginationRequestRecord = paginationRequest.request;
    if (!paginationRequestRecord) throw new Error("APV_CANCEL_PAGINATION_RECORD_MISSING");
    const pendingCancellationQueue = await listPendingShipmentApvPayoutCancellations(db);
    const pendingCancellationPageOne = await listPendingShipmentApvPayoutCancellations(db, {
      limit: 1,
    });
    const pendingCancellationPageTwo = pendingCancellationPageOne.nextCursor
      ? await listPendingShipmentApvPayoutCancellations(db, {
          limit: 1,
          cursor: pendingCancellationPageOne.nextCursor,
        })
      : { items: [], nextCursor: null, recordedAt: new Date().toISOString() };
    const pendingCancellationHealth = await getShipmentApvPayoutCancellationApprovalHealth(db);
    const selfApproval = await decideShipmentApvPayoutCancellation(db, {
      requestId: cancellationRequestRecord.id,
      payoutOffsetId: recoveryReserve.offset.id,
      settlementReleaseId: carryReleaseId,
      decisionRequestId: randomUUID(),
      approverId: cancellationRequesterId,
      decision: "APPROVE",
      reason: "The request maker must not be allowed to approve the same cancellation.",
      expectedVersion: 0,
      onchainState: "FUNDED",
    });
    const approvalStateBlocked = await decideShipmentApvPayoutCancellation(db, {
      requestId: cancellationRequestRecord.id,
      payoutOffsetId: recoveryReserve.offset.id,
      settlementReleaseId: carryReleaseId,
      decisionRequestId: randomUUID(),
      approverId: cancellationApproverId,
      decision: "APPROVE",
      reason: "The checker must refuse cancellation unless the settlement remains funded.",
      expectedVersion: 0,
      onchainState: "RELEASED",
    });
    const approvalDecisionRequestId = randomUUID();
    const approvalResults = await Promise.all(
      Array.from({ length: 10 }, () =>
        decideShipmentApvPayoutCancellation(db, {
          requestId: cancellationRequestRecord.id,
          payoutOffsetId: recoveryReserve.offset.id,
          settlementReleaseId: carryReleaseId,
          decisionRequestId: approvalDecisionRequestId,
          approverId: cancellationApproverId,
          decision: "APPROVE",
          reason:
            "A different administrator verified the expired signature and funded onchain state.",
          expectedVersion: 0,
          onchainState: "FUNDED",
        }),
      ),
    );
    const approvalWinners = approvalResults.filter((item) => item.outcome === "approved");
    const approvalReplays = approvalResults.filter((item) => item.outcome === "duplicate");
    const paginationExpired = await decideShipmentApvPayoutCancellation(db, {
      requestId: paginationRequestRecord.id,
      payoutOffsetId: paginationOffsetId,
      settlementReleaseId: paginationReleaseId,
      decisionRequestId: randomUUID(),
      approverId: cancellationApproverId,
      decision: "APPROVE",
      reason: "The approval window elapsed before the checker completed a decision.",
      expectedVersion: 0,
      onchainState: "FUNDED",
      now: new Date(paginationRequestNow.getTime() + 31 * 60_000),
    });
    const paginationRetryNow = new Date(paginationRequestNow.getTime() + 31 * 60_000 + 1_000);
    const paginationRetryRequest = await requestShipmentApvPayoutCancellation(db, {
      clientRequestId: randomUUID(),
      payoutOffsetId: paginationOffsetId,
      settlementReleaseId: paginationReleaseId,
      requesterId: cancellationRequesterId,
      reason:
        "The expired approval is retried through a new maker-checker request without reusing its decision.",
      now: paginationRetryNow,
    });
    if (!("request" in paginationRetryRequest))
      throw new Error(`APV_CANCEL_RETRY_${paginationRetryRequest.outcome}`);
    const paginationRetryRecord = paginationRetryRequest.request;
    if (!paginationRetryRecord) throw new Error("APV_CANCEL_RETRY_RECORD_MISSING");
    const paginationRetryDecision = await decideShipmentApvPayoutCancellation(db, {
      requestId: paginationRetryRecord.id,
      payoutOffsetId: paginationOffsetId,
      settlementReleaseId: paginationReleaseId,
      decisionRequestId: randomUUID(),
      approverId: cancellationApproverId,
      decision: "APPROVE",
      reason:
        "A different administrator approved the replacement request after the first approval expired.",
      expectedVersion: 0,
      onchainState: "FUNDED",
      now: new Date(paginationRetryNow.getTime() + 1_000),
    });
    const recoveredCancellationHealth = await getShipmentApvPayoutCancellationApprovalHealth(db);
    const cancelledOffsetRows = (await db.execute(sql`
      SELECT status FROM shipment_apv_payout_offsets WHERE id = ${recoveryReserve.offset.id}
    `)) as unknown as Array<Record<string, unknown>>;
    const recoveryCancelled = {
      outcome: approvalWinners.length === 1 ? ("cancelled" as const) : ("failed" as const),
      offset: { status: String(cancelledOffsetRows[0]?.status ?? "UNKNOWN") },
    };
    const recoveryAuditRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS count
        FROM admin_action_log
       WHERE action_type = 'shipment.apv_payout_reservation_cancel'
         AND target_type = 'shipment_apv_payout_offset'
         AND target_id = ${recoveryReserve.offset.id}
    `)) as unknown as Array<Record<string, unknown>>;
    const recoveryAuditCount = Number(recoveryAuditRows[0]?.count ?? 0);
    const makerCheckerAuditRows = (await db.execute(sql`
      SELECT action_type, COUNT(*)::int AS count
        FROM admin_action_log
       WHERE target_type = 'shipment_apv_payout_cancellation_request'
         AND target_id = ${cancellationRequestRecord.id}
       GROUP BY action_type
    `)) as unknown as Array<Record<string, unknown>>;
    const makerCheckerAuditCounts = Object.fromEntries(
      makerCheckerAuditRows.map((row) => [String(row.action_type), Number(row.count)]),
    );
    const lifecycleEventRows = (await db.execute(sql`
      SELECT cancellation_request_id, event_type, actor_id, request_version,
             previous_event_hash, event_hash
        FROM shipment_apv_payout_cancellation_events
       WHERE cancellation_request_id IN (
         ${cancellationRequestRecord.id}::uuid,
         ${paginationRequestRecord.id}::uuid,
         ${paginationRetryRecord.id}::uuid
       )
       ORDER BY created_at ASC, id ASC
    `)) as unknown as Array<Record<string, unknown>>;
    const lifecycleTimeline = await getShipmentApvPayoutCancellationTimeline(
      db,
      cancellationRequestRecord.id,
    );
    if (!lifecycleTimeline) throw new Error("APV_CANCEL_TIMELINE_MISSING");
    const { privateKey: auditPrivateKey } = generateKeyPairSync("ed25519");
    const signedLifecycleExport = createSignedShipmentApvPayoutCancellationAuditExport({
      cancellationRequestId: cancellationRequestRecord.id,
      events: lifecycleTimeline.events,
      generatedAt: new Date(),
      privateKey: auditPrivateKey,
    });
    const signedLifecycleExportValid =
      verifySignedShipmentApvPayoutCancellationAuditExport(signedLifecycleExport);
    const overdueArchiveCreatedAt = new Date(Date.now() - 16 * 60_000);
    const auditArchiveEnqueue = await enqueueShipmentApvCancellationAuditArchive(db, {
      cancellationRequestId: cancellationRequestRecord.id,
      events: lifecycleTimeline.events,
      now: overdueArchiveCreatedAt,
      privateKey: auditPrivateKey,
    });
    const auditArchiveReplay = await enqueueShipmentApvCancellationAuditArchive(db, {
      cancellationRequestId: cancellationRequestRecord.id,
      events: lifecycleTimeline.events,
      now: overdueArchiveCreatedAt,
      privateKey: auditPrivateKey,
    });
    const auditArchiveHealthBefore = await getShipmentApvCancellationAuditArchiveHealth(db);
    const archiveDispatch = await dispatchShipmentApvCancellationAuditArchives(db, {
      config: {
        url: "http://127.0.0.1/audit-archive",
        timeoutMs: 5_000,
        maxAttempts: 3,
        allowInsecureHttp: true,
        allowPrivateNetwork: true,
      },
      fetchImpl: async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        return new Response(
          JSON.stringify({
            receipt_id: "worm_apv_chaos_receipt",
            stored_sha256: headers["x-haggle-content-sha256"],
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      },
      now: new Date(),
      limit: 10,
    });
    const deliveredAuditArchive = await getShipmentApvCancellationAuditArchiveStatus(
      db,
      cancellationRequestRecord.id,
    );
    const auditArchiveHealthAfter = await getShipmentApvCancellationAuditArchiveHealth(db);
    const retryTimeline = await getShipmentApvPayoutCancellationTimeline(
      db,
      paginationRetryRecord.id,
    );
    if (!retryTimeline) throw new Error("APV_CANCEL_RETRY_TIMELINE_MISSING");
    await enqueueShipmentApvCancellationAuditArchive(db, {
      cancellationRequestId: paginationRetryRecord.id,
      events: retryTimeline.events,
      now: new Date(),
      privateKey: auditPrivateKey,
    });
    const deadLetterDispatch = await dispatchShipmentApvCancellationAuditArchives(db, {
      config: {
        url: "http://127.0.0.1/audit-archive",
        timeoutMs: 5_000,
        maxAttempts: 1,
        allowInsecureHttp: true,
        allowPrivateNetwork: true,
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ receipt_id: "mismatch", stored_sha256: "0".repeat(64) }), {
          status: 201,
        }),
      now: new Date(),
      limit: 10,
    });
    const deadLetterHealth = await getShipmentApvCancellationAuditArchiveHealth(db);
    const archiveFailureQueueBefore = await listShipmentApvCancellationAuditArchiveFailures(db, {
      limit: 20,
    });
    const archiveRequeue = await requeueShipmentApvCancellationAuditArchive(db, {
      cancellationRequestId: paginationRetryRecord.id,
      actorId: cancellationApproverId,
      reason: "The write-once archive endpoint recovered after operator verification.",
    });
    const archiveRequeueReplay = await requeueShipmentApvCancellationAuditArchive(db, {
      cancellationRequestId: paginationRetryRecord.id,
      actorId: cancellationApproverId,
      reason: "The write-once archive endpoint recovered after operator verification.",
    });
    const recoveryDispatch = await dispatchShipmentApvCancellationAuditArchives(db, {
      config: {
        url: "http://127.0.0.1/audit-archive",
        timeoutMs: 5_000,
        maxAttempts: 3,
        allowInsecureHttp: true,
        allowPrivateNetwork: true,
      },
      fetchImpl: async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        return new Response(
          JSON.stringify({
            receipt_id: "worm_recovered_receipt",
            stored_sha256: headers["x-haggle-content-sha256"],
          }),
          { status: 201 },
        );
      },
      now: new Date(),
      limit: 10,
    });
    const recoveredArchiveHealth = await getShipmentApvCancellationAuditArchiveHealth(db);
    const archiveFailureQueueAfter = await listShipmentApvCancellationAuditArchiveFailures(db, {
      limit: 20,
    });
    const archiveRequeueAuditRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM admin_action_log
       WHERE action_type = 'shipment.apv_cancellation_audit_archive_requeue'
         AND target_id = ${archiveRequeue.outcome === "requeued" ? archiveRequeue.archive.id : "missing"}
    `)) as unknown as Array<Record<string, unknown>>;
    const archiveRequeueAuditCount = Number(archiveRequeueAuditRows[0]?.count ?? 0);
    await db.execute(sql`
      UPDATE shipment_apv_payout_cancellation_events
         SET metadata = jsonb_set(metadata, '{tampered}', 'true'::jsonb, true)
       WHERE cancellation_request_id = ${cancellationRequestRecord.id}::uuid
         AND event_type = 'APPROVED'
    `);
    const tamperedLifecycleTimeline = await getShipmentApvPayoutCancellationTimeline(
      db,
      cancellationRequestRecord.id,
    );
    if (!tamperedLifecycleTimeline) throw new Error("APV_CANCEL_TAMPERED_TIMELINE_MISSING");
    const carryPayout = await reserveShipmentApvPayoutOffset(db, {
      settlementReleaseId: carryReleaseId,
      requestId: `apv-payout-carry:${carryReleaseId}`,
      maxOffsetMinor: 850,
    });
    const carryPayoutApplied = await completeShipmentApvPayoutOffset(db, {
      settlementReleaseId: carryReleaseId,
      payoutOffsetId: carryPayout.outcome === "reserved" ? carryPayout.offset.id : "missing",
      releaseTxHash: `0x${"ef".repeat(32)}`,
    });
    const carryQueueAfter = await listShipmentApvSellerLiabilities(db, sellerId);
    const recoveredReservationHealth = await getShipmentApvPayoutReservationHealth(db);
    const recoveredRecoveryQueue = await listExpiredShipmentApvPayoutReservations(db, {
      limit: 20,
    });
    const frozenClaim = await claimShipmentApvAdjustment(db, {
      ...baseInput,
      providerInvoiceId: `shinv_frozen_${randomUUID()}`,
      originalRateMinor: 625,
      adjustedRateMinor: 725,
      adjustmentMinor: 100,
    });
    const frozenRevision = await recordShipmentApvInvoiceRevision(db, {
      ...overBufferInput,
      adjustedRateMinor: 1275,
      adjustmentMinor: 650,
      invoiceEvent: "updated",
      webhookEventId: `evt_frozen_${randomUUID()}`,
    });

    const checks = {
      ...Object.fromEntries(
        Object.entries(retentionAlertFixture.checks).map(([key, value]) => [
          `cursor_retention_alert_${key}`,
          value,
        ]),
      ),
      buffer_capped: overBuffer.buffer_applied_minor === 150,
      seller_liability_recorded:
        overBuffer.seller_liability_minor === 250 && overBuffer.status === "REVIEW_REQUIRED",
      buyer_effect_zero: overBuffer.buyer_effect_minor === 0 && credit.buyer_effect_minor === 0,
      duplicate_idempotent: duplicate.outcome === "duplicate",
      payload_conflict_blocked: conflict.outcome === "payload_conflict",
      credit_recorded: credit.status === "CREDIT_RECORDED" && credit.carrier_credit_minor === 100,
      concurrent_single_winner: acquiredClaims.length === 1,
      concurrent_others_blocked: blockedClaims.length === 19,
      seller_review_recorded:
        sellerReview.outcome === "updated" && sellerReview.record.review_status === "PENDING",
      seller_review_idempotent: duplicateReview.outcome === "duplicate",
      seller_review_conflict_blocked: conflictingReview.outcome === "request_conflict",
      review_decision_single_winner:
        decisionWinners.length === 1 && decisionDuplicates.length + decisionConflicts.length === 9,
      review_decision_retry_idempotent: decisionReplay.outcome === "duplicate",
      waived_liability_balanced:
        finalReview?.review_status === "WAIVED" &&
        finalReview.assessed_seller_liability_minor === 250 &&
        finalReview.seller_liability_minor === 0 &&
        finalReview.platform_liability_minor === 250 &&
        finalReview.buyer_effect_minor === 0,
      revision_positive_delta:
        revisionTwo.outcome === "recorded" &&
        revisionTwo.revision.revision_number === 2 &&
        revisionTwo.revision.delta_minor === 100,
      revision_replay_idempotent: revisionTwoReplay.outcome === "duplicate",
      revision_negative_delta:
        revisionThree.outcome === "recorded" &&
        revisionThree.revision.revision_number === 3 &&
        revisionThree.revision.delta_minor === -50,
      revision_concurrent_serialized:
        recordedRevisions.length === 1 && duplicateRevisions.length === 9,
      revision_money_effect_zero:
        revisionTwo.outcome === "recorded" &&
        revisionThree.outcome === "recorded" &&
        revisionTwo.revision.buyer_effect_minor === 0 &&
        revisionThree.revision.buyer_effect_minor === 0,
      revision_waiver_applied:
        revisionTwoApplication.outcome === "applied" &&
        revisionTwoApplication.revision.platform_liability_minor === 100,
      revision_application_idempotent: revisionTwoApplicationReplay.outcome === "duplicate",
      revision_credit_applied:
        revisionThreeApplication.outcome === "applied" &&
        revisionThreeApplication.revision.carrier_credit_minor === 50,
      revision_application_single_winner:
        appliedApplications.length === 1 && duplicateApplications.length === 9,
      revision_aggregate_balanced:
        Number(finalAdjustment?.adjusted_rate_minor) === 1175 &&
        Number(finalAdjustment?.adjustment_minor) === 550 &&
        Number(finalAdjustment?.buffer_applied_minor) === 150 &&
        Number(finalAdjustment?.assessed_seller_liability_minor) === 400 &&
        Number(finalAdjustment?.seller_liability_minor) === 100 &&
        Number(finalAdjustment?.platform_liability_minor) === 300 &&
        Number(finalAdjustment?.buyer_effect_minor) === 0,
      revision_buffer_consistent: Number(finalRelease?.apv_adjustment_minor) === 150,
      revision_evidence_bound:
        revisionTwoEvidence.outcome === "bound" &&
        revisionThreeEvidence.outcome === "bound" &&
        revisionFourEvidence.outcome === "bound",
      revision_evidence_idempotent: revisionTwoEvidenceReplay.outcome === "duplicate",
      revision_evidence_immutable: revisionTwoEvidenceConflict.outcome === "evidence_conflict",
      revision_invoice_document_stored: invoiceDocumentStored.outcome === "stored",
      revision_invoice_document_idempotent: invoiceDocumentReplay.outcome === "duplicate",
      revision_invoice_document_immutable: invoiceDocumentConflict.outcome === "document_conflict",
      revision_invoice_document_bytes_verified:
        invoiceDocumentReadBytes?.equals(revisionTwoDocumentBytes) === true,
      revision_invoice_storage_healthy_before: invoiceDocumentHealthBefore.status === "healthy",
      revision_invoice_storage_orphan_detected:
        invoiceDocumentHealthWithOrphan.status === "warning" &&
        invoiceDocumentHealthWithOrphan.orphanFiles === 1,
      revision_invoice_storage_dry_run_safe:
        invoiceDocumentReconciliation.dryRun &&
        !invoiceDocumentReconciliation.mutated &&
        invoiceDocumentReconciliation.wouldQuarantineOrphans === 1,
      revision_invoice_storage_healthy_after: invoiceDocumentHealthAfter.status === "healthy",
      revision_invoice_storage_warning_alerted:
        invoiceDocumentAlert.severity === "warning" &&
        invoiceDocumentAlert.reasons.includes("invoice_document_orphan"),
      revision_invoice_storage_alert_cleared: !invoiceDocumentAlertAfter.wouldAlert,
      revision_invoice_reconciliation_candidate_opaque:
        reconciliationCandidates.candidates.length >= 1 &&
        orphanCandidate.candidateId.length === 64 &&
        !JSON.stringify(orphanCandidate).includes("storage"),
      revision_invoice_reconciliation_requested:
        reconciliationRequest.outcome === "requested" &&
        pendingInvoiceReconciliations.some((item) => item.id === reconciliationRequestRecord.id),
      revision_invoice_reconciliation_self_approval_blocked:
        reconciliationSelfApproval.outcome === "self_approval_forbidden",
      revision_invoice_reconciliation_checker_approved:
        reconciliationApproval.outcome === "approved",
      revision_invoice_reconciliation_idempotent:
        reconciliationApprovalReplay.outcome === "duplicate",
      revision_invoice_reconciliation_quarantined:
        quarantinedOrphanBytes?.equals(orphanBytes) === true,
      revision_invoice_reconciliation_lifecycle:
        reconciliationTimeline?.events.map((event) => event.event_type).join(",") ===
        "REQUESTED,APPLYING,APPROVED",
      revision_invoice_corruption_detected:
        corruptedDocumentHealth.status === "critical" &&
        corruptedDocumentHealth.hashMismatches === 1,
      revision_invoice_corruption_quarantined:
        corruptApproval.outcome === "approved" &&
        corruptQuarantineBytes?.equals(corruptedDocumentBytes) === true,
      revision_invoice_quarantine_remains_visible:
        quarantinedDocumentHealth.status === "warning" &&
        quarantinedDocumentHealth.quarantinedDocuments === 1,
      revision_invoice_restoration_candidate_opaque:
        restorationCandidate.candidateId.length === 64 &&
        !JSON.stringify(restorationCandidate).includes("document"),
      revision_invoice_restoration_mismatch_blocked:
        restorationMismatch.outcome === "replacement_mismatch",
      revision_invoice_restoration_request_idempotent:
        restorationRequest.outcome === "requested" &&
        restorationRequestReplay.outcome === "duplicate",
      revision_invoice_restoration_self_approval_blocked:
        restorationSelfApproval.outcome === "self_approval_forbidden",
      revision_invoice_restoration_checker_preserved: preservationApproval.outcome === "preserved",
      revision_invoice_restoration_preserve_idempotent:
        preservationApprovalReplay.outcome === "duplicate",
      revision_invoice_restoration_preserved_bytes_verified:
        preservedReplacementBytes?.equals(revisionTwoDocumentBytes) === true,
      revision_invoice_restoration_preserve_lifecycle:
        preservationTimeline?.events.map((event) => event.event_type).join(",") ===
        "REQUESTED,APPLYING,PRESERVED",
      revision_invoice_remediation_corruption_detected:
        remediationHealthBefore.status === "critical" &&
        remediationHealthBefore.hashMismatches === 1,
      revision_invoice_remediation_candidate_opaque:
        remediationCandidate.candidateId.length === 64 &&
        !JSON.stringify(remediationCandidate).includes("request") &&
        !JSON.stringify(remediationCandidate).includes("sha256"),
      revision_invoice_remediation_request_idempotent:
        remediationRequest.outcome === "requested" &&
        remediationRequestReplay.outcome === "duplicate",
      revision_invoice_remediation_pending_queue: pendingRemediations.some(
        (item) => item.id === remediationRequest.request.id && item.status === "PENDING",
      ),
      revision_invoice_remediation_self_approval_blocked:
        remediationSelfApproval.outcome === "self_approval_forbidden",
      revision_invoice_remediation_checker_approved: remediationApproval.outcome === "approved",
      revision_invoice_remediation_decision_idempotent:
        remediationApprovalReplay.outcome === "duplicate",
      revision_invoice_remediation_bytes_quarantined:
        remediatedQuarantineBytes?.equals(corruptedStagingBytes) === true,
      revision_invoice_remediation_lifecycle:
        remediationTimeline?.events.map((event) => event.event_type).join(",") ===
        "REQUESTED,APPLYING,APPROVED",
      revision_invoice_remediation_restoration_audited:
        remediatedRestorationRejection.outcome === "rejected" &&
        remediatedRestorationTimeline?.events.map((event) => event.event_type).join(",") ===
          "REQUESTED,REJECTED,STAGING_REMEDIATED",
      revision_invoice_remediation_health_recovered:
        remediationHealthAfter.status === "healthy" && remediationHealthAfter.trackedStaging === 0,
      revision_invoice_remediation_expiry_overdue_detected:
        remediationQueueHealthBefore.status === "critical" &&
        remediationQueueHealthBefore.overduePendingRequests === 1,
      revision_invoice_remediation_expiry_alert_firing:
        remediationQueueAlertBefore.severity === "critical" &&
        remediationQueueAlertBefore.reasons.includes("invoice_restoration_remediation_overdue"),
      revision_invoice_remediation_expiry_worker_completed:
        remediationExpiryJob.status === "completed" && remediationExpiryJob.expiry.expired === 1,
      revision_invoice_remediation_expiry_worker_converged:
        remediationExpiryReplay.status === "skipped" &&
        remediationExpiryReplay.reason === "healthy",
      revision_invoice_remediation_expiry_lifecycle:
        expiredRemediationTimeline?.events.map((event) => event.event_type).join(",") ===
        "REQUESTED,EXPIRED",
      revision_invoice_remediation_expired_request_left_bytes_untouched:
        expiryRestorationRejection.outcome === "rejected" &&
        cleanupRemediationApproval.outcome === "approved",
      revision_invoice_remediation_expiry_cleanup_lifecycle:
        cleanupRemediationTimeline?.events.map((event) => event.event_type).join(",") ===
          "REQUESTED,APPLYING,APPROVED" &&
        expiryRestorationTimeline?.events.map((event) => event.event_type).join(",") ===
          "REQUESTED,REJECTED,STAGING_REMEDIATED",
      revision_invoice_remediation_recovery_queue_scoped:
        cleanupRecoveryQueue.items.length === 1 &&
        cleanupRecoveryQueue.items[0]?.requestId === cleanupRemediationRequest.request.id &&
        cleanupRecoveryQueue.items[0]?.decisionRequestId === cleanupDecisionRequestId &&
        foreignRecoveryQueue.items.length === 0,
      revision_invoice_remediation_recovery_pagination_first_page:
        paginationRecoveryFirstPage.items.length === 1 &&
        paginationRecoveryFirstPage.items[0]?.requestId === cleanupRemediationRequest.request.id &&
        paginationRecoveryFirstPage.truncated === true &&
        typeof paginationRecoveryFirstPage.nextCursor === "string",
      revision_invoice_remediation_recovery_pagination_second_page:
        paginationRecoverySecondPage.items.length === 1 &&
        paginationRecoverySecondPage.items[0]?.requestId ===
          invoicePaginationRestorationRemediationRequestId &&
        paginationRecoverySecondPage.truncated === false &&
        paginationRecoverySecondPage.nextCursor === null,
      revision_invoice_remediation_recovery_pagination_snapshot_stable:
        paginationRecoverySecondPage.recordedAt === paginationRecoveryFirstPage.recordedAt &&
        !paginationRecoveryFirstPage.nextCursor?.includes(cleanupRemediationRequest.request.id) &&
        (paginationRecoveryFirstPage.nextCursor?.length ?? 0) <= 512,
      revision_invoice_remediation_recovery_pagination_fail_closed_and_clean:
        paginationInvalidCursorBlocked &&
        paginationRemediationCleanup.requests === 1 &&
        paginationRemediationCleanup.events === 2,
      revision_invoice_remediation_recovery_pagination_expired_cursor_blocked:
        paginationExpiredCursorBlocked,
      revision_invoice_remediation_recovery_queue_opaque:
        !/path|sha256|candidate|restorationRequestId|requester|reason/i.test(
          JSON.stringify(cleanupRecoveryQueue),
        ),
      revision_invoice_remediation_recovery_initially_unacknowledged:
        cleanupRecoveryQueue.items[0]?.acknowledged === false &&
        cleanupRecoveryQueue.items[0]?.incidentConnected === false,
      revision_invoice_remediation_recovery_wrong_checker_ack_blocked:
        wrongCheckerAcknowledgment.outcome === "invalid_state",
      revision_invoice_remediation_recovery_incident_requires_ack:
        incidentBeforeAcknowledgment.outcome === "acknowledgment_required",
      revision_invoice_remediation_recovery_ack_idempotent:
        recoveryAcknowledgment.outcome === "recorded" &&
        recoveryAcknowledgmentReplay.outcome === "duplicate",
      revision_invoice_remediation_recovery_incident_hash_bound:
        recoveryIncidentLink.outcome === "recorded" &&
        recoveryIncidentLink.acknowledgment.incidentReferenceBound &&
        recoveryAcknowledgmentRows.find((row) => row.action === "INCIDENT_LINKED")
          ?.incident_reference_hash ===
          createHash("sha256").update(incidentReference, "utf8").digest("hex") &&
        !JSON.stringify(recoveryIncidentLink).includes(incidentReference),
      revision_invoice_remediation_recovery_incident_idempotent:
        recoveryIncidentReplay.outcome === "duplicate" &&
        recoveryIncidentAlreadyRecorded.outcome === "already_recorded",
      revision_invoice_remediation_recovery_incident_conflict_isolated:
        recoveryIncidentConflict.outcome === "incident_conflict",
      revision_invoice_remediation_recovery_status_visible:
        acknowledgedRecoveryQueue.items.length === 1 &&
        acknowledgedRecoveryQueue.items[0]?.acknowledged === true &&
        acknowledgedRecoveryQueue.items[0]?.incidentConnected === true &&
        Boolean(acknowledgedRecoveryQueue.items[0]?.acknowledgedAt) &&
        Boolean(acknowledgedRecoveryQueue.items[0]?.incidentConnectedAt),
      revision_invoice_remediation_recovery_ack_does_not_mutate_decision:
        String(remediationStateAfterAcknowledgment[0]?.status) === "APPLYING" &&
        Number(remediationStateAfterAcknowledgment[0]?.version) === 1,
      revision_invoice_remediation_recovery_audit_redacted:
        recoveryAcknowledgmentAuditRows.length === 2 &&
        !JSON.stringify(recoveryAcknowledgmentAuditRows).includes(incidentReference) &&
        !JSON.stringify(recoveryAcknowledgmentAuditRows).includes(
          createHash("sha256").update(incidentReference, "utf8").digest("hex"),
        ),
      revision_invoice_remediation_recovery_age_bucket_escalated:
        cleanupRecoveryHealth.staleApplyingRequests === 1 &&
        cleanupRecoveryHealth.staleApplyingOver15Minutes === 1 &&
        cleanupRecoveryHealth.staleApplyingOver60Minutes === 1 &&
        cleanupRecoveryHealth.oldestApplyingAgeSeconds !== null &&
        cleanupRecoveryHealth.oldestApplyingAgeSeconds >= 60 * 60 &&
        cleanupRecoveryHealth.staleApplyingAgeBucket === "60m",
      revision_invoice_remediation_recovery_alert_aggregate_only:
        cleanupRecoveryAlert.severity === "critical" &&
        cleanupRecoveryAlert.reasons.includes("invoice_restoration_remediation_stale_applying") &&
        cleanupRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_stale_applying_15m",
        ) &&
        cleanupRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_stale_applying_60m",
        ) &&
        cleanupRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_unacknowledged_60m",
        ) &&
        cleanupRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_incident_unlinked_60m",
        ) &&
        cleanupRecoveryHealth.unacknowledgedStaleOver60Minutes === 1 &&
        cleanupRecoveryHealth.incidentUnlinkedStaleOver60Minutes === 1 &&
        !/requestId|decisionRequestId|approverId|path|sha256|candidate/i.test(
          JSON.stringify({ health: cleanupRecoveryHealth, alert: cleanupRecoveryAlert }),
        ),
      revision_invoice_remediation_recovery_handling_alert_cleared:
        acknowledgedRecoveryHealth.unacknowledgedStaleOver60Minutes === 0 &&
        acknowledgedRecoveryHealth.incidentUnlinkedStaleOver60Minutes === 0 &&
        !acknowledgedRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_unacknowledged_60m",
        ) &&
        !acknowledgedRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_incident_unlinked_60m",
        ),
      revision_invoice_remediation_recovery_base_stale_alert_preserved:
        acknowledgedRecoveryAlert.severity === "critical" &&
        acknowledgedRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_stale_applying",
        ) &&
        acknowledgedRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_stale_applying_15m",
        ) &&
        acknowledgedRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_stale_applying_60m",
        ),
      revision_invoice_remediation_recovery_fresh_ack_not_realerted:
        acknowledgedRecoveryHealth.acknowledgedStillApplyingOver30Minutes === 0 &&
        acknowledgedRecoveryHealth.incidentLinkedStillApplyingOver30Minutes === 0 &&
        !acknowledgedRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_acknowledged_still_applying_30m",
        ) &&
        !acknowledgedRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_incident_linked_still_applying_30m",
        ),
      revision_invoice_remediation_recovery_incident_sla_fresh:
        acknowledgedOnlyRecoveryHealth.incidentLinkOverdueAfterAcknowledgment === 0,
      revision_invoice_remediation_recovery_incident_sla_overdue:
        overdueIncidentRecoveryHealth.incidentLinkOverdueAfterAcknowledgment === 1 &&
        overdueIncidentRecoveryAlert.severity === "critical" &&
        overdueIncidentRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_incident_link_overdue_after_ack_15m",
        ) &&
        !/requestId|decisionRequestId|approverId|path|sha256|candidate/i.test(
          JSON.stringify({
            health: overdueIncidentRecoveryHealth,
            alert: overdueIncidentRecoveryAlert,
          }),
        ),
      revision_invoice_remediation_recovery_aged_ack_realerted:
        agedAcknowledgmentRecoveryHealth.acknowledgedStillApplyingOver30Minutes === 1 &&
        agedAcknowledgmentRecoveryHealth.incidentLinkedStillApplyingOver30Minutes === 1 &&
        agedAcknowledgmentRecoveryAlert.severity === "critical" &&
        agedAcknowledgmentRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_acknowledged_still_applying_30m",
        ) &&
        agedAcknowledgmentRecoveryAlert.reasons.includes(
          "invoice_restoration_remediation_incident_linked_still_applying_30m",
        ) &&
        !/requestId|decisionRequestId|approverId|path|sha256|candidate/i.test(
          JSON.stringify({
            health: agedAcknowledgmentRecoveryHealth,
            alert: agedAcknowledgmentRecoveryAlert,
          }),
        ),
      revision_invoice_remediation_recovery_wrong_checker_blocked:
        cleanupWrongChecker.outcome === "invalid_state",
      revision_invoice_remediation_recovery_same_decision_resumed:
        cleanupRemediationApproval.outcome === "approved" &&
        cleanupRemediationTimeline?.events.map((event) => event.event_type).join(",") ===
          "REQUESTED,APPLYING,APPROVED",
      revision_invoice_remediation_expiry_health_recovered:
        remediationQueueHealthAfter.status === "healthy" &&
        remediationQueueHealthAfter.pendingRequests === 0 &&
        remediationStagingHealthAfter.status === "healthy",
      revision_invoice_remediation_expiry_alert_cleared:
        remediationQueueAlertAfter.wouldAlert === false,
      revision_invoice_restoration_rejected: rejectedRestorationDecision.outcome === "rejected",
      revision_invoice_restoration_staging_dry_run:
        !("outcome" in stagingMaintenanceDryRun) &&
        stagingMaintenanceDryRun.eligible === 1 &&
        stagingMaintenanceDryRun.preserved === 0,
      revision_invoice_restoration_staging_preserved:
        !("outcome" in stagingMaintenance) &&
        stagingMaintenance.preserved === 1 &&
        stagingMaintenance.resumed === 1 &&
        stagingMaintenance.conflicts === 0 &&
        retainedRejectedBytes?.equals(revisionTwoDocumentBytes) === true,
      revision_invoice_restoration_staging_maintenance_idempotent:
        !("outcome" in stagingMaintenanceReplay) &&
        stagingMaintenanceReplay.eligible === 0 &&
        stagingMaintenanceReplay.preserved === 0,
      revision_invoice_restoration_staging_worker_completed:
        stagingMaintenanceJob.status === "completed",
      revision_invoice_restoration_staging_worker_converged:
        stagingMaintenanceReplayJob.status === "skipped" &&
        stagingMaintenanceReplayJob.reason === "healthy",
      revision_invoice_restoration_reject_lifecycle:
        rejectedRestorationTimeline?.events.map((event) => event.event_type).join(",") ===
        "REQUESTED,REJECTED,STAGING_PRESERVED",
      revision_invoice_restoration_expiration_dry_run:
        !("outcome" in expirationMaintenanceDryRun) &&
        expirationMaintenanceDryRun.eligible === 1 &&
        expirationMaintenanceDryRun.preserved === 0,
      revision_invoice_restoration_expired_staging_preserved:
        !("outcome" in expirationMaintenance) &&
        expirationMaintenance.expired === 1 &&
        expirationMaintenance.preserved === 1 &&
        expirationMaintenance.conflicts === 0 &&
        retainedExpiredBytes?.equals(revisionTwoDocumentBytes) === true,
      revision_invoice_restoration_expiry_lifecycle:
        expiredRestorationTimeline?.events.map((event) => event.event_type).join(",") ===
        "REQUESTED,EXPIRED,STAGING_PRESERVED",
      revision_invoice_restoration_staging_health_warning:
        stagingHealthBefore.status === "warning" &&
        stagingHealthBefore.pendingDisposition === 1 &&
        stagingHealthBefore.staleMoving === 1,
      revision_invoice_restoration_staging_alert_firing:
        stagingAlertBefore.severity === "warning" &&
        stagingAlertBefore.reasons.includes("invoice_restoration_staging_stale"),
      revision_invoice_restoration_staging_health_recovered:
        stagingHealthAfter.status === "healthy" && stagingHealthAfter.trackedStaging === 0,
      revision_invoice_restoration_staging_alert_cleared: stagingAlertAfter.wouldAlert === false,
      revision_invoice_restoration_checker_restored: restorationApproval.outcome === "restored",
      revision_invoice_restoration_decision_idempotent:
        restorationApprovalReplay.outcome === "duplicate",
      revision_invoice_restoration_bytes_verified:
        restoredDocumentBytes?.equals(revisionTwoDocumentBytes) === true,
      revision_invoice_restoration_lifecycle:
        restorationTimeline?.events.map((event) => event.event_type).join(",") ===
        "REQUESTED,APPLYING,RESTORED",
      revision_invoice_restoration_health_recovered: restoredDocumentHealth.status === "healthy",
      payout_waits_for_revisions: prematurePayout.outcome === "pending_revision",
      payout_offset_reserved:
        payoutOffset.outcome === "reserved" &&
        payoutOffset.offset.seller_liability_minor === 100 &&
        payoutOffset.offset.applied_offset_minor === 60 &&
        payoutOffset.offset.unapplied_liability_minor === 40,
      payout_offset_idempotent: payoutOffsetReplay.outcome === "duplicate",
      payout_snapshot_immutable: payoutOffsetConflict.outcome === "snapshot_conflict",
      payout_completion_idempotent:
        payoutApplied.outcome === "applied" &&
        payoutAppliedReplay.outcome === "duplicate" &&
        payoutTxConflict.outcome === "snapshot_conflict",
      payout_freezes_new_apv:
        frozenClaim.outcome === "payout_reserved" && frozenRevision.outcome === "payout_reserved",
      payout_carry_queue_partial: carryQueueBefore.some(
        (item) => item.status === "PARTIAL" && item.remaining_amount_minor === 40,
      ),
      payout_carry_forward_reserved:
        carryPayout.outcome === "reserved" &&
        carryPayout.offset.applied_offset_minor === 40 &&
        carryPayout.offset.unapplied_liability_minor === 0,
      payout_carry_forward_settled:
        carryPayoutApplied.outcome === "applied" &&
        carryQueueAfter.some(
          (item) => item.status === "SETTLED" && item.remaining_amount_minor === 0,
        ),
      payout_recovery_signature_bound: recoverySignature.outcome === "bound",
      payout_recovery_blocks_early_cancel: recoveryNotExpired.outcome === "not_expired",
      payout_recovery_requires_funded_state:
        recoveryStateBlocked.outcome === "onchain_state_conflict",
      payout_recovery_cancelled_and_retried:
        recoveryCancelled.outcome === "cancelled" &&
        recoveryCancelled.offset.status === "CANCELLED" &&
        carryPayout.outcome === "reserved",
      payout_expired_health_detected:
        expiredReservationHealth.status === "attention" &&
        expiredReservationHealth.expiredReserved === 1 &&
        expiredReservationHealth.signedExpired === 1,
      payout_expired_health_recovered:
        recoveredReservationHealth.status === "healthy" &&
        recoveredReservationHealth.expiredReserved === 0,
      payout_recovery_audit_atomic: recoveryAuditCount === 1,
      payout_recovery_queue_detected:
        expiredRecoveryQueue.items.length === 1 &&
        expiredRecoveryQueue.items[0]?.offsetId === recoveryReserve.offset.id,
      payout_recovery_queue_cleared: recoveredRecoveryQueue.items.length === 0,
      payout_cancel_request_idempotent:
        cancellationRequest.outcome === "requested" &&
        cancellationRequestReplay.outcome === "duplicate" &&
        cancellationRequestConflict.outcome === "request_conflict",
      payout_cancel_self_approval_blocked: selfApproval.outcome === "self_approval_forbidden",
      payout_cancel_checker_revalidates_chain:
        approvalStateBlocked.outcome === "onchain_state_conflict",
      payout_cancel_single_checker_winner:
        approvalWinners.length === 1 && approvalReplays.length === 9,
      payout_cancel_pending_queue_visible: pendingCancellationQueue.items.some(
        (item) => item.id === cancellationRequestRecord.id,
      ),
      payout_cancel_queue_cursor_stable:
        pendingCancellationPageOne.items.length === 1 &&
        Boolean(pendingCancellationPageOne.nextCursor) &&
        pendingCancellationPageTwo.items.length === 1 &&
        pendingCancellationPageOne.items[0]?.id !== pendingCancellationPageTwo.items[0]?.id &&
        pendingCancellationPageTwo.nextCursor === null,
      payout_cancel_maker_checker_audited:
        makerCheckerAuditCounts["shipment.apv_payout_cancellation_request"] === 1 &&
        makerCheckerAuditCounts["shipment.apv_payout_cancellation_decision"] === 1,
      payout_cancel_approval_health_detected:
        pendingCancellationHealth.status === "attention" &&
        pendingCancellationHealth.pendingRequests === 2,
      payout_cancel_approval_health_recovered:
        recoveredCancellationHealth.status === "healthy" &&
        recoveredCancellationHealth.pendingRequests === 0,
      payout_cancel_expiry_system_audited:
        paginationExpired.outcome === "expired" &&
        lifecycleEventRows.some(
          (event) =>
            event.cancellation_request_id === paginationRequestRecord.id &&
            event.event_type === "EXPIRED" &&
            event.actor_id === null &&
            Number(event.request_version) === 1,
        ),
      payout_cancel_expiry_retry_approved:
        paginationRetryRequest.outcome === "requested" &&
        paginationRetryDecision.outcome === "approved",
      payout_cancel_lifecycle_complete:
        lifecycleEventRows.length === 6 &&
        lifecycleEventRows.filter((event) => event.event_type === "REQUESTED").length === 3 &&
        lifecycleEventRows.filter((event) => event.event_type === "APPROVED").length === 2 &&
        lifecycleEventRows.some(
          (event) =>
            event.cancellation_request_id === cancellationRequestRecord.id &&
            event.event_type === "APPROVED" &&
            event.actor_id === cancellationApproverId,
        ),
      payout_cancel_hash_chain_valid:
        lifecycleTimeline.integrity.valid &&
        lifecycleTimeline.integrity.complete &&
        lifecycleTimeline.integrity.sealedEvents === 2 &&
        lifecycleTimeline.events.every((event) => Boolean(event.event_hash)),
      payout_cancel_signed_export_valid:
        signedLifecycleExportValid &&
        signedLifecycleExport.manifest.chain_valid &&
        signedLifecycleExport.manifest.event_count === 2,
      payout_cancel_tamper_detected: tamperedLifecycleTimeline.integrity.valid === false,
      payout_cancel_archive_idempotent:
        auditArchiveEnqueue.outcome === "enqueued" &&
        auditArchiveReplay.outcome === "duplicate" &&
        auditArchiveEnqueue.archive.id === auditArchiveReplay.archive.id,
      payout_cancel_archive_receipt_verified:
        archiveDispatch.status === "processed" &&
        archiveDispatch.delivered === 1 &&
        archiveDispatch.failed === 0 &&
        deliveredAuditArchive?.status === "DELIVERED" &&
        deliveredAuditArchive.receiptSha256 === deliveredAuditArchive.payloadSha256,
      payout_cancel_archive_health_detected:
        auditArchiveHealthBefore.pending === 1 &&
        auditArchiveHealthBefore.oldestUnfinishedAgeSeconds !== null,
      payout_cancel_archive_overdue_detected:
        auditArchiveHealthBefore.status === "attention" &&
        auditArchiveHealthBefore.overdueUnfinished === 1 &&
        (auditArchiveHealthBefore.oldestUnfinishedAgeSeconds ?? 0) >= 15 * 60,
      payout_cancel_archive_health_recovered:
        auditArchiveHealthAfter.pending === 0 &&
        auditArchiveHealthAfter.processing === 0 &&
        auditArchiveHealthAfter.failed === 0 &&
        auditArchiveHealthAfter.deadLetter === 0,
      payout_cancel_archive_dead_letter_detected:
        deadLetterDispatch.status === "processed" &&
        deadLetterDispatch.deadLettered === 1 &&
        deadLetterHealth.status === "critical" &&
        deadLetterHealth.deadLetter === 1,
      payout_cancel_archive_failure_queue_detected:
        archiveFailureQueueBefore.items.length === 1 &&
        archiveFailureQueueBefore.items[0]?.cancellationRequestId === paginationRetryRecord.id &&
        archiveFailureQueueBefore.items[0]?.status === "DEAD_LETTER",
      payout_cancel_archive_requeue_audited:
        archiveRequeue.outcome === "requeued" &&
        archiveRequeueReplay.outcome === "already_queued" &&
        archiveRequeueAuditCount === 1,
      payout_cancel_archive_requeue_recovered:
        recoveryDispatch.status === "processed" &&
        recoveryDispatch.delivered === 1 &&
        recoveredArchiveHealth.status === "healthy" &&
        recoveredArchiveHealth.deadLetter === 0,
      payout_cancel_archive_failure_queue_cleared: archiveFailureQueueAfter.items.length === 0,
    };
    return {
      pass: Object.values(checks).every(Boolean),
      checks,
      retentionAlertFixture,
      overBuffer,
      duplicate: duplicate.outcome,
      conflict: conflict.outcome,
      sellerReview,
      duplicateReview: duplicateReview.outcome,
      conflictingReview: conflictingReview.outcome,
      reviewDecision: {
        requests: reviewDecisions.length,
        winners: decisionWinners.length,
        idempotent: decisionDuplicates.length,
        conflicts: decisionConflicts.length,
        replay: decisionReplay.outcome,
        final: finalReview,
      },
      revisions: {
        positive: revisionTwo,
        replay: revisionTwoReplay.outcome,
        negative: revisionThree,
        concurrent: {
          requests: concurrentRevisions.length,
          recorded: recordedRevisions.length,
          duplicate: duplicateRevisions.length,
          revision:
            recordedRevisions[0] && "revision" in recordedRevisions[0]
              ? recordedRevisions[0].revision
              : null,
        },
        applications: {
          waived: revisionTwoApplication,
          replay: revisionTwoApplicationReplay.outcome,
          credit: revisionThreeApplication,
          concurrent: {
            requests: concurrentApplications.length,
            applied: appliedApplications.length,
            duplicate: duplicateApplications.length,
          },
          aggregate: finalAdjustment
            ? {
                adjusted_rate_minor: Number(finalAdjustment.adjusted_rate_minor),
                adjustment_minor: Number(finalAdjustment.adjustment_minor),
                buffer_applied_minor: Number(finalAdjustment.buffer_applied_minor),
                assessed_seller_liability_minor: Number(
                  finalAdjustment.assessed_seller_liability_minor,
                ),
                seller_liability_minor: Number(finalAdjustment.seller_liability_minor),
                platform_liability_minor: Number(finalAdjustment.platform_liability_minor),
                buyer_effect_minor: Number(finalAdjustment.buyer_effect_minor),
              }
            : null,
          settlement_buffer_applied_minor: Number(finalRelease?.apv_adjustment_minor ?? 0),
        },
        evidence: {
          bound: revisionTwoEvidence,
          replay: revisionTwoEvidenceReplay.outcome,
          conflict: revisionTwoEvidenceConflict.outcome,
          invoiceDocument: {
            stored: invoiceDocumentStored,
            replay: invoiceDocumentReplay.outcome,
            conflict: invoiceDocumentConflict.outcome,
            bytesVerified: invoiceDocumentReadBytes?.equals(revisionTwoDocumentBytes) === true,
            storageHealth: {
              before: invoiceDocumentHealthBefore,
              withOrphan: invoiceDocumentHealthWithOrphan,
              dryRun: invoiceDocumentReconciliation,
              after: invoiceDocumentHealthAfter,
              alert: invoiceDocumentAlert,
              alertAfter: invoiceDocumentAlertAfter,
              reconciliation: {
                candidates: reconciliationCandidates,
                request: reconciliationRequest,
                selfApproval: reconciliationSelfApproval.outcome,
                approval: reconciliationApproval,
                replay: reconciliationApprovalReplay.outcome,
                timeline: reconciliationTimeline,
                quarantinedBytesVerified: quarantinedOrphanBytes?.equals(orphanBytes) === true,
              },
              restoration: {
                corruptedHealth: corruptedDocumentHealth,
                corruptRequest,
                corruptApproval,
                corruptBytesVerified:
                  corruptQuarantineBytes?.equals(corruptedDocumentBytes) === true,
                quarantinedHealth: quarantinedDocumentHealth,
                candidates: restorationCandidates,
                mismatch: restorationMismatch.outcome,
                request: restorationRequest,
                requestReplay: restorationRequestReplay.outcome,
                selfApproval: restorationSelfApproval.outcome,
                preservation: {
                  approval: preservationApproval,
                  replay: preservationApprovalReplay.outcome,
                  timeline: preservationTimeline,
                  bytesVerified:
                    preservedReplacementBytes?.equals(revisionTwoDocumentBytes) === true,
                },
                remediation: {
                  restorationRejection: remediatedRestorationRejection,
                  healthBefore: remediationHealthBefore,
                  candidates: remediationCandidates,
                  request: remediationRequest,
                  requestReplay: remediationRequestReplay.outcome,
                  pendingQueueCount: pendingRemediations.length,
                  selfApproval: remediationSelfApproval.outcome,
                  approval: remediationApproval,
                  approvalReplay: remediationApprovalReplay.outcome,
                  timeline: remediationTimeline,
                  restorationTimeline: remediatedRestorationTimeline,
                  bytesQuarantined:
                    remediatedQuarantineBytes?.equals(corruptedStagingBytes) === true,
                  healthAfter: remediationHealthAfter,
                  expiry: {
                    restorationRejection: expiryRestorationRejection,
                    healthBefore: remediationQueueHealthBefore,
                    alertBefore: remediationQueueAlertBefore,
                    job: remediationExpiryJob,
                    replay: remediationExpiryReplay,
                    timeline: expiredRemediationTimeline,
                    cleanupApproval: cleanupRemediationApproval,
                    recovery: {
                      queue: cleanupRecoveryQueue,
                      foreignQueue: foreignRecoveryQueue,
                      pagination: {
                        first: paginationRecoveryFirstPage,
                        second: paginationRecoverySecondPage,
                        invalidCursorBlocked: paginationInvalidCursorBlocked,
                        expiredCursorBlocked: paginationExpiredCursorBlocked,
                        cleanup: paginationRemediationCleanup,
                      },
                      health: cleanupRecoveryHealth,
                      alert: cleanupRecoveryAlert,
                      healthAfterAcknowledgment: acknowledgedRecoveryHealth,
                      alertAfterAcknowledgment: acknowledgedRecoveryAlert,
                      agedAcknowledgmentHealth: agedAcknowledgmentRecoveryHealth,
                      agedAcknowledgmentAlert: agedAcknowledgmentRecoveryAlert,
                      wrongChecker: cleanupWrongChecker.outcome,
                      acknowledgment: recoveryAcknowledgment,
                      acknowledgmentReplay: recoveryAcknowledgmentReplay.outcome,
                      wrongCheckerAcknowledgment: wrongCheckerAcknowledgment.outcome,
                      incidentBeforeAcknowledgment: incidentBeforeAcknowledgment.outcome,
                      acknowledgedOnlyHealth: acknowledgedOnlyRecoveryHealth,
                      overdueIncidentHealth: overdueIncidentRecoveryHealth,
                      overdueIncidentAlert: overdueIncidentRecoveryAlert,
                      incidentLink: recoveryIncidentLink,
                      incidentReplay: recoveryIncidentReplay.outcome,
                      incidentAlreadyRecorded: recoveryIncidentAlreadyRecorded.outcome,
                      incidentConflict: recoveryIncidentConflict.outcome,
                      queueAfterAcknowledgment: acknowledgedRecoveryQueue,
                    },
                    cleanupTimeline: cleanupRemediationTimeline,
                    restorationTimeline: expiryRestorationTimeline,
                    healthAfter: remediationQueueHealthAfter,
                    alertAfter: remediationQueueAlertAfter,
                    stagingHealthAfter: remediationStagingHealthAfter,
                  },
                },
                stagingRetention: {
                  rejected: rejectedRestorationDecision,
                  dryRun: stagingMaintenanceDryRun,
                  apply: stagingMaintenance,
                  replay: stagingMaintenanceReplay,
                  job: {
                    first: stagingMaintenanceJob.status,
                    replay: stagingMaintenanceReplayJob.status,
                    replayReason: stagingMaintenanceReplayJob.reason,
                  },
                  timeline: rejectedRestorationTimeline,
                  bytesVerified: retainedRejectedBytes?.equals(revisionTwoDocumentBytes) === true,
                  expiration: {
                    request: expiredRestorationRequest,
                    dryRun: expirationMaintenanceDryRun,
                    apply: expirationMaintenance,
                    timeline: expiredRestorationTimeline,
                    bytesVerified: retainedExpiredBytes?.equals(revisionTwoDocumentBytes) === true,
                  },
                  health: {
                    before: stagingHealthBefore,
                    alertBefore: stagingAlertBefore,
                    after: stagingHealthAfter,
                    alertAfter: stagingAlertAfter,
                  },
                },
                finalRequest: finalRestorationRequest,
                approval: restorationApproval,
                approvalReplay: restorationApprovalReplay.outcome,
                timeline: restorationTimeline,
                restoredBytesVerified:
                  restoredDocumentBytes?.equals(revisionTwoDocumentBytes) === true,
                healthAfter: restoredDocumentHealth,
              },
            },
          },
        },
      },
      payout: {
        premature: prematurePayout.outcome,
        reserve: payoutOffset,
        replay: payoutOffsetReplay.outcome,
        conflict: payoutOffsetConflict.outcome,
        applied: payoutApplied,
        appliedReplay: payoutAppliedReplay.outcome,
        txConflict: payoutTxConflict.outcome,
        frozenClaim: frozenClaim.outcome,
        frozenRevision: frozenRevision.outcome,
        signedSplit:
          payoutOffset.outcome === "reserved"
            ? {
                gross_minor: 10000,
                seller_before_offset_minor: 9850,
                fee_before_offset_minor: 150,
                offset_minor: payoutOffset.offset.applied_offset_minor,
                seller_after_offset_minor: 9850 - payoutOffset.offset.applied_offset_minor,
                fee_after_offset_minor: 150 + payoutOffset.offset.applied_offset_minor,
              }
            : null,
        carryForward: {
          recovery: {
            reserve: recoveryReserve,
            notExpired: recoveryNotExpired,
            signature: recoverySignature,
            stateBlocked: recoveryStateBlocked,
            cancelled: recoveryCancelled,
            healthBefore: expiredReservationHealth,
            healthAfter: recoveredReservationHealth,
            auditCount: recoveryAuditCount,
            queueBefore: expiredRecoveryQueue,
            queueAfter: recoveredRecoveryQueue,
            makerChecker: {
              request: cancellationRequest,
              replay: cancellationRequestReplay.outcome,
              conflict: cancellationRequestConflict.outcome,
              pendingQueueCount: pendingCancellationQueue.items.length,
              pagination: {
                pageOne: pendingCancellationPageOne.items.length,
                pageTwo: pendingCancellationPageTwo.items.length,
                nextCursor: Boolean(pendingCancellationPageOne.nextCursor),
              },
              selfApproval: selfApproval.outcome,
              stateBlocked: approvalStateBlocked.outcome,
              approvals: {
                requests: approvalResults.length,
                approved: approvalWinners.length,
                replay: approvalReplays.length,
              },
              auditCounts: makerCheckerAuditCounts,
              healthBefore: pendingCancellationHealth,
              healthAfter: recoveredCancellationHealth,
              expired: paginationExpired.outcome,
              retry: paginationRetryDecision.outcome,
              lifecycleEvents: lifecycleEventRows.map((event) => ({
                requestId: String(event.cancellation_request_id),
                type: String(event.event_type),
                actor: event.actor_id ? "admin" : "system",
                version: Number(event.request_version),
              })),
              integrity: lifecycleTimeline.integrity,
              signedExport: {
                valid: signedLifecycleExportValid,
                algorithm: signedLifecycleExport.signature.algorithm,
                keyId: signedLifecycleExport.signature.key_id,
              },
              tamperedIntegrity: tamperedLifecycleTimeline.integrity,
              archive: deliveredAuditArchive
                ? {
                    status: deliveredAuditArchive.status,
                    attempts: deliveredAuditArchive.attemptCount,
                    receiptId: deliveredAuditArchive.receiptId,
                    receiptMatches:
                      deliveredAuditArchive.receiptSha256 === deliveredAuditArchive.payloadSha256,
                    idempotent: auditArchiveReplay.outcome,
                    healthBefore: auditArchiveHealthBefore,
                    healthAfter: auditArchiveHealthAfter,
                    deadLetterHealth,
                    requeue: archiveRequeue.outcome,
                    requeueReplay: archiveRequeueReplay.outcome,
                    requeueAuditCount: archiveRequeueAuditCount,
                    recoveredHealth: recoveredArchiveHealth,
                    failureQueueBefore: archiveFailureQueueBefore,
                    failureQueueAfter: archiveFailureQueueAfter,
                  }
                : null,
            },
          },
          queueBefore: carryQueueBefore,
          reserve: carryPayout,
          applied: carryPayoutApplied,
          queueAfter: carryQueueAfter,
        },
      },
      credit,
      concurrent: { requests: 20, acquired: acquiredClaims.length, blocked: blockedClaims.length },
      cleanup,
    };
  } finally {
    const reconciliationRequestIds = [
      invoiceReconciliationRequestId,
      invoiceCorruptReconciliationRequestId,
    ].filter((value): value is string => Boolean(value));
    const restorationRemediationRequestIds = [
      invoiceRestorationRemediationRequestId,
      invoiceExpiredRestorationRemediationRequestId,
      invoiceExpiredRestorationRemediationCleanupRequestId,
      invoicePaginationRestorationRemediationRequestId,
    ].filter((value): value is string => Boolean(value));
    const deletedInvoiceRestorationRemediation = restorationRemediationRequestIds.length
      ? await deleteShipmentApvInvoiceRestorationRemediationFixtureRows(
          db,
          restorationRemediationRequestIds,
        )
      : { acknowledgments: 0, events: 0, requests: 0 };
    const restorationRequestIds = [
      invoicePreservationRequestId,
      invoiceRemediatedRestorationRequestId,
      invoiceExpiredRemediationRestorationRequestId,
      invoiceRejectedRestorationRequestId,
      invoiceExpiredRestorationRequestId,
      invoiceRestorationRequestId,
    ].filter((value): value is string => Boolean(value));
    const deletedInvoiceRestoration = restorationRequestIds.length
      ? await deleteShipmentApvInvoiceRestorationFixtureRows(db, restorationRequestIds)
      : { events: 0, requests: 0 };
    const deletedInvoiceReconciliation = reconciliationRequestIds.length
      ? await deleteShipmentApvInvoiceReconciliationFixtureRows(db, reconciliationRequestIds)
      : { events: 0, requests: 0 };
    const deletedInvoiceDocument = invoiceDocumentRevisionId
      ? await deleteShipmentApvInvoiceDocumentForFixture(
          db,
          invoiceDocumentRevisionId,
          invoiceDocumentRoot,
        )
      : false;
    await rm(invoiceDocumentRoot, { recursive: true, force: true });
    const deletedAudits = (await db.execute(sql`
      DELETE FROM admin_action_log
       WHERE (
         action_type = 'shipment.apv_payout_reservation_cancel'
         AND target_type = 'shipment_apv_payout_offset'
         AND target_id IN (SELECT id::text FROM shipment_apv_payout_offsets WHERE settlement_release_id IN (${releaseId}, ${carryReleaseId}, ${paginationReleaseId}))
       ) OR (
         action_type = 'shipment.apv_payout_cancellation_request'
         AND target_type = 'shipment_apv_payout_cancellation_request'
         AND target_id IN (SELECT id::text FROM shipment_apv_payout_cancellation_requests WHERE settlement_release_id IN (${releaseId}, ${carryReleaseId}, ${paginationReleaseId}))
       ) OR (
         action_type = 'shipment.apv_payout_cancellation_decision'
         AND target_type = 'shipment_apv_payout_cancellation_request'
         AND target_id IN (SELECT id::text FROM shipment_apv_payout_cancellation_requests WHERE settlement_release_id IN (${releaseId}, ${carryReleaseId}, ${paginationReleaseId}))
       ) OR (
         action_type IN ('shipment.apv_invoice_reconciliation_request', 'shipment.apv_invoice_reconciliation_decision')
         AND target_type = 'shipment_apv_invoice_reconciliation_request'
         AND target_id IN (${invoiceReconciliationRequestId}, ${invoiceCorruptReconciliationRequestId})
       ) OR (
         action_type IN ('shipment.apv_invoice_restoration_remediation_request',
           'shipment.apv_invoice_restoration_remediation_decision',
           'shipment.apv_invoice_restoration_remediation_recovery_ack')
         AND target_type = 'shipment_apv_invoice_restoration_remediation_request'
         AND target_id IN (${invoiceRestorationRemediationRequestId},
           ${invoiceExpiredRestorationRemediationRequestId}, ${invoiceExpiredRestorationRemediationCleanupRequestId})
       ) OR (
         action_type IN ('shipment.apv_invoice_restoration_request', 'shipment.apv_invoice_restoration_decision',
           'shipment.apv_invoice_restoration_staging_preserve')
         AND target_type = 'shipment_apv_invoice_restoration_request'
         AND target_id IN (${invoicePreservationRequestId}, ${invoiceRemediatedRestorationRequestId},
           ${invoiceExpiredRemediationRestorationRequestId},
           ${invoiceRejectedRestorationRequestId},
           ${invoiceExpiredRestorationRequestId}, ${invoiceRestorationRequestId})
       ) OR (
         action_type = 'shipment.apv_cancellation_audit_archive_requeue'
         AND target_type = 'shipment_apv_payout_cancellation_audit_outbox'
         AND target_id IN (SELECT id::text FROM shipment_apv_payout_cancellation_audit_outbox WHERE cancellation_request_id IN (
           SELECT id FROM shipment_apv_payout_cancellation_requests WHERE settlement_release_id IN (${releaseId}, ${carryReleaseId}, ${paginationReleaseId})
         ))
       )
      RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    const deletedAuditArchives = (await db.execute(sql`
      DELETE FROM shipment_apv_payout_cancellation_audit_outbox
       WHERE cancellation_request_id IN (
         SELECT id FROM shipment_apv_payout_cancellation_requests
          WHERE settlement_release_id IN (${releaseId}, ${carryReleaseId}, ${paginationReleaseId})
       )
      RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    const deletedCancellationEvents = (await db.execute(sql`
      DELETE FROM shipment_apv_payout_cancellation_events
       WHERE cancellation_request_id IN (
         SELECT id FROM shipment_apv_payout_cancellation_requests
          WHERE settlement_release_id IN (${releaseId}, ${carryReleaseId}, ${paginationReleaseId})
       )
      RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    const deletedCancellationRequests = (await db.execute(sql`
      DELETE FROM shipment_apv_payout_cancellation_requests
       WHERE settlement_release_id IN (${releaseId}, ${carryReleaseId}, ${paginationReleaseId})
      RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    const deletedOffsets = (await db.execute(sql`
      DELETE FROM shipment_apv_payout_offsets
       WHERE settlement_release_id IN (${releaseId}, ${carryReleaseId}, ${paginationReleaseId})
      RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    const deletedLiabilities = (await db.execute(sql`
      DELETE FROM shipment_apv_seller_liabilities
       WHERE source_settlement_release_id IN (${releaseId}, ${carryReleaseId})
      RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    const deletedAdjustments = await db
      .delete(shipmentApvAdjustments)
      .where(eq(shipmentApvAdjustments.shipmentId, shipmentId))
      .returning({ id: shipmentApvAdjustments.id });
    const deletedShipments = await db
      .delete(shipments)
      .where(eq(shipments.id, shipmentId))
      .returning({ id: shipments.id });
    const deletedReleases = (await db.execute(sql`
      DELETE FROM settlement_releases WHERE id IN (${releaseId}, ${carryReleaseId}) RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    const deletedOrders = (await db.execute(sql`
      DELETE FROM commerce_orders WHERE id IN (${orderId}, ${carryOrderId}) RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    const deletedApprovals = (await db.execute(sql`
      DELETE FROM settlement_approvals WHERE id IN (${approvalId}, ${carryApprovalId}) RETURNING id
    `)) as unknown as Array<Record<string, unknown>>;
    Object.assign(cleanup, {
      offsets: deletedOffsets.length,
      audits: deletedAudits.length,
      cancellationRequests: deletedCancellationRequests.length,
      cancellationEvents: deletedCancellationEvents.length,
      auditArchives: deletedAuditArchives.length,
      liabilities: deletedLiabilities.length,
      adjustments: deletedAdjustments.length,
      shipments: deletedShipments.length,
      releases: deletedReleases.length,
      orders: deletedOrders.length,
      approvals: deletedApprovals.length,
      invoiceDocument: deletedInvoiceDocument,
      reconciliationRequests: deletedInvoiceReconciliation.requests,
      reconciliationEvents: deletedInvoiceReconciliation.events,
      restorationRequests: deletedInvoiceRestoration.requests,
      restorationEvents: deletedInvoiceRestoration.events,
      restorationRemediationRequests: deletedInvoiceRestorationRemediation.requests,
      restorationRemediationEvents: deletedInvoiceRestorationRemediation.events,
      restorationRemediationAcknowledgments: deletedInvoiceRestorationRemediation.acknowledgments,
      quarantinedOrphan: quarantinedOrphanVerified,
      succeeded:
        deletedOffsets.length === 4 &&
        deletedAudits.length === 32 &&
        deletedCancellationRequests.length === 3 &&
        deletedCancellationEvents.length === 6 &&
        deletedAuditArchives.length === 2 &&
        deletedLiabilities.length === 1 &&
        deletedShipments.length === 1 &&
        deletedReleases.length === 2 &&
        deletedOrders.length === 2 &&
        deletedApprovals.length === 2 &&
        deletedInvoiceDocument &&
        deletedInvoiceReconciliation.requests === 2 &&
        deletedInvoiceReconciliation.events === 6 &&
        deletedInvoiceRestoration.requests === 6 &&
        deletedInvoiceRestoration.events === 18 &&
        deletedInvoiceRestorationRemediation.requests === 3 &&
        deletedInvoiceRestorationRemediation.events === 8 &&
        deletedInvoiceRestorationRemediation.acknowledgments === 2 &&
        quarantinedOrphanVerified,
    });
  }
}
