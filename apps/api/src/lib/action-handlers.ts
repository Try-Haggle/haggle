/**
 * action-handlers.ts
 *
 * PipelineAction → DB 연산 매핑.
 * commerce-core의 routePipelineEvent이 반환한 action을 실제 DB 작업으로 실행.
 */

import { settlementApprovals, negotiationSessions, eq, type Database } from "@haggle/db";
import { updateIntentStatus } from "../services/intent.service.js";
import { getSessionById } from "../services/negotiation-session.service.js";
import type { EventDispatcher } from "./event-dispatcher.js";

/**
 * Register all action handlers on the event dispatcher.
 *
 * Each handler maps a PipelineAction type to the corresponding DB operation.
 */
export function registerActionHandlers(
  dispatcher: EventDispatcher,
  db: Database,
): void {
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

    await db
      .insert(settlementApprovals)
      .values({
        listingId: session.listingId,
        sellerId: action.sellerId,
        buyerId: action.buyerId,
        approvalState: "RESERVED_PENDING_APPROVAL",
        sellerApprovalMode: "MANUAL_CONFIRMATION",
        selectedPaymentRail: "x402",
        currency: "USD",
        finalAmountMinor: String(action.agreedPriceMinor),
        termsSnapshot: {
          session_id: action.sessionId,
          listing_id: session.listingId,
          agreed_price_minor: action.agreedPriceMinor,
          buyer_id: action.buyerId,
          seller_id: action.sellerId,
          negotiated_at: new Date().toISOString(),
        },
      })
      .onConflictDoNothing();
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
