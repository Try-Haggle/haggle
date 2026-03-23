/**
 * Commerce Dashboard Engine
 *
 * State machines and logic are copied from the real @haggle/* packages
 * (approval, payment, shipping, dispute) so the dashboard has zero
 * external dependencies and runs entirely in the browser.
 */

// ═══════════════════════════════════════════════════════════════
// Real types — from @haggle/commerce-core, payment-core, etc.
// ═══════════════════════════════════════════════════════════════

export type SellerApprovalMode = "AUTO_WITHIN_POLICY" | "MANUAL_CONFIRMATION";

export type ApprovalState =
  | "NEGOTIATING" | "MUTUALLY_ACCEPTABLE" | "AWAITING_BUYER_APPROVAL"
  | "HELD_BY_BUYER" | "RESERVED_PENDING_APPROVAL" | "AWAITING_SELLER_APPROVAL"
  | "APPROVED" | "DECLINED" | "EXPIRED";

export type PaymentIntentStatus =
  | "CREATED" | "QUOTED" | "AUTHORIZED" | "SETTLEMENT_PENDING"
  | "SETTLED" | "FAILED" | "CANCELED";

export type ShipmentStatus =
  | "LABEL_PENDING" | "LABEL_CREATED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY"
  | "DELIVERED" | "DELIVERY_EXCEPTION" | "RETURN_IN_TRANSIT" | "RETURNED";

export type DisputeStatus =
  | "OPEN" | "UNDER_REVIEW" | "WAITING_FOR_BUYER" | "WAITING_FOR_SELLER"
  | "RESOLVED_BUYER_FAVOR" | "RESOLVED_SELLER_FAVOR" | "PARTIAL_REFUND" | "CLOSED";

export type OrderPhase =
  | "NEGOTIATION" | "APPROVAL" | "PAYMENT" | "FULFILLMENT" | "DELIVERY"
  | "COMPLETED" | "IN_DISPUTE" | "CANCELED" | "REFUNDED";

export type DisputeReasonCode =
  | "ITEM_NOT_RECEIVED" | "ITEM_NOT_AS_DESCRIBED" | "PAYMENT_NOT_COMPLETED"
  | "SHIPMENT_SLA_MISSED" | "DELIVERY_EXCEPTION" | "SELLER_NO_FULFILLMENT"
  | "REFUND_DISPUTE" | "PARTIAL_REFUND_DISPUTE" | "COUNTERFEIT_CLAIM" | "OTHER";

// ═══════════════════════════════════════════════════════════════
// Real state machines — from @haggle/* packages
// ═══════════════════════════════════════════════════════════════

// --- Approval (commerce-core/approval-state-machine.ts) ---

type ApprovalEvent =
  | "reach_candidate" | "mark_mutually_acceptable" | "buyer_approve"
  | "buyer_hold" | "seller_reserve" | "resume_negotiation"
  | "seller_approve" | "decline" | "expire";

