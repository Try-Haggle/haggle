import { describe, it, expect, beforeEach } from 'vitest';
import { NegotiationBridge } from '../../src/negotiation/bridge.js';
import { InMemorySessionStore } from '../../src/negotiation/session-store.js';
import { BridgeErrorCode } from '../../src/negotiation/types.js';
import type { StartSessionInput, SubmitOfferInput, ListingContext } from '../../src/negotiation/types.js';

function makeListing(overrides?: Partial<ListingContext>): ListingContext {
  return {
    listing_id: 'lst_1',
    title: 'Test Item',
    target_price: 100,
    floor_price: 70,
    condition: 'good',
    seller_id: 'seller_1',
    ...overrides,
  };
}

function makeStartInput(overrides?: Partial<StartSessionInput>): StartSessionInput {
  return {
    listing: makeListing(),
    role: 'BUYER',
    user_id: 'buyer_1',
    counterparty_id: 'seller_1',
    ...overrides,
  };
}

describe('NegotiationBridge', () => {
  let store: InMemorySessionStore;
  let bridge: NegotiationBridge;

  beforeEach(() => {
    store = new InMemorySessionStore();
    bridge = new NegotiationBridge(store);
  });

  // ── startSession ──────────────────────────────────────────

  describe('startSession', () => {
    it('should create a session successfully', async () => {
      const result = await bridge.startSession(makeStartInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.session.session_id).toBeTruthy();
      expect(result.data.strategy_id).toBeTruthy();
    });

    it('should create a session in CREATED status', async () => {
      const result = await bridge.startSession(makeStartInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.session.status).toBe('CREATED');
    });

    it('should store the session in the store', async () => {
      const result = await bridge.startSession(makeStartInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const stored = await store.get(result.data.session.session_id);
      expect(stored).not.toBeNull();
      expect(stored!.strategy.id).toBe(result.data.strategy_id);
    });

    it('should set user_id on the strategy', async () => {
      const result = await bridge.startSession(makeStartInput({ user_id: 'my_user' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const stored = await store.get(result.data.session.session_id);
      expect(stored!.strategy.user_id).toBe('my_user');
    });

    it('should reject listing with zero target_price', async () => {
      const result = await bridge.startSession(
        makeStartInput({ listing: makeListing({ target_price: 0 }) }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(BridgeErrorCode.INVALID_STRATEGY);
    });
  });

  // ── submitOffer ───────────────────────────────────────────

  describe('submitOffer', () => {
    async function createSession(): Promise<string> {
      const r = await bridge.startSession(makeStartInput());
      if (!r.ok) throw new Error('Setup failed');
      return r.data.session.session_id;
    }

    it('should execute a round successfully', async () => {
      const sessionId = await createSession();
      const result = await bridge.submitOffer({
        session_id: sessionId,
        price: 90,
        sender_role: 'SELLER',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.decision).toBeTruthy();
      expect(result.data.utility.u_total).toBeGreaterThanOrEqual(0);
    });

    it('should transition CREATED→ACTIVE on first offer', async () => {
      const sessionId = await createSession();
      const result = await bridge.submitOffer({
        session_id: sessionId,
        price: 90,
        sender_role: 'SELLER',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.session.status).toBe('ACTIVE');
    });

    it('should return SESSION_NOT_FOUND for unknown session', async () => {
      const result = await bridge.submitOffer({
        session_id: 'nonexistent',
        price: 90,
        sender_role: 'SELLER',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(BridgeErrorCode.SESSION_NOT_FOUND);
    });

    it('should return SESSION_TERMINAL for terminated sessions', async () => {
      const sessionId = await createSession();
      // Manually set session to ACCEPTED
      const stored = await store.get(sessionId);
      await store.save({
        ...stored!,
        session: { ...stored!.session, status: 'ACCEPTED' },
      });

      const result = await bridge.submitOffer({
        session_id: sessionId,
        price: 90,
        sender_role: 'SELLER',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(BridgeErrorCode.SESSION_TERMINAL);
    });

    it('should return SESSION_EXPIRED when timed out', async () => {
      const sessionId = await createSession();
      // Manually set created_at far in the past
      const stored = await store.get(sessionId);
      const oldTime = Date.now() - 86400_000 * 2; // 2 days ago
      await store.save({
        session: { ...stored!.session, created_at: oldTime },
        strategy: stored!.strategy,
      });

      const result = await bridge.submitOffer({
        session_id: sessionId,
        price: 90,
        sender_role: 'SELLER',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(BridgeErrorCode.SESSION_EXPIRED);
    });

    it('should return INVALID_PRICE for price <= 0', async () => {
      const sessionId = await createSession();
      const result = await bridge.submitOffer({
        session_id: sessionId,
        price: 0,
        sender_role: 'SELLER',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(BridgeErrorCode.INVALID_PRICE);
    });

    it('should return INVALID_PRICE for negative price', async () => {
      const sessionId = await createSession();
      const result = await bridge.submitOffer({
        session_id: sessionId,
        price: -10,
        sender_role: 'SELLER',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(BridgeErrorCode.INVALID_PRICE);
    });

    it('should increment round count on multiple offers', async () => {
      const sessionId = await createSession();

      const r1 = await bridge.submitOffer({
        session_id: sessionId, price: 95, sender_role: 'SELLER',
      });
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;
      expect(r1.data.session.current_round).toBe(1);

      const r2 = await bridge.submitOffer({
        session_id: sessionId, price: 92, sender_role: 'SELLER',
      });
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;
      expect(r2.data.session.current_round).toBe(2);
    });

    it('should return outgoing message with session role', async () => {
      const sessionId = await createSession();
      const result = await bridge.submitOffer({
        session_id: sessionId, price: 90, sender_role: 'SELLER',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Bridge was created with BUYER role, outgoing message should be BUYER
      expect(result.data.message.sender_role).toBe('BUYER');
    });
  });

  // ── getSessionState ───────────────────────────────────────

  describe('getSessionState', () => {
    it('should return session state', async () => {
      const startResult = await bridge.startSession(makeStartInput());
      if (!startResult.ok) throw new Error('Setup failed');
      const sessionId = startResult.data.session.session_id;

      const result = await bridge.getSessionState(sessionId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('CREATED');
      expect(result.data.round_count).toBe(0);
    });

    it('should return SESSION_NOT_FOUND for unknown id', async () => {
      const result = await bridge.getSessionState('nonexistent');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(BridgeErrorCode.SESSION_NOT_FOUND);
    });

    it('should report is_terminal=true for terminal sessions', async () => {
      const startResult = await bridge.startSession(makeStartInput());
      if (!startResult.ok) throw new Error('Setup failed');
      const sessionId = startResult.data.session.session_id;

      // Manually set to REJECTED
      const stored = await store.get(sessionId);
      await store.save({
        ...stored!,
        session: { ...stored!.session, status: 'REJECTED' },
      });

      const result = await bridge.getSessionState(sessionId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.is_terminal).toBe(true);
    });

    it('should auto-expire timed out sessions', async () => {
      const startResult = await bridge.startSession(makeStartInput());
      if (!startResult.ok) throw new Error('Setup failed');
      const sessionId = startResult.data.session.session_id;

      // Set created_at far in the past
      const stored = await store.get(sessionId);
      await store.save({
        session: { ...stored!.session, created_at: Date.now() - 86400_000 * 2 },
        strategy: stored!.strategy,
      });

      const result = await bridge.getSessionState(sessionId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('EXPIRED');
      expect(result.data.is_terminal).toBe(true);
    });
  });
});
