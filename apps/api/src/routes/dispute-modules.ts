import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  computeModuleDisputeCost,
  createDepositRequirement,
  decideModuleDisputeOpen,
  DisputeService,
  normalizeDisputeModuleConfig,
  type DisputeModuleConfigInput,
  type DisputeReasonCode,
  type ModuleOpenDisputeRequest,
  type ModuleTransactionSnapshot,
  type DisputeTier,
} from "@haggle/dispute-core";
import {
  resolveDisputeModuleSecretsFromEnv,
  verifyDisputeModuleSignature,
} from "../services/dispute-module-auth.service.js";
import type { Database } from "@haggle/db";
import { INPUT_LIMITS } from "../lib/input-limits.js";
import {
  createDisputeModuleIdempotencyRecord,
  createDisputeRecord,
  getActiveDisputeByOrderId,
  getDisputeById,
  getDisputeModuleIdempotencyRecord,
  updateDisputeRecord,
} from "../services/dispute-record.service.js";
import {
  buildDisputeModuleWebhookEnvelope,
  createDisputeModuleWebhookOutboxRecord,
  deliverDisputeModuleWebhookOutboxRecord,
  type DisputeModuleWebhookEnvelope,
  type DisputeModuleWebhookOutboxRecord,
} from "../services/dispute-module-webhook.service.js";

const moduleTransactionSchema = z.object({
  platform_id: z.string().min(1).max(128),
  external_order_id: z.string().min(1).max(256),
  buyer_actor_id: z.string().min(1).max(256),
  seller_actor_id: z.string().min(1).max(256),
  amount_minor: z.number().int().positive(),
  currency: z.string().min(3).max(8),
  status: z.enum([
    "APPROVED",
    "PAYMENT_PENDING",
    "PAID",
    "FULFILLMENT_PENDING",
    "FULFILLMENT_ACTIVE",
    "DELIVERED",
    "IN_DISPUTE",
    "REFUNDED",
    "CLOSED",
    "CANCELED",
  ]),
  metadata: z.record(z.unknown()).optional(),
}).strict();

const moduleOpenRequestSchema = z.object({
  requester_actor_id: z.string().min(1).max(256),
  reason_code: z.string().min(1).max(INPUT_LIMITS.shortTextChars),
  summary: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars),
  client_request_id: z.string().min(1).max(128).optional(),
}).strict();

const moduleConfigSchema = z.object({
  tier1_rate: z.number().positive().optional(),
  tier2_rate: z.number().positive().optional(),
  tier3_rate: z.number().positive().optional(),
  tier1_min_cents: z.number().int().positive().optional(),
  tier2_min_cents: z.number().int().positive().optional(),
  tier3_min_cents: z.number().int().positive().optional(),
  reviewer_share: z.number().min(0).max(1).optional(),
  platform_share: z.number().min(0).max(1).optional(),
  allowed_open_statuses: z.array(moduleTransactionSchema.shape.status).min(1).optional(),
  use_shared_pool: z.boolean().optional(),
  haggle_network_fee_rate: z.number().min(0).optional(),
  ai_plaintiff_enabled: z.boolean().optional(),
  ai_defendant_enabled: z.boolean().optional(),
  ai_expert_witness_enabled: z.boolean().optional(),
}).strict().optional();

const previewSchema = z.object({
  transaction: moduleTransactionSchema,
  request: moduleOpenRequestSchema,
  config: z.never().optional(),
}).strict();

const createCaseSchema = previewSchema;

const escalationSchema = z.object({
  external_order_id: z.string().min(1).max(256),
  requester_actor_id: z.string().min(1).max(256),
  to_tier: z.union([z.literal(2), z.literal(3)]).optional(),
  reason: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars).optional(),
  client_request_id: z.string().min(1).max(128).optional(),
}).strict();

const statusSchema = z.object({
  external_order_id: z.string().min(1).max(256),
}).strict();

type ModuleCaseInput = z.infer<typeof createCaseSchema>;
type ModuleEscalationInput = z.infer<typeof escalationSchema>;

type PlatformConfigResult =
  | { ok: true; config: DisputeModuleConfigInput | undefined }
  | { ok: false; error: "INVALID_MODULE_PLATFORM_CONFIG" };