function transitionApprovalState(
  mode: SellerApprovalMode, status: ApprovalState, event: ApprovalEvent,
): ApprovalState | null {
  const table: Record<ApprovalState, Partial<Record<ApprovalEvent, ApprovalState>>> =
    mode === "AUTO_WITHIN_POLICY"
      ? {
          NEGOTIATING: { reach_candidate: "MUTUALLY_ACCEPTABLE", mark_mutually_acceptable: "MUTUALLY_ACCEPTABLE", decline: "DECLINED", expire: "EXPIRED" },
          MUTUALLY_ACCEPTABLE: { buyer_approve: "APPROVED", buyer_hold: "HELD_BY_BUYER", seller_reserve: "RESERVED_PENDING_APPROVAL", decline: "DECLINED", expire: "EXPIRED" },
          AWAITING_BUYER_APPROVAL: { buyer_approve: "APPROVED", decline: "DECLINED", expire: "EXPIRED" },
          HELD_BY_BUYER: { resume_negotiation: "NEGOTIATING", buyer_approve: "APPROVED", decline: "DECLINED", expire: "EXPIRED" },
          RESERVED_PENDING_APPROVAL: { buyer_approve: "APPROVED", resume_negotiation: "NEGOTIATING", decline: "DECLINED", expire: "EXPIRED" },
          AWAITING_SELLER_APPROVAL: {}, APPROVED: {}, DECLINED: {}, EXPIRED: {},
        }
      : {
          NEGOTIATING: { reach_candidate: "MUTUALLY_ACCEPTABLE", mark_mutually_acceptable: "MUTUALLY_ACCEPTABLE", decline: "DECLINED", expire: "EXPIRED" },
          MUTUALLY_ACCEPTABLE: { buyer_approve: "AWAITING_SELLER_APPROVAL", buyer_hold: "HELD_BY_BUYER", seller_reserve: "RESERVED_PENDING_APPROVAL", decline: "DECLINED", expire: "EXPIRED" },
          AWAITING_BUYER_APPROVAL: { buyer_approve: "AWAITING_SELLER_APPROVAL", decline: "DECLINED", expire: "EXPIRED" },
          HELD_BY_BUYER: { resume_negotiation: "NEGOTIATING", buyer_approve: "AWAITING_SELLER_APPROVAL", decline: "DECLINED", expire: "EXPIRED" },
          RESERVED_PENDING_APPROVAL: { buyer_approve: "AWAITING_SELLER_APPROVAL", resume_negotiation: "NEGOTIATING", decline: "DECLINED", expire: "EXPIRED" },
          AWAITING_SELLER_APPROVAL: { seller_approve: "APPROVED", decline: "DECLINED", expire: "EXPIRED" },
          APPROVED: {}, DECLINED: {}, EXPIRED: {},
        };
  return table[status]?.[event] ?? null;
}

// --- Payment (payment-core/state-machine.ts) ---

type PaymentEvent = "quote" | "authorize" | "mark_settlement_pending" | "settle" | "fail" | "cancel";

const PAYMENT_TRANSITIONS: Record<PaymentIntentStatus, Partial<Record<PaymentEvent, PaymentIntentStatus>>> = {
  CREATED: { quote: "QUOTED", authorize: "AUTHORIZED", cancel: "CANCELED", fail: "FAILED" },
  QUOTED: { authorize: "AUTHORIZED", cancel: "CANCELED", fail: "FAILED" },
  AUTHORIZED: { mark_settlement_pending: "SETTLEMENT_PENDING", cancel: "CANCELED", fail: "FAILED" },
  SETTLEMENT_PENDING: { settle: "SETTLED", fail: "FAILED" },
  SETTLED: {}, FAILED: {}, CANCELED: {},
};

function transitionPaymentIntent(status: PaymentIntentStatus, event: PaymentEvent): PaymentIntentStatus | null {
  return PAYMENT_TRANSITIONS[status]?.[event] ?? null;
}

// --- Shipment (shipping-core/state-machine.ts) ---

type ShipmentEventType = "label_create" | "ship" | "out_for_delivery" | "deliver" | "exception" | "return_ship" | "return_complete";

const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, Partial<Record<ShipmentEventType, ShipmentStatus>>> = {
  LABEL_PENDING: { label_create: "LABEL_CREATED" },
  LABEL_CREATED: { ship: "IN_TRANSIT", exception: "DELIVERY_EXCEPTION" },
  IN_TRANSIT: { out_for_delivery: "OUT_FOR_DELIVERY", deliver: "DELIVERED", exception: "DELIVERY_EXCEPTION", return_ship: "RETURN_IN_TRANSIT" },
  OUT_FOR_DELIVERY: { deliver: "DELIVERED", exception: "DELIVERY_EXCEPTION", return_ship: "RETURN_IN_TRANSIT" },
  DELIVERED: {}, DELIVERY_EXCEPTION: { ship: "IN_TRANSIT", return_ship: "RETURN_IN_TRANSIT" },
  RETURN_IN_TRANSIT: { return_complete: "RETURNED" }, RETURNED: {},
};

