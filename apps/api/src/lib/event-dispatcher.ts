/**
 * event-dispatcher.ts
 *
 * 큐 교체 가능한 이벤트 디스패처 인터페이스.
 * MVP: in-process 동기 실행. 나중에 Redis/SQS로 교체 시 이 구현체만 변경.
 */

import {
  routePipelineEvent,
  defaultPipelineContext,
  type PipelineAction as CommercePipelineAction,
  type PipelineEvent as CommercePipelineEvent,
  type PipelineContext,
} from "@haggle/commerce-core";

// ---------------------------------------------------------------------------
// Event envelope — 우리 시스템의 일반 이벤트
// ---------------------------------------------------------------------------

export interface PipelineEvent {
  domain: string;
  type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Action handler interface
// ---------------------------------------------------------------------------

export type ActionHandler = (action: CommercePipelineAction) => Promise<void>;

// ---------------------------------------------------------------------------
// Event dispatcher interface
// ---------------------------------------------------------------------------

export interface EventDispatcher {
  dispatch(event: PipelineEvent): Promise<CommercePipelineAction>;
  registerHandler(actionType: string, handler: ActionHandler): void;
}

// ---------------------------------------------------------------------------
// In-process synchronous implementation (MVP)
// ---------------------------------------------------------------------------

export function createEventDispatcher(
  context?: PipelineContext,
): EventDispatcher {
  const pipelineContext = context ?? defaultPipelineContext();
  const handlers = new Map<string, ActionHandler>();

  return {
    registerHandler(actionType: string, handler: ActionHandler) {
      handlers.set(actionType, handler);
    },

    async dispatch(event: PipelineEvent): Promise<CommercePipelineAction> {
      // Convert our generic envelope to commerce-core PipelineEvent
      const commerceEvent = toCommerceEvent(event);
      if (!commerceEvent) {
        return { action: "no_action", reason: `unknown event type: ${event.type}` };
      }

      // Route through commerce-core's pure router
      const action = routePipelineEvent(commerceEvent, pipelineContext);

      // Execute registered handler (if any)
      const handler = handlers.get(action.action);
      if (handler) {
        await handler(action);
      }

      return action;
    },
  };
}

// ---------------------------------------------------------------------------
// Event type mapping (our envelope → commerce-core events)
// ---------------------------------------------------------------------------

function toCommerceEvent(event: PipelineEvent): CommercePipelineEvent | null {
  const p = event.payload;

  switch (event.type) {
    case "intent.matched":
      return {
        type: "intent.matched",
        intentId: p.intent_id as string,
        listingId: p.listing_id as string,
        utotal: (p.utotal as number) ?? 0,
      };

    case "negotiation.agreed":
      return {
        type: "session.accepted",
        sessionId: p.session_id as string,
        agreedPriceMinor: (p.agreed_price_minor as number) ?? 0,
        buyerId: p.buyer_id as string,
        sellerId: p.seller_id as string,
      };

    case "negotiation.session.terminal":
      return {
        type: "session.terminal",
        sessionId: p.session_id as string,
        terminalStatus: p.terminal_status as "REJECTED" | "EXPIRED" | "SUPERSEDED",
        intentId: p.intent_id as string | undefined,
        rematchCount: p.rematch_count as number | undefined,
      };

    case "hold.expired":
      return {
        type: "hold.expired",
        sessionId: p.session_id as string,
        holdKind: p.hold_kind as "SOFT_HOLD" | "SELLER_RESERVED",
        heldPriceMinor: p.held_price_minor as number,
      };

    default:
      return null;
  }
}
