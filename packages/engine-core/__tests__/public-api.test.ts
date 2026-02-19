import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * Public API surface test.
 * Verifies that every function and type/enum exported from index.ts
 * is actually accessible at runtime.
 */
describe('Public API (@haggle/engine-core)', () => {
  describe('function exports', () => {
    it('exports computeUtility', () => {
      expect(typeof api.computeUtility).toBe('function');
    });

    it('exports computeVp', () => {
      expect(typeof api.computeVp).toBe('function');
    });

    it('exports computeVt', () => {
      expect(typeof api.computeVt).toBe('function');
    });

    it('exports computeVr', () => {
      expect(typeof api.computeVr).toBe('function');
    });

    it('exports computeVs', () => {
      expect(typeof api.computeVs).toBe('function');
    });

    it('exports adjustVpForCompetition', () => {
      expect(typeof api.adjustVpForCompetition).toBe('function');
    });

    it('exports makeDecision', () => {
      expect(typeof api.makeDecision).toBe('function');
    });

    it('exports computeCounterOffer', () => {
      expect(typeof api.computeCounterOffer).toBe('function');
    });

    it('exports batchEvaluate', () => {
      expect(typeof api.batchEvaluate).toBe('function');
    });

    it('exports compareSessions', () => {
      expect(typeof api.compareSessions).toBe('function');
    });

    it('exports validateContext', () => {
      expect(typeof api.validateContext).toBe('function');
    });

    it('exports clamp', () => {
      expect(typeof api.clamp).toBe('function');
    });
  });

  describe('enum exports', () => {
    it('exports EngineError with all members', () => {
      expect(api.EngineError.INVALID_WEIGHTS).toBe('INVALID_WEIGHTS');
      expect(api.EngineError.ZERO_PRICE_RANGE).toBe('ZERO_PRICE_RANGE');
      expect(api.EngineError.INVALID_DEADLINE).toBe('INVALID_DEADLINE');
      expect(api.EngineError.INVALID_ALPHA).toBe('INVALID_ALPHA');
      expect(api.EngineError.INVALID_RISK_INPUT).toBe('INVALID_RISK_INPUT');
      expect(api.EngineError.INVALID_THRESHOLD).toBe('INVALID_THRESHOLD');
    });
  });

  describe('end-to-end through public API', () => {
    it('full flow: computeUtility → makeDecision → computeCounterOffer', () => {
      const ctx: api.NegotiationContext = {
        weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
        price: { p_effective: 200, p_target: 180, p_limit: 220 },
        time: { t_elapsed: 36000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 },
        risk: { r_score: 0.85, i_completeness: 0.90, w_rep: 0.6, w_info: 0.4 },
        relationship: { n_success: 3, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 },
      };

      // Step 1: compute utility
      const utility = api.computeUtility(ctx);
      expect(utility.error).toBeUndefined();
      expect(utility.u_total).toBeGreaterThan(0);

      // Step 2: make decision
      const thresholds: api.DecisionThresholds = { u_threshold: 0.6, u_aspiration: 0.85 };
      const session: api.SessionState = { rounds_no_concession: 0 };
      const decision = api.makeDecision(utility, thresholds, session);
      expect(['ACCEPT', 'COUNTER', 'REJECT', 'NEAR_DEAL', 'ESCALATE']).toContain(decision.action);

      // Step 3: if COUNTER, compute counter-offer
      if (decision.action === 'COUNTER' || decision.action === 'NEAR_DEAL') {
        const params: api.FaratinParams = { p_start: 180, p_limit: 220, t: 36000, T: 86400, beta: 1.5 };
        const counterPrice = api.computeCounterOffer(params);
        expect(counterPrice).toBeGreaterThanOrEqual(180);
        expect(counterPrice).toBeLessThanOrEqual(220);
      }
    });

    it('full flow: batchEvaluate → compareSessions', () => {
      const request: api.BatchEvaluateRequest = {
        strategy: {
          weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
          p_target: 180,
          p_limit: 220,
          time: { t_elapsed: 36000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 },
          n_threshold: 10,
        },
        listings: [
          { listing_id: 'A', p_effective: 200, r_score: 0.8, i_completeness: 0.9 },
          { listing_id: 'B', p_effective: 190, r_score: 0.9, i_completeness: 0.95 },
        ],
      };

      // Step 1: batch evaluate
      const batchResult = api.batchEvaluate(request);
      expect(batchResult.evaluated).toBe(2);
      expect(batchResult.rankings).toHaveLength(2);

      // Step 2: compare as sessions
      const snapshots: api.SessionSnapshot[] = batchResult.rankings.map((r) => ({
        session_id: r.listing_id,
        utility: r.utility,
        thresholds: { u_threshold: 0.6, u_aspiration: 0.85 },
      }));

      const compareResult = api.compareSessions(snapshots);
      expect(compareResult.rankings).toHaveLength(2);
      expect(compareResult.batna).toBeDefined();
      expect(['CONTINUE', 'ACCEPT_BEST', 'ESCALATE']).toContain(compareResult.recommended_action);
    });
  });
});
