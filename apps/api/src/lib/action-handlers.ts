/**
 * action-handlers.ts
 *
 * PipelineAction → DB 연산 매핑.
 * commerce-core의 routePipelineEvent이 반환한 action을 실제 DB 작업으로 실행.
 */

import { type Database, eq, negotiationSessions, settlementApprovals } from "@haggle/db";
import { updateIntentStatus } from "../services/intent.service.js";
import { openListingHold } from "../services/listing-claim.service.js";
import { getSessionById } from "../services/negotiation-session.service.js";
import { recordAgreedPrice } from "../services/price-observation-sink.js";
import type { EventDispatcher } from "./event-dispatcher.js";
import { readFulfillmentFromSnapshot } from "./negotiation-fulfillment.js";

/**
 * Register all action handlers on the event dispatcher.
 *
 * Each handler maps a PipelineAction type to the corresponding DB operation.
 */
export function registerActionHandlers(dispatcher: EventDispatcher, db: Database): void {
  // ── create_settlement ──────────────────────────────────────
  // negotiation.agreed → settlement approval row 생성
  // PipelineAction: { action: 'create_settlement', sessionId, agreedPriceMinor, buyerId, sellerId }
  dispatcher.registerHandler("create_settlement", async (action) => {
    if (action.action !== "create_settlement") return;

    // Session에서 listingId 조회 (settlement_approvals의 NOT NULL 필드)
    const session = await getSessionById(db, action.sessionId);
    if (!session) {
      console.error("[action-handlers] create_settlement: session not found:", action.sessionId);
      return;
    }

    const now = new Date();
    const acceptedAt = now.toISOString();
    const fulfillment = readFulfillmentFromSnapshot(
      session.negotiationAgentSnapshot as Record<string, unknown> | null,
    );

    await db
      .insert(settlementApprovals)
      .values({
        id: action.sessionId,
        listingId: session.listingId,
        sellerId: action.sellerId,
        buyerId: action.buyerId,
        approvalState: "APPROVED",
        sellerApprovalMode: "AUTO_WITHIN_POLICY",
        selectedPaymentRail: "x402",
        currency: "USD",
        finalAmountMinor: String(action.agreedPriceMinor),
        buyerApprovedAt: now,
        sellerApprovedAt: now,
        termsSnapshot: {
          session_id: action.sessionId,
          listing_id: session.listingId,
          agreed_price_minor: action.agreedPriceMinor,
          final_amount_minor: action.agreedPriceMinor,
          buyer_id: action.buyerId,
          seller_id: action.sellerId,
          selected_payment_rail: "x402",
          allowed_payment_rails: ["x402", "stripe"],
          settlement_asset: "USDC",
          settlement_network: "base",
          settlement_contract: "HaggleConditionalSettlement",
          fulfillment_type: fulfillment.fulfillment_type,
          ...(fulfillment.fulfillment_context
            ? { fulfillment_method: fulfillment.fulfillment_context.method }
            : {}),
          ...(fulfillment.fulfillment_context?.shipping_cost_minor !== undefined
            ? { shipping_cost_minor: fulfillment.fulfillment_context.shipping_cost_minor }
            : {}),
          ...(fulfillment.buyer_shipping_address
            ? { buyer_shipping_address: fulfillment.buyer_shipping_address }
            : {}),
          currency: "USD",
          seller_policy_shipment_input_due_days: 3,
          seller_policy_median_response_minutes: 30,
          seller_policy_p95_response_minutes: 120,
          seller_policy_reliable_fast_responder: true,
          negotiated_at: acceptedAt,
        },
      })
      .onConflictDoNothing({ target: settlementApprovals.id });

    await openListingHold(db, {
      listingId: session.listingId,
      sessionId: action.sessionId,
      buyerId: action.buyerId,
      sellerId: action.sellerId,
      agreedPriceMinor: action.agreedPriceMinor,
    });

    // ── Record agreed price to HFMI (data moat) ──
    // Non-fatal: price recording failure never blocks settlement creation
    await recordAgreedPrice(db, {
      sessionId: action.sessionId,
      finalPriceMinor: action.agreedPriceMinor,
      buyerId: action.buyerId,
      sellerId: action.sellerId,
      listingId: session.listingId,
      category: (session as unknown as Record<string, unknown>).category as string | undefined,
    }).catch((err) => {
      console.error("[action-handlers] price-sink error:", (err as Error).message);
    });
  });

  // ── create_payment_intent ──────────────────────────────────
  // approval.approved → payment intent row 생성
  // PipelineAction: { action: 'create_payment_intent', sessionId, settlementId }
  // NOTE: 이 이벤트는 settlement approval 후 발생. MVP에서는 로그만 남기고
  // 실제 payment intent 생성은 settlement-release 플로우에서 처리.
  dispatcher.registerHandler("create_payment_intent", async (action) => {
    if (action.action !== "create_payment_intent") return;

    // MVP: settlement approval → payment 플로우는 settlement-releases.ts 라우트에서
    // buyer가 승인 시 직접 처리. 파이프라인 이벤트로는 로그만.
    console.info(
      "[action-handlers] create_payment_intent: settlement %s approved for session %s — payment handled by settlement-release flow",
      action.settlementId,
      action.sessionId,
    );
  });

  // ── rematch_intent ─────────────────────────────────────────
  // session.terminal + rematch eligible → intent 재활성화
  // PipelineAction: { action: 'rematch_intent', intentId, previousSessionId }
  dispatcher.registerHandler("rematch_intent", async (action) => {
    if (action.action !== "rematch_intent") return;

    await updateIntentStatus(db, action.intentId, "ACTIVE", {
      matchedAt: null as unknown as Date,
    });
  });

  // ── reprice_session ────────────────────────────────────────
  // hold.expired (SOFT_HOLD) → 세션 가격 컨텍스트 리셋
  // PipelineAction: { action: 'reprice_session', sessionId, previousPriceMinor }
  dispatcher.registerHandler("reprice_session", async (action) => {
    if (action.action !== "reprice_session") return;

    // Mark session for repricing — the next round will pick up new market price
    await db
      .update(negotiationSessions)
      .set({ updatedAt: new Date() })
      .where(eq(negotiationSessions.id, action.sessionId));
  });

  // ── create_session ─────────────────────────────────────────
  // intent.matched → 세션 생성 (API 라우트에서 직접 처리하므로 여기선 no-op)
  dispatcher.registerHandler("create_session", async (_action) => {
    // Session creation is handled by the API route handler directly
    // because it needs user input (strategy, pricing, etc.)
  });

  // ── no_action ──────────────────────────────────────────────
  dispatcher.registerHandler("no_action", async (_action) => {
    // Intentional no-op
  });
}
