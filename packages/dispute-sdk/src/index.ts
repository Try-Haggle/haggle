import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type ModuleActorRole = "buyer" | "seller";

export type ModuleTransactionStatus =
  | "APPROVED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "FULFILLMENT_PENDING"
  | "FULFILLMENT_ACTIVE"
  | "DELIVERED"
  | "IN_DISPUTE"
  | "REFUNDED"
  | "CLOSED"
  | "CANCELED";

export type DisputeReasonCode =
  | "ITEM_NOT_RECEIVED"
  | "ITEM_NOT_AS_DESCRIBED"
  | "PAYMENT_NOT_COMPLETED"
  | "SHIPMENT_SLA_MISSED"
  | "DELIVERY_EXCEPTION"
  | "SELLER_NO_FULFILLMENT"
  | "REFUND_DISPUTE"
  | "PARTIAL_REFUND_DISPUTE"
  | "COUNTERFEIT_CLAIM"
  | "OTHER";

export const MODULE_TRANSACTION_STATUSES = [
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
] as const satisfies readonly ModuleTransactionStatus[];

export const DISPUTE_REASON_CODES = [
  "ITEM_NOT_RECEIVED",
  "ITEM_NOT_AS_DESCRIBED",
  "PAYMENT_NOT_COMPLETED",
  "SHIPMENT_SLA_MISSED",
  "DELIVERY_EXCEPTION",
  "SELLER_NO_FULFILLMENT",
  "REFUND_DISPUTE",
  "PARTIAL_REFUND_DISPUTE",
  "COUNTERFEIT_CLAIM",
  "OTHER",
] as const satisfies readonly DisputeReasonCode[];

export interface ModuleTransactionSnapshot {
  platform_id: string;
  external_order_id: string;
  buyer_actor_id: string;
  seller_actor_id: string;
  amount_minor: number;
  currency: string;
  status: ModuleTransactionStatus;
  metadata?: Record<string, unknown>;
}

export interface ModuleOpenDisputeRequest {
  requester_actor_id: string;
  reason_code: DisputeReasonCode;
  summary: string;
  client_request_id?: string;
}

export interface ModuleDisputeCaseInput {
  transaction: ModuleTransactionSnapshot;
  request: ModuleOpenDisputeRequest;
}

export interface ModuleDisputeEscalationInput {
  external_order_id: string;
  requester_actor_id: string;
  to_tier?: 2 | 3;
  reason?: string;
  client_request_id?: string;
}

export interface DisputeCostPreview {
  tier: 1 | 2 | 3;
  cost_cents: number;
  reviewer_count: number | null;
  escalation_period_hours: number;
}

export interface ModuleConfigSummary {
  use_shared_pool: boolean;
  reviewer_share: number;
  platform_share: number;
}

export interface ModuleDisputePreviewResponse {
  ok: true;
  platform_id: string;
  idempotency_key: string;
  opened_by: ModuleActorRole;
  external_order_id: string;
  costs: DisputeCostPreview[];
  config: ModuleConfigSummary;
}

export interface ModuleDisputeCase {
  id: string;
  order_id: string;
  reason_code: string;
  status: string;
  opened_by: ModuleActorRole | "system";
  opened_at: string;
  evidence: Array<{
    id: string;
    dispute_id: string;
    submitted_by: ModuleActorRole | "system";
    type: string;
    uri?: string;
    text?: string;
    created_at: string;
  }>;
  metadata?: Record<string, unknown> | null;
}

export interface ModuleDisputeCreateResponse {
  ok: true;
  dispute: ModuleDisputeCase;
  platform_id: string;
  external_order_id: string;
  idempotency_key: string;
  idempotent: boolean;
}

export interface SellerDepositRequirement {
  amount_cents: number;
  deadline_hours: number;
  status: "PENDING" | "DEPOSITED" | "FORFEITED" | "REFUNDED" | string;
}

export interface ModuleDisputeEscalationPreviewResponse {
  ok: true;
  platform_id: string;
  dispute_id: string;
  external_order_id: string;
  requested_by: ModuleActorRole;
  previous_tier: 1 | 2;
  new_tier: 2 | 3;
  cost: DisputeCostPreview;
  seller_deposit_requirement: SellerDepositRequirement;
}

export interface ModuleDisputeEscalationCreateResponse extends ModuleDisputeEscalationPreviewResponse {
  dispute: ModuleDisputeCase;
  idempotency_key: string;
  idempotent: boolean;
}

export interface ModuleDisputeStatusResponse {
  ok: true;
  platform_id: string;
  dispute_id: string;
  external_order_id: string;
  status: string;
  tier: 1 | 2 | 3;
  current_tier_cost: DisputeCostPreview | null;
  current_seller_deposit_requirement: SellerDepositRequirement | null;
  escalation_history: unknown[];
  resolution: unknown | null;
}

export interface SettlementInstruction {
  action: "refund_buyer" | "release_to_seller";
  outcome: "buyer_favor" | "seller_favor" | "partial_refund" | "no_action";
  amount_minor?: number;
  currency?: string;
}

export interface SettlementInstructionWebhookData {
  dispute_id: string;
  status: string;
  tier: 1 | 2 | 3;
  outcome: SettlementInstruction["outcome"];
  refund_amount_minor: number | null;
  resolved_at: string | null;
  settlement_instruction: SettlementInstruction;
}

