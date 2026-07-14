// biome-ignore-all lint/suspicious/noImplicitAnyLet: Guarded assignments retain shipping service result types.
import { createHash } from "node:crypto";
import {
  and as andOp,
  type Database,
  eq as eqOp,
  orderAddresses,
  shipments as shipmentsTable,
} from "@haggle/db";
import type { DisputeCase } from "@haggle/dispute-core";
import { createId } from "@haggle/dispute-core";
import { confirmDelivery } from "@haggle/payment-core";
import {
  checkEscalation,
  computeWeightBuffer,
  EasyPostCarrierAdapter,
  isEasyPostTestApiKey,
  MockCarrierAdapter,
  normalizeCarrierEventTime,
  parseEasyPostInvoicePayload,
  parseEasyPostWebhookPayload,
  redactShippingSensitiveData,
  ShippingService,
  verifyEasyPostWebhook,
} from "@haggle/shipping-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getShipmentApvInvoiceRestorationRemediationExpiryJobStatus } from "../jobs/shipment-apv-invoice-restoration-remediation-expiry.js";
import { getShipmentApvInvoiceRestorationStagingMaintenanceJobStatus } from "../jobs/shipment-apv-invoice-restoration-staging-maintenance.js";
import {
  getShipmentApvRemediationCursorRetentionJobHealth,
  getShipmentApvRemediationCursorRetentionJobStatus,
} from "../jobs/shipment-apv-remediation-cursor-retention.js";
import { boundedJson, INPUT_LIMITS } from "../lib/input-limits.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { requireAuth } from "../middleware/require-auth.js";
import { type AdminActionType, writeAuditLog } from "../services/admin-action-log.service.js";
import { createDisputeRecord, getDisputeByOrderId } from "../services/dispute-record.service.js";
import {
  getCommerceOrderByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import {
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "../services/settlement-release.service.js";
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
import { evaluateShipmentApvCursorRetentionAlert } from "../services/shipment-apv-payout-alert.service.js";
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
  completeShipmentOperationIdempotency,
  createShipmentOperationInProgress,
  createShipmentRecord,
  failShipmentLabelRefund,
  getShipmentById,
  getShipmentByOrderId,
  getShipmentByTrackingNumber,
  getShipmentOperationIdempotencyRecord,
  insertShipmentEvent,
  normalizeProviderLabelRefundStatus,
  syncSubmittedShipmentLabelRefund,
  updateShipmentRecord,
} from "../services/shipment-record.service.js";
import { consumeShippingRateMissBudget } from "../services/shipping-rate-limit.service.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  startWebhookClaimHeartbeat,
  webhookPayloadSha256,
} from "../services/webhook-event-claim.service.js";

const createShipmentSchema = z.object({
  order_id: z.string().max(INPUT_LIMITS.shortTextChars),
  seller_id: z.string().max(INPUT_LIMITS.shortTextChars),
  buyer_id: z.string().max(INPUT_LIMITS.shortTextChars),
  carrier: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
  shipment_input_due_at: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
});

const recordEventSchema = z.object({
  event_id: z.string().min(1).max(128).optional(),
  event_type: z.enum([
    "label_create",
    "ship",
    "out_for_delivery",
    "deliver",
    "exception",
    "return_ship",
    "return_complete",
  ]),
  raw_status: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  payload: boundedJson(
    z.record(z.any()),
    INPUT_LIMITS.jsonPayloadBytes,
    "shipment event payload",
  ).optional(),
});

const apvSellerReviewSchema = z.object({
  request_id: z.string().uuid(),
  reason: z.string().trim().min(20).max(2000),
});

const apvReviewDecisionSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(["UPHELD", "WAIVED"]),
  reason: z.string().trim().min(20).max(2000),
  expected_version: z.number().int().nonnegative(),
});

const apvRevisionDecisionSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(["UPHELD", "WAIVED", "APPLY_CREDIT", "ACKNOWLEDGE"]),
  reason: z.string().trim().min(20).max(2000),
  expected_version: z.number().int().nonnegative(),
});

