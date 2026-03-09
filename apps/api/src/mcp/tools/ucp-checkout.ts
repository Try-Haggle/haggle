// ============================================================
// UCP Checkout MCP Tools
// Maps UCP operations to MCP tools per UCP MCP Binding spec
// ============================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createCheckoutStore,
  createBridgeStore,
  createCheckoutSession,
  getCheckoutSession,
  updateCheckoutSession,
  completeCheckoutSession,
  cancelCheckoutSession,
  createBridgedSession,
  processNegotiationRound,
  NEGOTIATION_EXTENSION_KEY,
} from "@haggle/ucp-adapter";
import type {
  CheckoutStore,
  BridgeStore,
} from "@haggle/ucp-adapter";
import type { NegotiationSession, MasterStrategy, RoundData } from "@haggle/engine-session";

// Shared state (in-memory for MVP)
const checkoutStore: CheckoutStore = createCheckoutStore();
const bridgeStore: BridgeStore = createBridgeStore();
const hnpSessions = new Map<string, NegotiationSession>();
const strategies = new Map<string, MasterStrategy>();

/** Allow external registration of strategies (from API routes). */
export function registerStrategy(strategy: MasterStrategy): void {
  strategies.set(strategy.id, strategy);
}

/** Allow external access to stores for REST route integration. */
export function getStores() {
  return { checkoutStore, bridgeStore, hnpSessions, strategies };
}