export interface DisputeCaseEscalatedWebhookData {
  dispute_id: string;
  status: string;
  previous_tier: 1 | 2;
  new_tier: 2 | 3;
  requested_by_role: ModuleActorRole;
  requested_by_actor_id: string;
  cost: DisputeCostPreview;
  seller_deposit_requirement: SellerDepositRequirement;
}

export type DisputeWebhookEventType =
  | "dispute.case.created"
  | "dispute.case.escalated"
  | "dispute.case.updated"
  | "dispute.settlement.instruction";

export interface DisputeWebhookEnvelope<TData = unknown> {
  id: string;
  type: DisputeWebhookEventType;
  created_at: string;
  platform_id: string;
  external_order_id: string;
  dispute_id: string;
  data: TData;
}

export interface VerifyDisputeWebhookInput {
  rawBody: string | Buffer;
  secret: string;
  timestamp?: string | string[];
  signature?: string | string[];
  eventId?: string | string[];
  nowMs?: number;
  toleranceMs?: number;
}

export interface HaggleDisputeClientOptions {
  baseUrl: string;
  platformId: string;
  secret: string;
  fetch?: typeof fetch;
  userAgent?: string;
  now?: () => Date;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
}

export interface RequestOptions {
  idempotencyKey: string;
}

export interface BuildHeadersOptions extends RequestOptions {
  timestamp?: string;
}

export interface SignedRequest {
  body: string;
  headers: Record<string, string>;
}

export class HaggleDisputeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  readonly requestId: string | null;

  constructor(params: {
    status: number;
    code: string;
    body: unknown;
    requestId?: string | null;
  }) {
    super(`Haggle dispute API error ${params.status}: ${params.code}`);
    this.name = "HaggleDisputeApiError";
    this.status = params.status;
    this.code = params.code;
    this.body = params.body;
    this.requestId = params.requestId ?? null;
  }
}

export interface HaggleDisputeValidationIssue {
  path: string;
  message: string;
}

export class HaggleDisputeValidationError extends Error {
  readonly code = "HAGGLE_DISPUTE_VALIDATION_ERROR";
  readonly issues: HaggleDisputeValidationIssue[];

  constructor(issues: HaggleDisputeValidationIssue[]) {
    super(`Haggle dispute validation failed: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "HaggleDisputeValidationError";
    this.issues = issues;
  }
}

export class HaggleDisputeResponseValidationError extends Error {
  readonly code = "HAGGLE_DISPUTE_RESPONSE_VALIDATION_ERROR";
  readonly issues: HaggleDisputeValidationIssue[];
  readonly body: unknown;

  constructor(issues: HaggleDisputeValidationIssue[], body: unknown) {
    super(`Haggle dispute response validation failed: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "HaggleDisputeResponseValidationError";
    this.issues = issues;
    this.body = body;
  }
}

export class HaggleDisputeWebhookVerificationError extends Error {
  readonly code:
    | "HAGGLE_WEBHOOK_MISSING_HEADERS"
    | "HAGGLE_WEBHOOK_INVALID_TIMESTAMP"
    | "HAGGLE_WEBHOOK_TIMESTAMP_OUT_OF_RANGE"
    | "HAGGLE_WEBHOOK_INVALID_SIGNATURE"
    | "HAGGLE_WEBHOOK_INVALID_BODY";
  readonly issues: HaggleDisputeValidationIssue[];

  constructor(params: {
    code: HaggleDisputeWebhookVerificationError["code"];
    message: string;
    issues?: HaggleDisputeValidationIssue[];
  }) {
    super(params.message);
    this.name = "HaggleDisputeWebhookVerificationError";
    this.code = params.code;
    this.issues = params.issues ?? [];
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  assertNonEmpty(baseUrl, "baseUrl");
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizePath(path: string): string {
  assertNonEmpty(path, "path");
  return path.startsWith("/") ? path : `/${path}`;
}

function assertClientOptions(options: HaggleDisputeClientOptions): void {
  assertNonEmpty(options.platformId, "platformId");
  assertNonEmpty(options.secret, "secret");
  if (options.secret.length < 16) {
    throw new Error("secret must be at least 16 characters");
  }
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error("timeoutMs must be a positive number");
  }
}

function assertSecureBaseUrl(baseUrl: string, allowInsecureHttp: boolean): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("baseUrl must be a valid URL");
  }

