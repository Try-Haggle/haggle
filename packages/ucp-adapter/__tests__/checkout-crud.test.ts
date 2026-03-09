import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCheckoutStore,
  createCheckoutSession,
  getCheckoutSession,
  updateCheckoutSession,
  completeCheckoutSession,
  cancelCheckoutSession,
  markCheckoutReady,
} from '../src/index.js';
import type { CheckoutStore } from '../src/index.js';

let store: CheckoutStore;

beforeEach(() => {
  store = createCheckoutStore();
});

const validRequest = {
  line_items: [
    { item: { id: 'prod_1', title: 'Running Shoes', price: 12000 }, quantity: 1 },
  ],
  currency: 'USD',
};

describe('createCheckoutSession', () => {
  it('creates a session with correct defaults', () => {
    const result = createCheckoutSession(store, validRequest, 'idem-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.status).toBe('incomplete');
    expect(result.session.currency).toBe('USD');
    expect(result.session.line_items).toHaveLength(1);
    expect(result.session.line_items[0].item.title).toBe('Running Shoes');
    expect(result.session.line_items[0].item.price).toBe(12000);
    expect(result.session.totals).toEqual([
      { type: 'subtotal', amount: 12000 },
      { type: 'total', amount: 12000 },
    ]);
  });

  it('returns cached response for duplicate idempotency key', () => {
    const r1 = createCheckoutSession(store, validRequest, 'idem-dup');
    const r2 = createCheckoutSession(store, validRequest, 'idem-dup');

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.session.id).toBe(r2.session.id);
    }
  });

  it('rejects empty line_items', () => {
    const result = createCheckoutSession(
      store,
      { line_items: [], currency: 'USD' },
      'idem-empty',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('rejects missing currency', () => {
    const result = createCheckoutSession(
      store,
      { line_items: validRequest.line_items, currency: '' },
      'idem-nocur',
    );
    expect(result.ok).toBe(false);
  });

  it('computes multi-item totals', () => {
    const result = createCheckoutSession(
      store,
      {
        line_items: [
          { item: { id: 'a', title: 'A', price: 1000 }, quantity: 2 },
          { item: { id: 'b', title: 'B', price: 500 }, quantity: 3 },
        ],
        currency: 'USD',
      },
      'idem-multi',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = result.session.totals.find((t) => t.type === 'total');
    expect(total?.amount).toBe(2000 + 1500); // 3500
  });
});

describe('getCheckoutSession', () => {
  it('retrieves existing session', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-get');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = getCheckoutSession(store, create.session.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.id).toBe(create.session.id);
    }
  });

  it('returns 404 for non-existent session', () => {
    const result = getCheckoutSession(store, 'chk_nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe('updateCheckoutSession', () => {
  it('updates buyer info', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-upd');
    if (!create.ok) return;

    const result = updateCheckoutSession(store, create.session.id, {
      buyer: { email: 'jane@example.com', first_name: 'Jane' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.buyer?.email).toBe('jane@example.com');
      expect(result.session.buyer?.first_name).toBe('Jane');
    }
  });

  it('merges extensions', () => {
    const create = createCheckoutSession(
      store,
      { ...validRequest, extensions: { foo: 'bar' } },
      'idem-ext',
    );
    if (!create.ok) return;

    const result = updateCheckoutSession(store, create.session.id, {
      extensions: { baz: 'qux' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.extensions).toEqual({ foo: 'bar', baz: 'qux' });
    }
  });

  it('reverts ready_for_complete to incomplete on update', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-revert');
    if (!create.ok) return;

    markCheckoutReady(store, create.session.id);
    const ready = getCheckoutSession(store, create.session.id);
    if (ready.ok) expect(ready.session.status).toBe('ready_for_complete');

    const result = updateCheckoutSession(store, create.session.id, {
      buyer: { email: 'new@example.com' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.status).toBe('incomplete');
    }
  });

  it('rejects update on canceled session', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-canc');
    if (!create.ok) return;

    cancelCheckoutSession(store, create.session.id, 'idem-canc2');
    const result = updateCheckoutSession(store, create.session.id, {
      buyer: { email: 'x@x.com' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});

describe('completeCheckoutSession', () => {
  function createReadySession() {
    const create = createCheckoutSession(store, validRequest, `idem-${Date.now()}-${Math.random()}`);
    if (!create.ok) throw new Error('create failed');
    markCheckoutReady(store, create.session.id);
    return create.session.id;
  }

  it('completes a ready session', () => {
    const id = createReadySession();
    const result = completeCheckoutSession(store, id, {
      payment: {
        instruments: [{
          id: 'pi_1',
          handler_id: 'ai.tryhaggle.usdc',
          type: 'crypto',
          credential: { type: 'token', token: 'sandbox_test' },
        }],
      },
    }, 'idem-complete');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.status).toBe('completed');
      expect(result.session.payment?.selected_instrument_id).toBe('pi_1');
    }
  });

  it('rejects completing an incomplete session', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-inc');
    if (!create.ok) return;

    const result = completeCheckoutSession(store, create.session.id, {
      payment: {
        instruments: [{
          id: 'pi_1',
          handler_id: 'test',
          type: 'card',
          credential: { type: 'token', token: 'tok' },
        }],
      },
    }, 'idem-comp-inc');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it('rejects without payment instruments', () => {
    const id = createReadySession();
    const result = completeCheckoutSession(store, id, {
      payment: { instruments: [] },
    }, 'idem-nopay');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns cached response for duplicate idempotency key', () => {
    const id = createReadySession();
    const payment = {
      payment: {
        instruments: [{
          id: 'pi_1',
          handler_id: 'test',
          type: 'card',
          credential: { type: 'token', token: 'tok' },
        }],
      },
    };

    const r1 = completeCheckoutSession(store, id, payment, 'idem-dup-comp');
    const r2 = completeCheckoutSession(store, id, payment, 'idem-dup-comp');

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.session.id).toBe(r2.session.id);
      expect(r1.session.status).toBe('completed');
    }
  });
});

describe('cancelCheckoutSession', () => {
  it('cancels an incomplete session', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-can1');
    if (!create.ok) return;

    const result = cancelCheckoutSession(store, create.session.id, 'idem-can2');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.status).toBe('canceled');
  });

  it('rejects canceling a completed session', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-cc1');
    if (!create.ok) return;
    markCheckoutReady(store, create.session.id);
    completeCheckoutSession(store, create.session.id, {
      payment: {
        instruments: [{
          id: 'pi_1',
          handler_id: 'test',
          type: 'card',
          credential: { type: 'token', token: 'tok' },
        }],
      },
    }, 'idem-cc2');

    const result = cancelCheckoutSession(store, create.session.id, 'idem-cc3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});

describe('markCheckoutReady', () => {
  it('transitions incomplete → ready_for_complete', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-rdy');
    if (!create.ok) return;

    const result = markCheckoutReady(store, create.session.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.status).toBe('ready_for_complete');
  });

  it('rejects from terminal state', () => {
    const create = createCheckoutSession(store, validRequest, 'idem-rdy2');
    if (!create.ok) return;
    cancelCheckoutSession(store, create.session.id, 'idem-rdy3');

    const result = markCheckoutReady(store, create.session.id);
    expect(result.ok).toBe(false);
  });
});