const apvRevisionEvidenceSchema = z.object({
  document_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  provider_document_id: z.string().trim().min(1).max(128),
  surcharge_category: z.enum([
    "ADDRESS_CORRECTION",
    "CLEARANCE",
    "COMMODITY_TYPE",
    "DANGEROUS_GOODS",
    "DELIVERY_CONVENIENCE",
    "DEMAND",
    "EXCEPTION",
    "FUEL",
    "HANDLING",
    "HAZMAT",
    "INTERNATIONAL_HANDLING",
    "OTHER",
    "PAYMENT_TYPE",
    "REBATE",
    "RETURNS",
    "SECURITY",
    "SERVICE_AREA_ADJUSTMENT",
    "SHIPMENT_VALUE",
    "SIGNATURE_SERVICE",
    "SPECIAL_SERVICE",
    "VALUE_ADD",
    "WEEKEND",
    "UNKNOWN",
  ]),
  surcharge_type: z.string().trim().min(1).max(128),
  amount_minor: z.number().int().nonnegative().max(10_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const apvInvoiceDocumentSchema = z.object({
  provider_document_id: z.string().trim().min(1).max(128),
  content_type: z.enum(["application/pdf", "text/csv", "application/json"]),
  content_base64: z
    .string()
    .min(4)
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

const apvInvoiceReconciliationRequestSchema = z
  .object({
    client_request_id: z.string().uuid(),
    candidate_id: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().trim().min(12).max(500),
  })
  .strict();

const apvInvoiceReconciliationDecisionSchema = z
  .object({
    decision_request_id: z.string().uuid(),
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().min(12).max(500),
    expected_version: z.number().int().nonnegative(),
  })
  .strict();

const apvInvoiceRestorationRequestSchema = z
  .object({
    client_request_id: z.string().uuid(),
    candidate_id: z.string().regex(/^[0-9a-f]{64}$/),
    content_type: z.enum(["application/pdf", "text/csv", "application/json"]),
    content_base64: z
      .string()
      .min(4)
      .max(7_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    reason: z.string().trim().min(12).max(500),
  })
  .strict();

const apvInvoiceRestorationDecisionSchema = z
  .object({
    decision_request_id: z.string().uuid(),
    decision: z.enum(["RESTORE", "PRESERVE", "REJECT"]),
    reason: z.string().trim().min(12).max(500),
    expected_version: z.number().int().nonnegative(),
  })
  .strict();

const apvInvoiceRestorationStagingMaintenanceSchema = z
  .object({
    mode: z.enum(["dry_run", "apply"]),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

const apvInvoiceRestorationRemediationRequestSchema = z
  .object({
    client_request_id: z.string().uuid(),
    candidate_id: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().trim().min(12).max(500),
  })
  .strict();

const apvInvoiceRestorationRemediationDecisionSchema = z
  .object({
    decision_request_id: z.string().uuid(),
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().min(12).max(500),
    expected_version: z.number().int().nonnegative(),
  })
  .strict();

const apvInvoiceRestorationRemediationAcknowledgmentSchema = z
  .object({
    client_request_id: z.string().uuid(),
    decision_request_id: z.string().uuid(),
    action: z.enum(["ACKNOWLEDGED", "INCIDENT_LINKED"]),
    expected_version: z.number().int().min(1),
    incident_reference: z
      .string()
      .trim()
      .min(4)
      .max(128)
      .regex(/^[\x20-\x7e]+$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.action === "INCIDENT_LINKED") !== Boolean(value.incident_reference)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["incident_reference"],
        message: "incident_reference is required only for INCIDENT_LINKED",
      });
    }
  });

function manualShipmentEventId(shipmentId: string, externalEventId: string): string {
  return `evt_manual_${createHash("sha256").update(`${shipmentId}:${externalEventId}`).digest("hex")}`;
}

const _webhookSchema = z.object({
  carrier: z.string().max(INPUT_LIMITS.shortTextChars),
  payload: boundedJson(z.record(z.any()), INPUT_LIMITS.jsonPayloadBytes, "carrier webhook payload"),
});

function requiresRealShippingProvider(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function realShippingUnavailable(_error?: unknown) {
  return {
    error: "REAL_SHIPPING_PROVIDER_UNAVAILABLE",
    message: "The configured shipping provider is temporarily unavailable",
  };
}

function sha256Hex(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

type RateQuoteRate = {
  id?: string;
  carrier: string;
  service: string;
  rate: string;
  rate_minor: number;
  est_delivery_days: number | null;
};

type RateQuoteResponseBody = {
  rates: RateQuoteRate[];
  weight_buffer_minor: number;
  source: "easypost" | "mock";
  quote_key: string;
  cache_scope: "exact_address";
  cache_hit: boolean;
  quoted_at: string;
  expires_at: string;
  cache_ttl_seconds: number;
};

type PreparedShipmentRate = RateQuoteRate & {
  source: "easypost" | "mock";
  easypost_shipment_id?: string;
  quoted_at: string;
};

function preparedShipmentRatesFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): PreparedShipmentRate[] {
  const rates = metadata?.prepared_rate_quotes;
  if (!Array.isArray(rates)) return [];
  return rates.filter((rate): rate is PreparedShipmentRate => {
    if (!rate || typeof rate !== "object") return false;
    const record = rate as Record<string, unknown>;
    return (
      typeof record.id === "string" &&
      typeof record.carrier === "string" &&
      typeof record.service === "string" &&
      typeof record.rate === "string" &&
      typeof record.rate_minor === "number" &&
      (record.source === "easypost" || record.source === "mock") &&
      typeof record.quoted_at === "string"
    );
  });
}

function preparedRateNotFoundResponse(rateId: string) {
  return {
    error: "RATE_NOT_PREPARED_FOR_SHIPMENT",
    message:
      "Run POST /shipments/:id/prepare and purchase one of the returned rates for this shipment.",
    rate_id: rateId,
  };
}

type CachedRateQuote = {
  body: Omit<RateQuoteResponseBody, "cache_hit">;
  expiresAtMs: number;
};

const shippingRateQuoteCache = new Map<string, CachedRateQuote>();

const MAX_PARCEL_WEIGHT_OZ = 2400;
const MAX_PARCEL_DIMENSION_IN = 120;

function positiveBoundedEnv(name: string, fallback: number, cap: number): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, cap);
}

function shippingRateCacheMaxEntries(): number {
  return positiveBoundedEnv("SHIPPING_RATE_CACHE_MAX_ENTRIES", 5000, 50_000);
}

function shippingRateMissLimitPerMinute(): number {
  return positiveBoundedEnv("SHIPPING_RATE_MAX_MISSES_PER_MINUTE", 30, 1000);
}

function shippingRateCacheTtlSeconds(): number {
  const ttlSeconds = Number(process.env.SHIPPING_RATE_CACHE_TTL_SECONDS);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return 30 * 60;
  return Math.min(Math.floor(ttlSeconds), 24 * 60 * 60);
}

function normalizeQuoteString(value: unknown, uppercase = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return uppercase ? normalized.toUpperCase() : normalized.toLowerCase();
}

function normalizeRateAddress(address: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const key of ["street1", "street2", "city", "state", "zip", "country"]) {
    const value = normalizeQuoteString(
      address[key],
      key === "state" || key === "country" || key === "zip",
    );
    if (value) normalized[key] = value;
  }
  return normalized;
}

function normalizeRateParcel(parcel: Record<string, unknown>): Record<string, number | null> {
  return {
    weight_oz: typeof parcel.weight_oz === "number" ? parcel.weight_oz : null,
    length_in: typeof parcel.length_in === "number" ? parcel.length_in : null,
    width_in: typeof parcel.width_in === "number" ? parcel.width_in : null,
    height_in: typeof parcel.height_in === "number" ? parcel.height_in : null,
  };
}

function rateQuoteKeyFor(input: {
  from_address: Record<string, unknown>;
  to_address: Record<string, unknown>;
  parcel: Record<string, unknown>;
}): string {
  const normalized = {
    from_address: normalizeRateAddress(input.from_address),
    to_address: normalizeRateAddress(input.to_address),
    parcel: normalizeRateParcel(input.parcel),
  };
  return `shipping_quote:${sha256Hex(stableJson(normalized)).replace(/^sha256:/, "")}`;
}

function buildRateQuoteResponse(input: {
  rates: RateQuoteRate[];
  weightBufferMinor: number;
  source: "easypost" | "mock";
  quoteKey: string;
  ttlSeconds: number;
  nowMs?: number;
}): RateQuoteResponseBody {
  const nowMs = input.nowMs ?? Date.now();
  return {
    rates: input.rates,
    weight_buffer_minor: input.weightBufferMinor,
    source: input.source,
    quote_key: input.quoteKey,
    cache_scope: "exact_address",
    cache_hit: false,
    quoted_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + input.ttlSeconds * 1000).toISOString(),
    cache_ttl_seconds: input.ttlSeconds,
  };
}

function cacheRateQuote(response: RateQuoteResponseBody): void {
  const { cache_hit: _cacheHit, ...body } = response;
  const maxEntries = shippingRateCacheMaxEntries();
  while (shippingRateQuoteCache.size >= maxEntries) {
    const oldestKey = shippingRateQuoteCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    shippingRateQuoteCache.delete(oldestKey);
  }
  shippingRateQuoteCache.set(response.quote_key, {
    body,
    expiresAtMs: Date.parse(response.expires_at),
  });
}

function requestHeaderString(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getCorrelationId(request: FastifyRequest): string {
  return (
    requestHeaderString(request, "x-request-id") ??
    requestHeaderString(request, "x-correlation-id") ??
    request.id
  );
}

function auditActorId(request: FastifyRequest): string {
  return request.user?.id ?? "00000000-0000-4000-8000-000000000000";
}

function getShippingIdempotencyKey(request: FastifyRequest): string | null {
  return (
    requestHeaderString(request, "idempotency-key") ??
    requestHeaderString(request, "x-idempotency-key")
  );
}

function safeRedactShippingLog(value: unknown): unknown {
  try {
    return redactShippingSensitiveData(value);
  } catch {
    return { redaction_error: true };
  }
}

function shipmentOperationRequestHash(
  operation: string,
  shipmentId: string | null,
  body: unknown,
  actorId: string | undefined,
): string {
  return sha256Hex(
    stableJson({
      operation,
      shipment_id: shipmentId,
      actor_id: actorId ?? null,
      body: body ?? null,
    }),
  );
}

async function beginShipmentOperationIdempotency(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  operation: string,
  shipmentId: string | null,
): Promise<{ key: string | null; requestHash: string; replayed: boolean }> {
  const key = getShippingIdempotencyKey(request);
  const requestHash = shipmentOperationRequestHash(
    operation,
    shipmentId,
    request.body,
    request.user?.id,
  );

  if (!key) {
    if (requiresRealShippingProvider()) {
      reply.code(400).send({
        error: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required for shipment label mutations in production",
      });
      return { key: null, requestHash, replayed: true };
    }
    return { key: null, requestHash, replayed: false };
  }

  const inserted = await createShipmentOperationInProgress(db, {
    operation,
    idempotencyKey: key,
    shipmentId,
    requestHash,
  });
  if (inserted) return { key, requestHash, replayed: false };

  const existing = await getShipmentOperationIdempotencyRecord(db, operation, key);
  if (!existing) {
    reply.code(409).send({ error: "IDEMPOTENCY_RECORD_CONFLICT" });
    return { key, requestHash, replayed: true };
  }
  if (existing.requestHash !== requestHash) {
    reply.code(409).send({
      error: "IDEMPOTENCY_KEY_CONFLICT",
      message: "Idempotency key was already used with a different shipment request",
    });
    return { key, requestHash, replayed: true };
  }
  if (existing.status === "SUCCEEDED" && existing.responseBody && existing.responseStatus) {
    reply.code(existing.responseStatus).send({
      ...(existing.responseBody as Record<string, unknown>),
      idempotent: true,
    });
    return { key, requestHash, replayed: true };
  }

  reply.code(409).send({
    error: "SHIPMENT_OPERATION_IN_PROGRESS",
    message: "A shipment operation with this idempotency key is already in progress",
  });
  return { key, requestHash, replayed: true };
}

async function completeShipmentOperation(
  db: Database,
  operation: string,
  idempotency: { key: string | null },
  responseStatus: number,
  responseBody: Record<string, unknown>,
): Promise<void> {
  if (!idempotency.key) return;
  await completeShipmentOperationIdempotency(db, operation, idempotency.key, {
    status: responseStatus >= 200 && responseStatus < 300 ? "SUCCEEDED" : "FAILED",
    responseStatus,
    responseBody: safeRedactShippingLog(responseBody) as Record<string, unknown>,
  });
}

async function auditShipmentAction(
  db: Database,
  request: FastifyRequest,
  actionType: AdminActionType,
  params: {
    shipmentId?: string | null;
    orderId?: string | null;
    reason: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditLog(db, {
    actorId: auditActorId(request),
    actionType,
    targetType: "shipment",
    targetId: params.shipmentId ?? null,
    payload: {
      actor: {
        id: request.user?.id ?? "system",
        role: request.user?.role ?? "system",
      },
      shipment_id: params.shipmentId ?? null,
      order_id: params.orderId ?? null,
      reason: params.reason,
      request_id: getCorrelationId(request),
      timestamp: new Date().toISOString(),
      metadata: params.metadata ? safeRedactShippingLog(params.metadata) : undefined,
    },
  });
}

function getCarrierWebhookEventId(body: unknown, source: string): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const result =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : {};
  const explicitId = record.id ?? result.id;
  if (typeof explicitId === "string" && explicitId.trim()) return explicitId;
  return sha256Hex(
    stableJson({
      source,
      description: record.description ?? null,
      tracking_code: result.tracking_code ?? null,
      status: result.status ?? null,
      datetime: Array.isArray(result.tracking_details)
        ? ((result.tracking_details.at(-1) as Record<string, unknown> | undefined)?.datetime ??
          null)
        : null,
    }),
  );
}

function isUspsCarrier(carrier: unknown): boolean {
  return typeof carrier === "string" && carrier.toLowerCase() === "usps";
}

function extractEasyPostLabelQrCodeForm(response: unknown): { formId?: string; formUrl?: string } {
  const record =
    response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const directFormType = record.form_type;
  const directFormUrl = record.form_url;
  if (directFormType === "label_qr_code" && typeof directFormUrl === "string") {
    return {
      formId: typeof record.id === "string" ? record.id : undefined,
      formUrl: directFormUrl,
    };
  }

  const forms = Array.isArray(record.forms) ? record.forms : [];
  for (const form of forms) {
    const formRecord = form && typeof form === "object" ? (form as Record<string, unknown>) : {};
    if (formRecord.form_type === "label_qr_code" && typeof formRecord.form_url === "string") {
      return {
        formId: typeof formRecord.id === "string" ? formRecord.id : undefined,
        formUrl: formRecord.form_url,
      };
    }
  }

  return {};
}

async function createEasyPostLabelQrCode(
  client: {
    Shipment: {
      generateForm?: (
        id: string,
        formType: string,
        params?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  },
  easypostShipmentId: string,
  carrier: unknown,
): Promise<{
  url: string | null;
  formId: string | null;
  status: "created" | "unsupported" | "failed";
  reason?: string;
}> {
  if (!isUspsCarrier(carrier)) {
    return {
      url: null,
      formId: null,
      status: "unsupported",
      reason: "label_qr_code is currently supported for USPS shipments",
    };
  }
  if (typeof client.Shipment.generateForm !== "function") {
    return {
      url: null,
      formId: null,
      status: "failed",
      reason: "EasyPost SDK does not expose Shipment.generateForm",
    };
  }

  try {
    const response = await client.Shipment.generateForm(easypostShipmentId, "label_qr_code");
    const form = extractEasyPostLabelQrCodeForm(response);
    if (!form.formUrl) {
      return {
        url: null,
        formId: form.formId ?? null,
        status: "failed",
        reason: "EasyPost did not return a label QR code URL",
      };
    }
    return { url: form.formUrl, formId: form.formId ?? null, status: "created" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
    return {
      url: null,
      formId: null,
      status: "failed",
      reason: message || "EasyPost label QR code form generation failed",
    };
  }
}

export function registerShipmentRoutes(app: FastifyInstance, db: Database) {
  const { requireShipmentOwner } = createOwnershipMiddleware(db);
  const easypostApiKey = process.env.EASYPOST_API_KEY;
  const easypostWebhookSecret = process.env.EASYPOST_WEBHOOK_SECRET;

  // Build carriers map
  const carriers: Record<string, import("@haggle/shipping-core").CarrierProvider> = {
    mock: new MockCarrierAdapter(),
  };

  if (easypostApiKey) {
    const easypost = new EasyPostCarrierAdapter({
      api_key: easypostApiKey,
      is_test: isEasyPostTestApiKey(easypostApiKey),
    });
    carriers.easypost = easypost;
    carriers.usps = easypost;
    carriers.ups = easypost;
    carriers.fedex = easypost;
    carriers.dhl = easypost;
  }

  const shippingService = new ShippingService(carriers);

  /**
   * When shipment reaches DELIVERED, auto-start the buyer review period.
   * This gives the buyer 3 days to inspect the item before product payment is released.
   */
  async function autoConfirmDeliveryIfNeeded(shipment: import("@haggle/shipping-core").Shipment) {
    if (shipment.status !== "DELIVERED") return;
    try {
      const release = await getSettlementReleaseByOrderId(db, shipment.order_id);
      if (release?.product_release_status !== "PENDING_DELIVERY") return;
      const updated = confirmDelivery(release, shipment.delivered_at ?? new Date().toISOString());
      await updateSettlementReleaseRecord(db, updated);
    } catch {
      // Non-critical: don't fail the shipment update
    }
  }

  /**
   * Auto-create a dispute when the shipment SLA is violated.
   * Non-blocking: failures are silently caught so the shipment update always succeeds.
   */
  async function autoCreateDisputeOnSlaViolation(
    shipment: import("@haggle/shipping-core").Shipment,
    db: Database,
  ) {
    try {
      // Only check SLA for shipments still pending label — the SLA tracks whether
      // the seller provided shipment info within the allowed window.
      if (shipment.status !== "LABEL_PENDING") return;

      // Query the raw DB row for the shipment_input_due_at deadline.
      const row = await db.query.shipments.findFirst({
        where: (fields, ops) => ops.eq(fields.id, shipment.id),
      });
      if (!row?.shipmentInputDueAt) return;

      const dueMs = new Date(row.shipmentInputDueAt).getTime();
      const now = new Date().toISOString();

      // Simple check: if now is past the due date, SLA is violated
      if (new Date(now).getTime() <= dueMs) return;

      // Check if a dispute already exists for this order
      const existing = await getDisputeByOrderId(db, shipment.order_id);
      if (existing) return;

      // Create system-initiated dispute
      const dispute: DisputeCase = {
        id: createId(),
        order_id: shipment.order_id,
        reason_code: "SHIPMENT_SLA_MISSED",
        status: "OPEN",
        opened_by: "system",
        opened_at: now,
        evidence: [],
      };

      await createDisputeRecord(db, dispute);
      await updateCommerceOrderStatus(db, shipment.order_id, "IN_DISPUTE");
    } catch {
      // Non-critical: don't fail the shipment update
    }
  }

  async function autoCreateDisputeOnDeliveryException(
    shipment: import("@haggle/shipping-core").Shipment,
  ) {
    try {
      const now = new Date().toISOString();
      const candidate = checkEscalation(shipment, shipment.created_at, now);
      if (!candidate?.auto_open || candidate.reason_code !== "DELIVERY_EXCEPTION") return;

      const existing = await getDisputeByOrderId(db, shipment.order_id);
      if (existing) return;

      const disputeId = createId();
      const dispute: DisputeCase = {
        id: disputeId,
        order_id: shipment.order_id,
        reason_code: "DELIVERY_EXCEPTION",
        status: "OPEN",
        opened_by: "system",
        opened_at: now,
        evidence: [
          {
            id: createId(),
            dispute_id: disputeId,
            submitted_by: "system",
            type: "tracking_snapshot",
            text: JSON.stringify(candidate.evidence_snapshot),
            created_at: now,
          },
        ],
        metadata: {
          tier: 1,
          source: "shipping_delivery_exception",
          auto_opened: true,
          shipment_id: shipment.id,
        },
      };

      await createDisputeRecord(db, dispute);
      await updateCommerceOrderStatus(db, shipment.order_id, "IN_DISPUTE");
    } catch {
      // Non-critical: preserve the carrier event and surface reconciliation separately.
    }
  }

  async function persistShipmentUpdate(
    result: {
      shipment: import("@haggle/shipping-core").Shipment;
      trust_triggers: import("@haggle/commerce-core").TrustTriggerEvent[];
    },
    db: Database,
    context: { buyer_id: string; seller_id: string },
    newEvent?: import("@haggle/shipping-core").ShipmentEvent,
  ) {
    await updateShipmentRecord(db, result.shipment);
    if (newEvent) {
      await insertShipmentEvent(db, newEvent);
    }

    await applyShipmentSideEffects(result, db, context);
  }

  async function applyShipmentSideEffects(
    result: {
      shipment: import("@haggle/shipping-core").Shipment;
      trust_triggers: import("@haggle/commerce-core").TrustTriggerEvent[];
    },
    db: Database,
    context: { buyer_id: string; seller_id: string },
  ) {
    // Sync order status with shipment status
    if (result.shipment.status === "LABEL_CREATED" || result.shipment.status === "IN_TRANSIT") {
      await updateCommerceOrderStatus(db, result.shipment.order_id, "FULFILLMENT_ACTIVE");
    } else if (result.shipment.status === "DELIVERED") {
      await updateCommerceOrderStatus(db, result.shipment.order_id, "DELIVERED");
    }

    // Auto-start buyer review when shipment is delivered
    await autoConfirmDeliveryIfNeeded(result.shipment);
    await autoCreateDisputeOnDeliveryException(result.shipment);
    // Auto-create dispute if SLA is violated and no dispute exists yet
    await autoCreateDisputeOnSlaViolation(result.shipment, db);
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.shipment.order_id,
        buyer_id: context.buyer_id,
        seller_id: context.seller_id,
        triggers: result.trust_triggers,
      });
    }
  }

  async function persistAndRespond(
    result: {
      shipment: import("@haggle/shipping-core").Shipment;
      trust_triggers: import("@haggle/commerce-core").TrustTriggerEvent[];
    },
    reply: import("fastify").FastifyReply,
    db: Database,
    context: { buyer_id: string; seller_id: string },
    newEvent?: import("@haggle/shipping-core").ShipmentEvent,
  ) {
    await persistShipmentUpdate(result, db, context, newEvent);
    return reply.send(result);
  }

  // POST /shipments — create shipment for an order
  app.post("/shipments", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createShipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_SHIPMENT_REQUEST", issues: parsed.error.issues });
    }

    const order = await getCommerceOrderByOrderId(db, parsed.data.order_id);
    if (!order) {
      return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    }

    // Verify requester is the seller of the referenced order
    if (request.user?.role !== "admin") {
      if (request.user!.id !== order.sellerId) {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "Only the seller can create a shipment" });
      }
    }

    const existingShipment = await getShipmentByOrderId(db, parsed.data.order_id, "outbound");
    if (existingShipment) {
      return reply.send({ shipment: existingShipment, idempotent: true });
    }

    const shipment = await createShipmentRecord(
      db,
      parsed.data.order_id,
      order.sellerId,
      order.buyerId,
      parsed.data.shipment_input_due_at,
    );

    return reply.code(201).send({ shipment });
  });

  // GET /shipments/:id
  app.get(
    "/shipments/:id",
    { preHandler: [requireAuth, requireShipmentOwner()] },
    async (request, reply) => {
      const shipment = await getShipmentById(db, (request.params as { id: string }).id);
      if (!shipment) {
        return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      }
      return reply.send({ shipment });
    },
  );

  // GET /shipments/by-order/:orderId
  app.get("/shipments/by-order/:orderId", { preHandler: [requireAuth] }, async (request, reply) => {
    const shipment = await getShipmentByOrderId(
      db,
      (request.params as { orderId: string }).orderId,
    );
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }
    if (request.user?.role !== "admin") {
      const userId = request.user!.id;
      if (userId !== shipment.buyer_id && userId !== shipment.seller_id) {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }
    }
    return reply.send({ shipment });
  });

  app.get(
    "/shipments/apv-adjustments/:adjustmentId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { adjustmentId } = request.params as { adjustmentId: string };
      if (!z.string().uuid().safeParse(adjustmentId).success)
        return reply.code(400).send({ error: "INVALID_ADJUSTMENT_ID" });
      const adjustment = await getShipmentApvReview(db, adjustmentId);
      if (!adjustment) return reply.code(404).send({ error: "APV_ADJUSTMENT_NOT_FOUND" });
      if (
        request.user?.role !== "admin" &&
        request.user?.id !== adjustment.seller_id &&
        request.user?.id !== adjustment.buyer_id
      ) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
      return reply.send({ adjustment });
    },
  );

  app.post(
    "/shipments/apv-adjustments/:adjustmentId/seller-review",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { adjustmentId } = request.params as { adjustmentId: string };
      if (!z.string().uuid().safeParse(adjustmentId).success)
        return reply.code(400).send({ error: "INVALID_ADJUSTMENT_ID" });
      const parsed = apvSellerReviewSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_REVIEW_REQUEST", issues: parsed.error.issues });
      const result = await submitShipmentApvSellerReview(db, {
        adjustmentId,
        sellerId: request.user!.id,
        requestId: parsed.data.request_id,
        reason: parsed.data.reason,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_ADJUSTMENT_NOT_FOUND" });
      if (result.outcome === "forbidden") return reply.code(403).send({ error: "FORBIDDEN" });
      if (result.outcome === "invalid_state")
        return reply.code(409).send({ error: "APV_REVIEW_NOT_AVAILABLE" });
      if (result.outcome === "request_conflict")
        return reply.code(409).send({ error: "APV_REVIEW_ALREADY_SUBMITTED" });
      if (result.outcome === "version_conflict")
        return reply.code(409).send({ error: "APV_REVIEW_VERSION_CONFLICT" });
      if (!("record" in result)) return reply.code(409).send({ error: "APV_REVIEW_CONFLICT" });
      if (result.outcome === "updated") {
        await auditShipmentAction(db, request, "shipment.apv_seller_review", {
          shipmentId: result.record.shipment_id,
          orderId: result.record.order_id,
          reason: "seller requested APV liability review",
          metadata: {
            adjustment_id: result.record.id,
            review_version: result.record.review_version,
          },
        });
      }
      return reply.send({ adjustment: result.record, idempotent: result.outcome === "duplicate" });
    },
  );

  app.post(
    "/shipments/apv-adjustments/:adjustmentId/decision",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { adjustmentId } = request.params as { adjustmentId: string };
      if (!z.string().uuid().safeParse(adjustmentId).success)
        return reply.code(400).send({ error: "INVALID_ADJUSTMENT_ID" });
      const parsed = apvReviewDecisionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_REVIEW_DECISION", issues: parsed.error.issues });
      const result = await decideShipmentApvReview(db, {
        adjustmentId,
        reviewerId: request.user!.id,
        requestId: parsed.data.request_id,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expected_version,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_ADJUSTMENT_NOT_FOUND" });
      if (result.outcome === "invalid_state")
        return reply.code(409).send({ error: "APV_REVIEW_NOT_PENDING" });
      if (result.outcome === "version_conflict")
        return reply.code(409).send({ error: "APV_REVIEW_VERSION_CONFLICT" });
      if (result.outcome === "forbidden" || result.outcome === "request_conflict") {
        return reply.code(409).send({ error: "APV_REVIEW_DECISION_CONFLICT" });
      }
      if (!("record" in result))
        return reply.code(409).send({ error: "APV_REVIEW_DECISION_CONFLICT" });
      if (result.outcome === "updated") {
        await auditShipmentAction(db, request, "shipment.apv_review_decision", {
          shipmentId: result.record.shipment_id,
          orderId: result.record.order_id,
          reason: "admin decided APV seller liability review",
          metadata: {
            adjustment_id: result.record.id,
            decision: result.record.review_status,
            review_version: result.record.review_version,
            buyer_effect_minor: 0,
          },
        });
      }
      return reply.send({ adjustment: result.record, idempotent: result.outcome === "duplicate" });
    },
  );

  app.get(
    "/shipments/apv-adjustments/:adjustmentId/revisions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { adjustmentId } = request.params as { adjustmentId: string };
      if (!z.string().uuid().safeParse(adjustmentId).success)
        return reply.code(400).send({ error: "INVALID_ADJUSTMENT_ID" });
      const adjustment = await getShipmentApvReview(db, adjustmentId);
      if (!adjustment) return reply.code(404).send({ error: "APV_ADJUSTMENT_NOT_FOUND" });
      if (
        request.user?.role !== "admin" &&
        request.user?.id !== adjustment.seller_id &&
        request.user?.id !== adjustment.buyer_id
      ) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
      const revisions = await listShipmentApvInvoiceRevisions(db, adjustmentId);
      return reply.send({ adjustment_id: adjustmentId, revisions });
    },
  );

  app.post(
    "/shipments/apv-revisions/:revisionId/decision",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { revisionId } = request.params as { revisionId: string };
      if (!z.string().uuid().safeParse(revisionId).success)
        return reply.code(400).send({ error: "INVALID_APV_REVISION_ID" });
      const parsed = apvRevisionDecisionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_REVISION_DECISION", issues: parsed.error.issues });
      const result = await applyShipmentApvInvoiceRevision(db, {
        revisionId,
        requestId: parsed.data.request_id,
        reviewerId: request.user!.id,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expected_version,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_REVISION_NOT_FOUND" });
      if (result.outcome === "invalid_decision")
        return reply.code(409).send({ error: "APV_REVISION_DECISION_MISMATCH" });
      if (result.outcome === "evidence_required")
        return reply.code(409).send({ error: "APV_REVISION_EVIDENCE_REQUIRED" });
      if (result.outcome === "predecessor_pending")
        return reply.code(409).send({ error: "APV_REVISION_PREDECESSOR_PENDING" });
      if (result.outcome === "aggregate_conflict")
        return reply.code(409).send({ error: "APV_REVISION_RECONCILIATION_REQUIRED" });
      if (result.outcome === "payout_reserved")
        return reply.code(409).send({ error: "APV_PAYOUT_ALREADY_RESERVED" });
      if (result.outcome === "invalid_state")
        return reply.code(409).send({ error: "APV_REVISION_STATE_CONFLICT" });
      if (result.outcome === "request_conflict")
        return reply.code(409).send({ error: "APV_REVISION_REQUEST_CONFLICT" });
      if (!("revision" in result))
        return reply.code(409).send({ error: "APV_REVISION_APPLICATION_CONFLICT" });
      if (result.outcome === "applied") {
        await auditShipmentAction(db, request, "shipment.apv_revision_decision", {
          reason: "admin applied APV invoice revision allocation",
          metadata: {
            revision_id: result.revision.id,
            adjustment_id: result.revision.adjustment_id,
            revision_number: result.revision.revision_number,
            decision: result.revision.decision,
            delta_minor: result.revision.delta_minor,
            buyer_effect_minor: 0,
          },
        });
      }
      return reply.send({ revision: result.revision, idempotent: result.outcome === "duplicate" });
    },
  );

  app.post(
    "/shipments/apv-revisions/:revisionId/evidence",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { revisionId } = request.params as { revisionId: string };
      if (!z.string().uuid().safeParse(revisionId).success)
        return reply.code(400).send({ error: "INVALID_APV_REVISION_ID" });
      const parsed = apvRevisionEvidenceSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_REVISION_EVIDENCE", issues: parsed.error.issues });
      const result = await bindShipmentApvRevisionEvidence(db, {
        revisionId,
        actorId: request.user!.id,
        documentSha256: parsed.data.document_sha256,
        providerDocumentId: parsed.data.provider_document_id,
        surchargeCategory: parsed.data.surcharge_category,
        surchargeType: parsed.data.surcharge_type,
        amountMinor: parsed.data.amount_minor,
        currency: parsed.data.currency,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_REVISION_NOT_FOUND" });
      if (result.outcome === "invalid_state")
        return reply.code(409).send({ error: "APV_REVISION_EVIDENCE_STATE_CONFLICT" });
      if (result.outcome === "amount_conflict")
        return reply.code(409).send({ error: "APV_REVISION_EVIDENCE_AMOUNT_CONFLICT" });
      if (result.outcome === "evidence_conflict")
        return reply.code(409).send({ error: "APV_REVISION_EVIDENCE_CONFLICT" });
      if (!("evidence" in result))
        return reply.code(409).send({ error: "APV_REVISION_EVIDENCE_UNAVAILABLE" });
      if (result.outcome === "bound") {
        await auditShipmentAction(db, request, "shipment.apv_evidence", {
          reason: "carrier invoice evidence bound to APV revision",
          metadata: {
            revision_id: result.evidence.revision_id,
            provider_document_id: result.evidence.provider_document_id,
            surcharge_category: result.evidence.surcharge_category,
            evidence_sha256: result.evidence.evidence_sha256,
          },
        });
      }
      return reply.send({ evidence: result.evidence, idempotent: result.outcome === "duplicate" });
    },
  );

  app.post(
    "/shipments/apv-revisions/:revisionId/invoice-document",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { revisionId } = request.params as { revisionId: string };
      if (!z.string().uuid().safeParse(revisionId).success)
        return reply.code(400).send({ error: "INVALID_APV_REVISION_ID" });
      const parsed = apvInvoiceDocumentSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_DOCUMENT", issues: parsed.error.issues });
      const bytes = Buffer.from(parsed.data.content_base64, "base64");
      if (bytes.toString("base64") !== parsed.data.content_base64) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_DOCUMENT_ENCODING" });
      }
      let result;
      try {
        result = await storeShipmentApvInvoiceDocument(db, {
          revisionId,
          providerDocumentId: parsed.data.provider_document_id,
          contentType: parsed.data.content_type,
          bytes,
          uploadedBy: request.user!.id,
        });
      } catch {
        return reply.code(503).send({ error: "APV_INVOICE_DOCUMENT_STORAGE_UNAVAILABLE" });
      }
      if (result.outcome === "revision_not_found")
        return reply.code(404).send({ error: "APV_REVISION_NOT_FOUND" });
      if (result.outcome === "evidence_not_bound")
        return reply.code(409).send({ error: "APV_REVISION_EVIDENCE_REQUIRED" });
      if (result.outcome === "evidence_mismatch")
        return reply.code(409).send({ error: "APV_INVOICE_DOCUMENT_EVIDENCE_MISMATCH" });
      if (result.outcome === "document_conflict")
        return reply.code(409).send({ error: "APV_INVOICE_DOCUMENT_CONFLICT" });
      if (result.outcome === "invalid_document")
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_DOCUMENT_BYTES" });
      if (!("document" in result))
        return reply.code(409).send({ error: "APV_INVOICE_DOCUMENT_UNAVAILABLE" });
      if (result.outcome === "stored") {
        await auditShipmentAction(db, request, "shipment.apv_invoice_document", {
          reason: "carrier invoice source document stored for APV revision",
          metadata: {
            revision_id: result.document.revision_id,
            provider_document_id: result.document.provider_document_id,
            content_type: result.document.content_type,
            byte_size: result.document.byte_size,
            sha256: result.document.sha256,
          },
        });
      }
      return reply
        .code(result.outcome === "stored" ? 201 : 200)
        .send({ document: result.document, idempotent: result.outcome === "duplicate" });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/health",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      try {
        return reply.send({ health: await getShipmentApvInvoiceDocumentStorageHealth(db) });
      } catch {
        return reply.code(503).send({ error: "APV_INVOICE_DOCUMENT_HEALTH_UNAVAILABLE" });
      }
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/reconcile",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const parsed = z
        .object({ dry_run: z.literal(true) })
        .strict()
        .safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "APV_INVOICE_DOCUMENT_DRY_RUN_REQUIRED" });
      try {
        return reply.send({
          reconciliation: await runShipmentApvInvoiceDocumentReconciliationDryRun(db),
        });
      } catch {
        return reply.code(503).send({ error: "APV_INVOICE_DOCUMENT_RECONCILIATION_UNAVAILABLE" });
      }
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/reconciliation-candidates",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      try {
        return reply.send({
          reconciliation_candidates: await discoverShipmentApvInvoiceReconciliationCandidates(db),
        });
      } catch {
        return reply.code(503).send({ error: "APV_INVOICE_RECONCILIATION_SCAN_UNAVAILABLE" });
      }
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/reconciliation-requests",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const parsed = apvInvoiceReconciliationRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RECONCILIATION_REQUEST" });
      const result = await requestShipmentApvInvoiceReconciliation(db, {
        clientRequestId: parsed.data.client_request_id,
        candidateId: parsed.data.candidate_id,
        requesterId: request.user!.id,
        reason: parsed.data.reason,
      });
      if (result.outcome === "candidate_not_found")
        return reply.code(404).send({ error: "APV_INVOICE_RECONCILIATION_CANDIDATE_NOT_FOUND" });
      if (result.outcome === "scan_truncated")
        return reply.code(409).send({ error: "APV_INVOICE_RECONCILIATION_SCAN_TRUNCATED" });
      if (result.outcome === "pending_conflict")
        return reply.code(409).send({ error: "APV_INVOICE_RECONCILIATION_ALREADY_PENDING" });
      if (result.outcome === "request_conflict")
        return reply.code(409).send({ error: "APV_INVOICE_RECONCILIATION_REQUEST_CONFLICT" });
      if (result.outcome === "invalid_request" || !("request" in result)) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RECONCILIATION_REQUEST" });
      }
      return reply.code(result.outcome === "requested" ? 201 : 200).send({
        reconciliation_request: result.request,
        idempotent: result.outcome === "duplicate",
      });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/reconciliation-requests/pending",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      return reply.send({
        reconciliation_requests: await listPendingShipmentApvInvoiceReconciliations(db),
      });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/reconciliation-requests/:requestId/timeline",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { requestId } = request.params as { requestId: string };
      if (!z.string().uuid().safeParse(requestId).success)
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RECONCILIATION_ID" });
      const timeline = await getShipmentApvInvoiceReconciliationTimeline(db, requestId);
      if (!timeline) return reply.code(404).send({ error: "APV_INVOICE_RECONCILIATION_NOT_FOUND" });
      return reply.send({ reconciliation_timeline: timeline });
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/reconciliation-requests/:requestId/decision",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { requestId } = request.params as { requestId: string };
      if (!z.string().uuid().safeParse(requestId).success)
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RECONCILIATION_ID" });
      const parsed = apvInvoiceReconciliationDecisionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RECONCILIATION_DECISION" });
      const result = await decideShipmentApvInvoiceReconciliation(db, {
        requestId,
        decisionRequestId: parsed.data.decision_request_id,
        approverId: request.user!.id,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expected_version,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_INVOICE_RECONCILIATION_NOT_FOUND" });
      if (result.outcome === "self_approval_forbidden")
        return reply
          .code(403)
          .send({ error: "APV_INVOICE_RECONCILIATION_SELF_APPROVAL_FORBIDDEN" });
      if (
        [
          "candidate_changed",
          "version_conflict",
          "invalid_state",
          "decision_conflict",
          "apply_state_lost",
        ].includes(result.outcome)
      ) {
        return reply
          .code(409)
          .send({ error: `APV_INVOICE_RECONCILIATION_${result.outcome.toUpperCase()}` });
      }
      if (result.outcome === "apply_failed")
        return reply.code(503).send({ error: "APV_INVOICE_RECONCILIATION_APPLY_FAILED" });
      if (result.outcome === "invalid_request" || !("request" in result)) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RECONCILIATION_DECISION" });
      }
      return reply.send({
        reconciliation_request: result.request,
        idempotent: result.outcome === "duplicate",
      });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/restoration-candidates",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      return reply.send({
        restoration_candidates: await listShipmentApvInvoiceRestorationCandidates(db),
      });
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/restoration-requests",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const parsed = apvInvoiceRestorationRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_REQUEST" });
      const bytes = Buffer.from(parsed.data.content_base64, "base64");
      if (bytes.toString("base64") !== parsed.data.content_base64) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_ENCODING" });
      }
      const result = await requestShipmentApvInvoiceRestoration(db, {
        clientRequestId: parsed.data.client_request_id,
        candidateId: parsed.data.candidate_id,
        requesterId: request.user!.id,
        reason: parsed.data.reason,
        contentType: parsed.data.content_type,
        bytes,
      });
      if (result.outcome === "candidate_not_found")
        return reply.code(404).send({ error: "APV_INVOICE_RESTORATION_CANDIDATE_NOT_FOUND" });
      if (result.outcome === "replacement_mismatch")
        return reply.code(409).send({ error: "APV_INVOICE_RESTORATION_REPLACEMENT_MISMATCH" });
      if (["pending_conflict", "request_conflict", "staging_conflict"].includes(result.outcome)) {
        return reply
          .code(409)
          .send({ error: `APV_INVOICE_RESTORATION_${result.outcome.toUpperCase()}` });
      }
      if (result.outcome === "invalid_request" || !("request" in result)) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_REQUEST" });
      }
      return reply
        .code(result.outcome === "requested" ? 201 : 200)
        .send({ restoration_request: result.request, idempotent: result.outcome === "duplicate" });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/restoration-requests/pending",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      return reply.send({
        restoration_requests: await listPendingShipmentApvInvoiceRestorations(db),
      });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/restoration-requests/:requestId/timeline",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { requestId } = request.params as { requestId: string };
      if (!z.string().uuid().safeParse(requestId).success)
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_ID" });
      const timeline = await getShipmentApvInvoiceRestorationTimeline(db, requestId);
      if (!timeline) return reply.code(404).send({ error: "APV_INVOICE_RESTORATION_NOT_FOUND" });
      return reply.send({ restoration_timeline: timeline });
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/restoration-requests/:requestId/decision",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { requestId } = request.params as { requestId: string };
      if (!z.string().uuid().safeParse(requestId).success)
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_ID" });
      const parsed = apvInvoiceRestorationDecisionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_DECISION" });
      const result = await decideShipmentApvInvoiceRestoration(db, {
        requestId,
        decisionRequestId: parsed.data.decision_request_id,
        approverId: request.user!.id,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expected_version,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_INVOICE_RESTORATION_NOT_FOUND" });
      if (result.outcome === "self_approval_forbidden")
        return reply.code(403).send({ error: "APV_INVOICE_RESTORATION_SELF_APPROVAL_FORBIDDEN" });
      if (
        ["candidate_changed", "version_conflict", "invalid_state", "decision_conflict"].includes(
          result.outcome,
        )
      ) {
        return reply
          .code(409)
          .send({ error: `APV_INVOICE_RESTORATION_${result.outcome.toUpperCase()}` });
      }
      if (result.outcome === "apply_failed")
        return reply.code(503).send({ error: "APV_INVOICE_RESTORATION_APPLY_FAILED" });
      if (result.outcome === "invalid_request" || !("request" in result)) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_DECISION" });
      }
      return reply.send({
        restoration_request: result.request,
        idempotent: result.outcome === "duplicate",
      });
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/restoration-staging/maintenance",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const parsed = apvInvoiceRestorationStagingMaintenanceSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_STAGING_MAINTENANCE" });
      const result = await maintainShipmentApvInvoiceRestorationStaging(db, {
        mode: parsed.data.mode,
        limit: parsed.data.limit,
        actorId: request.user!.id,
      });
      if ("outcome" in result)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_STAGING_MAINTENANCE" });
      return reply.send({ restoration_staging_maintenance: result });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/restoration-staging/health",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      return reply.send({
        restoration_staging_health: await getShipmentApvInvoiceRestorationStagingHealth(db),
        restoration_staging_maintenance:
          getShipmentApvInvoiceRestorationStagingMaintenanceJobStatus(),
        restoration_remediation_health: await getShipmentApvInvoiceRestorationRemediationHealth(db),
        restoration_remediation_expiry:
          getShipmentApvInvoiceRestorationRemediationExpiryJobStatus(),
      });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/restoration-remediation-candidates",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      return reply.send({
        restoration_remediation_candidates:
          await listShipmentApvInvoiceRestorationRemediationCandidates(db),
      });
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/restoration-remediation-requests",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const parsed = apvInvoiceRestorationRemediationRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_REQUEST" });
      const result = await requestShipmentApvInvoiceRestorationRemediation(db, {
        clientRequestId: parsed.data.client_request_id,
        candidateId: parsed.data.candidate_id,
        requesterId: request.user!.id,
        reason: parsed.data.reason,
      });
      if (result.outcome === "candidate_not_found") {
        return reply
          .code(404)
          .send({ error: "APV_INVOICE_RESTORATION_REMEDIATION_CANDIDATE_NOT_FOUND" });
      }
      if (["pending_conflict", "request_conflict"].includes(result.outcome)) {
        return reply
          .code(409)
          .send({ error: `APV_INVOICE_RESTORATION_REMEDIATION_${result.outcome.toUpperCase()}` });
      }
      if (result.outcome === "invalid_request" || !("request" in result)) {
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_REQUEST" });
      }
      return reply.code(result.outcome === "requested" ? 201 : 200).send({
        restoration_remediation_request: result.request,
        idempotent: result.outcome === "duplicate",
      });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/restoration-remediation-requests/pending",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      return reply.send({
        restoration_remediation_requests:
          await listPendingShipmentApvInvoiceRestorationRemediations(db),
      });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-queue",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const parsed = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          cursor: z
            .string()
            .min(1)
            .max(512)
            .regex(/^[A-Za-z0-9_-]+$/)
            .optional(),
        })
        .strict()
        .safeParse(request.query ?? {});
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_QUERY" });
      try {
        const queue = await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
          approverId: request.user!.id,
          limit: parsed.data.limit,
          cursor: parsed.data.cursor,
        });
        const cursorHealth = await getShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth(
          db,
        ).catch(() => null);
        const retentionJobHealth = await getShipmentApvRemediationCursorRetentionJobHealth(
          db,
        ).catch(() => null);
        const retentionJobStatus = getShipmentApvRemediationCursorRetentionJobStatus();
        return reply.send({
          restoration_remediation_recovery_queue: queue,
          restoration_remediation_recovery_cursor_health: cursorHealth,
          restoration_remediation_recovery_cursor_retention_job: {
            ...retentionJobStatus,
            health: retentionJobHealth,
            alertAssessment: retentionJobHealth
              ? evaluateShipmentApvCursorRetentionAlert({
                  ...retentionJobStatus,
                  health: retentionJobHealth,
                })
              : null,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          [
            "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR",
            "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR_EXPIRED",
          ].includes(error.message)
        ) {
          const reason = error.message.endsWith("_EXPIRED") ? "EXPIRED" : "INVALID";
          await recordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection(db, {
            reason,
          }).catch(() => undefined);
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/restoration-remediation-recovery-cursor-metrics/maintenance",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const parsed = z
        .object({
          retention_days: z.number().int().min(7).max(365).default(30),
          limit: z.number().int().min(1).max(1000).default(1000),
          dry_run: z.boolean().default(true),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!parsed.success)
        return reply.code(400).send({
          error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR_MAINTENANCE",
        });
      const maintenance =
        await maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics(db, {
          retentionDays: parsed.data.retention_days,
          limit: parsed.data.limit,
          dryRun: parsed.data.dry_run,
        });
      const retentionJobHealth = await getShipmentApvRemediationCursorRetentionJobHealth(db).catch(
        () => null,
      );
      const retentionJobStatus = getShipmentApvRemediationCursorRetentionJobStatus();
      return reply.send({
        restoration_remediation_recovery_cursor_maintenance: maintenance,
        restoration_remediation_recovery_cursor_retention_job: {
          ...retentionJobStatus,
          health: retentionJobHealth,
          alertAssessment: retentionJobHealth
            ? evaluateShipmentApvCursorRetentionAlert({
                ...retentionJobStatus,
                health: retentionJobHealth,
              })
            : null,
        },
      });
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/restoration-remediation-requests/:requestId/recovery-actions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { requestId } = request.params as { requestId: string };
      if (!z.string().uuid().safeParse(requestId).success) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_ID" });
      }
      const parsed = apvInvoiceRestorationRemediationAcknowledgmentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_ACTION" });
      }
      const result = await recordShipmentApvInvoiceRestorationRemediationAcknowledgment(db, {
        requestId,
        clientRequestId: parsed.data.client_request_id,
        decisionRequestId: parsed.data.decision_request_id,
        checkerId: request.user!.id,
        action: parsed.data.action,
        expectedVersion: parsed.data.expected_version,
        incidentReference: parsed.data.incident_reference,
      });
      if (result.outcome === "not_found") {
        return reply.code(404).send({ error: "APV_INVOICE_RESTORATION_REMEDIATION_NOT_FOUND" });
      }
      if (result.outcome === "not_stale_enough") {
        return reply
          .code(409)
          .send({ error: "APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_NOT_STALE_ENOUGH" });
      }
      if (result.outcome === "acknowledgment_required") {
        return reply
          .code(409)
          .send({ error: "APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_ACKNOWLEDGMENT_REQUIRED" });
      }
      if (
        ["invalid_state", "request_conflict", "incident_conflict", "action_conflict"].includes(
          result.outcome,
        )
      ) {
        return reply.code(409).send({
          error: `APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_${result.outcome.toUpperCase()}`,
        });
      }
      if (result.outcome === "invalid_request" || !("acknowledgment" in result)) {
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_ACTION" });
      }
      return reply.code(result.outcome === "recorded" ? 201 : 200).send({
        restoration_remediation_acknowledgment: result.acknowledgment,
        idempotent: result.outcome === "duplicate" || result.outcome === "already_recorded",
      });
    },
  );

  app.get(
    "/admin/shipments/apv-invoice-documents/restoration-remediation-requests/:requestId/timeline",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { requestId } = request.params as { requestId: string };
      if (!z.string().uuid().safeParse(requestId).success) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_ID" });
      }
      const timeline = await getShipmentApvInvoiceRestorationRemediationTimeline(db, requestId);
      if (!timeline)
        return reply.code(404).send({ error: "APV_INVOICE_RESTORATION_REMEDIATION_NOT_FOUND" });
      return reply.send({ restoration_remediation_timeline: timeline });
    },
  );

  app.post(
    "/admin/shipments/apv-invoice-documents/restoration-remediation-requests/:requestId/decision",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (request.user?.role !== "admin") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
      const { requestId } = request.params as { requestId: string };
      if (!z.string().uuid().safeParse(requestId).success) {
        return reply.code(400).send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_ID" });
      }
      const parsed = apvInvoiceRestorationRemediationDecisionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_DECISION" });
      const result = await decideShipmentApvInvoiceRestorationRemediation(db, {
        requestId,
        decisionRequestId: parsed.data.decision_request_id,
        approverId: request.user!.id,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expected_version,
      });
      if (result.outcome === "not_found") {
        return reply.code(404).send({ error: "APV_INVOICE_RESTORATION_REMEDIATION_NOT_FOUND" });
      }
      if (result.outcome === "self_approval_forbidden") {
        return reply
          .code(403)
          .send({ error: "APV_INVOICE_RESTORATION_REMEDIATION_SELF_APPROVAL_FORBIDDEN" });
      }
      if (
        ["candidate_changed", "version_conflict", "invalid_state", "decision_conflict"].includes(
          result.outcome,
        )
      ) {
        return reply
          .code(409)
          .send({ error: `APV_INVOICE_RESTORATION_REMEDIATION_${result.outcome.toUpperCase()}` });
      }
      if (result.outcome === "apply_failed") {
        return reply.code(503).send({ error: "APV_INVOICE_RESTORATION_REMEDIATION_APPLY_FAILED" });
      }
      if (result.outcome === "invalid_request" || !("request" in result)) {
        return reply
          .code(400)
          .send({ error: "INVALID_APV_INVOICE_RESTORATION_REMEDIATION_DECISION" });
      }
      return reply.send({
        restoration_remediation_request: result.request,
        idempotent: result.outcome === "duplicate",
      });
    },
  );

  app.get("/shipments/apv-liabilities", { preHandler: [requireAuth] }, async (request, reply) => {
    const query = z
      .object({ seller_id: z.string().uuid().optional() })
      .safeParse(request.query ?? {});
    if (!query.success)
      return reply
        .code(400)
        .send({ error: "INVALID_APV_LIABILITY_QUERY", issues: query.error.issues });
    if (query.data.seller_id && request.user?.role !== "admin")
      return reply.code(403).send({ error: "ADMIN_REQUIRED" });
    const sellerId = query.data.seller_id ?? request.user!.id;
    const liabilities = await listShipmentApvSellerLiabilities(db, sellerId);
    return reply.send({ seller_id: sellerId, liabilities });
  });

  // POST /shipments/:id/label — create shipping label (seller only)
  app.post(
    "/shipments/:id/label",
    { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] },
    async (request, reply) => {
      const shipment = await getShipmentById(db, (request.params as { id: string }).id);
      if (!shipment) {
        return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      }

      const carrier = shipment.carrier ?? (requiresRealShippingProvider() ? "easypost" : "mock");
      if (requiresRealShippingProvider() && !easypostApiKey) {
        return reply.code(503).send(realShippingUnavailable());
      }
      const idempotency = await beginShipmentOperationIdempotency(
        db,
        request,
        reply,
        "shipment.label",
        shipment.id,
      );
      if (idempotency.replayed) return;
      try {
        const result = await shippingService.createLabel({ ...shipment, carrier });
        await persistAndRespond(result, reply, db, {
          buyer_id: shipment.buyer_id,
          seller_id: shipment.seller_id,
        });
        await auditShipmentAction(db, request, "shipment.label_purchase", {
          shipmentId: shipment.id,
          orderId: shipment.order_id,
          reason: "shipment label created",
        });
        await completeShipmentOperation(
          db,
          "shipment.label",
          idempotency,
          200,
          result as unknown as Record<string, unknown>,
        );
      } catch (error) {
        const responseBody = {
          error: "LABEL_CREATION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
        await completeShipmentOperation(db, "shipment.label", idempotency, 400, responseBody);
        return reply.code(400).send(responseBody);
      }
    },
  );

  // POST /shipments/:id/prepare — seller provides from-address + parcel, gets rate quotes
  const prepareSchema = z
    .object({
      from_address_id: z.string().uuid().optional(),
      from_address: z
        .object({
          name: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
          street1: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
          street2: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
          city: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
          state: z.string().min(2).max(32),
          zip: z.string().min(3).max(16),
          country: z.string().max(2).default("US"),
          phone: z.string().max(32).optional(),
        })
        .optional(),
      parcel: z.object({
        length_in: z.number().positive(),
        width_in: z.number().positive(),
        height_in: z.number().positive(),
        weight_oz: z.number().positive(),
      }),
    })
    .refine((data) => (data.from_address_id != null) !== (data.from_address != null), {
      message: "Provide exactly one of from_address_id or from_address",
    });

  app.post(
    "/shipments/:id/prepare",
    { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] },
    async (request, reply) => {
      const shipmentId = (request.params as { id: string }).id;
      const shipment = await getShipmentById(db, shipmentId);
      if (!shipment) {
        return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      }

      if (shipment.status !== "LABEL_PENDING") {
        return reply
          .code(400)
          .send({ error: "INVALID_STATUS", message: "Shipment must be in LABEL_PENDING status" });
      }

      const parsed = prepareSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PREPARE_REQUEST", issues: parsed.error.issues });
      }

      const { from_address_id, from_address: rawFromAddress, parcel } = parsed.data;

      // Resolve from_address
      let fromAddress: {
        name: string;
        street1: string;
        street2?: string;
        city: string;
        state: string;
        zip: string;
        country: string;
        phone?: string;
      };
      if (from_address_id) {
        const savedAddr = await db.query.userSavedAddresses.findFirst({
          where: (fields, ops) =>
            ops.and(ops.eq(fields.id, from_address_id), ops.eq(fields.userId, request.user!.id)),
        });
        if (!savedAddr) {
          return reply.code(404).send({
            error: "ADDRESS_NOT_FOUND",
            message: "Saved address not found or does not belong to you",
          });
        }
        fromAddress = {
          name: savedAddr.name,
          street1: savedAddr.street1,
          street2: savedAddr.street2 ?? undefined,
          city: savedAddr.city,
          state: savedAddr.state,
          zip: savedAddr.zip,
          country: savedAddr.country,
          phone: savedAddr.phone ?? undefined,
        };
      } else {
        fromAddress = rawFromAddress!;
      }

      // Save seller's from_address to order_addresses
      // Upsert: delete existing seller address for this order, then insert
      await db
        .delete(orderAddresses)
        .where(
          andOp(
            eqOp(orderAddresses.orderId, shipment.order_id),
            eqOp(orderAddresses.role, "seller"),
          ),
        );
      await db.insert(orderAddresses).values({
        orderId: shipment.order_id,
        role: "seller",
        name: fromAddress.name,
        street1: fromAddress.street1,
        street2: fromAddress.street2,
        city: fromAddress.city,
        state: fromAddress.state,
        zip: fromAddress.zip,
        country: fromAddress.country,
        phone: fromAddress.phone,
      });

      // Look up buyer's address
      const buyerAddr = await db.query.orderAddresses.findFirst({
        where: (fields, ops) =>
          ops.and(ops.eq(fields.orderId, shipment.order_id), ops.eq(fields.role, "buyer")),
      });
      if (!buyerAddr) {
        return reply.code(400).send({
          error: "BUYER_ADDRESS_MISSING",
          message: "Buyer has not provided shipping address",
        });
      }

      const toAddress = {
        name: buyerAddr.name,
        street1: buyerAddr.street1,
        street2: buyerAddr.street2 ?? undefined,
        city: buyerAddr.city,
        state: buyerAddr.state,
        zip: buyerAddr.zip,
        country: buyerAddr.country,
        phone: buyerAddr.phone ?? undefined,
      };

      // Update shipment with parcel dimensions
      await db
        .update(shipmentsTable)
        .set({
          parcelLengthIn: String(parcel.length_in),
          parcelWidthIn: String(parcel.width_in),
          parcelHeightIn: String(parcel.height_in),
          parcelWeightOz: String(parcel.weight_oz),
          declaredWeightOz: String(parcel.weight_oz),
          updatedAt: new Date(),
        })
        .where(eqOp(shipmentsTable.id, shipmentId));

      // Get rate quotes — reuse the same logic as POST /shipments/rates
      const weightBuffer = computeWeightBuffer(parcel.weight_oz);

      if (easypostApiKey) {
        try {
          const EasyPost = (await import("@easypost/api")).default;
          const client = new EasyPost(easypostApiKey);
          const epShipment = await client.Shipment.create({
            from_address: {
              name: fromAddress.name,
              street1: fromAddress.street1,
              street2: fromAddress.street2,
              city: fromAddress.city,
              state: fromAddress.state,
              zip: fromAddress.zip,
              country: fromAddress.country,
            },
            to_address: {
              name: toAddress.name,
              street1: toAddress.street1,
              street2: toAddress.street2,
              city: toAddress.city,
              state: toAddress.state,
              zip: toAddress.zip,
              country: toAddress.country,
            },
            parcel: {
              weight: parcel.weight_oz,
              length: parcel.length_in,
              width: parcel.width_in,
              height: parcel.height_in,
            },
          });

          const quotedAt = new Date().toISOString();
          const rates = (epShipment.rates ?? []).map((r: any) => ({
            id: r.id ?? undefined,
            carrier: r.carrier ?? "unknown",
            service: r.service ?? "unknown",
            rate: r.rate ?? "0",
            rate_minor: Math.round(parseFloat(r.rate ?? "0") * 100),
            est_delivery_days: r.est_delivery_days ?? null,
            easypost_shipment_id: epShipment.id,
            source: "easypost" as const,
            quoted_at: quotedAt,
          }));

          const latestShipmentRow = await db.query.shipments.findFirst({
            where: (fields, ops) => ops.eq(fields.id, shipmentId),
          });
          await db
            .update(shipmentsTable)
            .set({
              metadata: {
                ...(latestShipmentRow?.metadata ?? {}),
                prepared_rate_quotes: rates,
                prepared_rate_quote_source: "easypost",
                prepared_rate_quote_at: quotedAt,
              },
              updatedAt: new Date(),
            })
            .where(eqOp(shipmentsTable.id, shipmentId));

          const updatedShipment = await getShipmentById(db, shipmentId);
          return reply.send({
            shipment: updatedShipment,
            rates,
            weight_buffer_minor: weightBuffer.buffer_amount_minor,
            source: "easypost",
          });
        } catch (error) {
          if (requiresRealShippingProvider()) {
            console.error("EasyPost rate fetch failed in /prepare:", safeRedactShippingLog(error));
            return reply.code(502).send(realShippingUnavailable(error));
          }
          console.error(
            "EasyPost rate fetch failed in /prepare, falling back to mock rates:",
            safeRedactShippingLog(error),
          );
        }
      }

      if (requiresRealShippingProvider()) {
        return reply.code(503).send(realShippingUnavailable());
      }

      // Mock rates fallback
      const quotedAt = new Date().toISOString();
      const mockRates = [
        {
          id: "rate_mock_ground",
          carrier: "USPS",
          service: "GroundAdvantage",
          rate: "5.50",
          rate_minor: 550,
          est_delivery_days: 5,
          source: "mock" as const,
          quoted_at: quotedAt,
        },
        {
          id: "rate_mock_priority",
          carrier: "USPS",
          service: "Priority",
          rate: "8.25",
          rate_minor: 825,
          est_delivery_days: 3,
          source: "mock" as const,
          quoted_at: quotedAt,
        },
        {
          id: "rate_mock_express",
          carrier: "USPS",
          service: "Express",
          rate: "26.35",
          rate_minor: 2635,
          est_delivery_days: 1,
          source: "mock" as const,
          quoted_at: quotedAt,
        },
        {
          id: "rate_mock_ups",
          carrier: "UPS",
          service: "Ground",
          rate: "9.50",
          rate_minor: 950,
          est_delivery_days: 5,
          source: "mock" as const,
          quoted_at: quotedAt,
        },
        {
          id: "rate_mock_fedex",
          carrier: "FedEx",
          service: "Ground",
          rate: "9.75",
          rate_minor: 975,
          est_delivery_days: 5,
          source: "mock" as const,
          quoted_at: quotedAt,
        },
      ];

      const latestShipmentRow = await db.query.shipments.findFirst({
        where: (fields, ops) => ops.eq(fields.id, shipmentId),
      });
      await db
        .update(shipmentsTable)
        .set({
          metadata: {
            ...(latestShipmentRow?.metadata ?? {}),
            prepared_rate_quotes: mockRates,
            prepared_rate_quote_source: "mock",
            prepared_rate_quote_at: quotedAt,
          },
          updatedAt: new Date(),
        })
        .where(eqOp(shipmentsTable.id, shipmentId));

      const updatedShipment = await getShipmentById(db, shipmentId);
      return reply.send({
        shipment: updatedShipment,
        rates: mockRates,
        weight_buffer_minor: weightBuffer.buffer_amount_minor,
        source: "mock",
      });
    },
  );

  // POST /shipments/:id/purchase-label — seller selects a rate and purchases label
  const purchaseLabelSchema = z.object({
    rate_id: z.string().min(1, "rate_id is required").max(INPUT_LIMITS.mediumTextChars),
  });
  const refundLabelSchema = z.object({
    reason: z.string().trim().min(3).max(500).default("Seller requested unused label refund"),
  });

  app.post(
    "/shipments/:id/purchase-label",
    { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] },
    async (request, reply) => {
      const shipmentId = (request.params as { id: string }).id;
      const shipment = await getShipmentById(db, shipmentId);
      if (!shipment) {
        return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      }

      if (shipment.status !== "LABEL_PENDING") {
        return reply.code(400).send({
          error: "INVALID_STATUS",
          message: "Shipment must be in LABEL_PENDING status (label not yet created)",
        });
      }

      // Verify parcel dimensions exist (seller must run /prepare first)
      const shipmentRow = await db.query.shipments.findFirst({
        where: (fields, ops) => ops.eq(fields.id, shipmentId),
      });
      if (!shipmentRow?.parcelWeightOz) {
        return reply.code(400).send({
          error: "PARCEL_NOT_SET",
          message: "Run POST /shipments/:id/prepare first to set parcel dimensions",
        });
      }

      const parsed = purchaseLabelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PURCHASE_REQUEST", issues: parsed.error.issues });
      }

      const { rate_id } = parsed.data;
      const idempotency = await beginShipmentOperationIdempotency(
        db,
        request,
        reply,
        "shipment.purchase_label",
        shipmentId,
      );
      if (idempotency.replayed) return;

      // Store selected_rate_id
      await db
        .update(shipmentsTable)
        .set({
          selectedRateId: rate_id,
          updatedAt: new Date(),
        })
        .where(eqOp(shipmentsTable.id, shipmentId));

      const preparedRates = preparedShipmentRatesFromMetadata(shipmentRow.metadata);
      const preparedRate = preparedRates.find((rate) => rate.id === rate_id);

      if (!preparedRate) {
        const responseBody = preparedRateNotFoundResponse(rate_id);
        await completeShipmentOperation(
          db,
          "shipment.purchase_label",
          idempotency,
          400,
          responseBody,
        );
        return reply.code(400).send(responseBody);
      }

      // If EasyPost is available and rate_id is an EasyPost prepared rate, buy exactly that prepared rate.
      if (easypostApiKey && rate_id.startsWith("rate_") && !rate_id.startsWith("rate_mock_")) {
        if (preparedRate.source !== "easypost" || !preparedRate.easypost_shipment_id) {
          const responseBody = {
            error: "RATE_SOURCE_MISMATCH",
            message:
              "Selected EasyPost rate does not belong to a prepared EasyPost shipment quote.",
            rate_id,
          };
          await completeShipmentOperation(
            db,
            "shipment.purchase_label",
            idempotency,
            400,
            responseBody,
          );
          return reply.code(400).send(responseBody);
        }

        try {
          const EasyPost = (await import("@easypost/api")).default;
          const client = new EasyPost(easypostApiKey);

          const epShipment = await client.Shipment.retrieve(preparedRate.easypost_shipment_id);
          const rateToBuy = epShipment.rates?.find((rate: any) => rate.id === rate_id);
          if (!rateToBuy) {
            const responseBody = {
              error: "PREPARED_RATE_UNAVAILABLE",
              message:
                "The prepared EasyPost rate is no longer available on the prepared shipment. Run /prepare again.",
              rate_id,
              easypost_shipment_id: preparedRate.easypost_shipment_id,
            };
            await completeShipmentOperation(
              db,
              "shipment.purchase_label",
              idempotency,
              409,
              responseBody,
            );
            return reply.code(409).send(responseBody);
          }

          const boughtShipment = await client.Shipment.buy(
            preparedRate.easypost_shipment_id,
            rateToBuy,
          );
          const labelQrCode = await createEasyPostLabelQrCode(
            client,
            boughtShipment.id,
            rateToBuy.carrier,
          );
          const shipmentMetadata = {
            ...(shipmentRow.metadata ?? {}),
            easypost_shipment_id: boughtShipment.id,
            easypost_rate_id: rateToBuy.id ?? null,
            label_qr_code_status: labelQrCode.status,
            label_qr_code_url: labelQrCode.url,
            label_qr_code_form_id: labelQrCode.formId,
            label_qr_code_reason: labelQrCode.reason,
            label_print_methods: labelQrCode.url ? ["pdf", "usps_label_broker_qr"] : ["pdf"],
          };

          // Update shipment in DB
          await db
            .update(shipmentsTable)
            .set({
              status: "LABEL_CREATED",
              carrier: rateToBuy.carrier ?? shipment.carrier,
              trackingNumber: boughtShipment.tracking_code ?? undefined,
              labelUrl: boughtShipment.postage_label?.label_url ?? undefined,
              rateMinor: String(Math.round(parseFloat(rateToBuy.rate ?? "0") * 100)),
              metadata: shipmentMetadata,
              labelRefundStatus: "NONE",
              labelRefundClaimId: null,
              labelRefundLeaseExpiresAt: null,
              labelRefundUpdatedAt: null,
              labelCreatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eqOp(shipmentsTable.id, shipmentId));

          // Record shipment event for LABEL_CREATED
          await insertShipmentEvent(db, {
            id: `evt_${Date.now()}`,
            shipment_id: shipmentId,
            status: "LABEL_CREATED",
            occurred_at: new Date().toISOString(),
            carrier_raw_status: boughtShipment.status ?? "pre_transit",
            message: `Label purchased via EasyPost (${rateToBuy.carrier} ${rateToBuy.service})`,
          });

          await updateCommerceOrderStatus(db, shipment.order_id, "FULFILLMENT_ACTIVE");

          const finalShipment = await getShipmentById(db, shipmentId);
          const responseBody = {
            shipment: finalShipment,
            label_url: boughtShipment.postage_label?.label_url ?? null,
            label_qr_code_url: labelQrCode.url,
            label_qr_code_available: Boolean(labelQrCode.url),
            label_qr_code_status: labelQrCode.status,
            tracking_number: boughtShipment.tracking_code ?? null,
          };
          await auditShipmentAction(db, request, "shipment.label_purchase", {
            shipmentId,
            orderId: shipment.order_id,
            reason: "shipment label purchased",
            metadata: {
              carrier: rateToBuy.carrier ?? null,
              service: rateToBuy.service ?? null,
            },
          });
          await completeShipmentOperation(
            db,
            "shipment.purchase_label",
            idempotency,
            200,
            responseBody as Record<string, unknown>,
          );
          return reply.send(responseBody);
        } catch (error) {
          const responseBody = {
            error: "LABEL_PURCHASE_FAILED",
            message: error instanceof Error ? error.message : String(error),
          };
          await completeShipmentOperation(
            db,
            "shipment.purchase_label",
            idempotency,
            400,
            responseBody,
          );
          return reply.code(400).send(responseBody);
        }
      }

      if (requiresRealShippingProvider()) {
        const responseBody = realShippingUnavailable();
        await completeShipmentOperation(
          db,
          "shipment.purchase_label",
          idempotency,
          503,
          responseBody,
        );
        return reply.code(503).send(responseBody);
      }

      if (preparedRate.source !== "mock") {
        const responseBody = {
          error: "RATE_SOURCE_MISMATCH",
          message: "Only mock prepared rates can be purchased without EasyPost.",
          rate_id,
        };
        await completeShipmentOperation(
          db,
          "shipment.purchase_label",
          idempotency,
          400,
          responseBody,
        );
        return reply.code(400).send(responseBody);
      }

      // Mock label purchase fallback
      const mockTrackingNumber = `MOCK${Date.now()}`;
      const mockLabelUrl = `https://mock-labels.example.com/${mockTrackingNumber}.pdf`;
      const mockQrCodeUrl = `https://mock-labels.example.com/${mockTrackingNumber}-qr.png`;

      await db
        .update(shipmentsTable)
        .set({
          status: "LABEL_CREATED",
          carrier: "mock",
          trackingNumber: mockTrackingNumber,
          labelUrl: mockLabelUrl,
          rateMinor:
            rate_id === "rate_mock_ground"
              ? "550"
              : rate_id === "rate_mock_priority"
                ? "825"
                : rate_id === "rate_mock_express"
                  ? "2635"
                  : rate_id === "rate_mock_ups"
                    ? "950"
                    : rate_id === "rate_mock_fedex"
                      ? "975"
                      : "550",
          metadata: {
            ...(shipmentRow.metadata ?? {}),
            label_qr_code_status: "created",
            label_qr_code_url: mockQrCodeUrl,
            label_qr_code_form_id: `form_mock_${mockTrackingNumber}`,
            label_print_methods: ["pdf", "usps_label_broker_qr"],
          },
          labelRefundStatus: "NONE",
          labelRefundClaimId: null,
          labelRefundLeaseExpiresAt: null,
          labelRefundUpdatedAt: null,
          labelCreatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eqOp(shipmentsTable.id, shipmentId));

      // Record shipment event for LABEL_CREATED
      await insertShipmentEvent(db, {
        id: `evt_${Date.now()}`,
        shipment_id: shipmentId,
        status: "LABEL_CREATED",
        occurred_at: new Date().toISOString(),
        carrier_raw_status: "pre_transit",
        message: "Label purchased (mock)",
      });

      // Sync order status
      await updateCommerceOrderStatus(db, shipment.order_id, "FULFILLMENT_ACTIVE");

      const finalShipment = await getShipmentById(db, shipmentId);
      const responseBody = {
        shipment: finalShipment,
        label_url: mockLabelUrl,
        label_qr_code_url: mockQrCodeUrl,
        label_qr_code_available: true,
        label_qr_code_status: "created",
        tracking_number: mockTrackingNumber,
      };
      await auditShipmentAction(db, request, "shipment.label_purchase", {
        shipmentId,
        orderId: shipment.order_id,
        reason: "mock shipment label purchased",
      });
      await completeShipmentOperation(
        db,
        "shipment.purchase_label",
        idempotency,
        200,
        responseBody as Record<string, unknown>,
      );
      return reply.send(responseBody);
    },
  );

  // POST /shipments/:id/refund-label — seller requests an unused EasyPost label refund.
  app.post(
    "/shipments/:id/refund-label",
    { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] },
    async (request, reply) => {
      const shipmentId = (request.params as { id: string }).id;
      const shipment = await getShipmentById(db, shipmentId);
      if (!shipment) return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      const parsed = refundLabelSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_LABEL_REFUND_REQUEST", issues: parsed.error.issues });

      const idempotency = await beginShipmentOperationIdempotency(
        db,
        request,
        reply,
        "shipment.refund_label",
        shipmentId,
      );
      if (idempotency.replayed) return;
      const claim = await claimShipmentLabelRefund(db, shipmentId);
      if (claim.outcome !== "acquired") {
        const statusMap = {
          in_progress: { code: 409, error: "LABEL_REFUND_IN_PROGRESS" },
          already_submitted: { code: 202, error: "LABEL_REFUND_SUBMITTED" },
          already_refunded: { code: 200, error: "LABEL_ALREADY_REFUNDED" },
          not_applicable: { code: 409, error: "LABEL_REFUND_NOT_APPLICABLE" },
          invalid_status: { code: 409, error: "LABEL_REFUND_NOT_ALLOWED" },
        } as const;
        const mapped = statusMap[claim.outcome];
        const responseBody = {
          error: mapped.error,
          refund_status: shipment.label_refund_status ?? "NONE",
          message:
            claim.outcome === "invalid_status"
              ? "Only an unscanned LABEL_CREATED shipment can request a label refund"
              : "The existing label refund state was preserved",
        };
        await completeShipmentOperation(
          db,
          "shipment.refund_label",
          idempotency,
          mapped.code,
          responseBody,
        );
        return reply.code(mapped.code).send(responseBody);
      }

      const providerShipmentId =
        typeof shipment.metadata?.easypost_shipment_id === "string"
          ? shipment.metadata.easypost_shipment_id
          : null;
      try {
        let providerStatus: ReturnType<typeof normalizeProviderLabelRefundStatus>;
        let providerMode: "easypost" | "mock" = "easypost";
        if (shipment.carrier === "mock" && !requiresRealShippingProvider()) {
          providerStatus = "REFUNDED";
          providerMode = "mock";
        } else {
          if (!easypostApiKey || !providerShipmentId) {
            await failShipmentLabelRefund(db, claim);
            const responseBody = realShippingUnavailable();
            await completeShipmentOperation(
              db,
              "shipment.refund_label",
              idempotency,
              503,
              responseBody,
            );
            return reply.code(503).send(responseBody);
          }
          const EasyPost = (await import("@easypost/api")).default;
          const client = new EasyPost(easypostApiKey);
          const refundedShipment = await client.Shipment.refund(providerShipmentId);
          providerStatus = normalizeProviderLabelRefundStatus(refundedShipment.refund_status);
        }
        if (!providerStatus) {
          await failShipmentLabelRefund(db, claim);
          const responseBody = {
            error: "LABEL_REFUND_PROVIDER_STATUS_INVALID",
            message: "Shipping provider returned an unknown refund state",
          };
          await completeShipmentOperation(
            db,
            "shipment.refund_label",
            idempotency,
            502,
            responseBody,
          );
          return reply.code(502).send(responseBody);
        }
        const completed = await completeShipmentLabelRefund(
          db,
          claim,
          providerStatus,
          providerShipmentId ?? `mock:${shipmentId}`,
        );
        if (!completed) {
          const responseBody = {
            error: "LABEL_REFUND_CLAIM_LOST",
            message: "Label refund state changed while the provider request was running",
          };
          await completeShipmentOperation(
            db,
            "shipment.refund_label",
            idempotency,
            409,
            responseBody,
          );
          return reply.code(409).send(responseBody);
        }
        await updateCommerceOrderStatus(
          db,
          shipment.order_id,
          providerStatus === "SUBMITTED" || providerStatus === "REFUNDED"
            ? "FULFILLMENT_PENDING"
            : "FULFILLMENT_ACTIVE",
        );
        await auditShipmentAction(db, request, "shipment.label_refund_request", {
          shipmentId,
          orderId: shipment.order_id,
          reason: parsed.data.reason,
          metadata: { provider: providerMode, refund_status: providerStatus },
        });
        const updated = await getShipmentById(db, shipmentId);
        const responseBody = {
          shipment: updated,
          refund_status: providerStatus,
          provider: providerMode,
          money_effect: "NONE",
          message:
            providerStatus === "SUBMITTED"
              ? "Carrier refund review is pending; do not hand off this label"
              : providerStatus === "REFUNDED"
                ? "Label refund confirmed; prepare and purchase a replacement label if fulfillment continues"
                : "Carrier did not confirm a label refund",
        };
        const responseCode = providerStatus === "SUBMITTED" ? 202 : 200;
        await completeShipmentOperation(
          db,
          "shipment.refund_label",
          idempotency,
          responseCode,
          responseBody as Record<string, unknown>,
        );
        return reply.code(responseCode).send(responseBody);
      } catch (error) {
        await failShipmentLabelRefund(db, claim);
        console.error("EasyPost label refund failed:", safeRedactShippingLog(error));
        const responseBody = {
          error: "LABEL_REFUND_PROVIDER_FAILED",
          message: "Shipping provider could not process the label refund request",
        };
        await completeShipmentOperation(
          db,
          "shipment.refund_label",
          idempotency,
          502,
          responseBody,
        );
        return reply.code(502).send(responseBody);
      }
    },
  );

  // POST /shipments/:id/refund-label/status — refresh an asynchronous provider refund.
  app.post(
    "/shipments/:id/refund-label/status",
    { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] },
    async (request, reply) => {
      const shipmentId = (request.params as { id: string }).id;
      const shipment = await getShipmentById(db, shipmentId);
      if (!shipment) return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      if (shipment.label_refund_status !== "SUBMITTED") {
        return reply.send({
          shipment,
          refund_status: shipment.label_refund_status ?? "NONE",
          refreshed: false,
        });
      }
      const providerShipmentId =
        typeof shipment.metadata?.easypost_shipment_id === "string"
          ? shipment.metadata.easypost_shipment_id
          : null;
      if (!easypostApiKey || !providerShipmentId)
        return reply.code(503).send(realShippingUnavailable());
      try {
        const EasyPost = (await import("@easypost/api")).default;
        const client = new EasyPost(easypostApiKey);
        const providerShipment = await client.Shipment.retrieve(providerShipmentId);
        const providerStatus = normalizeProviderLabelRefundStatus(providerShipment.refund_status);
        if (!providerStatus) {
          return reply.code(502).send({
            error: "LABEL_REFUND_PROVIDER_STATUS_INVALID",
            message: "Shipping provider returned an unknown refund state",
          });
        }
        await syncSubmittedShipmentLabelRefund(db, shipmentId, providerStatus, providerShipmentId);
        await updateCommerceOrderStatus(
          db,
          shipment.order_id,
          providerStatus === "SUBMITTED" || providerStatus === "REFUNDED"
            ? "FULFILLMENT_PENDING"
            : "FULFILLMENT_ACTIVE",
        );
        await auditShipmentAction(db, request, "shipment.label_refund_status", {
          shipmentId,
          orderId: shipment.order_id,
          reason: "label refund status refreshed",
          metadata: { refund_status: providerStatus },
        });
        return reply.send({
          shipment: await getShipmentById(db, shipmentId),
          refund_status: providerStatus,
          refreshed: true,
        });
      } catch (error) {
        console.error("EasyPost label refund status failed:", safeRedactShippingLog(error));
        return reply.code(502).send({
          error: "LABEL_REFUND_STATUS_FAILED",
          message: "Shipping provider refund status is temporarily unavailable",
        });
      }
    },
  );

  // POST /shipments/:id/return-label — buyer creates return label after dispute buyer_favor
  app.post(
    "/shipments/:id/return-label",
    { preHandler: [requireAuth, requireShipmentOwner({ role: "buyer" })] },
    async (request, reply) => {
      const shipmentId = (request.params as { id: string }).id;
      const shipment = await getShipmentById(db, shipmentId);
      if (!shipment) {
        return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      }

      // Validate: dispute for this order exists and outcome is buyer_favor
      const dispute = await getDisputeByOrderId(db, shipment.order_id);
      if (!dispute) {
        return reply
          .code(400)
          .send({ error: "NO_DISPUTE", message: "No dispute found for this order" });
      }

      // Check resolution outcome from dispute_resolutions table
      const resolutionRow = await db.query.disputeResolutions.findFirst({
        where: (fields, ops) => ops.eq(fields.disputeId, dispute.id),
        orderBy: (fields, { desc: descFn }) => [descFn(fields.createdAt)],
      });
      if (resolutionRow?.outcome !== "buyer_favor") {
        return reply.code(400).send({
          error: "DISPUTE_NOT_BUYER_FAVOR",
          message: "Return label can only be created when dispute outcome is buyer_favor",
        });
      }

      // Look up addresses from order_addresses
      const buyerAddr = await db.query.orderAddresses.findFirst({
        where: (fields, ops) =>
          ops.and(ops.eq(fields.orderId, shipment.order_id), ops.eq(fields.role, "buyer")),
      });
      const sellerAddr = await db.query.orderAddresses.findFirst({
        where: (fields, ops) =>
          ops.and(ops.eq(fields.orderId, shipment.order_id), ops.eq(fields.role, "seller")),
      });

      if (!buyerAddr) {
        return reply
          .code(400)
          .send({ error: "BUYER_ADDRESS_MISSING", message: "Buyer address not found" });
      }
      if (!sellerAddr) {
        return reply
          .code(400)
          .send({ error: "SELLER_ADDRESS_MISSING", message: "Seller address not found" });
      }

      const existingReturnShipment = await getShipmentByOrderId(db, shipment.order_id, "return");
      if (existingReturnShipment && existingReturnShipment.status !== "LABEL_PENDING") {
        return reply.send({
          shipment: existingReturnShipment,
          label_url: existingReturnShipment.label_url ?? null,
          label_qr_code_url: existingReturnShipment.label_qr_code_url ?? null,
          label_qr_code_available: Boolean(existingReturnShipment.label_qr_code_url),
          tracking_number: existingReturnShipment.tracking_number ?? null,
          idempotent: true,
        });
      }
      const idempotency = await beginShipmentOperationIdempotency(
        db,
        request,
        reply,
        "shipment.return_label",
        shipmentId,
      );
      if (idempotency.replayed) return;

      // Create or reuse the return shipment record. Reusing a pending row lets a
      // failed label attempt retry without creating duplicate return shipments.
      const returnShipmentRow =
        existingReturnShipment ??
        (await createShipmentRecord(
          db,
          shipment.order_id,
          shipment.seller_id,
          shipment.buyer_id,
          undefined,
          { shipmentType: "return" },
        ));

      // Attempt to create a return label via carrier
      const fromAddress = {
        name: buyerAddr.name,
        street1: buyerAddr.street1,
        street2: buyerAddr.street2 ?? undefined,
        city: buyerAddr.city,
        state: buyerAddr.state,
        zip: buyerAddr.zip,
        country: buyerAddr.country,
        phone: buyerAddr.phone ?? undefined,
      };
      const toAddress = {
        name: sellerAddr.name,
        street1: sellerAddr.street1,
        street2: sellerAddr.street2 ?? undefined,
        city: sellerAddr.city,
        state: sellerAddr.state,
        zip: sellerAddr.zip,
        country: sellerAddr.country,
        phone: sellerAddr.phone ?? undefined,
      };

      // Use parcel info from the original shipment if available
      const originalRow = await db.query.shipments.findFirst({
        where: (fields, ops) => ops.eq(fields.id, shipmentId),
      });

      let labelUrl: string | null = null;
      let trackingNumber: string | null = null;
      let labelQrCodeUrl: string | null = null;
      let labelQrCodeStatus: "created" | "unsupported" | "failed" | null = null;

      if (easypostApiKey && originalRow?.parcelWeightOz) {
        try {
          const EasyPost = (await import("@easypost/api")).default;
          const client = new EasyPost(easypostApiKey);
          const epShipment = await client.Shipment.create({
            from_address: {
              name: fromAddress.name,
              street1: fromAddress.street1,
              street2: fromAddress.street2,
              city: fromAddress.city,
              state: fromAddress.state,
              zip: fromAddress.zip,
              country: fromAddress.country,
            },
            to_address: {
              name: toAddress.name,
              street1: toAddress.street1,
              street2: toAddress.street2,
              city: toAddress.city,
              state: toAddress.state,
              zip: toAddress.zip,
              country: toAddress.country,
            },
            parcel: {
              weight: parseFloat(originalRow.parcelWeightOz),
              length: originalRow.parcelLengthIn
                ? parseFloat(originalRow.parcelLengthIn)
                : undefined,
              width: originalRow.parcelWidthIn ? parseFloat(originalRow.parcelWidthIn) : undefined,
              height: originalRow.parcelHeightIn
                ? parseFloat(originalRow.parcelHeightIn)
                : undefined,
            },
            is_return: true,
          });

          const lowestRate = epShipment.lowestRate();
          const boughtShipment = await client.Shipment.buy(epShipment.id, lowestRate);

          trackingNumber = boughtShipment.tracking_code ?? null;
          labelUrl = boughtShipment.postage_label?.label_url ?? null;
          const labelQrCode = await createEasyPostLabelQrCode(
            client,
            boughtShipment.id,
            lowestRate.carrier,
          );
          labelQrCodeUrl = labelQrCode.url;
          labelQrCodeStatus = labelQrCode.status;

          await db
            .update(shipmentsTable)
            .set({
              status: "LABEL_CREATED",
              carrier: lowestRate.carrier ?? "USPS",
              trackingNumber: trackingNumber ?? undefined,
              labelUrl: labelUrl ?? undefined,
              rateMinor: String(Math.round(parseFloat(lowestRate.rate ?? "0") * 100)),
              metadata: {
                ...((returnShipmentRow as { metadata?: Record<string, unknown> | null }).metadata ??
                  {}),
                easypost_shipment_id: boughtShipment.id,
                label_qr_code_status: labelQrCode.status,
                label_qr_code_url: labelQrCode.url,
                label_qr_code_form_id: labelQrCode.formId,
                label_qr_code_reason: labelQrCode.reason,
                label_print_methods: labelQrCode.url ? ["pdf", "usps_label_broker_qr"] : ["pdf"],
              },
              labelCreatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eqOp(shipmentsTable.id, returnShipmentRow.id));
        } catch (error) {
          if (requiresRealShippingProvider()) {
            console.error("EasyPost return label creation failed:", safeRedactShippingLog(error));
            const responseBody = realShippingUnavailable(error);
            await completeShipmentOperation(
              db,
              "shipment.return_label",
              idempotency,
              502,
              responseBody,
            );
            return reply.code(502).send(responseBody);
          }
          console.error(
            "EasyPost return label creation failed, falling back to mock:",
            safeRedactShippingLog(error),
          );
        }
      }

      // Mock fallback
      if (!trackingNumber) {
        if (requiresRealShippingProvider()) {
          const responseBody = realShippingUnavailable();
          await completeShipmentOperation(
            db,
            "shipment.return_label",
            idempotency,
            503,
            responseBody,
          );
          return reply.code(503).send(responseBody);
        }

        const mockTracking = `RET${Date.now()}`;
        const mockLabel = `https://mock-labels.example.com/${mockTracking}.pdf`;

        trackingNumber = mockTracking;
        labelUrl = mockLabel;
        labelQrCodeUrl = `https://mock-labels.example.com/${mockTracking}-qr.png`;
        labelQrCodeStatus = "created";

        await db
          .update(shipmentsTable)
          .set({
            status: "LABEL_CREATED",
            carrier: "mock",
            trackingNumber: mockTracking,
            labelUrl: mockLabel,
            rateMinor: "550",
            metadata: {
              ...((returnShipmentRow as { metadata?: Record<string, unknown> | null }).metadata ??
                {}),
              label_qr_code_status: labelQrCodeStatus,
              label_qr_code_url: labelQrCodeUrl,
              label_qr_code_form_id: `form_mock_${mockTracking}`,
              label_print_methods: ["pdf", "usps_label_broker_qr"],
            },
            labelCreatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eqOp(shipmentsTable.id, returnShipmentRow.id));
      }

      // Record event
      await insertShipmentEvent(db, {
        id: `evt_${Date.now()}`,
        shipment_id: returnShipmentRow.id,
        status: "LABEL_CREATED",
        occurred_at: new Date().toISOString(),
        carrier_raw_status: "pre_transit",
        message: "Return label created",
      });

      const finalShipment = await getShipmentById(db, returnShipmentRow.id);
      const responseBody = {
        shipment: finalShipment,
        label_url: labelUrl,
        label_qr_code_url: labelQrCodeUrl,
        label_qr_code_available: Boolean(labelQrCodeUrl),
        label_qr_code_status: labelQrCodeStatus,
        tracking_number: trackingNumber,
      };
      await auditShipmentAction(db, request, "shipment.return_label_purchase", {
        shipmentId: returnShipmentRow.id,
        orderId: shipment.order_id,
        reason: "return label purchased",
      });
      await completeShipmentOperation(
        db,
        "shipment.return_label",
        idempotency,
        201,
        responseBody as Record<string, unknown>,
      );
      return reply.code(201).send(responseBody);
    },
  );

  // POST /shipments/:id/event — record a shipment event (seller only)
  app.post(
    "/shipments/:id/event",
    { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] },
    async (request, reply) => {
      if (requiresRealShippingProvider() && request.user?.role !== "admin") {
        return reply.code(403).send({
          error: "MANUAL_SHIPMENT_EVENTS_DISABLED",
          message: "Carrier webhooks must drive shipment status in production",
        });
      }

      const shipment = await getShipmentById(db, (request.params as { id: string }).id);
      if (!shipment) {
        return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      }
      const parsed = recordEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_EVENT", issues: parsed.error.issues });
      }

      if (
        shipment.label_refund_status === "REQUESTING" ||
        shipment.label_refund_status === "SUBMITTED" ||
        shipment.label_refund_status === "REFUNDED"
      ) {
        return reply.code(409).send({
          error: "LABEL_REFUND_BLOCKS_SHIPMENT_EVENT",
          message:
            "This label cannot be advanced while its refund is requesting, submitted, or refunded",
        });
      }

      const internalEventId = parsed.data.event_id
        ? manualShipmentEventId(shipment.id, parsed.data.event_id)
        : null;
      if (internalEventId && shipment.events.some((event) => event.id === internalEventId)) {
        return reply.send({ shipment, trust_triggers: [], idempotent: true });
      }

      try {
        const payload = parsed.data.payload as
          | Partial<
              Pick<
                import("@haggle/shipping-core").ShipmentEvent,
                "carrier_raw_status" | "message" | "location"
              >
            >
          | undefined;
        const result = shippingService.recordEvent(shipment, parsed.data.event_type, {
          ...payload,
          carrier_raw_status: parsed.data.raw_status ?? payload?.carrier_raw_status,
        });
        const newEvent = result.shipment.events[result.shipment.events.length - 1];
        if (newEvent && internalEventId) newEvent.id = internalEventId;
        await persistShipmentUpdate(
          result,
          db,
          { buyer_id: shipment.buyer_id, seller_id: shipment.seller_id },
          newEvent,
        );
        return reply.send({ ...result, idempotent: false });
      } catch (error) {
        return reply.code(400).send({
          error: "EVENT_RECORD_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // POST /shipments/:id/track — poll carrier for tracking update
  app.post(
    "/shipments/:id/track",
    { preHandler: [requireAuth, requireShipmentOwner()] },
    async (request, reply) => {
      const shipment = await getShipmentById(db, (request.params as { id: string }).id);
      if (!shipment) {
        return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      }

      try {
        const result = await shippingService.trackShipment(shipment);
        await persistAndRespond(result, reply, db, {
          buyer_id: shipment.buyer_id,
          seller_id: shipment.seller_id,
        });
      } catch (error) {
        return reply.code(400).send({
          error: "TRACKING_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // POST /shipments/rates — get shipping rate quotes
  const rateRequestSchema = z.object({
    from_address: z.object({
      name: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street1: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street2: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
      city: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      state: z.string().min(2).max(32),
      zip: z.string().min(3).max(16),
      country: z.string().max(2).default("US"),
    }),
    to_address: z.object({
      name: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street1: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street2: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
      city: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      state: z.string().min(2).max(32),
      zip: z.string().min(3).max(16),
      country: z.string().max(2).default("US"),
    }),
    parcel: z.object({
      weight_oz: z.number().positive().max(MAX_PARCEL_WEIGHT_OZ),
      length_in: z.number().positive().max(MAX_PARCEL_DIMENSION_IN).optional(),
      width_in: z.number().positive().max(MAX_PARCEL_DIMENSION_IN).optional(),
      height_in: z.number().positive().max(MAX_PARCEL_DIMENSION_IN).optional(),
    }),
  });

  app.post("/shipments/rates", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = rateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_RATE_REQUEST", issues: parsed.error.issues });
    }

    const { from_address, to_address, parcel } = parsed.data;
    const quoteKey = rateQuoteKeyFor(parsed.data);
    const ttlSeconds = shippingRateCacheTtlSeconds();
    const cachedQuote = shippingRateQuoteCache.get(quoteKey);
    const nowMs = Date.now();

    if (cachedQuote && cachedQuote.expiresAtMs > nowMs) {
      return reply.send({ ...cachedQuote.body, cache_hit: true });
    }

    if (cachedQuote) {
      shippingRateQuoteCache.delete(quoteKey);
    }

    const missBudget = await consumeShippingRateMissBudget(
      db,
      `shipping_rate_miss:${request.user!.id}`,
      shippingRateMissLimitPerMinute(),
    );
    if (!missBudget.allowed) {
      reply.header("Retry-After", String(missBudget.retryAfterSeconds));
      return reply.code(429).send({
        error: "SHIPPING_RATE_LIMITED",
        message: "Too many uncached shipping rate requests. Retry after the current rate window.",
        retry_after_seconds: missBudget.retryAfterSeconds,
      });
    }

    // Weight buffer calculation
    const weightBuffer = computeWeightBuffer(parcel.weight_oz);

    // Try EasyPost rate shopping if available
    if (easypostApiKey) {
      try {
        const EasyPost = (await import("@easypost/api")).default;
        const client = new EasyPost(easypostApiKey);
        const epShipment = await client.Shipment.create({
          from_address: {
            name: from_address.name,
            street1: from_address.street1,
            street2: from_address.street2,
            city: from_address.city,
            state: from_address.state,
            zip: from_address.zip,
            country: from_address.country,
          },
          to_address: {
            name: to_address.name,
            street1: to_address.street1,
            street2: to_address.street2,
            city: to_address.city,
            state: to_address.state,
            zip: to_address.zip,
            country: to_address.country,
          },
          parcel: {
            weight: parcel.weight_oz,
            length: parcel.length_in,
            width: parcel.width_in,
            height: parcel.height_in,
          },
        });

        const rates = (epShipment.rates ?? []).map((r: any) => ({
          carrier: r.carrier ?? "unknown",
          service: r.service ?? "unknown",
          rate: r.rate ?? "0",
          rate_minor: Math.round(parseFloat(r.rate ?? "0") * 100),
          est_delivery_days: r.est_delivery_days ?? null,
        }));

        const responseBody = buildRateQuoteResponse({
          rates,
          weightBufferMinor: weightBuffer.buffer_amount_minor,
          source: "easypost",
          quoteKey,
          ttlSeconds,
        });
        cacheRateQuote(responseBody);
        return reply.send(responseBody);
      } catch (error) {
        if (requiresRealShippingProvider()) {
          console.error("EasyPost rate fetch failed:", safeRedactShippingLog(error));
          return reply.code(502).send(realShippingUnavailable(error));
        }
        console.error(
          "EasyPost rate fetch failed, falling back to mock rates:",
          safeRedactShippingLog(error),
        );
      }
    }

    if (requiresRealShippingProvider()) {
      return reply.code(503).send(realShippingUnavailable());
    }

    // Mock rates fallback
    const mockRates = [
      {
        carrier: "USPS",
        service: "GroundAdvantage",
        rate: "5.50",
        rate_minor: 550,
        est_delivery_days: 5,
      },
      { carrier: "USPS", service: "Priority", rate: "8.25", rate_minor: 825, est_delivery_days: 3 },
      {
        carrier: "USPS",
        service: "Express",
        rate: "26.35",
        rate_minor: 2635,
        est_delivery_days: 1,
      },
      { carrier: "UPS", service: "Ground", rate: "9.50", rate_minor: 950, est_delivery_days: 5 },
      { carrier: "FedEx", service: "Ground", rate: "9.75", rate_minor: 975, est_delivery_days: 5 },
    ];

    const responseBody = buildRateQuoteResponse({
      rates: mockRates,
      weightBufferMinor: weightBuffer.buffer_amount_minor,
      source: "mock",
      quoteKey,
      ttlSeconds,
    });
    cacheRateQuote(responseBody);
    return reply.send(responseBody);
  });

  // POST /shipments/webhooks/easypost — receive EasyPost tracking webhook
  app.post(
    "/shipments/webhooks/easypost",
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      const rawBody =
        (request as unknown as { rawBody?: string | Buffer }).rawBody ??
        JSON.stringify(request.body);
      // In production, reject webhooks if secret is not configured.
      if (!easypostWebhookSecret) {
        if (process.env.NODE_ENV === "production") {
          return reply.code(401).send({ error: "EASYPOST_WEBHOOK_SECRET_NOT_CONFIGURED" });
        }
        // In development/test, skip signature verification.
      } else {
        const isValid = verifyEasyPostWebhook(
          rawBody,
          request.headers as Record<string, string>,
          easypostWebhookSecret,
          { method: request.method },
        );
        if (!isValid) {
          await auditShipmentAction(db, request, "shipment.webhook_rejected", {
            reason: "invalid EasyPost webhook signature",
          });
          return reply.code(401).send({ error: "INVALID_WEBHOOK_SIGNATURE" });
        }
      }

      const webhookEventId = getCarrierWebhookEventId(request.body, "easypost");
      const webhookClaim = await claimWebhookEvent(db, {
        source: "easypost",
        eventId: webhookEventId,
        payloadSha256: webhookPayloadSha256(rawBody),
      });
      if (webhookClaim.outcome === "duplicate") {
        return reply.send({ accepted: true, action: "duplicate", reason: "already_processed" });
      }
      if (webhookClaim.outcome === "payload_conflict") {
        return reply.code(409).send({ accepted: false, error: "WEBHOOK_PAYLOAD_CONFLICT" });
      }
      if (webhookClaim.outcome !== "acquired") {
        return reply.code(503).send({ accepted: false, error: "WEBHOOK_PROCESSING_IN_PROGRESS" });
      }
      const stopEasyPostHeartbeat = startWebhookClaimHeartbeat(db, webhookClaim);
      reply.raw.once("finish", stopEasyPostHeartbeat);
      await auditShipmentAction(db, request, "shipment.webhook_received", {
        reason: "EasyPost webhook received",
        metadata: {
          event_id: webhookEventId,
          description: (request.body as Record<string, unknown> | undefined)?.description,
        },
      });

      // Check if this is a ShipmentInvoice (APV weight adjustment) event
      const invoice = parseEasyPostInvoicePayload(request.body);
      if (invoice) {
        let acquiredApvClaim: Extract<
          Awaited<ReturnType<typeof claimShipmentApvAdjustment>>,
          { outcome: "acquired" }
        > | null = null;
        try {
          // Look up shipment by tracking code
          const shipmentRow = await getShipmentByTrackingNumber(db, invoice.tracking_code);

          if (!shipmentRow) {
            console.warn("APV invoice: shipment not found");
            await completeWebhookEvent(db, webhookClaim, 200);
            return reply.send({
              accepted: true,
              skipped: true,
              reason: "shipment not found for invoice",
            });
          }

          // Look up settlement release by order
          const release = await getSettlementReleaseByOrderId(db, shipmentRow.order_id);
          if (!release) {
            console.warn("APV invoice: no settlement release for order", {
              order_id: shipmentRow.order_id,
            });
            await completeWebhookEvent(db, webhookClaim, 200);
            return reply.send({
              accepted: true,
              skipped: true,
              reason: "settlement release not found",
            });
          }

          const providerShipmentId =
            typeof shipmentRow.metadata?.easypost_shipment_id === "string"
              ? shipmentRow.metadata.easypost_shipment_id
              : null;
          if (!providerShipmentId) {
            await completeWebhookEvent(db, webhookClaim, 409);
            return reply
              .code(409)
              .send({ accepted: false, error: "APV_PROVIDER_SHIPMENT_ID_MISSING" });
          }
          if (providerShipmentId !== invoice.shipment_id) {
            await completeWebhookEvent(db, webhookClaim, 409);
            return reply.code(409).send({ accepted: false, error: "APV_SHIPMENT_ID_MISMATCH" });
          }

          const apvInput = {
            provider: "easypost",
            providerInvoiceId: invoice.invoice_id,
            shipmentId: shipmentRow.id,
            orderId: shipmentRow.order_id,
            settlementReleaseId: release.id,
            originalRateMinor: invoice.original_rate_minor,
            adjustedRateMinor: invoice.adjusted_rate_minor,
            adjustmentMinor: invoice.adjustment_minor,
            invoiceEvent: invoice.invoice_event,
            webhookEventId,
          };
          if (invoice.invoice_event === "updated") {
            const revision = await recordShipmentApvInvoiceRevision(db, {
              ...apvInput,
              invoiceEvent: "updated",
              webhookEventId,
            });
            if (revision.outcome === "not_found" || revision.outcome === "base_revision_missing") {
              await failWebhookEvent(db, webhookClaim);
              return reply
                .code(503)
                .send({ accepted: false, error: "APV_REVISION_BASE_NOT_READY" });
            }
            if (revision.outcome === "identity_conflict") {
              await completeWebhookEvent(db, webhookClaim, 409);
              return reply
                .code(409)
                .send({ accepted: false, error: "APV_REVISION_IDENTITY_CONFLICT" });
            }
            if (revision.outcome === "amount_conflict") {
              await completeWebhookEvent(db, webhookClaim, 409);
              return reply
                .code(409)
                .send({ accepted: false, error: "APV_REVISION_AMOUNT_CONFLICT" });
            }
            if (revision.outcome === "payout_reserved") {
              await completeWebhookEvent(db, webhookClaim, 409);
              return reply
                .code(409)
                .send({ accepted: false, error: "APV_PAYOUT_ALREADY_RESERVED" });
            }
            if (!("revision" in revision)) {
              await failWebhookEvent(db, webhookClaim);
              return reply.code(503).send({ accepted: false, error: "APV_REVISION_UNAVAILABLE" });
            }
            await auditShipmentAction(db, request, "shipment.apv_revision", {
              shipmentId: shipmentRow.id,
              orderId: shipmentRow.order_id,
              reason: "EasyPost invoice revision recorded for manual review",
              metadata: {
                revision_number: revision.revision.revision_number,
                delta_minor: revision.revision.delta_minor,
                status: revision.revision.status,
                idempotent: revision.outcome === "duplicate",
              },
            });
            await completeWebhookEvent(db, webhookClaim, 202);
            return reply.code(202).send({
              accepted: true,
              idempotent: revision.outcome === "duplicate",
              manual_review_required: true,
              revision: revision.revision,
              money_effect: "NONE_PENDING_REVIEW",
            });
          }

          const apvClaim = await claimShipmentApvAdjustment(db, apvInput);
          if (apvClaim.outcome === "payout_reserved") {
            await completeWebhookEvent(db, webhookClaim, 409);
            return reply.code(409).send({ accepted: false, error: "APV_PAYOUT_ALREADY_RESERVED" });
          }
          if (apvClaim.outcome === "payload_conflict") {
            await completeWebhookEvent(db, webhookClaim, 409);
            return reply.code(409).send({ accepted: false, error: "APV_INVOICE_PAYLOAD_CONFLICT" });
          }
          if (apvClaim.outcome === "in_progress") {
            await failWebhookEvent(db, webhookClaim);
            return reply.code(503).send({ accepted: false, error: "APV_INVOICE_PROCESSING" });
          }
          if (apvClaim.outcome === "duplicate") {
            await completeWebhookEvent(db, webhookClaim, 200);
            return reply.send({ accepted: true, idempotent: true, adjustment: apvClaim.record });
          }

          acquiredApvClaim = apvClaim;
          const adjustment = await completeShipmentApvAdjustment(db, apvClaim, apvInput);
          await auditShipmentAction(db, request, "shipment.apv_adjustment", {
            shipmentId: shipmentRow.id,
            orderId: shipmentRow.order_id,
            reason: "EasyPost shipment invoice applied",
            metadata: {
              status: adjustment.status,
              buffer_applied_minor: adjustment.buffer_applied_minor,
              seller_liability_minor: adjustment.seller_liability_minor,
              carrier_credit_minor: adjustment.carrier_credit_minor,
              buyer_effect_minor: adjustment.buyer_effect_minor,
            },
          });
          await completeWebhookEvent(db, webhookClaim, 200);
          return reply.send({
            accepted: true,
            idempotent: false,
            adjustment,
            fairness: {
              buyer_effect_minor: 0,
              seller_declared_package_responsibility: true,
            },
          });
        } catch (error) {
          if (acquiredApvClaim) {
            await failShipmentApvAdjustment(db, acquiredApvClaim);
          }
          await failWebhookEvent(db, webhookClaim);
          console.error("APV invoice processing error:", safeRedactShippingLog(error));
          return reply.code(500).send({ accepted: false, error: "invoice processing failed" });
        }
      }

      const parsed = parseEasyPostWebhookPayload(request.body);
      if (!parsed) {
        await completeWebhookEvent(db, webhookClaim, 200);
        return reply.send({ accepted: true, skipped: true, reason: "not a tracker event" });
      }

      const shipment = await getShipmentByTrackingNumber(db, parsed.tracking_code);
      if (!shipment) {
        await completeWebhookEvent(db, webhookClaim, 200);
        return reply.send({ accepted: true, skipped: true, reason: "shipment not found" });
      }

      try {
        const eventTime = normalizeCarrierEventTime(parsed.occurred_at, new Date());
        const carrierResult = await applyCarrierShipmentEvent(db, {
          shipmentId: shipment.id,
          eventKey: webhookEventId,
          incomingStatus: parsed.status,
          occurredAt: eventTime.occurredAt,
          carrierRawStatus: parsed.carrier_raw_status,
          message: parsed.message,
          location: parsed.location,
          timestampSource: eventTime.source,
        });
        if (!carrierResult) {
          await completeWebhookEvent(db, webhookClaim, 200);
          return reply.send({ accepted: true, skipped: true, reason: "shipment not found" });
        }
        if (carrierResult.effectsRequired) {
          await applyShipmentSideEffects(
            { shipment: carrierResult.shipment, trust_triggers: [] },
            db,
            { buyer_id: shipment.buyer_id, seller_id: shipment.seller_id },
          );
        }
        await completeWebhookEvent(db, webhookClaim, 200);
        return reply.send({
          accepted: true,
          tracking_code: parsed.tracking_code,
          event_status: parsed.status,
          new_status: carrierResult.shipment.status,
          state_changed: carrierResult.stateChanged,
          ordering_disposition: carrierResult.disposition,
          occurred_at: eventTime.occurredAt.toISOString(),
          timestamp_source: eventTime.source,
        });
      } catch (error) {
        await failWebhookEvent(db, webhookClaim);
        console.error("EasyPost tracker persistence error:", safeRedactShippingLog(error));
        return reply.code(500).send({ accepted: false, error: "tracker processing failed" });
      }
    },
  );

  // POST /shipments/webhooks/:carrier — generic carrier webhook (fallback)
  app.post("/shipments/webhooks/:carrier", async (request, reply) => {
    if (requiresRealShippingProvider()) {
      return reply.code(404).send({ error: "CARRIER_WEBHOOK_NOT_CONFIGURED" });
    }

    const { carrier } = request.params as { carrier: string };
    return reply.send({
      accepted: true,
      carrier,
      received_at: new Date().toISOString(),
    });
  });
}
