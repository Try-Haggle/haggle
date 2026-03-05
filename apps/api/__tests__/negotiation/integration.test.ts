import { describe, it, expect, vi, afterEach } from 'vitest';
import { NegotiationBridge } from '../../src/negotiation/bridge.js';
import { InMemorySessionStore } from '../../src/negotiation/session-store.js';
import { BridgeErrorCode } from '../../src/negotiation/types.js';
import type { StartSessionInput, ListingContext } from '../../src/negotiation/types.js';

function makeListing(): ListingContext {
  return {
    listing_id: 'lst_integ',
    title: 'Integration Test Item',
    target_price: 100,
    floor_price: 70,
    condition: 'good',
    seller_id: 'seller_1',
    seller_reputation: 0.8,
    info_completeness: 0.9,
  };
}

function makeStartInput(): StartSessionInput {
  return {
    listing: makeListing(),
    role: 'BUYER',
    user_id: 'buyer_1',
    counterparty_id: 'seller_1',
    persona: 'balanced',
  };
}

describe('Integration: full negotiation lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle full lifecycle: create → multi-round → final state', async () => {
    const store = new InMemorySessionStore();
    const bridge = new NegotiationBridge(store);

    // 1. Create session
    const startResult = await bridge.startSession(makeStartInput());
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) return;
    const sessionId = startResult.data.session.session_id;
    expect(startResult.data.session.status).toBe('CREATED');

    // 2. First offer (seller sends 95)
    const r1 = await bridge.submitOffer({
      session_id: sessionId,
      price: 95,
      sender_role: 'SELLER',
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.data.session.current_round).toBe(1);
    expect(r1.data.session.status).toBe('ACTIVE');

    // 3. Second offer (seller comes down to 90)
    const r2 = await bridge.submitOffer({
      session_id: sessionId,
      price: 90,
      sender_role: 'SELLER',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.data.session.current_round).toBe(2);

    // 4. Third offer (seller comes down to 85)
    const r3 = await bridge.submitOffer({
      session_id: sessionId,
      price: 85,
      sender_role: 'SELLER',
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.data.session.current_round).toBe(3);

    // 5. Verify state reflects all rounds
    const state = await bridge.getSessionState(sessionId);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.data.round_count).toBe(3);
  });

  it('should expire session via timeout', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const store = new InMemorySessionStore();
    const bridge = new NegotiationBridge(store);

    const startResult = await bridge.startSession(makeStartInput());
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) return;
    const sessionId = startResult.data.session.session_id;

    // Advance time past deadline (24h + 1s)
    vi.setSystemTime(now + 86400_000 + 1000);

    const offerResult = await bridge.submitOffer({
      session_id: sessionId,
      price: 90,
      sender_role: 'SELLER',
    });
    expect(offerResult.ok).toBe(false);
    if (offerResult.ok) return;
    expect(offerResult.error.code).toBe(BridgeErrorCode.SESSION_EXPIRED);

    // State should also show expired
    const state = await bridge.getSessionState(sessionId);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.data.status).toBe('EXPIRED');
    expect(state.data.is_terminal).toBe(true);
  });

  it('should reject offers after session reaches terminal state', async () => {
    const store = new InMemorySessionStore();
    const bridge = new NegotiationBridge(store);

    const startResult = await bridge.startSession(makeStartInput());
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) return;
    const sessionId = startResult.data.session.session_id;

    // Manually force terminal state
    const stored = await store.get(sessionId);
    await store.save({
      ...stored!,
      session: { ...stored!.session, status: 'ACCEPTED' },
    });

    const offerResult = await bridge.submitOffer({
      session_id: sessionId,
      price: 85,
      sender_role: 'SELLER',
    });
    expect(offerResult.ok).toBe(false);
    if (offerResult.ok) return;
    expect(offerResult.error.code).toBe(BridgeErrorCode.SESSION_TERMINAL);
  });

  it('should create SELLER sessions with correct pricing', async () => {
    const store = new InMemorySessionStore();
    const bridge = new NegotiationBridge(store);

    const result = await bridge.startSession({
      listing: makeListing(),
      role: 'SELLER',
      user_id: 'seller_1',
      counterparty_id: 'buyer_1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await store.get(result.data.session.session_id);
    expect(stored!.strategy.p_target).toBe(100);
    expect(stored!.strategy.p_limit).toBe(70);
    expect(stored!.session.role).toBe('SELLER');
  });

  it('should handle concurrent sessions independently', async () => {
    const store = new InMemorySessionStore();
    const bridge = new NegotiationBridge(store);

    const s1 = await bridge.startSession(makeStartInput());
    const s2 = await bridge.startSession({
      ...makeStartInput(),
      user_id: 'buyer_2',
      persona: 'aggressive',
    });

    expect(s1.ok).toBe(true);
    expect(s2.ok).toBe(true);
    if (!s1.ok || !s2.ok) return;

    // Submit offers to each independently
    const r1 = await bridge.submitOffer({
      session_id: s1.data.session.session_id, price: 90, sender_role: 'SELLER',
    });
    const r2 = await bridge.submitOffer({
      session_id: s2.data.session.session_id, price: 90, sender_role: 'SELLER',
    });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    // They should be independent sessions
    expect(r1.data.session.session_id).not.toBe(r2.data.session.session_id);
    expect(store.size).toBe(2);
  });
});
