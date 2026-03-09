// ============================================================
// UCP Order Webhook Handler
// Receives order events, verifies signature, updates bridge state
// ============================================================

import type { Order, OrderWebhookPayload } from './types.js';
import type { BridgeStore } from '../checkout/session-bridge.js';

export interface WebhookVerificationResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify webhook signature (Detached JWT per RFC 7797).
 * MVP: stub verification — always passes for sandbox tokens.
 * Production: verify JWS against signing keys from UCP profile.
 */
export function verifyWebhookSignature(
  signature: string | undefined,
  _body: string,
  _signingKeys: Array<{ kid: string; alg: string }>,
): WebhookVerificationResult {
  if (!signature) {
    return { ok: false, error: 'Missing Request-Signature header' };
  }

  // MVP: accept sandbox signatures
  if (signature.startsWith('sandbox_') || signature === 'test') {
    return { ok: true };
  }

  // Production: JWS verification would go here
  // For now, accept all signatures with a valid format (header..signature)
  const parts = signature.split('..');
  if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
    return { ok: true };
  }

  return { ok: false, error: 'Invalid signature format' };
}

// --- Order Store (in-memory for MVP) ---

export function createOrderStore() {
  const orders = new Map<string, Order>();
  const byCheckoutId = new Map<string, string>();

  function upsert(order: Order): Order {
    orders.set(order.id, order);
    byCheckoutId.set(order.checkout_id, order.id);
    return order;
  }

  function get(id: string): Order | null {
    return orders.get(id) ?? null;
  }

  function getByCheckoutId(checkoutId: string): Order | null {
    const orderId = byCheckoutId.get(checkoutId);
    return orderId ? orders.get(orderId) ?? null : null;
  }

  function clear(): void {
    orders.clear();
    byCheckoutId.clear();
  }

  return { upsert, get, getByCheckoutId, clear };
}

export type OrderStore = ReturnType<typeof createOrderStore>;

/**
 * Process an incoming order webhook event.
 * Per UCP spec: full order entity on every update (not incremental).
 */
export function processOrderWebhook(
  orderStore: OrderStore,
  bridgeStore: BridgeStore,
  payload: OrderWebhookPayload,
): { ok: true; order: Order } | { ok: false; error: string } {
  const { order } = payload;

  if (!order || !order.id || !order.checkout_id) {
    return { ok: false, error: 'Invalid order payload: missing id or checkout_id' };
  }

  // Store/update order
  orderStore.upsert(order);

  // Update bridge status if exists
  const bridge = bridgeStore.getByCheckoutId(order.checkout_id);
  if (bridge) {
    // Check if all items are fulfilled
    const allFulfilled = order.line_items.every(
      (li) => li.fulfillment_status === 'fulfilled',
    );

    if (allFulfilled) {
      bridgeStore.update(bridge.id, { status: 'COMPLETED' });
    }
  }

  return { ok: true, order };
}
