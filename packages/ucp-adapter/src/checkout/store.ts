// ============================================================
// In-memory Checkout Session Store (MVP)
// Includes idempotency key tracking (24h minimum per UCP spec)
// ============================================================

import type { CheckoutSession } from './types.js';

export interface IdempotencyRecord {
  key: string;
  sessionId: string;
  response: CheckoutSession;
  createdAt: number;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createCheckoutStore() {
  const sessions = new Map<string, CheckoutSession>();
  const idempotencyKeys = new Map<string, IdempotencyRecord>();

  let counter = 0;

  function generateId(): string {
    counter += 1;
    return `chk_${Date.now()}_${counter}`;
  }

  function create(session: CheckoutSession): CheckoutSession {
    sessions.set(session.id, session);
    return session;
  }

  function get(id: string): CheckoutSession | null {
    return sessions.get(id) ?? null;
  }

  function update(id: string, updates: Partial<CheckoutSession>): CheckoutSession | null {
    const existing = sessions.get(id);
    if (!existing) return null;

    const updated: CheckoutSession = {
      ...existing,
      ...updates,
      id: existing.id, // never overwrite id
      created_at: existing.created_at, // never overwrite created_at
      updated_at: new Date().toISOString(),
    };
    sessions.set(id, updated);
    return updated;
  }

  function remove(id: string): boolean {
    return sessions.delete(id);
  }

  function getByIdempotencyKey(key: string): IdempotencyRecord | null {
    const record = idempotencyKeys.get(key);
    if (!record) return null;

    // Expired?
    if (Date.now() - record.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyKeys.delete(key);
      return null;
    }
    return record;
  }

  function setIdempotencyKey(
    key: string,
    sessionId: string,
    response: CheckoutSession,
  ): void {
    idempotencyKeys.set(key, {
      key,
      sessionId,
      response,
      createdAt: Date.now(),
    });
  }

  function clear(): void {
    sessions.clear();
    idempotencyKeys.clear();
    counter = 0;
  }

  return {
    generateId,
    create,
    get,
    update,
    remove,
    getByIdempotencyKey,
    setIdempotencyKey,
    clear,
  };
}

export type CheckoutStore = ReturnType<typeof createCheckoutStore>;