  if (parsed.username || parsed.password) {
    throw new Error("baseUrl must not include credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("baseUrl must not include query strings or fragments");
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && allowInsecureHttp) return;
  throw new Error("baseUrl must use HTTPS unless allowInsecureHttp is true");
}

function assertIdempotencyKey(idempotencyKey: string): void {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new Error("idempotencyKey must be 8-128 URL-safe characters");
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pushStringIssue(
  issues: HaggleDisputeValidationIssue[],
  path: string,
  value: unknown,
  options: { min?: number; max?: number } = {},
): value is string {
  if (typeof value !== "string") {
    issues.push({ path, message: "must be a string" });
    return false;
  }
  const min = options.min ?? 1;
  if (value.trim().length < min) {
    issues.push({ path, message: "must not be empty" });
    return false;
  }
  if (options.max !== undefined && value.length > options.max) {
    issues.push({ path, message: `must be at most ${options.max} characters` });
    return false;
  }
  return true;
}

export function validateModuleDisputeCaseInput(
  input: unknown,
  options: { platformId?: string } = {},
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: "input", message: "must be an object" }];
  }

  const transaction = input.transaction;
  const request = input.request;
  if (!isRecord(transaction)) {
    issues.push({ path: "transaction", message: "must be an object" });
  }
  if (!isRecord(request)) {
    issues.push({ path: "request", message: "must be an object" });
  }
  if (!isRecord(transaction) || !isRecord(request)) return issues;

  const platformIdOk = pushStringIssue(issues, "transaction.platform_id", transaction.platform_id, { max: 128 });
  if (platformIdOk && options.platformId && transaction.platform_id !== options.platformId) {
    issues.push({ path: "transaction.platform_id", message: "must match the client platformId" });
  }
  pushStringIssue(issues, "transaction.external_order_id", transaction.external_order_id, { max: 256 });
  const buyerOk = pushStringIssue(issues, "transaction.buyer_actor_id", transaction.buyer_actor_id, { max: 256 });
  const sellerOk = pushStringIssue(issues, "transaction.seller_actor_id", transaction.seller_actor_id, { max: 256 });
  if (buyerOk && sellerOk && transaction.buyer_actor_id === transaction.seller_actor_id) {
    issues.push({ path: "transaction.seller_actor_id", message: "must be different from buyer_actor_id" });
  }
  const amountMinor = transaction.amount_minor;
  if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor <= 0) {
    issues.push({ path: "transaction.amount_minor", message: "must be a positive integer" });
  }
  const currency = transaction.currency;
  const currencyOk = pushStringIssue(issues, "transaction.currency", currency, { min: 3, max: 8 });
  if (currencyOk && !/^[A-Z][A-Z0-9_]{2,7}$/.test(currency)) {
    issues.push({ path: "transaction.currency", message: "must be an uppercase currency code" });
  }
  if (typeof transaction.status !== "string" || !MODULE_TRANSACTION_STATUSES.includes(transaction.status as ModuleTransactionStatus)) {
    issues.push({ path: "transaction.status", message: "must be a supported module transaction status" });
  }
  if (transaction.metadata !== undefined && !isRecord(transaction.metadata)) {
    issues.push({ path: "transaction.metadata", message: "must be an object when provided" });
  }

  const requesterOk = pushStringIssue(issues, "request.requester_actor_id", request.requester_actor_id, { max: 256 });
  if (
    requesterOk &&
    buyerOk &&
    sellerOk &&
    request.requester_actor_id !== transaction.buyer_actor_id &&
    request.requester_actor_id !== transaction.seller_actor_id
  ) {
    issues.push({ path: "request.requester_actor_id", message: "must match buyer_actor_id or seller_actor_id" });
  }
  if (typeof request.reason_code !== "string" || !DISPUTE_REASON_CODES.includes(request.reason_code as DisputeReasonCode)) {
    issues.push({ path: "request.reason_code", message: "must be a supported dispute reason code" });
  }
  pushStringIssue(issues, "request.summary", request.summary, { max: 5_000 });
  if (request.client_request_id !== undefined) {
    pushStringIssue(issues, "request.client_request_id", request.client_request_id, { max: 128 });
  }

  try {
    JSON.stringify(input);
  } catch {
    issues.push({ path: "input", message: "must be JSON serializable" });
  }

  return issues;
}

export function assertValidModuleDisputeCaseInput(
  input: unknown,
  options: { platformId?: string } = {},
): asserts input is ModuleDisputeCaseInput {
  const issues = validateModuleDisputeCaseInput(input, options);
  if (issues.length > 0) {
    throw new HaggleDisputeValidationError(issues);
  }
}

export function validateModuleDisputeEscalationInput(
  input: unknown,
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: "input", message: "must be an object" }];
  }
  pushStringIssue(issues, "external_order_id", input.external_order_id, { max: 256 });
  pushStringIssue(issues, "requester_actor_id", input.requester_actor_id, { max: 256 });
  if (input.to_tier !== undefined && input.to_tier !== 2 && input.to_tier !== 3) {
    issues.push({ path: "to_tier", message: "must be 2 or 3 when provided" });
  }
  if (input.reason !== undefined) {
    pushStringIssue(issues, "reason", input.reason, { max: 5_000 });
  }
  if (input.client_request_id !== undefined) {
    pushStringIssue(issues, "client_request_id", input.client_request_id, { max: 128 });
  }
  try {
    JSON.stringify(input);
  } catch {
    issues.push({ path: "input", message: "must be JSON serializable" });
  }
  return issues;
}

export function assertValidModuleDisputeEscalationInput(
  input: unknown,
): asserts input is ModuleDisputeEscalationInput {
  const issues = validateModuleDisputeEscalationInput(input);
  if (issues.length > 0) {
    throw new HaggleDisputeValidationError(issues);
  }
}

