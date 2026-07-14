import sharp from "sharp";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { assessImageSimilarity, computeImageSimilarityFingerprint } from "./dispute-image-similarity.service.js";
import {
  expireDisputeSimilarityReviews,
  getDisputeSimilarityReviewExpiryEventById,
  listDisputeSimilarityReviewExpiryEvents,
} from "./dispute-similarity-review-expiry.service.js";
import {
  createSignedDisputeSimilarityReviewAuditExport,
  verifySignedDisputeSimilarityReviewAuditExport,
} from "./dispute-similarity-review-audit-export.service.js";
import {
  dispatchDisputeSimilarityReviewAuditArchives,
  enqueueDisputeSimilarityReviewAuditArchive,
  getDisputeSimilarityReviewAuditArchiveHealth,
  listDisputeSimilarityReviewAuditArchiveFailures,
  requeueDisputeSimilarityReviewAuditArchive,
} from "./dispute-similarity-review-audit-archive.service.js";
import { runDisputeSimilarityReviewAuditArchiveAlert } from "../jobs/dispute-similarity-review-audit-archive-alert.js";
import { getDisputeSimilarityReviewAuditArchiveAlertDeliveryState } from "./dispute-similarity-review-audit-archive-alert.service.js";
import {
  claimVerifiedDisputeSimilarityArchiveAlert,
  verifyDisputeSimilarityReviewAuditArchiveAlert,
} from "./dispute-similarity-review-audit-archive-alert-verifier.service.js";
import { completeWebhookEvent } from "./webhook-event-claim.service.js";
import {
  decideDisputeEvidenceSimilarityReview,
  findNearestCommittedCameraEvidence,
  getDisputeEvidenceSimilarityReviewHealth,
  listDisputeEvidenceSimilarityReviews,
  updateDisputeEvidenceUploadSimilarity,
} from "./dispute-record.service.js";

async function baseFixture(width = 96, height = 64, quality = 95) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      data[offset] = Math.round((x / Math.max(1, width - 1)) * 255);
      data[offset + 1] = y < height / 2 ? 40 : 210;
      data[offset + 2] = x < width / 2 ? 220 : 30;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).jpeg({ quality }).toBuffer();
}

async function distinctFixture(width = 96, height = 64) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const block = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      data[offset] = block ? 240 : 10;
      data[offset + 1] = block ? 20 : 235;
      data[offset + 2] = (x * 13 + y * 7) % 256;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