function transitionShipmentStatus(status: ShipmentStatus, event: ShipmentEventType): ShipmentStatus | null {
  return SHIPMENT_TRANSITIONS[status]?.[event] ?? null;
}

// --- Dispute (dispute-core/state-machine.ts) ---

type DisputeEvent = "review" | "request_buyer_evidence" | "request_seller_evidence" | "resolve_buyer_favor" | "resolve_seller_favor" | "resolve_partial_refund" | "close";

const DISPUTE_TRANSITIONS: Record<DisputeStatus, Partial<Record<DisputeEvent, DisputeStatus>>> = {
  OPEN: { review: "UNDER_REVIEW", request_buyer_evidence: "WAITING_FOR_BUYER", request_seller_evidence: "WAITING_FOR_SELLER" },
  UNDER_REVIEW: { request_buyer_evidence: "WAITING_FOR_BUYER", request_seller_evidence: "WAITING_FOR_SELLER", resolve_buyer_favor: "RESOLVED_BUYER_FAVOR", resolve_seller_favor: "RESOLVED_SELLER_FAVOR", resolve_partial_refund: "PARTIAL_REFUND" },
  WAITING_FOR_BUYER: { review: "UNDER_REVIEW", close: "CLOSED" },
  WAITING_FOR_SELLER: { review: "UNDER_REVIEW", close: "CLOSED" },
  RESOLVED_BUYER_FAVOR: { close: "CLOSED" }, RESOLVED_SELLER_FAVOR: { close: "CLOSED" },
  PARTIAL_REFUND: { close: "CLOSED" }, CLOSED: {},
};

function transitionDisputeStatus(status: DisputeStatus, event: DisputeEvent): DisputeStatus | null {
  return DISPUTE_TRANSITIONS[status]?.[event] ?? null;
}

// --- Order lifecycle (commerce-core/order-lifecycle.ts) ---

function computeOrderPhase(s: { approval_state?: string; payment_status?: string; shipment_status?: string; dispute_status?: string }): OrderPhase {
  if (s.payment_status === "REFUNDED") return "REFUNDED";
  if ((s.approval_state === "DECLINED" || s.approval_state === "EXPIRED") && (!s.payment_status || s.payment_status === "NONE")) return "CANCELED";
  if (s.payment_status === "CANCELED") return "CANCELED";
  if (s.dispute_status && s.dispute_status !== "NONE") {
    if (s.dispute_status === "RESOLVED_REFUND") return "REFUNDED";
    if (s.dispute_status === "RESOLVED_NO_REFUND") return "COMPLETED";
    return "IN_DISPUTE";
  }
  if (s.shipment_status === "DELIVERED") return "COMPLETED";
  if (s.shipment_status === "DELIVERY_EXCEPTION" || s.shipment_status === "IN_TRANSIT" || s.shipment_status === "OUT_FOR_DELIVERY") return "DELIVERY";
  if (s.shipment_status === "LABEL_CREATED" || s.shipment_status === "PENDING_PICKUP" || s.shipment_status === "SLA_MISSED") return "FULFILLMENT";
  if (s.payment_status === "SETTLED") return "FULFILLMENT";
  if (s.payment_status === "INTENT_CREATED" || s.payment_status === "AUTHORIZED" || s.payment_status === "PENDING" || s.payment_status === "CREATED" || s.payment_status === "QUOTED" || s.payment_status === "SETTLEMENT_PENDING") return "PAYMENT";
  if (s.approval_state === "APPROVED") return "PAYMENT";
  if (s.approval_state && s.approval_state !== "NEGOTIATING" && s.approval_state !== "NONE") return "APPROVAL";
  return "NEGOTIATION";
}

// --- Trust (commerce-core/trust-policy.ts) ---

type TrustPenaltyReason = "BUYER_APPROVED_BUT_NOT_PAID" | "SELLER_APPROVED_BUT_NOT_FULFILLED" | "SHIPMENT_INFO_SLA_MISSED" | "DISPUTE_LOSS";