export function validateModuleDisputeStatusInput(input: unknown): HaggleDisputeValidationIssue[] {
  if (!isRecord(input)) {
    return [{ path: "input", message: "must be an object" }];
  }
  const issues: HaggleDisputeValidationIssue[] = [];
  pushStringIssue(issues, "external_order_id", input.external_order_id, { max: 256 });
  try {
    JSON.stringify(input);
  } catch {
    issues.push({ path: "input", message: "must be JSON serializable" });
  }
  return issues;
}

export function assertValidModuleDisputeStatusInput(
  input: unknown,
): asserts input is { external_order_id: string } {
  const issues = validateModuleDisputeStatusInput(input);
  if (issues.length > 0) {
    throw new HaggleDisputeValidationError(issues);
  }
}

function pushBooleanIssue(
  issues: HaggleDisputeValidationIssue[],
  path: string,
  value: unknown,
): value is boolean {
  if (typeof value !== "boolean") {
    issues.push({ path, message: "must be a boolean" });
    return false;
  }
  return true;
}

function pushNumberIssue(
  issues: HaggleDisputeValidationIssue[],
  path: string,
  value: unknown,
  options: { integer?: boolean; min?: number; max?: number } = {},
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, message: "must be a finite number" });
    return false;
  }
  if (options.integer && !Number.isInteger(value)) {
    issues.push({ path, message: "must be an integer" });
    return false;
  }
  if (options.min !== undefined && value < options.min) {
    issues.push({ path, message: `must be at least ${options.min}` });
    return false;
  }
  if (options.max !== undefined && value > options.max) {
    issues.push({ path, message: `must be at most ${options.max}` });
    return false;
  }
  return true;
}

function validateExpectedString(
  issues: HaggleDisputeValidationIssue[],
  path: string,
  value: unknown,
  expected: string,
): void {
  if (!pushStringIssue(issues, path, value)) return;
  if (value !== expected) {
    issues.push({ path, message: "does not match the request" });
  }
}

function validateCostPreview(
  issues: HaggleDisputeValidationIssue[],
  path: string,
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  if (![1, 2, 3].includes(value.tier as number)) {
    issues.push({ path: `${path}.tier`, message: "must be 1, 2, or 3" });
  }
  pushNumberIssue(issues, `${path}.cost_cents`, value.cost_cents, { integer: true, min: 0 });
  if (value.reviewer_count !== null) {
    pushNumberIssue(issues, `${path}.reviewer_count`, value.reviewer_count, { integer: true, min: 1 });
  }
  pushNumberIssue(issues, `${path}.escalation_period_hours`, value.escalation_period_hours, { integer: true, min: 0 });
}

function validateSellerDepositRequirement(
  issues: HaggleDisputeValidationIssue[],
  path: string,
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  pushNumberIssue(issues, `${path}.amount_cents`, value.amount_cents, { integer: true, min: 0 });
  pushNumberIssue(issues, `${path}.deadline_hours`, value.deadline_hours, { integer: true, min: 1 });
  pushStringIssue(issues, `${path}.status`, value.status);
}

function validateConfigSummary(
  issues: HaggleDisputeValidationIssue[],
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({ path: "config", message: "must be an object" });
    return;
  }
  pushBooleanIssue(issues, "config.use_shared_pool", value.use_shared_pool);
  pushNumberIssue(issues, "config.reviewer_share", value.reviewer_share, { min: 0, max: 1 });
  pushNumberIssue(issues, "config.platform_share", value.platform_share, { min: 0, max: 1 });
}

export function validateModuleDisputePreviewResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; idempotencyKey: string },
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(response)) return [{ path: "response", message: "must be an object" }];
  if (response.ok !== true) issues.push({ path: "ok", message: "must be true" });
  validateExpectedString(issues, "platform_id", response.platform_id, expected.platformId);
  validateExpectedString(issues, "external_order_id", response.external_order_id, expected.externalOrderId);
  validateExpectedString(issues, "idempotency_key", response.idempotency_key, expected.idempotencyKey);
  if (response.opened_by !== "buyer" && response.opened_by !== "seller") {
    issues.push({ path: "opened_by", message: "must be buyer or seller" });
  }
  if (!Array.isArray(response.costs)) {
    issues.push({ path: "costs", message: "must be an array" });
  } else {
    if (response.costs.length !== 3) {
      issues.push({ path: "costs", message: "must include exactly three tier previews" });
    }
    const tiers = new Set(response.costs.map((cost) => isRecord(cost) ? cost.tier : undefined));
    for (const tier of [1, 2, 3]) {
      if (!tiers.has(tier)) {
        issues.push({ path: "costs", message: `must include tier ${tier}` });
      }
    }
    response.costs.forEach((cost, index) => validateCostPreview(issues, `costs.${index}`, cost));
  }
  validateConfigSummary(issues, response.config);
  return issues;
}

function validateModuleDisputeCase(
  issues: HaggleDisputeValidationIssue[],
  value: unknown,
): void {
  if (!isRecord(value)) {
    issues.push({ path: "dispute", message: "must be an object" });
    return;
  }
  pushStringIssue(issues, "dispute.id", value.id);
  pushStringIssue(issues, "dispute.order_id", value.order_id);
  pushStringIssue(issues, "dispute.reason_code", value.reason_code);
  pushStringIssue(issues, "dispute.status", value.status);
  if (value.opened_by !== "buyer" && value.opened_by !== "seller" && value.opened_by !== "system") {
    issues.push({ path: "dispute.opened_by", message: "must be buyer, seller, or system" });
  }
  pushStringIssue(issues, "dispute.opened_at", value.opened_at);
  if (!Array.isArray(value.evidence)) {
    issues.push({ path: "dispute.evidence", message: "must be an array" });
  }
}

export function validateModuleDisputeCreateResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; idempotencyKey: string },
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(response)) return [{ path: "response", message: "must be an object" }];
  if (response.ok !== true) issues.push({ path: "ok", message: "must be true" });
  validateExpectedString(issues, "platform_id", response.platform_id, expected.platformId);
  validateExpectedString(issues, "external_order_id", response.external_order_id, expected.externalOrderId);
  validateExpectedString(issues, "idempotency_key", response.idempotency_key, expected.idempotencyKey);
  pushBooleanIssue(issues, "idempotent", response.idempotent);
  validateModuleDisputeCase(issues, response.dispute);
  return issues;
}

export function validateModuleDisputeEscalationPreviewResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; disputeId: string },
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(response)) return [{ path: "response", message: "must be an object" }];
  if (response.ok !== true) issues.push({ path: "ok", message: "must be true" });
  validateExpectedString(issues, "platform_id", response.platform_id, expected.platformId);
  validateExpectedString(issues, "external_order_id", response.external_order_id, expected.externalOrderId);
  validateExpectedString(issues, "dispute_id", response.dispute_id, expected.disputeId);
  if (response.requested_by !== "buyer" && response.requested_by !== "seller") {
    issues.push({ path: "requested_by", message: "must be buyer or seller" });
  }
  if (response.previous_tier !== 1 && response.previous_tier !== 2) {
    issues.push({ path: "previous_tier", message: "must be 1 or 2" });
  }
  if (response.new_tier !== 2 && response.new_tier !== 3) {
    issues.push({ path: "new_tier", message: "must be 2 or 3" });
  }
  if (
    typeof response.previous_tier === "number" &&
    typeof response.new_tier === "number" &&
    response.new_tier !== response.previous_tier + 1
  ) {
    issues.push({ path: "new_tier", message: "must advance by exactly one tier" });
  }
  validateCostPreview(issues, "cost", response.cost);
  validateSellerDepositRequirement(issues, "seller_deposit_requirement", response.seller_deposit_requirement);
  return issues;
}

export function validateModuleDisputeEscalationCreateResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; disputeId: string; idempotencyKey: string },
): HaggleDisputeValidationIssue[] {
  const issues = validateModuleDisputeEscalationPreviewResponse(response, expected);
  if (!isRecord(response)) return issues;
  validateExpectedString(issues, "idempotency_key", response.idempotency_key, expected.idempotencyKey);
  pushBooleanIssue(issues, "idempotent", response.idempotent);
  validateModuleDisputeCase(issues, response.dispute);
  return issues;
}

export function validateModuleDisputeStatusResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; disputeId: string },
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(response)) return [{ path: "response", message: "must be an object" }];
  if (response.ok !== true) issues.push({ path: "ok", message: "must be true" });
  validateExpectedString(issues, "platform_id", response.platform_id, expected.platformId);
  validateExpectedString(issues, "external_order_id", response.external_order_id, expected.externalOrderId);
  validateExpectedString(issues, "dispute_id", response.dispute_id, expected.disputeId);
  pushStringIssue(issues, "status", response.status);
  if (response.tier !== 1 && response.tier !== 2 && response.tier !== 3) {
    issues.push({ path: "tier", message: "must be 1, 2, or 3" });
  }
  if (response.current_tier_cost !== null) {
    validateCostPreview(issues, "current_tier_cost", response.current_tier_cost);
  }
  if (response.current_seller_deposit_requirement !== null) {
    validateSellerDepositRequirement(
      issues,
      "current_seller_deposit_requirement",
      response.current_seller_deposit_requirement,
    );
  }
  if (!Array.isArray(response.escalation_history)) {
    issues.push({ path: "escalation_history", message: "must be an array" });
  }
  return issues;
}

function assertValidModuleDisputePreviewResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; idempotencyKey: string },
): asserts response is ModuleDisputePreviewResponse {
  const issues = validateModuleDisputePreviewResponse(response, expected);
  if (issues.length > 0) {
    throw new HaggleDisputeResponseValidationError(issues, response);
  }
}

function assertValidModuleDisputeCreateResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; idempotencyKey: string },
): asserts response is ModuleDisputeCreateResponse {
  const issues = validateModuleDisputeCreateResponse(response, expected);
  if (issues.length > 0) {
    throw new HaggleDisputeResponseValidationError(issues, response);
  }
}

function assertValidModuleDisputeEscalationPreviewResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; disputeId: string },
): asserts response is ModuleDisputeEscalationPreviewResponse {
  const issues = validateModuleDisputeEscalationPreviewResponse(response, expected);
  if (issues.length > 0) {
    throw new HaggleDisputeResponseValidationError(issues, response);
  }
}

function assertValidModuleDisputeEscalationCreateResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; disputeId: string; idempotencyKey: string },
): asserts response is ModuleDisputeEscalationCreateResponse {
  const issues = validateModuleDisputeEscalationCreateResponse(response, expected);
  if (issues.length > 0) {
    throw new HaggleDisputeResponseValidationError(issues, response);
  }
}

