import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { INPUT_LIMITS } from "../lib/input-limits.js";
import { requireAdmin } from "../middleware/require-auth.js";
import {
  claimVerifiedDisputeSimilarityArchiveAlert,
  getDisputeSimilarityArchiveAlertReceiverHealth,
  getDisputeSimilarityArchiveAlertReceiverPolicyStatus,
  resolveDisputeSimilarityArchiveAlertReceiverSecretsFromEnv,
  verifyDisputeSimilarityReviewAuditArchiveAlert,
} from "../services/dispute-similarity-review-audit-archive-alert-verifier.service.js";
import { completeWebhookEvent, failWebhookEvent } from "../services/webhook-event-claim.service.js";
import {
  claimVerifiedDisputeAiArchiveAlert, getDisputeAiArchiveAlertReceiverHealth,
  getDisputeAiArchiveAlertReceiverPolicyStatus, resolveDisputeAiArchiveAlertReceiverSecretsFromEnv,
  verifyDisputeAiAuditArchiveAlert,
} from "../services/dispute-ai-audit-archive-alert-verifier.service.js";
import {
  disputeAuditPublicKeyRegistryDocument, resolveDisputeAuditPublicKeyRegistryFromEnv,
} from "../services/dispute-audit-public-key-registry.service.js";
import {
  claimVerifiedDisputeEvidenceProvenanceArchiveAlert,
  getDisputeEvidenceProvenanceArchiveAlertReceiverHealth,
  getDisputeEvidenceProvenanceArchiveAlertReceiverPolicyStatus,
  resolveDisputeEvidenceProvenanceArchiveAlertReceiverSecretsFromEnv,
  verifyDisputeEvidenceProvenanceArchiveAlert,
} from "../services/dispute-evidence-provenance-archive-alert-verifier.service.js";
import {
  claimVerifiedConditionalSettlementPreflightAlert,
  getConditionalSettlementPreflightAlertReceiverHealth,
  getConditionalSettlementPreflightAlertReceiverPolicyStatus,
  resolveConditionalSettlementPreflightAlertReceiverSecretsFromEnv,
  verifyConditionalSettlementPreflightAlert,
} from "../services/conditional-settlement-preflight-alert-verifier.service.js";
import {
  claimVerifiedConditionalSettlementFinalityAlert, getConditionalSettlementFinalityAlertReceiverHealth,
  getConditionalSettlementFinalityAlertReceiverPolicyStatus, resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv,
  verifyConditionalSettlementFinalityAlert,
} from "../services/conditional-settlement-finality-alert-verifier.service.js";
import {
  claimVerifiedWebhookClaimHealthAlert, getWebhookClaimAlertReceiverHealth, getWebhookClaimAlertReceiverPolicyStatus,
  resolveWebhookClaimAlertReceiverSecretsFromEnv, verifyWebhookClaimHealthAlert,
} from "../services/webhook-claim-alert-verifier.service.js";
import {
  claimDisputeEvidenceScanRetryAlert,
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_HEALTH_PATH,
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_PATH,
  getDisputeEvidenceScanRetryAlertReceiverHealth,
  getDisputeEvidenceScanRetryAlertReceiverPolicyStatus,
  resolveDisputeEvidenceScanRetryAlertReceiverSecretsFromEnv,
  verifyDisputeEvidenceScanRetryAlert,
} from "../services/dispute-evidence-scan-retry-alert-verifier.service.js";

const BAD_REQUEST_ERRORS = new Set(["INVALID_DELIVERY_ID", "INVALID_ALERT_TIMESTAMP", "INVALID_ALERT_BODY", "ALERT_DELIVERY_ID_MISMATCH"]);

