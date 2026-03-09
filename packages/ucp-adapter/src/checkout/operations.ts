// ============================================================
// Checkout Session Operations
// Business logic for create/update/complete/cancel
// ============================================================

import type {
  CheckoutSession,
  CreateCheckoutRequest,
  UpdateCheckoutRequest,
  CompleteCheckoutRequest,
  Total,
  LineItem,
  CheckoutMessage,
} from './types.js';
import type { CheckoutStore } from './store.js';
import { transitionCheckout, isTerminalCheckoutStatus } from './state-machine.js';

export type CheckoutResult =
  | { ok: true; session: CheckoutSession }
  | { ok: false; status: number; error: string; messages?: CheckoutMessage[] };

function computeTotals(lineItems: LineItem[]): Total[] {
  let subtotal = 0;
  for (const li of lineItems) {
    const liTotal = li.totals.find((t) => t.type === 'total');
    subtotal += liTotal ? liTotal.amount : li.item.price * li.quantity;
  }
  return [
    { type: 'subtotal', amount: subtotal },
    { type: 'total', amount: subtotal },
  ];
}

export function createCheckoutSession(
  store: CheckoutStore,
  request: CreateCheckoutRequest,
  idempotencyKey: string,
): CheckoutResult {
  // Idempotency check
  const existing = store.getByIdempotencyKey(idempotencyKey);
  if (existing) {
    return { ok: true, session: existing.response };
  }

  // Validate
  if (!request.line_items || request.line_items.length === 0) {
    return { ok: false, status: 400, error: 'At least one line item is required' };
  }
  if (!request.currency) {
    return { ok: false, status: 400, error: 'Currency is required' };
  }

  const now = new Date().toISOString();
  const id = store.generateId();

  // Build line items with totals
  const lineItems: LineItem[] = request.line_items.map((li, idx) => {
    const price = li.item.price ?? 0;
    const amount = price * li.quantity;
    return {
      id: `li_${idx + 1}`,
      item: { id: li.item.id, title: li.item.title, price },
      quantity: li.quantity,
      totals: [
        { type: 'subtotal', amount },
        { type: 'total', amount },
      ],
    };
  });

  const session: CheckoutSession = {
    id,
    status: 'incomplete',
    currency: request.currency.toUpperCase(),
    line_items: lineItems,
    buyer: request.buyer,
    totals: computeTotals(lineItems),
    extensions: request.extensions,
    created_at: now,
    updated_at: now,
  };

  store.create(session);
  store.setIdempotencyKey(idempotencyKey, id, session);

  return { ok: true, session };
}

export function getCheckoutSession(
  store: CheckoutStore,
  id: string,
): CheckoutResult {
  const session = store.get(id);
  if (!session) {
    return { ok: false, status: 404, error: `Checkout session not found: ${id}` };
  }
  return { ok: true, session };
}

export function updateCheckoutSession(
  store: CheckoutStore,
  id: string,
  request: UpdateCheckoutRequest,
): CheckoutResult {
  const session = store.get(id);
  if (!session) {
    return { ok: false, status: 404, error: `Checkout session not found: ${id}` };
  }

  if (isTerminalCheckoutStatus(session.status)) {
    return { ok: false, status: 409, error: `Cannot update session in ${session.status} state` };
  }

  // If session was ready_for_complete, revert to incomplete on update
  let newStatus = session.status;
  if (session.status === 'ready_for_complete') {
    const next = transitionCheckout(session.status, 'update');
    if (next) newStatus = next;
  }

  const updates: Partial<CheckoutSession> = { status: newStatus };

  if (request.buyer) {
    updates.buyer = { ...session.buyer, ...request.buyer };
  }
  if (request.fulfillment) {
    updates.fulfillment = request.fulfillment;
    // Recompute totals with fulfillment costs
    const fulfillmentTotal = request.fulfillment.methods.reduce((sum, m) => {
      const groupCost = (m.groups ?? []).reduce((gs, g) => {
        const selected = g.options.find((o) => o.id === g.selected_option_id);
        const optTotal = selected?.totals.find((t) => t.type === 'total');
        return gs + (optTotal?.amount ?? 0);
      }, 0);
      return sum + groupCost;
    }, 0);

    const baseTotals = computeTotals(session.line_items);
    const subtotal = baseTotals.find((t) => t.type === 'subtotal')?.amount ?? 0;
    updates.totals = [
      { type: 'subtotal', amount: subtotal },
      ...(fulfillmentTotal > 0 ? [{ type: 'fulfillment' as const, amount: fulfillmentTotal }] : []),
      { type: 'total', amount: subtotal + fulfillmentTotal },
    ];
  }
  if (request.payment) {
    updates.payment = request.payment;
  }
  if (request.extensions) {
    updates.extensions = { ...session.extensions, ...request.extensions };
  }

  const updated = store.update(id, updates);
  if (!updated) {
    return { ok: false, status: 500, error: 'Failed to update session' };
  }

  return { ok: true, session: updated };
}