export function registerUcpMcpTools(server: McpServer) {
  // ─── haggle_ucp_create_checkout ────────────────────────────
  server.tool(
    "haggle_ucp_create_checkout",
    "Create a UCP checkout session. Set negotiate=true to also create a linked negotiation session. Returns checkout session with negotiation extension if applicable.",
    {
      item_id: z.string().describe("Product/listing ID"),
      item_title: z.string().describe("Product title"),
      item_price: z.number().int().positive().describe("Price in minor units (cents)"),
      quantity: z.number().int().positive().default(1),
      currency: z.string().default("USD"),
      negotiate: z.boolean().default(false).describe("Create linked negotiation session"),
      strategy_id: z.string().optional().describe("Strategy ID for negotiation"),
      counterparty_id: z.string().optional().describe("Counterparty ID for negotiation"),
    },
    async (params) => {
      const idempotencyKey = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const request = {
        line_items: [{
          item: { id: params.item_id, title: params.item_title, price: params.item_price },
          quantity: params.quantity,
        }],
        currency: params.currency,
      };

      if (params.negotiate && params.strategy_id) {
        const strategy = strategies.get(params.strategy_id);
        if (!strategy) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Strategy not found", strategy_id: params.strategy_id }) }],
          };
        }

        const result = createBridgedSession(checkoutStore, bridgeStore, {
          checkoutRequest: request,
          strategy,
          counterpartyId: params.counterparty_id ?? "unknown",
          idempotencyKey,
        });

        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }],
          };
        }

        hnpSessions.set(result.hnpSession.session_id, result.hnpSession);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              checkout: result.checkout,
              negotiation_session_id: result.hnpSession.session_id,
              bridge_id: result.bridge.id,
            }),
          }],
        };
      }

      // Non-negotiated checkout
      const result = createCheckoutSession(checkoutStore, request, idempotencyKey);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ checkout: result.session }) }],
      };
    },
  );

  // ─── haggle_ucp_get_checkout ───────────────────────────────
  server.tool(
    "haggle_ucp_get_checkout",
    "Retrieve the current state of a UCP checkout session including negotiation status.",
    {
      id: z.string().describe("Checkout session ID"),
    },
    async ({ id }) => {
      const result = getCheckoutSession(checkoutStore, id);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ checkout: result.session }) }],
      };
    },
  );

  // ─── haggle_ucp_submit_offer ───────────────────────────────
  server.tool(
    "haggle_ucp_submit_offer",
    "Submit a negotiation offer within a UCP checkout session. The engine will compute utility, make a decision (ACCEPT/COUNTER/REJECT), and update the checkout accordingly.",
    {
      checkout_id: z.string().describe("Checkout session ID"),
      offer_price: z.number().int().positive().describe("Offer price in minor units (cents)"),
      strategy_id: z.string().describe("Strategy ID to use"),
      r_score: z.number().min(0).max(1).default(0.8).describe("Counterparty reputation score"),
      i_completeness: z.number().min(0).max(1).default(0.9).describe("Listing info completeness"),
      t_elapsed: z.number().min(0).default(60).describe("Time elapsed in seconds"),
      n_success: z.number().int().min(0).default(0).describe("Successful past transactions"),
      n_dispute_losses: z.number().int().min(0).default(0).describe("Past dispute losses"),
    },
    async (params) => {
      const strategy = strategies.get(params.strategy_id);
      if (!strategy) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Strategy not found" }) }],
        };
      }

      const roundData: RoundData = {
        p_effective: params.offer_price / 100,
        r_score: params.r_score,
        i_completeness: params.i_completeness,
        t_elapsed: params.t_elapsed,
        n_success: params.n_success,
        n_dispute_losses: params.n_dispute_losses,
      };

      const result = processNegotiationRound(
        checkoutStore,
        bridgeStore,
        hnpSessions,
        {
          checkoutId: params.checkout_id,
          offerPrice: params.offer_price,
          roundData,
          strategy,
        },
      );

      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            decision: result.roundResult.decision,
            counter_offer: result.roundResult.message.price
              ? Math.round(result.roundResult.message.price * 100)
              : null,
            utility: result.roundResult.utility.u_total,
            checkout_status: result.checkout.status,
            bridge_status: result.bridge.status,
            negotiation: result.checkout.extensions?.[NEGOTIATION_EXTENSION_KEY],
          }),
        }],
      };
    },
  );

  // ─── haggle_ucp_update_checkout ────────────────────────────
  server.tool(
    "haggle_ucp_update_checkout",
    "Update buyer info, fulfillment, or payment details on a checkout session.",
    {
      id: z.string().describe("Checkout session ID"),
      buyer_email: z.string().optional(),
      buyer_first_name: z.string().optional(),
      buyer_last_name: z.string().optional(),
    },
    async (params) => {
      const result = updateCheckoutSession(checkoutStore, params.id, {
        buyer: {
          email: params.buyer_email,
          first_name: params.buyer_first_name,
          last_name: params.buyer_last_name,
        },
      });

      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ checkout: result.session }) }],
      };
    },
  );

  // ─── haggle_ucp_complete_checkout ──────────────────────────
  server.tool(
    "haggle_ucp_complete_checkout",
    "Complete a checkout session with payment. Session must be in ready_for_complete status.",
    {
      id: z.string().describe("Checkout session ID"),
      payment_handler_id: z.string().describe("Payment handler ID (e.g., ai.tryhaggle.usdc)"),
      payment_type: z.string().default("crypto"),
      payment_token: z.string().describe("Payment credential token"),
    },
    async (params) => {
      const idempotencyKey = `mcp_complete_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const result = completeCheckoutSession(checkoutStore, params.id, {
        payment: {
          instruments: [{
            id: `pi_${Date.now()}`,
            handler_id: params.payment_handler_id,
            type: params.payment_type,
            credential: { type: "token", token: params.payment_token },
          }],
        },
      }, idempotencyKey);

      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ checkout: result.session }) }],
      };
    },
  );

  // ─── haggle_ucp_cancel_checkout ────────────────────────────
  server.tool(
    "haggle_ucp_cancel_checkout",
    "Cancel a checkout session. Cannot cancel completed sessions.",
    {
      id: z.string().describe("Checkout session ID"),
    },
    async ({ id }) => {
      const idempotencyKey = `mcp_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = cancelCheckoutSession(checkoutStore, id, idempotencyKey);

      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ checkout: result.session }) }],
      };
    },
  );
}