function trustPenaltyScore(reason: TrustPenaltyReason): number {
  const scores: Record<TrustPenaltyReason, number> = {
    BUYER_APPROVED_BUT_NOT_PAID: 0.35,
    SELLER_APPROVED_BUT_NOT_FULFILLED: 0.4,
    SHIPMENT_INFO_SLA_MISSED: 0.2,
    DISPUTE_LOSS: 0.3,
  };
  return scores[reason];
}

function computeSettlementReliability(snap: { successful_settlements: number; approval_defaults: number; shipment_sla_misses: number; dispute_wins: number; dispute_losses: number }): number {
  const success = snap.successful_settlements;
  const defaults = snap.approval_defaults * 1.5;
  const slaMisses = snap.shipment_sla_misses * 1.0;
  const disputeLosses = snap.dispute_losses * 1.2;
  const disputeWinsCredit = snap.dispute_wins * 0.2;
  const numerator = success + disputeWinsCredit;
  const denominator = success + defaults + slaMisses + disputeLosses + disputeWinsCredit;
  if (denominator <= 0) return 1;
  return Math.max(0, Math.min(1, numerator / denominator));
}

// --- Reason codes (dispute-core/reason-codes.ts) ---

interface ReasonCodeMeta { code: DisputeReasonCode; label: string }

export const DISPUTE_REASON_OPTIONS: ReasonCodeMeta[] = [
  { code: "ITEM_NOT_RECEIVED", label: "Item not received" },
  { code: "ITEM_NOT_AS_DESCRIBED", label: "Item not as described" },
  { code: "PAYMENT_NOT_COMPLETED", label: "Payment not completed after approval" },
  { code: "SHIPMENT_SLA_MISSED", label: "Shipment info not provided within SLA" },
  { code: "DELIVERY_EXCEPTION", label: "Delivery exception occurred" },
  { code: "SELLER_NO_FULFILLMENT", label: "Seller did not fulfill after approval" },
  { code: "REFUND_DISPUTE", label: "Refund request disputed" },
  { code: "PARTIAL_REFUND_DISPUTE", label: "Partial refund amount disputed" },
  { code: "COUNTERFEIT_CLAIM", label: "Item claimed to be counterfeit" },
  { code: "OTHER", label: "Other" },
];

// ═══════════════════════════════════════════════════════════════
// Dashboard types
// ═══════════════════════════════════════════════════════════════

export interface NegotiationResult {
  listing_title: string;
  listing_category: string;
  seller_name: string;
  buyer_name: string;
  seller_id: string;
  buyer_id: string;
  listing_id: string;
  original_price: number;
  agreed_price: number;
  currency: string;
  rounds_taken: number;
  seller_approval_mode: SellerApprovalMode;
}

export interface WalletInfo { address: string; balance: number; network: string }
export interface ShipmentInfo { carrier: string; tracking_number: string; tracking_url: string; eta: string }

export interface DisputeInfo {
  reason_code: DisputeReasonCode;
  description: string;
  evidence_text: string;
  resolution?: { outcome: string; summary: string; refund_amount?: number };
}

export interface TimelineEvent {
  id: string; timestamp: string; phase: OrderPhase | "APPROVAL";
  title: string; detail: string; actor: "buyer" | "seller" | "system" | "ai"; icon: string;
}

export interface CommerceState {
  negotiation: NegotiationResult;
  phase: OrderPhase;
  approval_state: ApprovalState;
  payment_status: PaymentIntentStatus | "IDLE";
  shipment_status: ShipmentStatus | "IDLE";
  dispute_status: DisputeStatus | "NONE";
  buyer_wallet: WalletInfo;
  seller_wallet: WalletInfo;
  platform_wallet: WalletInfo;
  shipment?: ShipmentInfo;
  dispute?: DisputeInfo;
  timeline: TimelineEvent[];
  trust_scores: { buyer_reliability: number; seller_reliability: number };
  escrow_held: number;
  seller_received: number;
  platform_fee: number;
}

