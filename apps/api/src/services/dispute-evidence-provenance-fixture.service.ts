import { generateKeyPairSync, randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import type { DisputeEvidenceDerivedArtifact } from "@haggle/dispute-core";
import { runDisputeEvidenceProvenanceArchiveAlert } from "../jobs/dispute-evidence-provenance-archive-alert.js";
import { normalizeDisputeAuditPublicKeyRecord } from "./dispute-audit-public-key-registry.service.js";
import {
  createSignedDisputeEvidenceProvenance,
  verifyTrustedDisputeEvidenceProvenance,
} from "./dispute-evidence-provenance.service.js";
import {
  dispatchDisputeEvidenceProvenanceArchives,
  enqueueDisputeEvidenceProvenanceArchive,
  listDisputeEvidenceProvenanceArchiveFailures,
  requeueDisputeEvidenceProvenanceArchive,
} from "./dispute-evidence-provenance-archive.service.js";
import {
  claimVerifiedDisputeEvidenceProvenanceArchiveAlert,
  verifyDisputeEvidenceProvenanceArchiveAlert,
} from "./dispute-evidence-provenance-archive-alert-verifier.service.js";
import { completeWebhookEvent } from "./webhook-event-claim.service.js";

export async function runDisputeEvidenceProvenanceFixture(db: Database) {
  const disputeRows = (await db.execute(
    sql`SELECT id FROM dispute_cases ORDER BY created_at DESC LIMIT 1`,
  )) as unknown as Array<{ id: string }>;
  const disputeId = disputeRows[0]?.id;
  if (!disputeId) throw new Error("EVIDENCE_PROVENANCE_FIXTURE_REQUIRES_DISPUTE");
  const evidenceId = randomUUID();
  const sourceContentSha256 = "a".repeat(64);
  const generatedAt = new Date();
  const { privateKey } = generateKeyPairSync("ed25519");
  const artifacts: DisputeEvidenceDerivedArtifact[] = [
    {
      id: `${evidenceId}:visual:1`,
      kind: "image_visual_observation",
      source_evidence_id: evidenceId,
      text: "렌즈 오른쪽 가장자리에 균열이 보입니다.",
      metadata: { category: "visible_damage", confidence: 0.91, provider: "fixture-vision" },
      created_at: generatedAt.toISOString(),
    },
  ];
  const provenance = createSignedDisputeEvidenceProvenance({
    disputeId,
    evidenceId,
    sourceContentSha256,
    verifierProvider: "fixture-vision",
    artifacts,
    generatedAt,
    privateKey,
  });
  const activeKey = normalizeDisputeAuditPublicKeyRecord({
    public_key_spki_base64: provenance.signature.public_key_spki_base64,
    status: "active",
    not_before: new Date(generatedAt.getTime() - 60_000).toISOString(),
  });
  const revokedKey = normalizeDisputeAuditPublicKeyRecord({
    public_key_spki_base64: provenance.signature.public_key_spki_base64,
    status: "revoked",
    not_before: new Date(generatedAt.getTime() - 60_000).toISOString(),
    revoked_at: new Date(generatedAt.getTime() + 60_000).toISOString(),
  });

  let stored = false;
  let trusted = false;
  let artifactTamperBlocked = false;
  let sourceSwapBlocked = false;
  let revokedKeyBlocked = false;
  let appendOnlyUpdateBlocked = false;
  let archiveEnqueued = false;
  let archiveDuplicate = false;
  let archivePayloadImmutable = false;
  let receiptMismatchDeadLettered = false;
  let archiveDelivered = false;
  let receiptMatched = false;
  let archiveSurvivedEvidenceDelete = false;
  let atomicRollbackClean = false;
  let failureQueueDetected = false;
  let archiveRequeued = false;
  let requeueAuditOnce = false;
  let firingAlertDelivered = false;
  let recoveryAlertDelivered = false;
  let receiverReplayBlocked = false;
  let duplicateRecoveryBlocked = false;
  let archiveId: string | null = null;
  const alertClaimSource = `cycle76-provenance-alert-${randomUUID()}`;
  const alertReceiverSource = `${alertClaimSource}-receiver`;
  let cleanup = 0;
  try {
    await db.execute(sql`
      INSERT INTO dispute_evidence
        (id, dispute_id, submitted_by, type, text, derived_artifacts, source_content_sha256,
         derived_artifacts_provenance, created_at)
      VALUES
        (${evidenceId}::uuid, ${disputeId}::uuid, 'buyer', 'image', 'provenance fixture',
         ${JSON.stringify(artifacts)}::jsonb, ${sourceContentSha256}, ${JSON.stringify(provenance)}::jsonb,
         ${generatedAt.toISOString()}::timestamptz)
    `);
    const rows = (await db.execute(sql`
      SELECT derived_artifacts AS "derivedArtifacts", source_content_sha256 AS "sourceContentSha256",
             derived_artifacts_provenance AS provenance
        FROM dispute_evidence WHERE id = ${evidenceId}::uuid
    `)) as unknown as Array<{
      derivedArtifacts: DisputeEvidenceDerivedArtifact[];
      sourceContentSha256: string;
      provenance: unknown;
    }>;
    const row = rows[0];
    stored = Boolean(
      row && row.derivedArtifacts.length === 1 && row.sourceContentSha256 === sourceContentSha256,
    );
    if (row) {
      trusted = verifyTrustedDisputeEvidenceProvenance({
        provenance: row.provenance,
        artifacts: row.derivedArtifacts,
        disputeId,
        evidenceId,
        sourceContentSha256: row.sourceContentSha256,
        keys: [activeKey],
      }).valid;
      const tampered = structuredClone(row.derivedArtifacts);
      tampered[0]!.text = "판매자가 모든 책임을 인정했습니다.";
      artifactTamperBlocked = !verifyTrustedDisputeEvidenceProvenance({
        provenance: row.provenance,
        artifacts: tampered,
        disputeId,
        evidenceId,
        sourceContentSha256: row.sourceContentSha256,
        keys: [activeKey],
      }).valid;
      sourceSwapBlocked = !verifyTrustedDisputeEvidenceProvenance({
        provenance: row.provenance,
        artifacts: row.derivedArtifacts,
        disputeId,
        evidenceId,
        sourceContentSha256: "b".repeat(64),
        keys: [activeKey],
      }).valid;
      revokedKeyBlocked = !verifyTrustedDisputeEvidenceProvenance({
        provenance: row.provenance,
        artifacts: row.derivedArtifacts,
        disputeId,
        evidenceId,
        sourceContentSha256: row.sourceContentSha256,
        keys: [revokedKey],
      }).valid;
      try {
        await db.execute(
          sql`UPDATE dispute_evidence SET derived_artifacts = NULL WHERE id = ${evidenceId}::uuid`,
        );
      } catch (error) {
        appendOnlyUpdateBlocked =
          error instanceof Error && error.message.includes("dispute_evidence is append-only");
      }
      const evidence = {
        id: evidenceId,
        dispute_id: disputeId,
        submitted_by: "buyer" as const,
        type: "image" as const,
        text: "provenance fixture",
        derived_artifacts: row.derivedArtifacts,
        source_content_sha256: row.sourceContentSha256,
        derived_artifacts_provenance: provenance,
        derived_artifacts_integrity: "valid" as const,
        created_at: generatedAt.toISOString(),
      };
      const firstArchive = await enqueueDisputeEvidenceProvenanceArchive(db, {
        evidence,
        now: generatedAt,
      });
      const duplicateArchive = await enqueueDisputeEvidenceProvenanceArchive(db, {
        evidence,
        now: generatedAt,
      });
      archiveId = firstArchive.archive.id;
      archiveEnqueued = firstArchive.outcome === "enqueued";
      archiveDuplicate =
        duplicateArchive.outcome === "duplicate" && duplicateArchive.archive.id === archiveId;
      try {
        await db.execute(sql`
          UPDATE dispute_evidence_provenance_archive_outbox SET payload = '{}'::jsonb WHERE id = ${archiveId}::uuid
        `);
      } catch (error) {
        archivePayloadImmutable =
          error instanceof Error &&
          error.message.includes("dispute evidence provenance archive payload is immutable");
      }
      const archiveConfig = {
        url: "http://127.0.0.1:4177/mock-worm",
        timeoutMs: 1000,
        maxAttempts: 1,
        allowInsecureHttp: true,
        allowPrivateNetwork: true,
      };
      const mismatchFetch = (async () =>
        new Response(
          JSON.stringify({
            receipt_id: "cycle74-bad-receipt",
            stored_sha256: "0".repeat(64),
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        )) as typeof fetch;
      const failed = await dispatchDisputeEvidenceProvenanceArchives(db, {
        config: archiveConfig,
        fetchImpl: mismatchFetch,
        now: new Date(generatedAt.getTime() + 10),
        archiveId,
      });
      receiptMismatchDeadLettered = failed.deadLettered === 1;
      const alertConfig = {
        url: "http://127.0.0.1:4177/mock-ops-alert",
        secret: "cycle76-provenance-alert-secret",
        timeoutMs: 1000,
        cooldownMinutes: 15,
        coverageGapThreshold: 1,
        staleThreshold: 1,
        retryReadyThreshold: 1,
        deadLetterThreshold: 1,
        allowInsecureHttp: true,
        allowPrivateNetwork: true,
      };
      const alertStates: string[] = [];
      const alertFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const rawBody = String(init?.body ?? "");
        const verification = verifyDisputeEvidenceProvenanceArchiveAlert({
          rawBody,
          timestamp: headers.get("x-haggle-alert-timestamp") ?? undefined,
          signature: headers.get("x-haggle-alert-signature") ?? undefined,
          deliveryId: headers.get("x-haggle-alert-delivery-id") ?? undefined,
          secret: alertConfig.secret,
          nowMs: Date.parse(headers.get("x-haggle-alert-timestamp") ?? ""),
        });
        if (!verification.ok) return new Response("invalid", { status: 401 });
        const accepted = await claimVerifiedDisputeEvidenceProvenanceArchiveAlert(
          db,
          verification,
          alertReceiverSource,
        );
        if (accepted.outcome !== "accepted") return new Response("conflict", { status: 409 });
        await completeWebhookEvent(db, accepted.claim, 202);
        const replay = await claimVerifiedDisputeEvidenceProvenanceArchiveAlert(
          db,
          verification,
          alertReceiverSource,
        );
        receiverReplayBlocked = receiverReplayBlocked || replay.outcome === "replay_or_in_progress";
        const parsed = JSON.parse(rawBody) as { state?: string };
        alertStates.push(String(parsed.state ?? ""));
        return new Response("accepted", { status: 202 });
      }) as typeof fetch;
      const firing = await runDisputeEvidenceProvenanceArchiveAlert(db, {
        config: alertConfig,
        fetchImpl: alertFetch,
        claimSource: alertClaimSource,
        now: new Date(generatedAt.getTime() + 12),
      });
      firingAlertDelivered =
        firing.status === "delivered" &&
        firing.assessment.severity === "critical" &&
        firing.assessment.reasons.includes("evidence_provenance_archive_dead_letter") &&
        alertStates[0] === "firing";
      const failures = await listDisputeEvidenceProvenanceArchiveFailures(db, {
        limit: 100,
        now: new Date(generatedAt.getTime() + 15),
      });
      failureQueueDetected = failures.items.some(
        (item) =>
          item.archiveId === archiveId &&
          item.status === "DEAD_LETTER" &&
          item.payloadSha256 === firstArchive.archive.payloadSha256,
      );
      const requeued = await requeueDisputeEvidenceProvenanceArchive(db, {
        archiveId,
        actorId: "99999999-9999-4999-8999-999999999999",
        reason: "Cycle 75 confirmed that the external WORM receipt service recovered.",
        now: new Date(generatedAt.getTime() + 20),
      });
      const duplicateRequeue = await requeueDisputeEvidenceProvenanceArchive(db, {
        archiveId,
        actorId: "99999999-9999-4999-8999-999999999999",
        reason: "Cycle 75 duplicate operator retry must remain idempotent.",
        now: new Date(generatedAt.getTime() + 21),
      });
      archiveRequeued =
        requeued.outcome === "requeued" &&
        duplicateRequeue.outcome === "already_queued" &&
        requeued.archive.payloadSha256 === firstArchive.archive.payloadSha256;
      const auditRows = (await db.execute(sql`
        SELECT count(*)::int AS count FROM admin_action_log
         WHERE action_type = 'dispute.evidence_provenance_archive_requeue' AND target_id = ${archiveId}
      `)) as unknown as Array<{ count: number }>;
      requeueAuditOnce = auditRows[0]?.count === 1;
      const receiptFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        return new Response(
          JSON.stringify({
            receipt_id: "cycle74-provenance-receipt",
            stored_sha256: headers.get("x-haggle-content-sha256"),
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;
      const delivered = await dispatchDisputeEvidenceProvenanceArchives(db, {
        config: { ...archiveConfig, maxAttempts: 3 },
        fetchImpl: receiptFetch,
        now: new Date(generatedAt.getTime() + 30),
        archiveId,
      });
      const deliveredRows = (await db.execute(sql`
        SELECT status, payload_sha256, receipt_sha256 FROM dispute_evidence_provenance_archive_outbox
         WHERE id = ${archiveId}::uuid
      `)) as unknown as Array<{
        status: string;
        payload_sha256: string;
        receipt_sha256: string | null;
      }>;
      archiveDelivered = delivered.delivered === 1 && deliveredRows[0]?.status === "DELIVERED";
      receiptMatched = deliveredRows[0]?.receipt_sha256 === deliveredRows[0]?.payload_sha256;
      await db.execute(sql`DELETE FROM dispute_evidence WHERE id = ${evidenceId}::uuid`);
      const survivor = (await db.execute(sql`
        SELECT count(*)::int AS count FROM dispute_evidence_provenance_archive_outbox WHERE id = ${archiveId}::uuid
      `)) as unknown as Array<{ count: number }>;
      archiveSurvivedEvidenceDelete = survivor[0]?.count === 1;
      const recovery = await runDisputeEvidenceProvenanceArchiveAlert(db, {
        config: alertConfig,
        fetchImpl: alertFetch,
        claimSource: alertClaimSource,
        now: new Date(generatedAt.getTime() + 40),
      });
      const duplicateRecovery = await runDisputeEvidenceProvenanceArchiveAlert(db, {
        config: alertConfig,
        fetchImpl: alertFetch,
        claimSource: alertClaimSource,
        now: new Date(generatedAt.getTime() + 41),
      });
      recoveryAlertDelivered = recovery.status === "recovered" && alertStates[1] === "recovered";
      duplicateRecoveryBlocked =
        duplicateRecovery.status === "skipped" &&
        duplicateRecovery.reason === "recovery_already_sent_or_in_progress";

      const rollbackEvidenceId = randomUUID();
      const rollbackArtifacts: DisputeEvidenceDerivedArtifact[] = [
        {
          ...artifacts[0]!,
          id: `${rollbackEvidenceId}:visual:1`,
          source_evidence_id: rollbackEvidenceId,
        },
      ];
      const rollbackProvenance = createSignedDisputeEvidenceProvenance({
        disputeId,
        evidenceId: rollbackEvidenceId,
        sourceContentSha256,
        verifierProvider: "fixture-vision",
        artifacts: rollbackArtifacts,
        generatedAt,
        privateKey,
      });
      try {
        await db.transaction(async (transaction) => {
          const tx = transaction as unknown as Database;
          await tx.execute(sql`
            INSERT INTO dispute_evidence
              (id, dispute_id, submitted_by, type, text, derived_artifacts, source_content_sha256,
               derived_artifacts_provenance, created_at)
            VALUES (${rollbackEvidenceId}::uuid, ${disputeId}::uuid, 'buyer', 'image', 'rollback fixture',
              ${JSON.stringify(rollbackArtifacts)}::jsonb, ${sourceContentSha256}, ${JSON.stringify(rollbackProvenance)}::jsonb,
              ${generatedAt.toISOString()}::timestamptz)
          `);
          await enqueueDisputeEvidenceProvenanceArchive(tx, {
            evidence: {
              id: rollbackEvidenceId,
              dispute_id: disputeId,
              submitted_by: "buyer",
              type: "image",
              text: "rollback fixture",
              derived_artifacts: rollbackArtifacts,
              source_content_sha256: sourceContentSha256,
              derived_artifacts_provenance: rollbackProvenance,
              created_at: generatedAt.toISOString(),
            },
            now: generatedAt,
          });
          throw new Error("CYCLE74_FORCE_ATOMIC_ROLLBACK");
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "CYCLE74_FORCE_ATOMIC_ROLLBACK")
          throw error;
      }
      const rollbackRows = (await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM dispute_evidence WHERE id = ${rollbackEvidenceId}::uuid) AS evidence_count,
          (SELECT count(*)::int FROM dispute_evidence_provenance_archive_outbox
            WHERE evidence_id = ${rollbackEvidenceId}::uuid) AS archive_count
      `)) as unknown as Array<{ evidence_count: number; archive_count: number }>;
      atomicRollbackClean =
        rollbackRows[0]?.evidence_count === 0 && rollbackRows[0]?.archive_count === 0;
    }
  } finally {
    const deleted = (await db.execute(
      sql`DELETE FROM dispute_evidence WHERE id = ${evidenceId}::uuid RETURNING id`,
    )) as unknown as unknown[];
    const archiveDeleted = archiveId
      ? ((await db.execute(
          sql`DELETE FROM dispute_evidence_provenance_archive_outbox WHERE id = ${archiveId}::uuid RETURNING id`,
        )) as unknown as unknown[])
      : [];
    const auditDeleted = archiveId
      ? ((await db.execute(sql`
          DELETE FROM admin_action_log WHERE action_type = 'dispute.evidence_provenance_archive_requeue'
            AND target_id = ${archiveId} RETURNING id
        `)) as unknown as unknown[])
      : [];
    const alertClaimsDeleted = (await db.execute(sql`
      DELETE FROM webhook_idempotency WHERE source IN (${alertClaimSource}, ${alertReceiverSource}) RETURNING id
    `)) as unknown as unknown[];
    cleanup =
      deleted.length + archiveDeleted.length + auditDeleted.length + alertClaimsDeleted.length;
  }
  const checks = {
    stored,
    trusted,
    artifact_tamper_blocked: artifactTamperBlocked,
    source_swap_blocked: sourceSwapBlocked,
    revoked_key_blocked: revokedKeyBlocked,
    append_only_update_blocked: appendOnlyUpdateBlocked,
    archive_enqueued: archiveEnqueued,
    archive_duplicate_idempotent: archiveDuplicate,
    archive_payload_immutable: archivePayloadImmutable,
    receipt_mismatch_dead_lettered: receiptMismatchDeadLettered,
    archive_delivered: archiveDelivered,
    receipt_matched: receiptMatched,
    archive_survived_evidence_delete: archiveSurvivedEvidenceDelete,
    atomic_rollback_clean: atomicRollbackClean,
    failure_queue_detected: failureQueueDetected,
    archive_requeued: archiveRequeued,
    requeue_audit_once: requeueAuditOnce,
    firing_alert_delivered: firingAlertDelivered,
    recovery_alert_delivered: recoveryAlertDelivered,
    receiver_replay_blocked: receiverReplayBlocked,
    duplicate_recovery_blocked: duplicateRecoveryBlocked,
    cleanup: cleanup === 6,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return {
    pass: passed === Object.keys(checks).length,
    checks: `${passed}/${Object.keys(checks).length}`,
    ...checks,
    key_id: activeKey.key_id,
    trust_boundary:
      "DB content is trusted only when the artifact digest, source file hash, signature, and registry key state all match.",
  };
}
