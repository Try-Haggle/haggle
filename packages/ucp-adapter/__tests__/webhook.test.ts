import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifyWebhookSignature,
  createOrderStore,
  createBridgeStore,
  processOrderWebhook,
} from '../src/index.js';
import type { OrderStore, BridgeStore, Order } from '../src/index.js';

let orderStore: OrderStore;
let bridgeStore: BridgeStore;

beforeEach(() => {
  orderStore = createOrderStore();
  bridgeStore = createBridgeStore();
});

function makeOrder(overrides?: Partial<Order>): Order {
  return {
    id: 'order_1',
    checkout_id: 'chk_1',
    permalink_url: 'https://merchant.com/orders/1',
    line_items: [{
      id: 'li_1',
      item_id: 'prod_1',
      title: 'Running Shoes',
      quantity: 1,
      price: 22000,
      fulfillment_status: 'processing',
    }],
    fulfillment: {
      expectations: [{ method: 'shipping', description: '5-7 business days' }],
      events: [],
    },
    adjustments: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('verifyWebhookSignature', () => {
  it('rejects missing signature', () => {
    const result = verifyWebhookSignature(undefined, '{}', []);
    expect(result.ok).toBe(false);
  });

  it('accepts sandbox signatures', () => {
    expect(verifyWebhookSignature('sandbox_test', '{}', []).ok).toBe(true);
    expect(verifyWebhookSignature('test', '{}', []).ok).toBe(true);
  });

  it('accepts valid JWS detached format', () => {
    const result = verifyWebhookSignature('eyJhbGciOiJFUzI1NiJ9..signature_here', '{}', []);
    expect(result.ok).toBe(true);
  });

  it('rejects invalid format', () => {
    const result = verifyWebhookSignature('invalid', '{}', []);
    expect(result.ok).toBe(false);
  });
});

describe('processOrderWebhook', () => {
  it('stores a new order', () => {
    const order = makeOrder();
    const result = processOrderWebhook(orderStore, bridgeStore, { order });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.id).toBe('order_1');
    }

    expect(orderStore.get('order_1')).not.toBeNull();
    expect(orderStore.getByCheckoutId('chk_1')).not.toBeNull();
  });

  it('updates bridge to COMPLETED when all items fulfilled', () => {
    // Create bridge first
    bridgeStore.create({
      id: 'bridge_1',
      ucp_checkout_id: 'chk_1',
      hnp_session_id: 'hnp_1',
      status: 'AGREED',
      listing_price: 25000,
      negotiated_price: 22000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const order = makeOrder({
      line_items: [{
        id: 'li_1',
        item_id: 'prod_1',
        title: 'Running Shoes',
        quantity: 1,
        price: 22000,
        fulfillment_status: 'fulfilled',
      }],
    });

    processOrderWebhook(orderStore, bridgeStore, { order });

    const bridge = bridgeStore.getByCheckoutId('chk_1');
    expect(bridge?.status).toBe('COMPLETED');
  });

  it('does not update bridge if not all items fulfilled', () => {
    bridgeStore.create({
      id: 'bridge_2',
      ucp_checkout_id: 'chk_2',
      hnp_session_id: 'hnp_2',
      status: 'AGREED',
      listing_price: 25000,
      negotiated_price: 22000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const order = makeOrder({
      checkout_id: 'chk_2',
      line_items: [{
        id: 'li_1',
        item_id: 'prod_1',
        title: 'Running Shoes',
        quantity: 1,
        price: 22000,
        fulfillment_status: 'processing',
      }],
    });

    processOrderWebhook(orderStore, bridgeStore, { order });

    const bridge = bridgeStore.getByCheckoutId('chk_2');
    expect(bridge?.status).toBe('AGREED'); // not COMPLETED
  });

  it('rejects invalid payload', () => {
    const result = processOrderWebhook(orderStore, bridgeStore, { order: {} as any });
    expect(result.ok).toBe(false);
  });
});