// ═══════════════════════════════════════════════════════════════
// Initial state
// ═══════════════════════════════════════════════════════════════

const DEFAULT_NEGOTIATION: NegotiationResult = {
  listing_title: "iPhone 15 Pro Max 256GB (거의 새 것)",
  listing_category: "전자기기",
  seller_name: "테크딜_KR",
  buyer_name: "스마트바이어_US",
  seller_id: "seller_001",
  buyer_id: "buyer_001",
  listing_id: "listing_001",
  original_price: 95000,
  agreed_price: 82500,
  currency: "USDC",
  rounds_taken: 4,
  seller_approval_mode: "AUTO_WITHIN_POLICY",
};

export function createInitialState(negotiation: Partial<NegotiationResult> = {}): CommerceState {
  const neg = { ...DEFAULT_NEGOTIATION, ...negotiation };
  const fee = Math.round(neg.agreed_price * 0.015);

  return {
    negotiation: neg,
    phase: "APPROVAL",
    approval_state: "MUTUALLY_ACCEPTABLE",
    payment_status: "IDLE",
    shipment_status: "IDLE",
    dispute_status: "NONE",
    buyer_wallet: { address: "0x1a2B...buyer", balance: 150000, network: "Base" },
    seller_wallet: { address: "0x3c4D...seller", balance: 25000, network: "Base" },
    platform_wallet: { address: "0x5e6F...haggle", balance: 0, network: "Base" },
    timeline: [{
      id: "evt_000",
      timestamp: new Date(Date.now() - 300_000).toISOString(),
      phase: "APPROVAL",
      title: "협상 완료",
      detail: `${neg.rounds_taken}라운드 만에 $${(neg.agreed_price / 100).toFixed(2)}에 합의 (원가: $${(neg.original_price / 100).toFixed(2)}, 절약: ${Math.round(((neg.original_price - neg.agreed_price) / neg.original_price) * 100)}%)`,
      actor: "system",
      icon: "🤝",
    }],
    trust_scores: {
      buyer_reliability: computeSettlementReliability({ successful_settlements: 12, approval_defaults: 1, shipment_sla_misses: 0, dispute_wins: 0, dispute_losses: 0 }),
      seller_reliability: computeSettlementReliability({ successful_settlements: 18, approval_defaults: 0, shipment_sla_misses: 1, dispute_wins: 1, dispute_losses: 1 }),
    },
    escrow_held: 0,
    seller_received: 0,
    platform_fee: fee,
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

let eventCounter = 1;
function createEvent(phase: OrderPhase | "APPROVAL", title: string, detail: string, actor: TimelineEvent["actor"], icon: string): TimelineEvent {
  return { id: `evt_${String(eventCounter++).padStart(3, "0")}`, timestamp: new Date().toISOString(), phase, title, detail, actor, icon };
}

function derivePhase(state: CommerceState, overrides: Partial<{ approval_state: ApprovalState; payment_status: PaymentIntentStatus | "IDLE"; shipment_status: ShipmentStatus | "IDLE"; dispute_status: DisputeStatus | "NONE" }>): OrderPhase {
  const a = overrides.approval_state ?? state.approval_state;
  const p = overrides.payment_status ?? state.payment_status;
  const sh = overrides.shipment_status ?? state.shipment_status;
  const d = overrides.dispute_status ?? state.dispute_status;
  return computeOrderPhase({
    approval_state: a,
    payment_status: p === "IDLE" ? undefined : p,
    shipment_status: sh === "IDLE" ? undefined : sh,
    dispute_status: d === "NONE" ? undefined : d,
  });
}

// ═══════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════

export function buyerApprove(state: CommerceState): CommerceState {
  if (state.approval_state !== "MUTUALLY_ACCEPTABLE") return state;
  const next = transitionApprovalState(state.negotiation.seller_approval_mode, state.approval_state, "buyer_approve");
  if (!next) return state;
  const events = [createEvent("APPROVAL", "구매자 승인", `${state.negotiation.buyer_name}이(가) $${(state.negotiation.agreed_price / 100).toFixed(2)}에 거래를 승인했습니다`, "buyer", "✅")];
  if (next === "APPROVED") events.push(createEvent("APPROVAL", "자동 승인 완료", "판매자 정책: AUTO_WITHIN_POLICY — 거래가 자동 승인되었습니다", "system", "⚡"));
  const ps: PaymentIntentStatus | "IDLE" = next === "APPROVED" ? "CREATED" : "IDLE";
  return { ...state, approval_state: next, phase: derivePhase(state, { approval_state: next, payment_status: ps }), payment_status: ps, timeline: [...state.timeline, ...events] };
}

export function sellerApprove(state: CommerceState): CommerceState {
  if (state.approval_state !== "AWAITING_SELLER_APPROVAL") return state;
  const next = transitionApprovalState(state.negotiation.seller_approval_mode, state.approval_state, "seller_approve");
  if (!next) return state;
  const ps: PaymentIntentStatus | "IDLE" = next === "APPROVED" ? "CREATED" : "IDLE";
  return { ...state, approval_state: next, phase: derivePhase(state, { approval_state: next, payment_status: ps }), payment_status: ps, timeline: [...state.timeline, createEvent("APPROVAL", "판매자 수동 승인", `${state.negotiation.seller_name}이(가) 거래를 수동 승인했습니다`, "seller", "✅")] };
}

export function processPayment(state: CommerceState): CommerceState {
  if (state.payment_status === "SETTLED") return state;
  if (state.payment_status === "IDLE" && state.approval_state !== "APPROVED") return state;
  let status: PaymentIntentStatus = state.payment_status === "IDLE" ? "CREATED" : state.payment_status as PaymentIntentStatus;
  const amount = state.negotiation.agreed_price;
  const fee = state.platform_fee;
  const steps: { event: PaymentEvent; title: string; detail: string; icon: string; actor: TimelineEvent["actor"] }[] = [
    { event: "quote", title: "결제 견적 생성", detail: `x402 견적: Base 네트워크에서 ${amount / 100} USDC`, icon: "📋", actor: "system" },
    { event: "authorize", title: "결제 승인", detail: `구매자 지갑 ${state.buyer_wallet.address}에서 ${amount / 100} USDC 승인`, icon: "🔐", actor: "buyer" },
    { event: "mark_settlement_pending", title: "정산 대기", detail: `에스크로: 스마트 컨트랙트에 ${amount / 100} USDC 보관`, icon: "⏳", actor: "system" },
    { event: "settle", title: "결제 완료", detail: `판매자 수령: $${((amount - fee) / 100).toFixed(2)}, 플랫폼 수수료: $${(fee / 100).toFixed(2)} (1.5%)`, icon: "💰", actor: "system" },
  ];
  const events: TimelineEvent[] = [];
  for (const step of steps) {
    const n = transitionPaymentIntent(status, step.event);
    if (!n) break;
    status = n;
    events.push(createEvent("PAYMENT", step.title, step.detail, step.actor, step.icon));
  }
  return {
    ...state,
    phase: derivePhase(state, { payment_status: status, shipment_status: status === "SETTLED" ? "LABEL_PENDING" : state.shipment_status }),
    payment_status: status,
    shipment_status: status === "SETTLED" ? "LABEL_PENDING" : state.shipment_status,
    buyer_wallet: { ...state.buyer_wallet, balance: state.buyer_wallet.balance - amount },
    escrow_held: amount - fee,
    platform_wallet: { ...state.platform_wallet, balance: state.platform_wallet.balance + fee },
    timeline: [...state.timeline, ...events],
  };
}

export function submitShippingInfo(state: CommerceState, info: ShipmentInfo): CommerceState {
  if (state.shipment_status !== "LABEL_PENDING") return state;
  const next = transitionShipmentStatus("LABEL_PENDING", "label_create");
  if (!next) return state;
  return { ...state, shipment_status: next, phase: derivePhase(state, { shipment_status: next }), shipment: info, timeline: [...state.timeline, createEvent("FULFILLMENT", "배송 라벨 생성", `운송사: ${info.carrier} | 운송장: ${info.tracking_number}`, "seller", "📦")] };
}

const SHIPMENT_EVENT_MAP: Record<string, { event: ShipmentEventType; title: string; detailFn: (s: CommerceState) => string; icon: string }> = {
  LABEL_CREATED: { event: "ship", title: "발송 완료", detailFn: (s) => `${s.shipment!.carrier}에서 물품을 수거했습니다`, icon: "🚚" },
  IN_TRANSIT: { event: "out_for_delivery", title: "배달 출발", detailFn: () => "구매자 지역에서 배달이 시작되었습니다", icon: "🏠" },
  OUT_FOR_DELIVERY: { event: "deliver", title: "배송 완료", detailFn: () => "물품이 정상 배달되었습니다. 에스크로가 판매자에게 정산됩니다.", icon: "✅" },
};

export function advanceShipment(state: CommerceState): CommerceState {
  if (!state.shipment) return state;
  const m = SHIPMENT_EVENT_MAP[state.shipment_status as string];
  if (!m) return state;
  const next = transitionShipmentStatus(state.shipment_status as ShipmentStatus, m.event);
  if (!next) return state;
  const delivered = next === "DELIVERED";
  const phase = derivePhase(state, { shipment_status: next });
  return {
    ...state, shipment_status: next, phase,
    seller_wallet: delivered ? { ...state.seller_wallet, balance: state.seller_wallet.balance + state.escrow_held } : state.seller_wallet,
    seller_received: delivered ? state.escrow_held : state.seller_received,
    escrow_held: delivered ? 0 : state.escrow_held,
    timeline: [...state.timeline, createEvent(phase, m.title, m.detailFn(state), "system", m.icon)],
  };
}

export function triggerDeliveryException(state: CommerceState): CommerceState {
  if (!state.shipment || state.shipment_status === "DELIVERED") return state;
  const next = transitionShipmentStatus(state.shipment_status as ShipmentStatus, "exception");
  if (!next) return state;
  return { ...state, shipment_status: next, timeline: [...state.timeline, createEvent("DELIVERY", "배송 예외 발생", "운송사에서 배송 문제를 보고했습니다. 분쟁을 신청할 수 있습니다.", "system", "⚠️")] };
}

export function fileDispute(state: CommerceState, info: Omit<DisputeInfo, "resolution">): CommerceState {
  if (state.dispute_status !== "NONE" || state.phase === "COMPLETED") return state;
  const label = DISPUTE_REASON_OPTIONS.find((o) => o.code === info.reason_code)?.label ?? info.reason_code;
  return { ...state, phase: derivePhase(state, { dispute_status: "OPEN" }), dispute_status: "OPEN", dispute: info, timeline: [...state.timeline, createEvent("IN_DISPUTE", "분쟁 신청", `사유: ${label} — "${info.description}"`, "buyer", "⚖️")] };
}

export function startAiReview(state: CommerceState): CommerceState {
  if (state.dispute_status !== "OPEN") return state;
  const next = transitionDisputeStatus("OPEN", "review");
  if (!next) return state;
  return { ...state, dispute_status: next, timeline: [...state.timeline, createEvent("IN_DISPUTE", "AI 심사 시작", "AI 분쟁 에이전트가 증거, 배송 데이터, 거래 내역을 분석 중입니다...", "ai", "🔍")] };
}

export function resolveDispute(state: CommerceState, outcome: "buyer_favor" | "seller_favor" | "partial_refund"): CommerceState {
  if (state.dispute_status !== "OPEN" && state.dispute_status !== "UNDER_REVIEW") return state;
  const dEvent = outcome === "buyer_favor" ? "resolve_buyer_favor" as const : outcome === "seller_favor" ? "resolve_seller_favor" as const : "resolve_partial_refund" as const;
  let cur = state.dispute_status as DisputeStatus;
  if (cur === "OPEN") { const r = transitionDisputeStatus(cur, "review"); if (r) cur = r; }
  const resolved = transitionDisputeStatus(cur, dEvent);
  if (!resolved) return state;

  const amount = state.negotiation.agreed_price;
  const fee = state.platform_fee;
  const net = amount - fee;
  const penalty = trustPenaltyScore("DISPUTE_LOSS");
  let resolution: DisputeInfo["resolution"];
  let refund = 0;
  let bRel = state.trust_scores.buyer_reliability;
  let sRel = state.trust_scores.seller_reliability;

  if (outcome === "buyer_favor") { refund = net; resolution = { outcome: "구매자 승소", summary: "AI 심사 결과 구매자의 주장이 타당합니다. 전액 환불 처리됩니다.", refund_amount: refund }; sRel = Math.max(0, sRel - penalty); }
  else if (outcome === "seller_favor") { resolution = { outcome: "판매자 승소", summary: "AI 심사 결과 판매자가 의무를 이행했습니다. 환불 없음." }; bRel = Math.max(0, bRel - penalty); }
  else { refund = Math.round(net * 0.5); resolution = { outcome: "부분 환불", summary: "AI 심사: 양측 모두 책임이 있습니다. 50% 환불 처리됩니다.", refund_amount: refund }; sRel = Math.max(0, sRel - penalty); }

  return {
    ...state,
    phase: refund > 0 ? "REFUNDED" : derivePhase(state, { dispute_status: resolved }),
    dispute_status: resolved, dispute: state.dispute ? { ...state.dispute, resolution } : undefined,
    buyer_wallet: { ...state.buyer_wallet, balance: state.buyer_wallet.balance + refund },
    seller_wallet: { ...state.seller_wallet, balance: state.seller_wallet.balance + (state.escrow_held - refund) },
    escrow_held: 0, seller_received: state.escrow_held - refund,
    trust_scores: { buyer_reliability: bRel, seller_reliability: sRel },
    timeline: [
      ...state.timeline,
      createEvent("IN_DISPUTE", "AI 심사 완료", "AI 분쟁 에이전트가 증거를 분석하고 판결을 내렸습니다", "ai", "🤖"),
      createEvent(refund > 0 ? "REFUNDED" : "COMPLETED", `분쟁 해결: ${resolution.outcome}`, `${resolution.summary}${refund > 0 ? ` 환불: $${(refund / 100).toFixed(2)}` : ""}`, "system", outcome === "buyer_favor" ? "🏆" : outcome === "seller_favor" ? "🛡️" : "⚖️"),
    ],
  };
}

export function updateNegotiation(state: CommerceState, patch: Partial<NegotiationResult>): CommerceState {
  if (state.phase !== "APPROVAL") return state;
  const neg = { ...state.negotiation, ...patch };
  return { ...state, negotiation: neg, platform_fee: Math.round(neg.agreed_price * 0.015) };
}

// ═══════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════

export function formatCurrency(cents: number, currency = "USDC"): string {
  return `$${(cents / 100).toFixed(2)} ${currency}`;
}

export function getPhaseLabel(phase: OrderPhase): string {
  const labels: Record<OrderPhase, string> = { NEGOTIATION: "협상 중", APPROVAL: "승인", PAYMENT: "결제", FULFILLMENT: "이행", DELIVERY: "배송", COMPLETED: "완료", IN_DISPUTE: "분쟁 중", REFUNDED: "환불됨", CANCELED: "취소됨" };
  return labels[phase] ?? phase;
}

export function getPhaseIndex(phase: OrderPhase): number {
  const order: OrderPhase[] = ["APPROVAL", "PAYMENT", "FULFILLMENT", "DELIVERY", "COMPLETED"];
  return order.indexOf(phase);
}