export function completeCheckoutSession(
  store: CheckoutStore,
  id: string,
  request: CompleteCheckoutRequest,
  idempotencyKey: string,
): CheckoutResult {
  // Idempotency
  const existingIdem = store.getByIdempotencyKey(idempotencyKey);
  if (existingIdem && existingIdem.sessionId === id) {
    return { ok: true, session: existingIdem.response };
  }

  const session = store.get(id);
  if (!session) {
    return { ok: false, status: 404, error: `Checkout session not found: ${id}` };
  }

  if (session.status !== 'ready_for_complete') {
    return {
      ok: false,
      status: 409,
      error: `Cannot complete session in ${session.status} state. Must be ready_for_complete.`,
    };
  }

  if (!request.payment?.instruments || request.payment.instruments.length === 0) {
    return { ok: false, status: 400, error: 'At least one payment instrument is required' };
  }

  const next = transitionCheckout(session.status, 'complete');
  if (!next) {
    return { ok: false, status: 409, error: 'Invalid state transition' };
  }

  const updated = store.update(id, {
    status: next,
    payment: {
      ...session.payment,
      instruments: request.payment.instruments,
      selected_instrument_id: request.payment.instruments[0].id,
    },
  });

  if (!updated) {
    return { ok: false, status: 500, error: 'Failed to complete session' };
  }

  store.setIdempotencyKey(idempotencyKey, id, updated);
  return { ok: true, session: updated };
}

export function cancelCheckoutSession(
  store: CheckoutStore,
  id: string,
  idempotencyKey: string,
): CheckoutResult {
  // Idempotency
  const existingIdem = store.getByIdempotencyKey(idempotencyKey);
  if (existingIdem && existingIdem.sessionId === id) {
    return { ok: true, session: existingIdem.response };
  }

  const session = store.get(id);
  if (!session) {
    return { ok: false, status: 404, error: `Checkout session not found: ${id}` };
  }

  if (isTerminalCheckoutStatus(session.status)) {
    return { ok: false, status: 409, error: `Cannot cancel session in ${session.status} state` };
  }

  const next = transitionCheckout(session.status, 'cancel');
  if (!next) {
    return { ok: false, status: 409, error: 'Invalid state transition' };
  }

  const updated = store.update(id, { status: next });
  if (!updated) {
    return { ok: false, status: 500, error: 'Failed to cancel session' };
  }

  store.setIdempotencyKey(idempotencyKey, id, updated);
  return { ok: true, session: updated };
}

/**
 * Transition checkout to ready_for_complete.
 * Used when all requirements are met (e.g., negotiation agreed + buyer info complete).
 */
export function markCheckoutReady(
  store: CheckoutStore,
  id: string,
): CheckoutResult {
  const session = store.get(id);
  if (!session) {
    return { ok: false, status: 404, error: `Checkout session not found: ${id}` };
  }

  const next = transitionCheckout(session.status, 'ready');
  if (!next) {
    return { ok: false, status: 409, error: `Cannot mark ready from ${session.status} state` };
  }

  const updated = store.update(id, { status: next });
  if (!updated) {
    return { ok: false, status: 500, error: 'Failed to update session' };
  }

  return { ok: true, session: updated };
}