export function registerOpsAlertRoutes(app: FastifyInstance, db: Database) {
  app.post("/internal/ops/alerts/webhook-claim-health", { config: { rawBody: true } }, async (request, reply) => {
    let secrets: string[];
    try { secrets = resolveWebhookClaimAlertReceiverSecretsFromEnv(); }
    catch { return reply.code(503).send({ error: "OPS_ALERT_RECEIVER_INVALID_CONFIGURATION" }); }
    if (!secrets.length) return reply.code(503).send({ error: "OPS_ALERT_RECEIVER_NOT_CONFIGURED" });
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) return reply.code(400).send({ error: "MISSING_RAW_BODY" });
    const verification = verifyWebhookClaimHealthAlert({ rawBody,
      timestamp: request.headers["x-haggle-alert-timestamp"], signature: request.headers["x-haggle-alert-signature"],
      deliveryId: request.headers["x-haggle-alert-delivery-id"], secret: secrets });
    if (!verification.ok) return reply.code(BAD_REQUEST_ERRORS.has(verification.error) ? 400 : 401).send({ error: verification.error });
    const delivery = await claimVerifiedWebhookClaimHealthAlert(db, verification);
    if (delivery.outcome === "payload_conflict") return reply.code(409).send({ error: "ALERT_DELIVERY_PAYLOAD_CONFLICT" });
    if (delivery.outcome === "replay_completed") return reply.send({ accepted: false, replayed: true, delivery_id: verification.deliveryId });
    if (delivery.outcome === "in_progress") return reply.header("retry-after", "2").code(503)
      .send({ error: "ALERT_DELIVERY_IN_PROGRESS", retry_after_seconds: 2 });
    if (delivery.outcome === "retry_backoff") return reply.header("retry-after", String(delivery.retryAfterSeconds)).code(503)
      .send({ error: "ALERT_RETRY_BACKOFF", retry_after_seconds: delivery.retryAfterSeconds });
    try {
      const completed = await completeWebhookEvent(db, delivery.claim, 202);
      if (!completed) throw new Error("ALERT_CLAIM_COMPLETION_FAILED");
    } catch {
      try { await failWebhookEvent(db, delivery.claim); } catch { /* Lease takeover remains the recovery path. */ }
      return reply.header("retry-after", "2").code(503).send({ error: "ALERT_CLAIM_COMPLETION_FAILED", retry_after_seconds: 2 });
    }
    return reply.code(202).send({ accepted: true, replayed: false, delivery_id: verification.deliveryId,
      state: verification.state, severity: verification.severity });
  });

  app.get("/admin/ops/alerts/webhook-claim-health/health", { preHandler: [requireAdmin] }, async (_request, reply) => reply.send({
    receiver_kind: "webhook_claim_health", receiver_health: await getWebhookClaimAlertReceiverHealth(db),
    receiver_policy: getWebhookClaimAlertReceiverPolicyStatus(),
  }));

  app.post(
    DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_PATH,
    {
      bodyLimit: INPUT_LIMITS.jsonPayloadBytes,
      config: { rawBody: true },
      onRequest: async (_request, reply) => {
        reply.header("Cache-Control", "no-store");
      },
    },
    async (request, reply) => {
      const contentType = request.headers["content-type"]
        ?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        return reply.code(415).send({ error: "UNSUPPORTED_MEDIA_TYPE" });
      }
      let secrets: string[];
      try {
        secrets = resolveDisputeEvidenceScanRetryAlertReceiverSecretsFromEnv();
      } catch {
        return reply.code(503).send({
          error: "OPS_ALERT_RECEIVER_INVALID_CONFIGURATION",
        });
      }
      if (!secrets.length) {
        return reply.code(503).send({
          error: "OPS_ALERT_RECEIVER_NOT_CONFIGURED",
        });
      }
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        return reply.code(400).send({ error: "MISSING_RAW_BODY" });
      }
      const verification = verifyDisputeEvidenceScanRetryAlert({
        rawBody,
        timestamp: request.headers["x-haggle-alert-timestamp"],
        signature: request.headers["x-haggle-alert-signature"],
        deliveryId: request.headers["x-haggle-alert-delivery-id"],
        secret: secrets,
      });
      if (!verification.ok) {
        return reply.code(BAD_REQUEST_ERRORS.has(verification.error) ? 400 : 401)
          .send({ error: verification.error });
      }
      let delivery;
      try {
        delivery = await claimDisputeEvidenceScanRetryAlert(db, verification);
      } catch {
        request.log.error({
          event: "dispute_evidence_scan_retry_alert_receiver_claim_failed",
        }, "scan retry alert receiver claim failed");
        return reply.header("retry-after", "2").code(503).send({
          error: "ALERT_RECEIVER_UNAVAILABLE",
          retry_after_seconds: 2,
        });
      }
      if (delivery.outcome === "payload_conflict") {
        return reply.code(409).send({
          error: "ALERT_DELIVERY_PAYLOAD_CONFLICT",
        });
      }
      if (delivery.outcome === "duplicate") {
        return reply.send({
          accepted: false,
          replayed: true,
          delivery_id: verification.deliveryId,
        });
      }
      if (delivery.outcome === "in_progress") {
        return reply.header("retry-after", "2").code(503).send({
          error: "ALERT_DELIVERY_IN_PROGRESS",
          retry_after_seconds: 2,
        });
      }
      if (delivery.outcome === "retry_later") {
        return reply.header(
          "retry-after", String(delivery.retryAfterSeconds),
        ).code(503).send({
          error: "ALERT_RETRY_BACKOFF",
          retry_after_seconds: delivery.retryAfterSeconds,
        });
      }
      try {
        const completed = await completeWebhookEvent(db, delivery, 202);
        if (!completed) throw new Error("ALERT_CLAIM_COMPLETION_FAILED");
      } catch {
        try {
          await failWebhookEvent(db, delivery);
        } catch {
          // The expiring claim remains the recovery path if failure recording fails.
        }
        return reply.header("retry-after", "2").code(503).send({
          error: "ALERT_CLAIM_COMPLETION_FAILED",
          retry_after_seconds: 2,
        });
      }
      return reply.code(202).send({
        accepted: true,
        replayed: false,
        delivery_id: verification.deliveryId,
        state: verification.state,
        severity: verification.severity,
      });
    },
  );

  app.get(
    DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_RECEIVER_HEALTH_PATH,
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return reply.send({
          receiver_kind: "dispute_evidence_scan_retry",
          receiver_health:
            await getDisputeEvidenceScanRetryAlertReceiverHealth(db),
          receiver_policy:
            getDisputeEvidenceScanRetryAlertReceiverPolicyStatus(),
        });
      } catch {
        request.log.error({
          event: "dispute_evidence_scan_retry_alert_receiver_health_failed",
        }, "scan retry alert receiver health failed");
        return reply.code(503).send({
          error: "OPS_ALERT_RECEIVER_HEALTH_UNAVAILABLE",
        });
      }
    },
  );

  app.post("/internal/ops/alerts/conditional-settlement-finality", { config: { rawBody: true } }, async (request, reply) => {
    let secrets: string[];
    try { secrets = resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv(); }
    catch { return reply.code(503).send({ error: "OPS_ALERT_RECEIVER_INVALID_CONFIGURATION" }); }
    if (!secrets.length) return reply.code(503).send({ error: "OPS_ALERT_RECEIVER_NOT_CONFIGURED" });
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) return reply.code(400).send({ error: "MISSING_RAW_BODY" });
    const verification = verifyConditionalSettlementFinalityAlert({ rawBody,
      timestamp: request.headers["x-haggle-alert-timestamp"], signature: request.headers["x-haggle-alert-signature"],
      deliveryId: request.headers["x-haggle-alert-delivery-id"], secret: secrets });
    if (!verification.ok) return reply.code(BAD_REQUEST_ERRORS.has(verification.error) ? 400 : 401).send({ error: verification.error });
    const delivery = await claimVerifiedConditionalSettlementFinalityAlert(db, verification);
    if (delivery.outcome === "payload_conflict") return reply.code(409).send({ error: "ALERT_DELIVERY_PAYLOAD_CONFLICT" });
    if (delivery.outcome === "replay_completed") return reply.send({ accepted: false, replayed: true, delivery_id: verification.deliveryId });
    if (delivery.outcome === "in_progress") return reply.header("retry-after", "2").code(503)
      .send({ error: "ALERT_DELIVERY_IN_PROGRESS", retry_after_seconds: 2 });
    if (delivery.outcome === "retry_backoff") return reply.header("retry-after", String(delivery.retryAfterSeconds)).code(503)
      .send({ error: "ALERT_RETRY_BACKOFF", retry_after_seconds: delivery.retryAfterSeconds });
    try {
      const completed = await completeWebhookEvent(db, delivery.claim, 202);
      if (!completed) throw new Error("ALERT_CLAIM_COMPLETION_FAILED");
    } catch {
      try { await failWebhookEvent(db, delivery.claim); } catch { /* A later lease takeover remains the recovery path. */ }
      return reply.header("retry-after", "2").code(503).send({ error: "ALERT_CLAIM_COMPLETION_FAILED", retry_after_seconds: 2 });
    }
    return reply.code(202).send({ accepted: true, replayed: false, delivery_id: verification.deliveryId,
      state: verification.state, severity: verification.severity });
  });

  app.get("/admin/ops/alerts/conditional-settlement-finality/health", { preHandler: [requireAdmin] }, async (_request, reply) => reply.send({
    receiver_kind: "conditional_settlement_finality", receiver_health: await getConditionalSettlementFinalityAlertReceiverHealth(db),
    receiver_policy: getConditionalSettlementFinalityAlertReceiverPolicyStatus(),
  }));

  app.post(
    "/internal/ops/alerts/conditional-settlement-preflight",
    { config: { rawBody: true } },
    async (request, reply) => {
      const secrets = resolveConditionalSettlementPreflightAlertReceiverSecretsFromEnv();
      if (!secrets.length) return reply.code(503).send({ error: "OPS_ALERT_RECEIVER_NOT_CONFIGURED" });
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) return reply.code(400).send({ error: "MISSING_RAW_BODY" });
      const verification = verifyConditionalSettlementPreflightAlert({
        rawBody,
        timestamp: request.headers["x-haggle-alert-timestamp"],
        signature: request.headers["x-haggle-alert-signature"],
        deliveryId: request.headers["x-haggle-alert-delivery-id"],
        secret: secrets,
      });
      if (!verification.ok) return reply.code(BAD_REQUEST_ERRORS.has(verification.error) ? 400 : 401).send({ error: verification.error });
      const delivery = await claimVerifiedConditionalSettlementPreflightAlert(db, verification);
      if (delivery.outcome === "payload_conflict") return reply.code(409).send({ error: "ALERT_DELIVERY_PAYLOAD_CONFLICT" });
      if (delivery.outcome === "replay_or_in_progress") return reply.send({ accepted: false, replayed: true, delivery_id: verification.deliveryId });
      const completed = await completeWebhookEvent(db, delivery.claim, 202);
      if (!completed) return reply.code(503).send({ error: "ALERT_CLAIM_COMPLETION_FAILED" });
      return reply.code(202).send({ accepted: true, replayed: false, delivery_id: verification.deliveryId,
        state: verification.state, severity: verification.severity });
    },
  );

  app.get(
    "/admin/ops/alerts/conditional-settlement-preflight/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) => reply.send({
      receiver_kind: "conditional_settlement_preflight",
      receiver_health: await getConditionalSettlementPreflightAlertReceiverHealth(db),
      receiver_policy: getConditionalSettlementPreflightAlertReceiverPolicyStatus(),
    }),
  );

  app.get("/.well-known/haggle-dispute-audit-keys.json", async (_request, reply) => {
    try {
      const keys = resolveDisputeAuditPublicKeyRegistryFromEnv();
      if (!keys.length) return reply.code(503).send({ error: "DISPUTE_AUDIT_KEY_REGISTRY_NOT_CONFIGURED" });
      const document = disputeAuditPublicKeyRegistryDocument(keys);
      return reply.header("cache-control", "public, max-age=300").header("etag", `\"${document.registry_sha256}\"`).send(document);
    } catch {
      return reply.code(503).send({ error: "DISPUTE_AUDIT_KEY_REGISTRY_INVALID" });
    }
  });
  app.post(
    "/internal/ops/alerts/dispute-evidence-provenance-archive",
    { config: { rawBody: true } },
    async (request, reply) => {
      const secrets = resolveDisputeEvidenceProvenanceArchiveAlertReceiverSecretsFromEnv();
      if (!secrets.length) return reply.code(503).send({ error: "OPS_ALERT_RECEIVER_NOT_CONFIGURED" });
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) return reply.code(400).send({ error: "MISSING_RAW_BODY" });
      const verification = verifyDisputeEvidenceProvenanceArchiveAlert({ rawBody,
        timestamp: request.headers["x-haggle-alert-timestamp"], signature: request.headers["x-haggle-alert-signature"],
        deliveryId: request.headers["x-haggle-alert-delivery-id"], secret: secrets });
      if (!verification.ok) return reply.code(BAD_REQUEST_ERRORS.has(verification.error) ? 400 : 401).send({ error: verification.error });
      const delivery = await claimVerifiedDisputeEvidenceProvenanceArchiveAlert(db, verification);
      if (delivery.outcome === "payload_conflict") return reply.code(409).send({ error: "ALERT_DELIVERY_PAYLOAD_CONFLICT" });
      if (delivery.outcome === "replay_or_in_progress") return reply.send({ accepted: false, replayed: true, delivery_id: verification.deliveryId });
      await completeWebhookEvent(db, delivery.claim, 202);
      return reply.code(202).send({ accepted: true, replayed: false, delivery_id: verification.deliveryId,
        state: verification.state, severity: verification.severity });
    },
  );

  app.get(
    "/admin/ops/alerts/dispute-evidence-provenance-archive/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) => reply.send({ receiver_kind: "evidence_provenance_archive",
      receiver_health: await getDisputeEvidenceProvenanceArchiveAlertReceiverHealth(db),
      receiver_policy: getDisputeEvidenceProvenanceArchiveAlertReceiverPolicyStatus() }),
  );

  app.post(
    "/internal/ops/alerts/dispute-ai-audit-archive",
    { config: { rawBody: true } },
    async (request, reply) => {
      const secrets = resolveDisputeAiArchiveAlertReceiverSecretsFromEnv();
      if (!secrets.length) return reply.code(503).send({ error: "OPS_ALERT_RECEIVER_NOT_CONFIGURED" });
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) return reply.code(400).send({ error: "MISSING_RAW_BODY" });
      const verification = verifyDisputeAiAuditArchiveAlert({ rawBody,
        timestamp: request.headers["x-haggle-alert-timestamp"], signature: request.headers["x-haggle-alert-signature"],
        deliveryId: request.headers["x-haggle-alert-delivery-id"], secret: secrets });
      if (!verification.ok) return reply.code(BAD_REQUEST_ERRORS.has(verification.error) ? 400 : 401).send({ error: verification.error });
      const delivery = await claimVerifiedDisputeAiArchiveAlert(db, verification);
      if (delivery.outcome === "payload_conflict") return reply.code(409).send({ error: "ALERT_DELIVERY_PAYLOAD_CONFLICT" });
      if (delivery.outcome === "replay_or_in_progress") return reply.send({ accepted: false, replayed: true, delivery_id: verification.deliveryId });
      await completeWebhookEvent(db, delivery.claim, 202);
      return reply.code(202).send({ accepted: true, replayed: false, delivery_id: verification.deliveryId,
        state: verification.state, severity: verification.severity });
    },
  );

  app.get(
    "/admin/ops/alerts/dispute-ai-audit-archive/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) => reply.send({ receiver_kind: "ai_audit_archive", receiver_health: await getDisputeAiArchiveAlertReceiverHealth(db),
      receiver_policy: getDisputeAiArchiveAlertReceiverPolicyStatus() }),
  );
  app.post(
    "/internal/ops/alerts/dispute-similarity-review-audit-archive",
    { config: { rawBody: true } },
    async (request, reply) => {
      const secrets = resolveDisputeSimilarityArchiveAlertReceiverSecretsFromEnv();
      if (!secrets.length) return reply.code(503).send({ error: "OPS_ALERT_RECEIVER_NOT_CONFIGURED" });
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) return reply.code(400).send({ error: "MISSING_RAW_BODY" });
      const verification = verifyDisputeSimilarityReviewAuditArchiveAlert({
        rawBody,
        timestamp: request.headers["x-haggle-alert-timestamp"],
        signature: request.headers["x-haggle-alert-signature"],
        deliveryId: request.headers["x-haggle-alert-delivery-id"],
        secret: secrets,
      });
      if (!verification.ok) {
        return reply.code(BAD_REQUEST_ERRORS.has(verification.error) ? 400 : 401).send({ error: verification.error });
      }
      const delivery = await claimVerifiedDisputeSimilarityArchiveAlert(db, verification);
      if (delivery.outcome === "payload_conflict") return reply.code(409).send({ error: "ALERT_DELIVERY_PAYLOAD_CONFLICT" });
      if (delivery.outcome === "replay_or_in_progress") return reply.send({ accepted: false, replayed: true, delivery_id: verification.deliveryId });
      await completeWebhookEvent(db, delivery.claim, 202);
      return reply.code(202).send({
        accepted: true, replayed: false, delivery_id: verification.deliveryId,
        state: verification.state, severity: verification.severity,
      });
    },
  );

  app.get(
    "/admin/ops/alerts/dispute-similarity-review-audit-archive/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) => reply.send({
      receiver_kind: "similarity_review_audit_archive",
      receiver_health: await getDisputeSimilarityArchiveAlertReceiverHealth(db),
      receiver_policy: getDisputeSimilarityArchiveAlertReceiverPolicyStatus(),
    }),
  );
}