export async function runDisputeImageSimilarityFixtureEvaluation(db?: Database) {
  const originalBytes = await baseFixture();
  const original = await computeImageSimilarityFingerprint(originalBytes);
  const variants = [
    { key: "recompressed", expectedReview: true, bytes: await baseFixture(192, 128, 45) },
    { key: "cropped", expectedReview: true, bytes: await sharp(originalBytes).extract({ left: 6, top: 4, width: 84, height: 56 }).resize(96, 64).jpeg({ quality: 70 }).toBuffer() },
    { key: "recolored", expectedReview: true, bytes: await sharp(originalBytes).tint({ r: 30, g: 220, b: 180 }).jpeg({ quality: 75 }).toBuffer() },
    { key: "different_structure", expectedReview: false, bytes: await distinctFixture() },
  ];
  const cases = await Promise.all(variants.map(async (variant) => {
    const assessment = assessImageSimilarity(await computeImageSimilarityFingerprint(variant.bytes), original);
    return {
      key: variant.key,
      expected_review: variant.expectedReview,
      actual_review: assessment.reviewRequired,
      pass: assessment.reviewRequired === variant.expectedReview,
      distances: { dhash: assessment.dHashDistance, ahash: assessment.aHashDistance, color: assessment.colorDistance },
      matched_signals: assessment.matchedSignals,
    };
  }));
  let persistence: {
    pass: boolean;
    nearest_review: boolean;
    stored: boolean;
    queue_detected: boolean;
    review_winners: number;
    review_blocked: number;
    review_audit_count: number;
    expired_review_blocked: boolean;
    reference_linked: boolean;
    health_attention: boolean;
    health_recovered: boolean;
    expiry_winners: number;
    expiry_event_count: number;
    system_actor_null: boolean;
    expiry_visible_in_health: boolean;
    expiry_history_detected: boolean;
    expiry_hash_valid: boolean;
    expiry_tamper_detected: boolean;
    expiry_export_valid: boolean;
    archive_enqueued: boolean;
    archive_duplicate: boolean;
    archive_delivered: boolean;
    archive_receipt_match: boolean;
    archive_dead_letter: boolean;
    archive_failure_queue: boolean;
    archive_requeued: boolean;
    archive_requeue_idempotent: boolean;
    archive_requeue_audit_count: number;
    archive_health_recovered: boolean;
    alert_firing_delivered: boolean;
    alert_firing_signature_valid: boolean;
    alert_recovery_delivered: boolean;
    alert_recovery_signature_valid: boolean;
    alert_recovery_duplicate_suppressed: boolean;
    alert_receiver_replay_blocked: boolean;
    alert_incident_closed: boolean;
    alert_claim_cleanup: number;
    archive_cleanup: number;
    archive_audit_cleanup: number;
    queue_cleared: boolean;
    stored_fields?: Record<string, boolean>;
    cleanup: number;
  } | null = null;
  if (db && typeof db.execute === "function") {
    const candidateId = randomUUID();
    const targetId = randomUUID();
    const expiryTargetId = randomUUID();
    const disputeId = randomUUID();
    const targetBytes = variants[0]!.bytes;
    const targetFingerprint = await computeImageSimilarityFingerprint(targetBytes);
    const alertClaimSource = `haggle-similarity-archive-alert-fixture-${randomUUID()}`;
    const alertReceiverSource = `haggle-similarity-archive-alert-receiver-fixture-${randomUUID()}`;
    const alertSecret = "cycle59-similarity-alert-fixture-secret";
    const capturedAlerts: Array<{ state: string; severity: string; verified: boolean; replayBlocked: boolean }> = [];
    const alertConfig = {
      url: "http://127.0.0.1:4177/mock-ops-alert", secret: alertSecret, timeoutMs: 1000,
      cooldownMinutes: 15, staleThreshold: 1, retryReadyThreshold: 5,
      deadLetterThreshold: 1, overdueUnfinishedThreshold: 1,
      allowInsecureHttp: true, allowPrivateNetwork: true,
    };
    const alertFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = String(init?.body ?? "");
      const timestamp = headers.get("x-haggle-alert-timestamp") ?? "";
      const parsed = JSON.parse(body) as { state?: string; severity?: string };
      const verification = verifyDisputeSimilarityReviewAuditArchiveAlert({
        rawBody: body,
        timestamp,
        signature: headers.get("x-haggle-alert-signature") ?? undefined,
        deliveryId: headers.get("x-haggle-alert-delivery-id") ?? undefined,
        secret: alertSecret,
        nowMs: Date.parse(timestamp),
      });
      let accepted = false;
      let replayBlocked = false;
      if (verification.ok) {
        const receiverClaim = await claimVerifiedDisputeSimilarityArchiveAlert(db, verification, alertReceiverSource);
        accepted = receiverClaim.outcome === "accepted";
        if (receiverClaim.outcome === "accepted") await completeWebhookEvent(db, receiverClaim.claim, 200);
        const replay = await claimVerifiedDisputeSimilarityArchiveAlert(db, verification, alertReceiverSource);
        replayBlocked = replay.outcome === "replay_or_in_progress";
      }
      capturedAlerts.push({
        state: String(parsed.state ?? ""), severity: String(parsed.severity ?? ""),
        verified: verification.ok && accepted,
        replayBlocked,
      });
      return new Response(verification.ok && accepted && replayBlocked ? "ok" : "invalid", {
        status: verification.ok && accepted && replayBlocked ? 200 : 401,
      });
    }) as typeof fetch;
    const healthBaseline = await getDisputeEvidenceSimilarityReviewHealth(db, { slaMinutes: 15, dueSoonMinutes: 60 });
    let cleanup = 0;
    let archiveRecordId: string | null = null;
    try {
      await db.execute(sql`
        INSERT INTO dispute_evidence_uploads
          (id, dispute_id, uploaded_by, evidence_type, content_type, file_size_bytes, storage_path,
           status, scan_status, content_sha256, camera_session_id, perceptual_hash, average_hash,
           color_histogram, similarity_status, expires_at)
        VALUES
          (${candidateId}::uuid, ${disputeId}::uuid, 'buyer', 'image', 'image/jpeg', ${originalBytes.length},
           ${`cycle48/${candidateId}.jpg`}, 'COMMITTED', 'CLEAN', ${createHash("sha256").update(originalBytes).digest("hex")},
           ${`cycle48-${candidateId}`}, ${original.dHash}, ${original.aHash}, ${JSON.stringify(original.colorHistogram)}::jsonb,
           'CLEAR', now() + interval '1 hour'),
          (${targetId}::uuid, ${disputeId}::uuid, 'buyer', 'image', 'image/jpeg', ${targetBytes.length},
           ${`cycle48/${targetId}.jpg`}, 'QUARANTINED', 'CLEAN', ${createHash("sha256").update(targetBytes).digest("hex")},
           ${`cycle48-${targetId}`}, NULL, NULL, NULL, 'PENDING', now() + interval '1 hour')
          ,(${expiryTargetId}::uuid, ${disputeId}::uuid, 'seller', 'image', 'image/jpeg', ${targetBytes.length},
           ${`cycle52/${expiryTargetId}.jpg`}, 'QUARANTINED', 'CLEAN', ${createHash("sha256").update(targetBytes).digest("hex")},
           ${`cycle52-${expiryTargetId}`}, ${targetFingerprint.dHash}, ${targetFingerprint.aHash}, ${JSON.stringify(targetFingerprint.colorHistogram)}::jsonb,
           'REVIEW_REQUIRED', now() - interval '1 minute')
      `);
      const nearest = await findNearestCommittedCameraEvidence(db, targetFingerprint);
      if (nearest) {
        await updateDisputeEvidenceUploadSimilarity(db, targetId, {
          perceptualHash: targetFingerprint.dHash,
          averageHash: targetFingerprint.aHash,
          colorHistogram: targetFingerprint.colorHistogram,
          status: nearest.assessment.reviewRequired ? "REVIEW_REQUIRED" : "CLEAR",
          distance: nearest.assessment.dHashDistance,
          signals: {
            candidate_upload_id: nearest.uploadId,
            distances: { dhash: nearest.assessment.dHashDistance, ahash: nearest.assessment.aHashDistance, color: nearest.assessment.colorDistance },
            matched_signals: nearest.assessment.matchedSignals,
          },
        });
      }
      const stored = await db.execute(sql`
        SELECT average_hash AS "averageHash", color_histogram AS "colorHistogram",
               similarity_signals AS "similaritySignals"
          FROM dispute_evidence_uploads WHERE id = ${targetId}::uuid
      `) as unknown as Array<Record<string, unknown>>;
      const reviewQueue = await listDisputeEvidenceSimilarityReviews(db, { limit: 100 });
      const queueDetected = reviewQueue.items.some((item) => item.uploadId === targetId && item.disputeId === disputeId);
      const referenceLinked = reviewQueue.items.some((item) => item.uploadId === targetId
        && item.matchedUploadId === candidateId && item.matchedStoragePath === `cycle48/${candidateId}.jpg`);
      await db.execute(sql`UPDATE dispute_evidence_uploads SET created_at = now() - interval '16 minutes' WHERE id = ${targetId}::uuid`);
      const healthBefore = await getDisputeEvidenceSimilarityReviewHealth(db, { slaMinutes: 15, dueSoonMinutes: 60 });
      const healthAttention = healthBefore.pendingReviews === healthBaseline.pendingReviews + 1
        && healthBefore.overdueSla === healthBaseline.overdueSla + 1;
      const reviewerId = randomUUID();
      await db.execute(sql`UPDATE dispute_evidence_uploads SET expires_at = now() - interval '1 second' WHERE id = ${targetId}::uuid`);
      const expiredReview = await decideDisputeEvidenceSimilarityReview(db, {
        disputeId,
        uploadId: targetId,
        reviewerId,
        decision: "approve",
        note: "Cycle 49 expired evidence guard fixture",
      });
      const expiredReviewBlocked = expiredReview.outcome === "not_pending";
      await db.execute(sql`UPDATE dispute_evidence_uploads SET expires_at = now() + interval '1 hour' WHERE id = ${targetId}::uuid`);
      const reviewResults = await Promise.all(Array.from({ length: 10 }, () => decideDisputeEvidenceSimilarityReview(db, {
        disputeId,
        uploadId: targetId,
        reviewerId,
        decision: "approve",
        note: "Cycle 49 concurrent similarity review fixture",
      })));
      const reviewWinners = reviewResults.filter((result) => result.outcome === "approved").length;
      const reviewBlocked = reviewResults.filter((result) => result.outcome === "not_pending").length;
      const auditRows = await db.execute(sql`
        SELECT count(*)::int AS count FROM admin_action_log
         WHERE action_type = 'dispute.evidence_similarity_review'
           AND target_type = 'dispute_evidence_upload' AND target_id = ${targetId}
      `) as unknown as Array<{ count: number }>;
      const reviewAuditCount = Number(auditRows[0]?.count ?? 0);
      const queueAfterDecision = await listDisputeEvidenceSimilarityReviews(db, { limit: 100 });
      const queueCleared = !queueAfterDecision.items.some((item) => item.uploadId === targetId);
      const expiryResults = await Promise.all(Array.from({ length: 10 }, () => expireDisputeSimilarityReviews(db, { batchSize: 50 })));
      const expiryWinners = expiryResults.reduce((sum, result) => sum + result.expired, 0);
      const expiryEvents = await db.execute(sql`
        SELECT id, actor_id AS "actorId", event_hash AS "eventHash" FROM dispute_evidence_similarity_review_events
         WHERE upload_id = ${expiryTargetId}::uuid AND event_type = 'AUTO_EXPIRED'
      `) as unknown as Array<{ id: string; actorId: string | null; eventHash: string | null }>;
      const expiredUpload = await db.execute(sql`
        SELECT status, similarity_status AS "similarityStatus", scan_detail AS "scanDetail"
          FROM dispute_evidence_uploads WHERE id = ${expiryTargetId}::uuid
      `) as unknown as Array<{ status: string; similarityStatus: string; scanDetail: string }>;
      const expiryEventCount = expiryEvents.length;
      const systemActorNull = expiryEvents.length === 1 && expiryEvents[0]?.actorId === null;
      const expiryHistory = await listDisputeSimilarityReviewExpiryEvents(db, { limit: 100 });
      const expiryHistoryDetected = expiryHistory.items.some((item) => item.uploadId === expiryTargetId
        && item.disputeId === disputeId && item.actorKind === "system" && item.reason === "REVIEW_WINDOW_EXPIRED");
      const expiryHistoryItem = expiryHistory.items.find((item) => item.uploadId === expiryTargetId);
      const expiryHashValid = expiryHistoryItem?.integrity === "valid" && Boolean(expiryHistoryItem.eventHash);
      let expiryExportValid = false;
      const { privateKey: expiryAuditPrivateKey } = generateKeyPairSync("ed25519");
      if (expiryHistoryItem?.eventHash) {
        const signed = createSignedDisputeSimilarityReviewAuditExport({
          event: expiryHistoryItem.hashable,
          storedEventHash: expiryHistoryItem.eventHash,
          generatedAt: new Date(),
          privateKey: expiryAuditPrivateKey,
        });
        expiryExportValid = verifySignedDisputeSimilarityReviewAuditExport(signed);
      }
      await db.execute(sql`
        UPDATE dispute_evidence_similarity_review_events
           SET metadata = jsonb_set(metadata, '{reason}', '"TAMPERED"'::jsonb)
         WHERE id = ${expiryEvents[0]?.id ?? null}::uuid
      `);
      const tamperedEvent = expiryEvents[0]?.id
        ? await getDisputeSimilarityReviewExpiryEventById(db, expiryEvents[0].id) : null;
      const expiryTamperDetected = tamperedEvent?.integrity === "invalid";
      await db.execute(sql`
        UPDATE dispute_evidence_similarity_review_events
           SET metadata = jsonb_set(metadata, '{reason}', '"REVIEW_WINDOW_EXPIRED"'::jsonb)
         WHERE id = ${expiryEvents[0]?.id ?? null}::uuid
      `);
      let archiveEnqueued = false;
      let archiveDuplicate = false;
      let archiveDelivered = false;
      let archiveReceiptMatch = false;
      let archiveDeadLetter = false;
      let archiveFailureQueue = false;
      let archiveRequeued = false;
      let archiveRequeueIdempotent = false;
      let archiveRequeueAuditCount = 0;
      let archiveHealthRecovered = false;
      let alertFiringDelivered = false;
      let alertFiringSignatureValid = false;
      let alertRecoveryDelivered = false;
      let alertRecoverySignatureValid = false;
      let alertRecoveryDuplicateSuppressed = false;
      let alertReceiverReplayBlocked = false;
      let alertIncidentClosed = false;
      if (expiryEvents[0]?.id) {
        const firstArchive = await enqueueDisputeSimilarityReviewAuditArchive(db, {
          eventId: expiryEvents[0].id, privateKey: expiryAuditPrivateKey,
        });
        archiveRecordId = firstArchive.archive.id;
        const duplicateArchive = await enqueueDisputeSimilarityReviewAuditArchive(db, {
          eventId: expiryEvents[0].id, privateKey: expiryAuditPrivateKey,
        });
        archiveEnqueued = firstArchive.outcome === "enqueued";
        archiveDuplicate = duplicateArchive.outcome === "duplicate"
          && duplicateArchive.archive.id === firstArchive.archive.id
          && duplicateArchive.archive.payloadSha256 === firstArchive.archive.payloadSha256;
        const mismatchFetch = (async () => new Response(JSON.stringify({
          receipt_id: "cycle56-mismatch", stored_sha256: "0".repeat(64),
        }), { status: 201, headers: { "content-type": "application/json" } })) as typeof fetch;
        await dispatchDisputeSimilarityReviewAuditArchives(db, {
          config: {
            url: "http://127.0.0.1:4177/mock-worm", timeoutMs: 1000, maxAttempts: 1,
            allowInsecureHttp: true, allowPrivateNetwork: true,
          },
          fetchImpl: mismatchFetch,
        });
        const criticalHealth = await getDisputeSimilarityReviewAuditArchiveHealth(db);
        const failures = await listDisputeSimilarityReviewAuditArchiveFailures(db, { limit: 100 });
        archiveDeadLetter = criticalHealth.status === "critical" && criticalHealth.deadLetter >= 1;
        archiveFailureQueue = failures.items.some((item) => item.eventId === expiryEvents[0]!.id && item.status === "DEAD_LETTER");
        const incidentAlert = await runDisputeSimilarityReviewAuditArchiveAlert(db, {
          config: alertConfig, claimSource: alertClaimSource, fetchImpl: alertFetch,
        });
        alertFiringDelivered = incidentAlert.status === "delivered";
        alertFiringSignatureValid = capturedAlerts[0]?.state === "firing"
          && capturedAlerts[0]?.severity === "critical" && capturedAlerts[0]?.verified === true;
        const requeueActorId = randomUUID();
        const requeue = await requeueDisputeSimilarityReviewAuditArchive(db, {
          eventId: expiryEvents[0].id, actorId: requeueActorId,
          reason: "Cycle 56 mock WORM endpoint recovered after receipt verification.",
        });
        const requeueAgain = await requeueDisputeSimilarityReviewAuditArchive(db, {
          eventId: expiryEvents[0].id, actorId: requeueActorId,
          reason: "Cycle 56 duplicate requeue must not create another audit row.",
        });
        archiveRequeued = requeue.outcome === "requeued"
          && requeue.archive.payloadSha256 === firstArchive.archive.payloadSha256;
        archiveRequeueIdempotent = requeueAgain.outcome === "already_queued";
        const requeueAudits = await db.execute(sql`
          SELECT count(*)::int AS count FROM admin_action_log
           WHERE action_type = 'dispute.similarity_review_audit_archive_requeue'
             AND target_id = ${firstArchive.archive.id}
        `) as unknown as Array<{ count: number }>;
        archiveRequeueAuditCount = Number(requeueAudits[0]?.count ?? 0);
        const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
          const headers = init?.headers as Record<string, string>;
          return new Response(JSON.stringify({
            receipt_id: "cycle55-worm-receipt",
            stored_sha256: headers["x-haggle-content-sha256"],
          }), { status: 201, headers: { "content-type": "application/json" } });
        }) as typeof fetch;
        const dispatch = await dispatchDisputeSimilarityReviewAuditArchives(db, {
          config: {
            url: "http://127.0.0.1:4177/mock-worm", timeoutMs: 1000, maxAttempts: 3,
            allowInsecureHttp: true, allowPrivateNetwork: true,
          },
          fetchImpl,
        });
        const archiveRows = await db.execute(sql`
          SELECT status, payload_sha256 AS "payloadSha256", receipt_sha256 AS "receiptSha256"
            FROM dispute_evidence_similarity_review_audit_outbox WHERE event_id = ${expiryEvents[0].id}::uuid
        `) as unknown as Array<{ status: string; payloadSha256: string; receiptSha256: string | null }>;
        archiveDelivered = dispatch.delivered === 1 && archiveRows[0]?.status === "DELIVERED";
        archiveReceiptMatch = archiveRows[0]?.receiptSha256 === archiveRows[0]?.payloadSha256;
        const recoveredHealth = await getDisputeSimilarityReviewAuditArchiveHealth(db);
        archiveHealthRecovered = recoveredHealth.status === "healthy" && recoveredHealth.deadLetter === 0
          && recoveredHealth.failed === 0 && recoveredHealth.processing === 0;
        const recoveryAlert = await runDisputeSimilarityReviewAuditArchiveAlert(db, {
          config: alertConfig, claimSource: alertClaimSource, fetchImpl: alertFetch,
        });
        const duplicateRecovery = await runDisputeSimilarityReviewAuditArchiveAlert(db, {
          config: alertConfig, claimSource: alertClaimSource, fetchImpl: alertFetch,
        });
        const alertDeliveryState = await getDisputeSimilarityReviewAuditArchiveAlertDeliveryState(db, alertClaimSource);
        alertRecoveryDelivered = recoveryAlert.status === "recovered";
        alertRecoverySignatureValid = capturedAlerts[1]?.state === "recovered"
          && capturedAlerts[1]?.severity === "recovery" && capturedAlerts[1]?.verified === true;
        alertRecoveryDuplicateSuppressed = duplicateRecovery.status === "skipped"
          && duplicateRecovery.reason === "recovery_already_sent_or_in_progress" && capturedAlerts.length === 2;
        alertReceiverReplayBlocked = capturedAlerts.length === 2
          && capturedAlerts.every((item) => item.replayBlocked);
        alertIncidentClosed = alertDeliveryState.incidentOpen === false
          && Boolean(alertDeliveryState.lastIncidentAlertAt) && Boolean(alertDeliveryState.lastRecoveryAlertAt);
      }
      const autoExpired = expiryWinners === 1 && expiredUpload[0]?.status === "EXPIRED"
        && expiredUpload[0]?.similarityStatus === "REJECTED"
        && expiredUpload[0]?.scanDetail === "CAMERA_SIMILARITY_REVIEW_EXPIRED";
      const healthAfter = await getDisputeEvidenceSimilarityReviewHealth(db, { slaMinutes: 15, dueSoonMinutes: 60 });
      const expiryVisibleInHealth = healthAfter.autoExpiredLast24Hours === healthBaseline.autoExpiredLast24Hours + 1
        && healthAfter.lastAutoExpiredAt !== null;
      const healthRecovered = healthAfter.pendingReviews === healthBaseline.pendingReviews
        && healthAfter.overdueSla === healthBaseline.overdueSla
        && healthAfter.expiredUnresolved === healthBaseline.expiredUnresolved;
      persistence = {
        pass: Boolean(
          nearest?.assessment.reviewRequired
          && stored[0]?.averageHash
          && stored[0]?.colorHistogram
          && stored[0]?.similaritySignals
          && queueDetected
          && referenceLinked
          && healthAttention
          && reviewWinners === 1
          && reviewBlocked === 9
          && reviewAuditCount === 1
          && expiredReviewBlocked
          && queueCleared
          && autoExpired
          && expiryEventCount === 1
          && systemActorNull
          && expiryHistoryDetected
          && expiryHashValid
          && expiryTamperDetected
          && expiryExportValid
          && archiveEnqueued
          && archiveDuplicate
          && archiveDelivered
          && archiveReceiptMatch
          && archiveDeadLetter
          && archiveFailureQueue
          && archiveRequeued
          && archiveRequeueIdempotent
          && archiveRequeueAuditCount === 1
          && archiveHealthRecovered
          && alertFiringDelivered
          && alertFiringSignatureValid
          && alertRecoveryDelivered
          && alertRecoverySignatureValid
          && alertRecoveryDuplicateSuppressed
          && alertReceiverReplayBlocked
          && alertIncidentClosed
          && expiryVisibleInHealth
          && healthRecovered
        ),
        nearest_review: nearest?.assessment.reviewRequired === true,
        stored: Boolean(stored[0]?.averageHash && stored[0]?.colorHistogram && stored[0]?.similaritySignals),
        queue_detected: queueDetected,
        review_winners: reviewWinners,
        review_blocked: reviewBlocked,
        review_audit_count: reviewAuditCount,
        expired_review_blocked: expiredReviewBlocked,
        reference_linked: referenceLinked,
        health_attention: healthAttention,
        health_recovered: healthRecovered,
        expiry_winners: expiryWinners,
        expiry_event_count: expiryEventCount,
        system_actor_null: systemActorNull,
        expiry_visible_in_health: expiryVisibleInHealth,
        expiry_history_detected: expiryHistoryDetected,
        expiry_hash_valid: expiryHashValid,
        expiry_tamper_detected: expiryTamperDetected,
        expiry_export_valid: expiryExportValid,
        archive_enqueued: archiveEnqueued,
        archive_duplicate: archiveDuplicate,
        archive_delivered: archiveDelivered,
        archive_receipt_match: archiveReceiptMatch,
        archive_dead_letter: archiveDeadLetter,
        archive_failure_queue: archiveFailureQueue,
        archive_requeued: archiveRequeued,
        archive_requeue_idempotent: archiveRequeueIdempotent,
        archive_requeue_audit_count: archiveRequeueAuditCount,
        archive_health_recovered: archiveHealthRecovered,
        alert_firing_delivered: alertFiringDelivered,
        alert_firing_signature_valid: alertFiringSignatureValid,
        alert_recovery_delivered: alertRecoveryDelivered,
        alert_recovery_signature_valid: alertRecoverySignatureValid,
        alert_recovery_duplicate_suppressed: alertRecoveryDuplicateSuppressed,
        alert_receiver_replay_blocked: alertReceiverReplayBlocked,
        alert_incident_closed: alertIncidentClosed,
        alert_claim_cleanup: 0,
        archive_cleanup: 0,
        archive_audit_cleanup: 0,
        queue_cleared: queueCleared,
        stored_fields: {
          average_hash: Boolean(stored[0]?.averageHash),
          color_histogram: Boolean(stored[0]?.colorHistogram),
          similarity_signals: Boolean(stored[0]?.similaritySignals),
        },
        cleanup: 0,
      };
    } finally {
      const deletedAlertClaims = await db.execute(sql`
        DELETE FROM webhook_idempotency
         WHERE source IN (${alertClaimSource}, ${alertReceiverSource})
        RETURNING id
      `) as unknown as Array<Record<string, unknown>>;
      if (persistence) persistence.alert_claim_cleanup = deletedAlertClaims.length;
      await db.execute(sql`
        DELETE FROM admin_action_log
         WHERE action_type = 'dispute.evidence_similarity_review'
           AND target_type = 'dispute_evidence_upload' AND target_id = ${targetId}
      `);
      const deletedArchiveAudits = await db.execute(sql`
        DELETE FROM admin_action_log
         WHERE action_type = 'dispute.similarity_review_audit_archive_requeue'
           AND target_id = ${archiveRecordId}
        RETURNING id
      `) as unknown as Array<Record<string, unknown>>;
      if (persistence) persistence.archive_audit_cleanup = deletedArchiveAudits.length;
      const deletedArchives = await db.execute(sql`
        DELETE FROM dispute_evidence_similarity_review_audit_outbox
         WHERE event_id IN (SELECT id FROM dispute_evidence_similarity_review_events WHERE upload_id = ${expiryTargetId}::uuid)
        RETURNING id
      `) as unknown as Array<Record<string, unknown>>;
      if (persistence) persistence.archive_cleanup = deletedArchives.length;
      await db.execute(sql`DELETE FROM dispute_evidence_similarity_review_events WHERE upload_id = ${expiryTargetId}::uuid`);
      const deleted = await db.execute(sql`DELETE FROM dispute_evidence_uploads WHERE id IN (${candidateId}::uuid, ${targetId}::uuid, ${expiryTargetId}::uuid) RETURNING id`) as unknown as Array<Record<string, unknown>>;
      cleanup = deleted.length;
      if (persistence) persistence.cleanup = cleanup;
    }
  }
  const passed = cases.filter((item) => item.pass).length
    + (persistence?.pass && persistence.cleanup === 3
      && persistence.archive_cleanup === 1 && persistence.archive_audit_cleanup === 1
      && persistence.alert_claim_cleanup === 4 ? 1 : 0);
  const total = cases.length + (persistence ? 1 : 0);
  return { pass: passed === total, checks: `${passed}/${total}`, cases, persistence };
}