const ACTIVE_DISPUTE_STATUSES = new Set([
  "OPEN",
  "UNDER_REVIEW",
  "WAITING_FOR_BUYER",
  "WAITING_FOR_SELLER",
]);

function rawBodyForRequest(request: FastifyRequest): Buffer | string {
  const raw = (request as unknown as { rawBody?: Buffer }).rawBody;
  return raw ?? JSON.stringify(request.body ?? {});
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function moduleCreateRequestFingerprint(input: ModuleCaseInput): string {
  return `sha256:${createHash("sha256").update(stableJson(input)).digest("hex")}`;
}

function moduleEscalationRequestFingerprint(disputeId: string, input: ModuleEscalationInput): string {
  return `sha256:${createHash("sha256").update(stableJson({ dispute_id: disputeId, ...input })).digest("hex")}`;
}

function requestPath(request: FastifyRequest): string {
  return request.url.split("?")[0] || request.url;
}

function resolvePlatformModuleConfig(platformId: string): PlatformConfigResult {
  const raw = process.env.DISPUTE_MODULE_PLATFORM_CONFIGS;
  if (!raw) return { ok: true, config: undefined };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config = parsed[platformId];
    if (!config) return { ok: true, config: undefined };
    if (typeof config !== "object" || Array.isArray(config)) {
      return { ok: false, error: "INVALID_MODULE_PLATFORM_CONFIG" };
    }
    const parsedConfig = moduleConfigSchema.parse(config) as DisputeModuleConfigInput;
    return { ok: true, config: normalizeDisputeModuleConfig(parsedConfig) };
  } catch {
    return { ok: false, error: "INVALID_MODULE_PLATFORM_CONFIG" };
  }
}

function authenticateModuleRequest(request: FastifyRequest) {
  return verifyDisputeModuleSignature({
    method: request.method,
    path: requestPath(request),
    rawBody: rawBodyForRequest(request),
    platformId: request.headers["x-haggle-module-platform-id"],
    timestamp: request.headers["x-haggle-module-timestamp"],
    signature: request.headers["x-haggle-module-signature"],
    idempotencyKey: request.headers["x-haggle-idempotency-key"],
    secretResolver: resolveDisputeModuleSecretsFromEnv,
  });
}

