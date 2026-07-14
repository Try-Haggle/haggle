import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const shipments = pgTable("shipments", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  sellerId: uuid("seller_id").notNull(),
  buyerId: uuid("buyer_id").notNull(),
  status: text("status", {
    enum: [
      "LABEL_PENDING",
      "LABEL_CREATED",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "DELIVERY_EXCEPTION",
      "RETURN_IN_TRANSIT",
      "RETURNED",
    ],
  })
    .notNull()
    .default("LABEL_PENDING"),
  shipmentType: text("shipment_type").notNull().default("outbound"),
  carrier: text("carrier"),
  trackingNumber: text("tracking_number"),
  labelCreatedAt: timestamp("label_created_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  lastCarrierEventAt: timestamp("last_carrier_event_at", { withTimezone: true }),
  lastCarrierEventKey: text("last_carrier_event_key"),
  shipmentInputDueAt: timestamp("shipment_input_due_at", { withTimezone: true }),
  shippingFeeMinor: numeric("shipping_fee_minor", { precision: 18, scale: 0 }),
  currency: text("currency").notNull().default("USD"),
  declaredWeightOz: numeric("declared_weight_oz", { precision: 10, scale: 2 }),
  parcelLengthIn: numeric("parcel_length_in", { precision: 10, scale: 2 }),
  parcelWidthIn: numeric("parcel_width_in", { precision: 10, scale: 2 }),
  parcelHeightIn: numeric("parcel_height_in", { precision: 10, scale: 2 }),
  parcelWeightOz: numeric("parcel_weight_oz", { precision: 10, scale: 2 }),
  selectedRateId: text("selected_rate_id"),
  labelUrl: text("label_url"),
  labelRefundStatus: text("label_refund_status", {
    enum: ["NONE", "REQUESTING", "SUBMITTED", "REFUNDED", "REJECTED", "NOT_APPLICABLE", "FAILED"],
  }).notNull().default("NONE"),
  labelRefundClaimId: uuid("label_refund_claim_id"),
  labelRefundLeaseExpiresAt: timestamp("label_refund_lease_expires_at", { withTimezone: true }),
  labelRefundAttemptCount: integer("label_refund_attempt_count").notNull().default(0),
  labelRefundRequestedAt: timestamp("label_refund_requested_at", { withTimezone: true }),
  labelRefundUpdatedAt: timestamp("label_refund_updated_at", { withTimezone: true }),
  rateMinor: numeric("rate_minor", { precision: 18, scale: 0 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentEvents = pgTable("shipment_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  shipmentId: uuid("shipment_id").notNull(),
  eventType: text("event_type").notNull(),
  rawStatus: text("raw_status"),
  canonicalStatus: text("canonical_status", {
    enum: [
      "LABEL_PENDING",
      "LABEL_CREATED",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "DELIVERY_EXCEPTION",
      "RETURN_IN_TRANSIT",
      "RETURNED",
    ],
  }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shippingRateLimitWindows = pgTable(
  "shipping_rate_limit_windows",
  {
    key: text("key").primaryKey(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("shipping_rate_limit_windows_updated_idx").on(table.updatedAt)],
);

export const shipmentOperationIdempotency = pgTable(
  "shipment_operation_idempotency",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    shipmentId: uuid("shipment_id"),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["IN_PROGRESS", "SUCCEEDED", "FAILED"] }).notNull().default("IN_PROGRESS"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    lockedUntil: timestamp("locked_until", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '2 minutes'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (table) => ({
    operationKeyUnique: uniqueIndex("shipment_operation_idem_operation_key_unique")
      .on(table.operation, table.idempotencyKey),
    shipmentIdx: index("shipment_operation_idem_shipment_idx").on(table.shipmentId),
    expiresAtIdx: index("shipment_operation_idem_expires_at_idx").on(table.expiresAt),
  }),
);

export const shipmentApvAdjustments = pgTable(
  "shipment_apv_adjustments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    providerInvoiceId: text("provider_invoice_id").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    shipmentId: uuid("shipment_id").notNull(),
    orderId: uuid("order_id").notNull(),
    settlementReleaseId: uuid("settlement_release_id").notNull(),
    status: text("status", {
      enum: ["PROCESSING", "APPLIED", "REVIEW_REQUIRED", "CREDIT_RECORDED", "FAILED"],
    }).notNull().default("PROCESSING"),
    originalRateMinor: numeric("original_rate_minor", { precision: 18, scale: 0 }).notNull(),
    adjustedRateMinor: numeric("adjusted_rate_minor", { precision: 18, scale: 0 }).notNull(),
    adjustmentMinor: numeric("adjustment_minor", { precision: 18, scale: 0 }).notNull(),
    bufferAppliedMinor: numeric("buffer_applied_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    assessedSellerLiabilityMinor: numeric("assessed_seller_liability_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    sellerLiabilityMinor: numeric("seller_liability_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    platformLiabilityMinor: numeric("platform_liability_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    carrierCreditMinor: numeric("carrier_credit_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    buyerEffectMinor: numeric("buyer_effect_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    reviewStatus: text("review_status", {
      enum: ["NONE", "PENDING", "UPHELD", "WAIVED"],
    }).notNull().default("NONE"),
    reviewRequestId: text("review_request_id"),
    sellerReviewReason: text("seller_review_reason"),
    sellerReviewSubmittedAt: timestamp("seller_review_submitted_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by"),
    reviewDecisionRequestId: text("review_decision_request_id"),
    reviewDecisionReason: text("review_decision_reason"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewVersion: integer("review_version").notNull().default(0),
    claimId: uuid("claim_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerInvoiceUnique: uniqueIndex("shipment_apv_provider_invoice_unique")
      .on(table.provider, table.providerInvoiceId),
    shipmentIdx: index("shipment_apv_shipment_idx").on(table.shipmentId),
    statusLeaseIdx: index("shipment_apv_status_lease_idx").on(table.status, table.leaseExpiresAt),
    reviewStatusIdx: index("shipment_apv_review_status_idx").on(table.reviewStatus, table.sellerReviewSubmittedAt),
  }),
);

export const shipmentApvAdjustmentRevisions = pgTable(
  "shipment_apv_adjustment_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adjustmentId: uuid("adjustment_id").notNull()
      .references(() => shipmentApvAdjustments.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerInvoiceId: text("provider_invoice_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    invoiceEvent: text("invoice_event", { enum: ["created", "updated"] }).notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    webhookEventId: text("webhook_event_id").notNull(),
    priorAdjustedRateMinor: numeric("prior_adjusted_rate_minor", { precision: 18, scale: 0 }).notNull(),
    adjustedRateMinor: numeric("adjusted_rate_minor", { precision: 18, scale: 0 }).notNull(),
    deltaMinor: numeric("delta_minor", { precision: 18, scale: 0 }).notNull(),
    status: text("status", {
      enum: ["APPLIED", "REVIEW_REQUIRED", "CREDIT_RECORDED", "PENDING_REVIEW", "WAIVED_TO_PLATFORM", "CREDIT_APPLIED", "ACKNOWLEDGED"],
    }).notNull(),
    buyerEffectMinor: numeric("buyer_effect_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    decisionRequestId: text("decision_request_id"),
    decision: text("decision", { enum: ["UPHELD", "WAIVED", "APPLY_CREDIT", "ACKNOWLEDGE"] }),
    bufferAppliedMinor: numeric("buffer_applied_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    sellerLiabilityMinor: numeric("seller_liability_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    platformLiabilityMinor: numeric("platform_liability_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    carrierCreditMinor: numeric("carrier_credit_minor", { precision: 18, scale: 0 }).notNull().default("0"),
    appliedBy: uuid("applied_by"),
    decisionReason: text("decision_reason"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    applyVersion: integer("apply_version").notNull().default(0),
    evidenceSha256: text("evidence_sha256"),
    providerDocumentId: text("provider_document_id"),
    surchargeCategory: text("surcharge_category"),
    surchargeType: text("surcharge_type"),
    evidenceAmountMinor: numeric("evidence_amount_minor", { precision: 18, scale: 0 }),
    evidenceCurrency: text("evidence_currency"),
    evidenceBoundBy: uuid("evidence_bound_by"),
    evidenceBoundAt: timestamp("evidence_bound_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    revisionUnique: uniqueIndex("shipment_apv_revision_number_unique")
      .on(table.adjustmentId, table.revisionNumber),
    payloadUnique: uniqueIndex("shipment_apv_revision_payload_unique")
      .on(table.provider, table.providerInvoiceId, table.payloadSha256),
    invoiceIdx: index("shipment_apv_revision_invoice_idx")
      .on(table.provider, table.providerInvoiceId, table.revisionNumber),
    decisionRequestUnique: uniqueIndex("shipment_apv_revision_decision_request_unique")
      .on(table.decisionRequestId),
  }),
);

export const shipmentApvPayoutOffsets = pgTable(
  "shipment_apv_payout_offsets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    settlementReleaseId: uuid("settlement_release_id").notNull(),
    orderId: uuid("order_id").notNull(),
    sellerId: uuid("seller_id").notNull(),
    currency: text("currency").notNull().default("USDC"),
    sellerLiabilityMinor: numeric("seller_liability_minor", { precision: 18, scale: 0 }).notNull(),
    appliedOffsetMinor: numeric("applied_offset_minor", { precision: 18, scale: 0 }).notNull(),
    unappliedLiabilityMinor: numeric("unapplied_liability_minor", { precision: 18, scale: 0 }).notNull(),
    evidenceManifestSha256: text("evidence_manifest_sha256").notNull(),
    requestId: text("request_id").notNull(),
    allocationVersion: integer("allocation_version").notNull().default(0),
    status: text("status", { enum: ["RESERVED", "APPLIED", "CANCELLED"] }).notNull().default("RESERVED"),
    releaseTxHash: text("release_tx_hash"),
    signatureDeadline: timestamp("signature_deadline", { withTimezone: true }),
    reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by"),
    cancellationReason: text("cancellation_reason"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeReleaseUnique: uniqueIndex("shipment_apv_payout_offset_active_release_unique")
      .on(table.settlementReleaseId)
      .where(sql`${table.status} IN ('RESERVED', 'APPLIED')`),
    requestUnique: uniqueIndex("shipment_apv_payout_offset_request_unique").on(table.requestId),
    orderIdx: index("shipment_apv_payout_offset_order_idx").on(table.orderId, table.status),
  }),
);

export const shipmentApvSellerLiabilities = pgTable(
  "shipment_apv_seller_liabilities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id").notNull(),
    sourceSettlementReleaseId: uuid("source_settlement_release_id").notNull(),
    sourceOrderId: uuid("source_order_id").notNull(),
    currency: text("currency").notNull().default("USDC"),
    originalAmountMinor: numeric("original_amount_minor", { precision: 18, scale: 0 }).notNull(),
    remainingAmountMinor: numeric("remaining_amount_minor", { precision: 18, scale: 0 }).notNull(),
    evidenceManifestSha256: text("evidence_manifest_sha256").notNull(),
    status: text("status", { enum: ["OPEN", "PARTIAL", "SETTLED"] }).notNull().default("OPEN"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => ({
    sourceReleaseUnique: uniqueIndex("shipment_apv_seller_liability_source_release_unique")
      .on(table.sourceSettlementReleaseId),
    sellerQueueIdx: index("shipment_apv_seller_liability_queue_idx")
      .on(table.sellerId, table.status, table.createdAt),
  }),
);

export const shipmentApvPayoutOffsetAllocations = pgTable(
  "shipment_apv_payout_offset_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payoutOffsetId: uuid("payout_offset_id").notNull()
      .references(() => shipmentApvPayoutOffsets.id, { onDelete: "cascade" }),
    sellerLiabilityId: uuid("seller_liability_id").notNull()
      .references(() => shipmentApvSellerLiabilities.id, { onDelete: "cascade" }),
    amountMinor: numeric("amount_minor", { precision: 18, scale: 0 }).notNull(),
    status: text("status", { enum: ["RESERVED", "APPLIED", "CANCELLED"] }).notNull().default("RESERVED"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    offsetLiabilityUnique: uniqueIndex("shipment_apv_payout_allocation_offset_liability_unique")
      .on(table.payoutOffsetId, table.sellerLiabilityId),
    liabilityStatusIdx: index("shipment_apv_payout_allocation_liability_status_idx")
      .on(table.sellerLiabilityId, table.status),
  }),
);

export const shipmentApvPayoutCancellationRequests = pgTable(
  "shipment_apv_payout_cancellation_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientRequestId: uuid("client_request_id").notNull(),
    payoutOffsetId: uuid("payout_offset_id").notNull()
      .references(() => shipmentApvPayoutOffsets.id),
    settlementReleaseId: uuid("settlement_release_id").notNull(),
    requesterId: uuid("requester_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] }).notNull().default("PENDING"),
    version: integer("version").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approverId: uuid("approver_id"),
    decisionRequestId: uuid("decision_request_id"),
    decisionReason: text("decision_reason"),
    onchainState: text("onchain_state"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientRequestUnique: uniqueIndex("shipment_apv_payout_cancel_request_client_unique").on(table.clientRequestId),
    decisionRequestUnique: uniqueIndex("shipment_apv_payout_cancel_request_decision_unique").on(table.decisionRequestId),
    activeOffsetUnique: uniqueIndex("shipment_apv_payout_cancel_request_active_offset_unique")
      .on(table.payoutOffsetId)
      .where(sql`${table.status} = 'PENDING'`),
    pendingQueueIdx: index("shipment_apv_payout_cancel_request_pending_idx")
      .on(table.status, table.expiresAt, table.createdAt),
  }),
);

export const shipmentApvPayoutCancellationEvents = pgTable(
  "shipment_apv_payout_cancellation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cancellationRequestId: uuid("cancellation_request_id").notNull()
      .references(() => shipmentApvPayoutCancellationRequests.id, { onDelete: "cascade" }),
    eventType: text("event_type", { enum: ["REQUESTED", "APPROVED", "REJECTED", "EXPIRED"] }).notNull(),
    actorId: uuid("actor_id"),
    requestVersion: integer("request_version").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    previousEventHash: text("previous_event_hash"),
    eventHash: text("event_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    transitionUnique: uniqueIndex("shipment_apv_payout_cancel_event_transition_unique")
      .on(table.cancellationRequestId, table.eventType, table.requestVersion),
    requestTimelineIdx: index("shipment_apv_payout_cancel_event_timeline_idx")
      .on(table.cancellationRequestId, table.createdAt, table.id),
    eventHashIdx: index("shipment_apv_payout_cancel_event_hash_idx")
      .on(table.eventHash)
      .where(sql`${table.eventHash} IS NOT NULL`),
  }),
);

export const shipmentApvPayoutCancellationAuditOutbox = pgTable(
  "shipment_apv_payout_cancellation_audit_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    archiveKey: text("archive_key").notNull(),
    cancellationRequestId: uuid("cancellation_request_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    status: text("status", { enum: ["PENDING", "PROCESSING", "DELIVERED", "FAILED", "DEAD_LETTER"] }).notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    httpStatus: integer("http_status"),
    receiptId: text("receipt_id"),
    receiptSha256: text("receipt_sha256"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    archiveKeyUnique: uniqueIndex("shipment_apv_payout_cancel_audit_archive_key_unique").on(table.archiveKey),
    requestIdx: index("shipment_apv_payout_cancel_audit_request_idx")
      .on(table.cancellationRequestId, table.createdAt),
    dueIdx: index("shipment_apv_payout_cancel_audit_due_idx")
      .on(table.status, table.nextAttemptAt),
  }),
);