function assertValidModuleDisputeStatusResponse(
  response: unknown,
  expected: { platformId: string; externalOrderId: string; disputeId: string },
): asserts response is ModuleDisputeStatusResponse {
  const issues = validateModuleDisputeStatusResponse(response, expected);
  if (issues.length > 0) {
    throw new HaggleDisputeResponseValidationError(issues, response);
  }
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildSigningPayload(params: {
  timestamp: string;
  method: string;
  path: string;
  body: string | Buffer;
}): string {
  return `${params.timestamp}.${params.method.toUpperCase()}.${normalizePath(params.path)}.${sha256Hex(params.body)}`;
}

export function signModuleRequest(params: {
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  body: string | Buffer;
}): string {
  if (params.secret.length < 16) {
    throw new Error("secret must be at least 16 characters");
  }
  return `sha256=${createHmac("sha256", params.secret).update(buildSigningPayload(params)).digest("hex")}`;
}

export function buildWebhookSigningPayload(params: {
  timestamp: string;
  eventId: string;
  rawBody: string | Buffer;
}): string {
  return `${params.timestamp}.${params.eventId}.${sha256Hex(params.rawBody)}`;
}

export function signDisputeWebhookPayload(params: {
  secret: string;
  timestamp: string;
  eventId: string;
  rawBody: string | Buffer;
}): string {
  if (params.secret.length < 16) {
    throw new Error("secret must be at least 16 characters");
  }
  return `sha256=${createHmac("sha256", params.secret).update(buildWebhookSigningPayload(params)).digest("hex")}`;
}

function assertWebhookSignature(input: Required<Pick<VerifyDisputeWebhookInput, "rawBody" | "secret">> & {
  timestamp: string;
  signature: string;
  eventId: string;
  nowMs?: number;
  toleranceMs?: number;
}): void {
  if (input.secret.length < 16) {
    throw new Error("secret must be at least 16 characters");
  }
  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new HaggleDisputeWebhookVerificationError({
      code: "HAGGLE_WEBHOOK_INVALID_TIMESTAMP",
      message: "Webhook timestamp is invalid",
    });
  }
  const nowMs = input.nowMs ?? Date.now();
  const toleranceMs = input.toleranceMs ?? 5 * 60 * 1000;
  if (Math.abs(nowMs - timestampMs) > toleranceMs) {
    throw new HaggleDisputeWebhookVerificationError({
      code: "HAGGLE_WEBHOOK_TIMESTAMP_OUT_OF_RANGE",
      message: "Webhook timestamp is outside the allowed tolerance",
    });
  }

  const expected = signDisputeWebhookPayload({
    secret: input.secret,
    timestamp: input.timestamp,
    eventId: input.eventId,
    rawBody: input.rawBody,
  });
  const received = input.signature.startsWith("sha256=") ? input.signature : `sha256=${input.signature}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new HaggleDisputeWebhookVerificationError({
      code: "HAGGLE_WEBHOOK_INVALID_SIGNATURE",
      message: "Webhook signature is invalid",
    });
  }
}

export function validateDisputeWebhookEnvelope(
  envelope: unknown,
  options: { eventId?: string; platformId?: string } = {},
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(envelope)) return [{ path: "webhook", message: "must be an object" }];
  validateExpectedString(issues, "id", envelope.id, options.eventId ?? String(envelope.id ?? ""));
  if (![
    "dispute.case.created",
    "dispute.case.escalated",
    "dispute.case.updated",
    "dispute.settlement.instruction",
  ].includes(String(envelope.type))) {
    issues.push({ path: "type", message: "must be a supported dispute webhook event type" });
  }
  pushStringIssue(issues, "created_at", envelope.created_at);
  const platformOk = pushStringIssue(issues, "platform_id", envelope.platform_id);
  if (platformOk && options.platformId && envelope.platform_id !== options.platformId) {
    issues.push({ path: "platform_id", message: "does not match the expected platform" });
  }
  pushStringIssue(issues, "external_order_id", envelope.external_order_id);
  pushStringIssue(issues, "dispute_id", envelope.dispute_id);
  if (envelope.data === undefined) {
    issues.push({ path: "data", message: "is required" });
  }
  return issues;
}

export function validateSettlementInstruction(
  value: unknown,
  _expected: { platformId?: string; externalOrderId?: string; disputeId?: string } = {},
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(value)) return [{ path: "settlement", message: "must be an object" }];
  if (value.action !== "refund_buyer" && value.action !== "release_to_seller") {
    issues.push({ path: "settlement.action", message: "must be refund_buyer or release_to_seller" });
  }
  if (!["buyer_favor", "seller_favor", "partial_refund", "no_action"].includes(String(value.outcome))) {
    issues.push({ path: "settlement.outcome", message: "must be a supported settlement outcome" });
  }
  if (value.amount_minor !== undefined) {
    pushNumberIssue(issues, "settlement.amount_minor", value.amount_minor, { integer: true, min: 0 });
  }
  if (value.currency !== undefined) {
    pushStringIssue(issues, "settlement.currency", value.currency, { min: 3, max: 8 });
  }
  return issues;
}

export function validateSettlementInstructionWebhookData(
  value: unknown,
  expected: { externalOrderId?: string; disputeId?: string } = {},
): HaggleDisputeValidationIssue[] {
  const issues: HaggleDisputeValidationIssue[] = [];
  if (!isRecord(value)) return [{ path: "data", message: "must be an object" }];
  if (expected.disputeId) {
    validateExpectedString(issues, "data.dispute_id", value.dispute_id, expected.disputeId);
  } else {
    pushStringIssue(issues, "data.dispute_id", value.dispute_id);
  }
  pushStringIssue(issues, "data.status", value.status);
  if (value.tier !== 1 && value.tier !== 2 && value.tier !== 3) {
    issues.push({ path: "data.tier", message: "must be 1, 2, or 3" });
  }
  if (!["buyer_favor", "seller_favor", "partial_refund", "no_action"].includes(String(value.outcome))) {
    issues.push({ path: "data.outcome", message: "must be a supported settlement outcome" });
  }
  if (value.refund_amount_minor !== null) {
    pushNumberIssue(issues, "data.refund_amount_minor", value.refund_amount_minor, { integer: true, min: 0 });
  }
  if (value.resolved_at !== null) {
    pushStringIssue(issues, "data.resolved_at", value.resolved_at);
  }
  issues.push(...validateSettlementInstruction(value.settlement_instruction)
    .map((issue) => ({ ...issue, path: issue.path.replace(/^settlement/, "data.settlement_instruction") })));
  void expected.externalOrderId;
  return issues;
}

export function verifyDisputeWebhook<TData = unknown>(
  input: VerifyDisputeWebhookInput & { platformId?: string },
): DisputeWebhookEnvelope<TData> {
  const timestamp = singleHeader(input.timestamp);
  const signature = singleHeader(input.signature);
  const eventId = singleHeader(input.eventId);
  if (!timestamp || !signature || !eventId) {
    throw new HaggleDisputeWebhookVerificationError({
      code: "HAGGLE_WEBHOOK_MISSING_HEADERS",
      message: "Webhook timestamp, signature, and event id are required",
    });
  }
  assertWebhookSignature({
    rawBody: input.rawBody,
    secret: input.secret,
    timestamp,
    signature,
    eventId,
    nowMs: input.nowMs,
    toleranceMs: input.toleranceMs,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.isBuffer(input.rawBody) ? input.rawBody.toString("utf8") : input.rawBody);
  } catch {
    throw new HaggleDisputeWebhookVerificationError({
      code: "HAGGLE_WEBHOOK_INVALID_BODY",
      message: "Webhook body must be valid JSON",
    });
  }

  const issues = validateDisputeWebhookEnvelope(parsed, { eventId, platformId: input.platformId });
  if (issues.length > 0) {
    throw new HaggleDisputeWebhookVerificationError({
      code: "HAGGLE_WEBHOOK_INVALID_BODY",
      message: "Webhook envelope is invalid",
      issues,
    });
  }

  return parsed as DisputeWebhookEnvelope<TData>;
}

export function buildModuleHeaders(params: {
  platformId: string;
  secret: string;
  method: string;
  path: string;
  body: string | Buffer;
  idempotencyKey: string;
  timestamp?: string;
}): Record<string, string> {
  assertNonEmpty(params.platformId, "platformId");
  assertIdempotencyKey(params.idempotencyKey);
  const timestamp = params.timestamp ?? new Date().toISOString();
  return {
    "content-type": "application/json",
    "x-haggle-module-platform-id": params.platformId,
    "x-haggle-module-timestamp": timestamp,
    "x-haggle-idempotency-key": params.idempotencyKey,
    "x-haggle-module-signature": signModuleRequest({
      secret: params.secret,
      timestamp,
      method: params.method,
      path: params.path,
      body: params.body,
    }),
  };
}

export function redactModuleHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (key.toLowerCase() === "x-haggle-module-signature") {
        return [key, value.startsWith("sha256=") ? "sha256=<redacted>" : "<redacted>"];
      }
      return [key, value];
    }),
  );
}

export class HaggleDisputeClient {
  private readonly baseUrl: string;
  private readonly platformId: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: HaggleDisputeClientOptions) {
    assertClientOptions(options);
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    assertSecureBaseUrl(this.baseUrl, options.allowInsecureHttp ?? false);
    this.platformId = options.platformId;
    this.secret = options.secret;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? "@haggle/dispute-sdk";
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 10_000;

    if (!this.fetchImpl) {
      throw new Error("fetch is required in this runtime");
    }
  }

  previewCase(
    input: ModuleDisputeCaseInput,
    options: RequestOptions,
  ): Promise<ModuleDisputePreviewResponse> {
    return this.previewCaseInternal(input, options);
  }

  createCase(
    input: ModuleDisputeCaseInput,
    options: RequestOptions,
  ): Promise<ModuleDisputeCreateResponse> {
    return this.createCaseInternal(input, options);
  }

  previewEscalation(
    disputeId: string,
    input: ModuleDisputeEscalationInput,
    options: RequestOptions,
  ): Promise<ModuleDisputeEscalationPreviewResponse> {
    return this.previewEscalationInternal(disputeId, input, options);
  }

  createEscalation(
    disputeId: string,
    input: ModuleDisputeEscalationInput,
    options: RequestOptions,
  ): Promise<ModuleDisputeEscalationCreateResponse> {
    return this.createEscalationInternal(disputeId, input, options);
  }

  getCaseStatus(
    disputeId: string,
    input: { external_order_id: string },
    options: RequestOptions,
  ): Promise<ModuleDisputeStatusResponse> {
    return this.getCaseStatusInternal(disputeId, input, options);
  }

  buildSignedRequest(
    method: "POST",
    path: string,
    body: unknown,
    options: BuildHeadersOptions,
  ): SignedRequest {
    assertIdempotencyKey(options.idempotencyKey);
    const jsonBody = JSON.stringify(body);
    const timestamp = options.timestamp ?? this.now().toISOString();
    return {
      body: jsonBody,
      headers: {
        ...buildModuleHeaders({
          platformId: this.platformId,
          secret: this.secret,
          method,
          path,
          body: jsonBody,
          idempotencyKey: options.idempotencyKey,
          timestamp,
        }),
        "user-agent": this.userAgent,
      },
    };
  }

  private async previewCaseInternal(
    input: ModuleDisputeCaseInput,
    options: RequestOptions,
  ): Promise<ModuleDisputePreviewResponse> {
    const response = await this.request("/modules/disputes/v1/cases/preview", input, options);
    assertValidModuleDisputePreviewResponse(response, {
      platformId: this.platformId,
      externalOrderId: input.transaction.external_order_id,
      idempotencyKey: options.idempotencyKey,
    });
    return response;
  }

  private async createCaseInternal(
    input: ModuleDisputeCaseInput,
    options: RequestOptions,
  ): Promise<ModuleDisputeCreateResponse> {
    const response = await this.request("/modules/disputes/v1/cases", input, options);
    assertValidModuleDisputeCreateResponse(response, {
      platformId: this.platformId,
      externalOrderId: input.transaction.external_order_id,
      idempotencyKey: options.idempotencyKey,
    });
    return response;
  }

  private async previewEscalationInternal(
    disputeId: string,
    input: ModuleDisputeEscalationInput,
    options: RequestOptions,
  ): Promise<ModuleDisputeEscalationPreviewResponse> {
    const path = this.moduleCasePath(disputeId, "/escalations/preview");
    const response = await this.requestEscalation(path, input, options);
    assertValidModuleDisputeEscalationPreviewResponse(response, {
      platformId: this.platformId,
      externalOrderId: input.external_order_id,
      disputeId,
    });
    return response;
  }

  private async createEscalationInternal(
    disputeId: string,
    input: ModuleDisputeEscalationInput,
    options: RequestOptions,
  ): Promise<ModuleDisputeEscalationCreateResponse> {
    const path = this.moduleCasePath(disputeId, "/escalations");
    const response = await this.requestEscalation(path, input, options);
    assertValidModuleDisputeEscalationCreateResponse(response, {
      platformId: this.platformId,
      externalOrderId: input.external_order_id,
      disputeId,
      idempotencyKey: options.idempotencyKey,
    });
    return response;
  }

  private async getCaseStatusInternal(
    disputeId: string,
    input: { external_order_id: string },
    options: RequestOptions,
  ): Promise<ModuleDisputeStatusResponse> {
    assertValidModuleDisputeStatusInput(input);
    const path = this.moduleCasePath(disputeId, "/status");
    const response = await this.requestJson(path, input, options);
    assertValidModuleDisputeStatusResponse(response, {
      platformId: this.platformId,
      externalOrderId: input.external_order_id,
      disputeId,
    });
    return response;
  }

  private moduleCasePath(disputeId: string, suffix: string): string {
    assertNonEmpty(disputeId, "disputeId");
    return `/modules/disputes/v1/cases/${encodeURIComponent(disputeId)}${suffix}`;
  }

  private async requestEscalation(
    path: string,
    input: ModuleDisputeEscalationInput,
    options: RequestOptions,
  ): Promise<unknown> {
    assertValidModuleDisputeEscalationInput(input);
    return this.requestJson(path, input, options);
  }

  private async request(
    path: string,
    input: ModuleDisputeCaseInput,
    options: RequestOptions,
  ): Promise<unknown> {
    assertValidModuleDisputeCaseInput(input, { platformId: this.platformId });
    return this.requestJson(path, input, options);
  }

  private async requestJson(
    path: string,
    body: unknown,
    options: RequestOptions,
  ): Promise<unknown> {
    const signed = this.buildSignedRequest("POST", path, body, options);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HaggleDisputeApiError({
          status: 0,
          code: "HAGGLE_DISPUTE_REQUEST_TIMEOUT",
          body: { message: `Request timed out after ${this.timeoutMs}ms` },
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = await readJson(response);
    if (!response.ok) {
      const code = responseBody && typeof responseBody === "object" && "error" in responseBody
        ? String((responseBody as { error: unknown }).error)
        : "HAGGLE_DISPUTE_API_ERROR";
      throw new HaggleDisputeApiError({
        status: response.status,
        code,
        body: responseBody,
        requestId: response.headers.get("x-request-id"),
      });
    }

    return responseBody;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