function moduleOrderId(platformId: string, externalOrderId: string): string {
  const bytes = createHash("sha256")
    .update(`haggle:dispute-module:v1:${platformId}:${externalOrderId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isActiveDispute(status: string): boolean {
  return ACTIVE_DISPUTE_STATUSES.has(status);
}

function sameModuleIdempotency(dispute: { metadata?: Record<string, unknown> | null }, idempotencyKey: string): boolean {
  return dispute.metadata?.idempotency_key === idempotencyKey;
}

function sameModuleRequestFingerprint(
  dispute: { metadata?: Record<string, unknown> | null },
  requestFingerprint: string,
): boolean {
  return dispute.metadata?.request_fingerprint === requestFingerprint;
}

function disputeCosts(
  transaction: ModuleTransactionSnapshot,
  platformConfig: DisputeModuleConfigInput | undefined,
) {
  const tiers = [1, 2, 3] as DisputeTier[];
  return tiers.map((tier) => computeModuleDisputeCost(transaction.amount_minor, tier, platformConfig));
}

function currentDisputeTier(dispute: { metadata?: Record<string, unknown> | null }): DisputeTier {
  const tier = dispute.metadata?.tier;
  return tier === 2 || tier === 3 ? tier : 1;
}

function resolvedDisputeStatus(status: string): boolean {
  return !isActiveDispute(status);
}

function actorRoleInModuleTransaction(
  transaction: ModuleTransactionSnapshot,
  actorId: string,
): "buyer" | "seller" | null {
  if (transaction.buyer_actor_id === actorId) return "buyer";
  if (transaction.seller_actor_id === actorId) return "seller";
  return null;
}

function moduleDisputeTransactionSnapshot(dispute: {
  metadata?: Record<string, unknown> | null;
}): ModuleTransactionSnapshot | null {
  const snapshot = dispute.metadata?.transaction_snapshot;
  const parsed = moduleTransactionSchema.safeParse(snapshot);
  return parsed.success ? parsed.data as ModuleTransactionSnapshot : null;
}

function buildModuleEscalationPreview(params: {
  dispute: { id: string; status: string; metadata?: Record<string, unknown> | null };
  transaction: ModuleTransactionSnapshot;
  platformConfig: DisputeModuleConfigInput | undefined;
  toTier?: 2 | 3;
}) {
  const previousTier = currentDisputeTier(params.dispute);
  if (previousTier >= 3) {
    return { ok: false as const, status: 409, error: "MAX_TIER_REACHED" };
  }
  const newTier = params.toTier ?? ((previousTier + 1) as 2 | 3);
  if (newTier !== previousTier + 1) {
    return { ok: false as const, status: 409, error: "TIER_NOT_ADVANCING" };
  }
  const cost = computeModuleDisputeCost(params.transaction.amount_minor, newTier, params.platformConfig);
  const depositRequirement = createDepositRequirement(params.dispute.id, newTier, params.transaction.amount_minor);
  return {
    ok: true as const,
    previous_tier: previousTier,
    new_tier: newTier,
    cost,
    seller_deposit_requirement: {
      amount_cents: depositRequirement.amount_cents,
      deadline_hours: depositRequirement.deadline_hours,
      status: depositRequirement.seller_deposit.status,
    },
  };
}

function isModuleIdempotencyUniqueError(error: unknown): boolean {
  return error instanceof Error && /dispute_module_idem_platform_key_unique/i.test(error.message);
}

function isActiveDisputeUniqueError(error: unknown): boolean {
  return error instanceof Error && /dispute_cases_active_order_uidx/i.test(error.message);
}

export function registerDisputeModuleRoutes(app: FastifyInstance, db: Database) {
  const disputeService = new DisputeService();

  async function writeModuleDisputeOpen(
    dispute: ReturnType<typeof disputeService.openCase>["dispute"],
    idempotency: {
      platformId: string;
      idempotencyKey: string;
      requestFingerprint: string;
    },
    webhookEnvelope: DisputeModuleWebhookEnvelope,
  ): Promise<DisputeModuleWebhookOutboxRecord> {
    let webhookOutboxRecord: DisputeModuleWebhookOutboxRecord | null = null;
    const persist = async (tx: unknown) => {
      const txDb = tx as Database;
      await createDisputeRecord(txDb, dispute);
      await createDisputeModuleIdempotencyRecord(txDb, {
        ...idempotency,
        disputeId: dispute.id,
      });
      webhookOutboxRecord = await createDisputeModuleWebhookOutboxRecord(txDb, webhookEnvelope);
    };
    if (typeof db.transaction === "function") {
      await db.transaction(persist);
    } else {
      await persist(db);
    }
    if (!webhookOutboxRecord) {
      throw new Error("Failed to create dispute module webhook outbox record");
    }
    return webhookOutboxRecord;
  }

  app.post("/modules/disputes/v1/cases/preview", async (request, reply) => {
    const auth = authenticateModuleRequest(request);

    if (!auth.ok) {
      return reply.code(auth.status).send({ error: auth.error });
    }

    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_MODULE_REQUEST", issues: parsed.error.issues });
    }

    if (parsed.data.transaction.platform_id !== auth.platformId) {
      return reply.code(403).send({
        error: "PLATFORM_MISMATCH",
        message: "Signed platform id does not match transaction platform_id",
      });
    }

    const platformConfigResult = resolvePlatformModuleConfig(auth.platformId);
    if (!platformConfigResult.ok) {
      return reply.code(500).send({ error: platformConfigResult.error });
    }
    const platformConfig = platformConfigResult.config;
    const decision = decideModuleDisputeOpen(
      parsed.data.transaction as ModuleTransactionSnapshot,
      parsed.data.request as ModuleOpenDisputeRequest,
      platformConfig,
    );
    if (!decision.ok) {
      const status = decision.error === "FORBIDDEN" ? 403 : decision.error === "ORDER_NOT_DISPUTABLE" ? 409 : 400;
      return reply.code(status).send({ error: decision.error, message: decision.message });
    }

    const costs = disputeCosts(parsed.data.transaction as ModuleTransactionSnapshot, platformConfig);

    return reply.send({
      ok: true,
      platform_id: auth.platformId,
      idempotency_key: auth.idempotencyKey,
      opened_by: decision.opened_by,
      external_order_id: parsed.data.transaction.external_order_id,
      costs,
      config: {
        use_shared_pool: decision.config.use_shared_pool,
        reviewer_share: decision.config.reviewer_share,
        platform_share: decision.config.platform_share,
      },
    });
  });

  app.post("/modules/disputes/v1/cases", async (request, reply) => {
    const auth = authenticateModuleRequest(request);
    if (!auth.ok) {
      return reply.code(auth.status).send({ error: auth.error });
    }

    const parsed = createCaseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_MODULE_REQUEST", issues: parsed.error.issues });
    }

    const input = parsed.data as ModuleCaseInput;
    if (input.transaction.platform_id !== auth.platformId) {
      return reply.code(403).send({
        error: "PLATFORM_MISMATCH",
        message: "Signed platform id does not match transaction platform_id",
      });
    }

    const requestFingerprint = moduleCreateRequestFingerprint(input);
    const idempotencyRecord = await getDisputeModuleIdempotencyRecord(
      db,
      auth.platformId,
      auth.idempotencyKey,
    );
    if (idempotencyRecord) {
      if (idempotencyRecord.requestFingerprint !== requestFingerprint) {
        return reply.code(409).send({
          error: "IDEMPOTENCY_KEY_REUSED",
          message: "This idempotency key was already used for a different module dispute request",
        });
      }
      const replay = await getDisputeById(db, idempotencyRecord.disputeId);
      if (replay) {
        return reply.send({
          ok: true,
          dispute: replay,
          platform_id: auth.platformId,
          external_order_id: input.transaction.external_order_id,
          idempotency_key: auth.idempotencyKey,
          idempotent: true,
        });
      }
      return reply.code(409).send({
        error: "IDEMPOTENCY_REPLAY_UNAVAILABLE",
        message: "This idempotency key is already reserved but the dispute is not readable yet",
      });
    }

    const platformConfigResult = resolvePlatformModuleConfig(auth.platformId);
    if (!platformConfigResult.ok) {
      return reply.code(500).send({ error: platformConfigResult.error });
    }
    const platformConfig = platformConfigResult.config;
    const decision = decideModuleDisputeOpen(
      input.transaction as ModuleTransactionSnapshot,
      input.request as ModuleOpenDisputeRequest,
      platformConfig,
    );
    if (!decision.ok) {
      const status = decision.error === "FORBIDDEN" ? 403 : decision.error === "ORDER_NOT_DISPUTABLE" ? 409 : 400;
      return reply.code(status).send({ error: decision.error, message: decision.message });
    }

    const orderId = moduleOrderId(auth.platformId, input.transaction.external_order_id);
    const existing = await getActiveDisputeByOrderId(db, orderId);
    if (existing && isActiveDispute(existing.status)) {
      if (
        sameModuleIdempotency(existing, auth.idempotencyKey) &&
        sameModuleRequestFingerprint(existing, requestFingerprint)
      ) {
        return reply.send({
          ok: true,
          dispute: existing,
          platform_id: auth.platformId,
          external_order_id: input.transaction.external_order_id,
          idempotency_key: auth.idempotencyKey,
          idempotent: true,
        });
      }
      return reply.code(409).send({
        error: "ACTIVE_MODULE_DISPUTE_EXISTS",
        dispute_id: existing.id,
        message: "This platform transaction already has an active dispute",
      });
    }

    const costs = disputeCosts(input.transaction as ModuleTransactionSnapshot, platformConfig);
    const result = disputeService.openCase({
      order_id: orderId,
      reason_code: input.request.reason_code as DisputeReasonCode,
      opened_by: decision.opened_by,
      initial_evidence: [
        {
          submitted_by: decision.opened_by,
          type: "text",
          text: input.request.summary,
        },
      ],
    });

    result.dispute.metadata = {
      source: "dispute_module_api",
      module_version: "v1",
      tier: 1,
      platform_id: auth.platformId,
      external_order_id: input.transaction.external_order_id,
      requester_actor_id: input.request.requester_actor_id,
      opened_by_actor_id: decision.opened_by === "buyer"
        ? input.transaction.buyer_actor_id
        : input.transaction.seller_actor_id,
      client_request_id: input.request.client_request_id ?? null,
      idempotency_key: auth.idempotencyKey,
      request_fingerprint: requestFingerprint,
      transaction_snapshot: input.transaction,
      costs,
      config: {
        use_shared_pool: decision.config.use_shared_pool,
        reviewer_share: decision.config.reviewer_share,
        platform_share: decision.config.platform_share,
      },
    };

    const webhookEnvelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: auth.platformId,
      externalOrderId: input.transaction.external_order_id,
      dispute: result.dispute,
    });

    let webhookOutboxRecord: DisputeModuleWebhookOutboxRecord;
    try {
      webhookOutboxRecord = await writeModuleDisputeOpen(result.dispute, {
        platformId: auth.platformId,
        idempotencyKey: auth.idempotencyKey,
        requestFingerprint,
      }, webhookEnvelope);
    } catch (error) {
      if (isModuleIdempotencyUniqueError(error)) {
        const replayRecord = await getDisputeModuleIdempotencyRecord(db, auth.platformId, auth.idempotencyKey);
        if (replayRecord?.requestFingerprint === requestFingerprint) {
          const replay = await getDisputeById(db, replayRecord.disputeId);
          if (replay) {
            return reply.send({
              ok: true,
              dispute: replay,
              platform_id: auth.platformId,
              external_order_id: input.transaction.external_order_id,
              idempotency_key: auth.idempotencyKey,
              idempotent: true,
            });
          }
        }
        return reply.code(409).send({
          error: "IDEMPOTENCY_KEY_REUSED",
          message: "This idempotency key was already used for a different module dispute request",
        });
      }
      if (isActiveDisputeUniqueError(error)) {
        const replay = await getActiveDisputeByOrderId(db, orderId);
        if (
          replay &&
          sameModuleIdempotency(replay, auth.idempotencyKey) &&
          sameModuleRequestFingerprint(replay, requestFingerprint)
        ) {
          return reply.send({
            ok: true,
            dispute: replay,
            platform_id: auth.platformId,
            external_order_id: input.transaction.external_order_id,
            idempotency_key: auth.idempotencyKey,
            idempotent: true,
          });
        }
        return reply.code(409).send({
          error: "ACTIVE_MODULE_DISPUTE_EXISTS",
          message: "This platform transaction already has an active dispute",
        });
      }
      throw error;
    }

    deliverDisputeModuleWebhookOutboxRecord(db, webhookOutboxRecord).then((delivery) => {
      if (delivery.status === "failed") {
        request.log.warn({ delivery }, "dispute module webhook delivery failed");
      }
    }).catch((error) => {
      request.log.warn({ err: error }, "dispute module webhook dispatch error");
    });

    return reply.code(201).send({
      ok: true,
      dispute: result.dispute,
      platform_id: auth.platformId,
      external_order_id: input.transaction.external_order_id,
      idempotency_key: auth.idempotencyKey,
      idempotent: false,
    });
  });

  app.post<{ Params: { id: string } }>(
    "/modules/disputes/v1/cases/:id/escalations/preview",
    async (request, reply) => {
      const auth = authenticateModuleRequest(request);
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const parsed = escalationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_MODULE_ESCALATION_REQUEST", issues: parsed.error.issues });
      }

      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (resolvedDisputeStatus(dispute.status)) {
        return reply.code(409).send({ error: "DISPUTE_ALREADY_RESOLVED", status: dispute.status });
      }
      if (dispute.metadata?.platform_id !== auth.platformId) {
        return reply.code(403).send({ error: "PLATFORM_MISMATCH" });
      }
      if (dispute.metadata?.external_order_id !== parsed.data.external_order_id) {
        return reply.code(403).send({ error: "EXTERNAL_ORDER_MISMATCH" });
      }

      const transaction = moduleDisputeTransactionSnapshot(dispute);
      if (!transaction) {
        return reply.code(409).send({ error: "MODULE_TRANSACTION_SNAPSHOT_MISSING" });
      }
      const requesterRole = actorRoleInModuleTransaction(transaction, parsed.data.requester_actor_id);
      if (!requesterRole) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "requester_actor_id is not a transaction party" });
      }

      const platformConfigResult = resolvePlatformModuleConfig(auth.platformId);
      if (!platformConfigResult.ok) {
        return reply.code(500).send({ error: platformConfigResult.error });
      }

      const preview = buildModuleEscalationPreview({
        dispute,
        transaction,
        platformConfig: platformConfigResult.config,
        toTier: parsed.data.to_tier,
      });
      if (!preview.ok) {
        return reply.code(preview.status).send({ error: preview.error });
      }

      return reply.send({
        ok: true,
        platform_id: auth.platformId,
        dispute_id: dispute.id,
        external_order_id: parsed.data.external_order_id,
        requested_by: requesterRole,
        previous_tier: preview.previous_tier,
        new_tier: preview.new_tier,
        cost: preview.cost,
        seller_deposit_requirement: preview.seller_deposit_requirement,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/modules/disputes/v1/cases/:id/escalations",
    async (request, reply) => {
      const auth = authenticateModuleRequest(request);
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const parsed = escalationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_MODULE_ESCALATION_REQUEST", issues: parsed.error.issues });
      }
      const input = parsed.data;
      const requestFingerprint = moduleEscalationRequestFingerprint(request.params.id, input);

      const idempotencyRecord = await getDisputeModuleIdempotencyRecord(db, auth.platformId, auth.idempotencyKey);
      if (idempotencyRecord) {
        if (idempotencyRecord.requestFingerprint !== requestFingerprint) {
          return reply.code(409).send({
            error: "IDEMPOTENCY_KEY_REUSED",
            message: "This idempotency key was already used for a different module dispute request",
          });
        }
        const replay = await getDisputeById(db, idempotencyRecord.disputeId);
        if (replay) {
          return reply.send({
            ok: true,
            dispute: replay,
            platform_id: auth.platformId,
            external_order_id: input.external_order_id,
            idempotency_key: auth.idempotencyKey,
            idempotent: true,
          });
        }
        return reply.code(409).send({
          error: "IDEMPOTENCY_REPLAY_UNAVAILABLE",
          message: "This idempotency key is already reserved but the dispute is not readable yet",
        });
      }

      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (resolvedDisputeStatus(dispute.status)) {
        return reply.code(409).send({ error: "DISPUTE_ALREADY_RESOLVED", status: dispute.status });
      }
      if (dispute.metadata?.platform_id !== auth.platformId) {
        return reply.code(403).send({ error: "PLATFORM_MISMATCH" });
      }
      if (dispute.metadata?.external_order_id !== input.external_order_id) {
        return reply.code(403).send({ error: "EXTERNAL_ORDER_MISMATCH" });
      }

      const transaction = moduleDisputeTransactionSnapshot(dispute);
      if (!transaction) {
        return reply.code(409).send({ error: "MODULE_TRANSACTION_SNAPSHOT_MISSING" });
      }
      const requesterRole = actorRoleInModuleTransaction(transaction, input.requester_actor_id);
      if (!requesterRole) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "requester_actor_id is not a transaction party" });
      }

      const platformConfigResult = resolvePlatformModuleConfig(auth.platformId);
      if (!platformConfigResult.ok) {
        return reply.code(500).send({ error: platformConfigResult.error });
      }

      const preview = buildModuleEscalationPreview({
        dispute,
        transaction,
        platformConfig: platformConfigResult.config,
        toTier: input.to_tier,
      });
      if (!preview.ok) {
        return reply.code(preview.status).send({ error: preview.error });
      }

      const escalatedDispute = {
        ...dispute,
        status: "UNDER_REVIEW" as const,
        metadata: {
          ...(dispute.metadata ?? {}),
          tier: preview.new_tier,
          escalated_by_actor_id: input.requester_actor_id,
          escalated_by_role: requesterRole,
          escalated_reason: input.reason ?? null,
          escalated_at: new Date().toISOString(),
          current_tier_cost: preview.cost,
          current_seller_deposit_requirement: preview.seller_deposit_requirement,
          escalation_history: [
            ...(
              Array.isArray(dispute.metadata?.escalation_history)
                ? dispute.metadata.escalation_history
                : []
            ),
            {
              from_tier: preview.previous_tier,
              to_tier: preview.new_tier,
              requested_by_actor_id: input.requester_actor_id,
              requested_by_role: requesterRole,
              reason: input.reason ?? null,
              client_request_id: input.client_request_id ?? null,
              requested_at: new Date().toISOString(),
              cost: preview.cost,
              seller_deposit_requirement: preview.seller_deposit_requirement,
            },
          ],
        },
      };

      const webhookEnvelope = buildDisputeModuleWebhookEnvelope({
        type: "dispute.case.escalated",
        platformId: auth.platformId,
        externalOrderId: input.external_order_id,
        dispute: escalatedDispute,
        dedupeKey: `tier:${preview.new_tier}`,
        data: {
          dispute_id: escalatedDispute.id,
          status: escalatedDispute.status,
          previous_tier: preview.previous_tier,
          new_tier: preview.new_tier,
          requested_by_role: requesterRole,
          requested_by_actor_id: input.requester_actor_id,
          cost: preview.cost,
          seller_deposit_requirement: preview.seller_deposit_requirement,
        },
      });

      let webhookOutboxRecord: DisputeModuleWebhookOutboxRecord | null = null;
      try {
        const persist = async (tx: unknown) => {
          const txDb = tx as Database;
          await updateDisputeRecord(txDb, escalatedDispute);
          await createDisputeModuleIdempotencyRecord(txDb, {
            platformId: auth.platformId,
            idempotencyKey: auth.idempotencyKey,
            requestFingerprint,
            disputeId: dispute.id,
          });
          webhookOutboxRecord = await createDisputeModuleWebhookOutboxRecord(txDb, webhookEnvelope);
        };
        if (typeof db.transaction === "function") {
          await db.transaction(persist);
        } else {
          await persist(db);
        }
      } catch (error) {
        if (isModuleIdempotencyUniqueError(error)) {
          const replayRecord = await getDisputeModuleIdempotencyRecord(db, auth.platformId, auth.idempotencyKey);
          if (replayRecord?.requestFingerprint === requestFingerprint) {
            const replay = await getDisputeById(db, replayRecord.disputeId);
            if (replay) {
              return reply.send({
                ok: true,
                dispute: replay,
                platform_id: auth.platformId,
                external_order_id: input.external_order_id,
                idempotency_key: auth.idempotencyKey,
                idempotent: true,
              });
            }
          }
          return reply.code(409).send({
            error: "IDEMPOTENCY_KEY_REUSED",
            message: "This idempotency key was already used for a different module dispute request",
          });
        }
        throw error;
      }

      if (webhookOutboxRecord) {
        deliverDisputeModuleWebhookOutboxRecord(db, webhookOutboxRecord).then((delivery) => {
          if (delivery.status === "failed") {
            request.log.warn({ delivery }, "dispute module escalation webhook delivery failed");
          }
        }).catch((error) => {
          request.log.warn({ err: error }, "dispute module escalation webhook dispatch error");
        });
      }

      return reply.code(201).send({
        ok: true,
        dispute: escalatedDispute,
        platform_id: auth.platformId,
        external_order_id: input.external_order_id,
        idempotency_key: auth.idempotencyKey,
        idempotent: false,
        previous_tier: preview.previous_tier,
        new_tier: preview.new_tier,
        cost: preview.cost,
        seller_deposit_requirement: preview.seller_deposit_requirement,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/modules/disputes/v1/cases/:id/status",
    async (request, reply) => {
      const auth = authenticateModuleRequest(request);
      if (!auth.ok) {
        return reply.code(auth.status).send({ error: auth.error });
      }

      const parsed = statusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_MODULE_STATUS_REQUEST", issues: parsed.error.issues });
      }

      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (dispute.metadata?.platform_id !== auth.platformId) {
        return reply.code(403).send({ error: "PLATFORM_MISMATCH" });
      }
      if (dispute.metadata?.external_order_id !== parsed.data.external_order_id) {
        return reply.code(403).send({ error: "EXTERNAL_ORDER_MISMATCH" });
      }

      return reply.send({
        ok: true,
        platform_id: auth.platformId,
        dispute_id: dispute.id,
        external_order_id: parsed.data.external_order_id,
        status: dispute.status,
        tier: currentDisputeTier(dispute),
        current_tier_cost: dispute.metadata?.current_tier_cost ?? null,
        current_seller_deposit_requirement: dispute.metadata?.current_seller_deposit_requirement ?? null,
        escalation_history: Array.isArray(dispute.metadata?.escalation_history)
          ? dispute.metadata.escalation_history
          : [],
        resolution: dispute.resolution ?? null,
      });
    },
  );
}
