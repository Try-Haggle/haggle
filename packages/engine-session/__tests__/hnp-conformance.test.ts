import { describe, it, expect } from 'vitest';
import {
  toMinorUnits,
  fromMinorUnits,
  createHnpProfile,
  negotiateCoreRevision,
  negotiateCapability,
  negotiateProfile,
  transition,
} from '../src/index.js';
import type {
  HnpEnvelope,
  HnpProposalPayload,
  HnpAcceptPayload,
  HnpErrorPayload,
  HnpEscalatePayload,
  HnpWellKnownProfile,
  HnpCapabilitySupport,
} from '../src/index.js';

describe('HNP Conformance', () => {
  // ── 1. Money conversion ──────────────────────────────────────

  describe('Money conversion (P0-4)', () => {
    it('toMinorUnits converts decimal to integer', () => {
      expect(toMinorUnits(49.99)).toBe(4999);
      expect(toMinorUnits(0)).toBe(0);
      expect(toMinorUnits(100)).toBe(10000);
      expect(toMinorUnits(1.1)).toBe(110);
    });

    it('fromMinorUnits converts integer to decimal', () => {
      expect(fromMinorUnits(4999)).toBe(49.99);
      expect(fromMinorUnits(0)).toBe(0);
      expect(fromMinorUnits(10000)).toBe(100);
    });

    it('roundtrip preserves value', () => {
      expect(fromMinorUnits(toMinorUnits(49.99))).toBe(49.99);
      expect(fromMinorUnits(toMinorUnits(0.01))).toBe(0.01);
    });
  });

  // ── 2. Envelope structure (P0-2) ────────────────────────────

  describe('Envelope structure (P0-2)', () => {
    it('requires all mandatory fields', () => {
      const envelope: HnpEnvelope<HnpProposalPayload> = {
        spec_version: '2026-03-09',
        capability: 'hnp.core.negotiation',
        session_id: 'sess-001',
        message_id: 'msg-001',
        idempotency_key: 'idem-001',
        sequence: 1,
        sent_at_ms: Date.now(),
        expires_at_ms: Date.now() + 60_000,
        sender_agent_id: 'agent-buyer',
        sender_role: 'BUYER',
        type: 'OFFER',
        payload: {
          proposal_id: 'prop-001',
          issues: [{ issue_id: 'price', value: 4999, kind: 'NEGOTIABLE' }],
          total_price: { currency: 'USD', units_minor: 4999 },
        },
      };

      expect(envelope.message_id).toBeDefined();
      expect(envelope.idempotency_key).toBeDefined();
      expect(envelope.sequence).toBeGreaterThanOrEqual(0);
      expect(envelope.sender_agent_id).toBeDefined();
      expect(envelope.sender_role).toBeDefined();
    });
  });

  // ── 3. ACCEPT binding (P0-3) ────────────────────────────────

  describe('ACCEPT binding (P0-3)', () => {
    it('requires accepted_message_id and accepted_proposal_id', () => {
      const accept: HnpAcceptPayload = {
        accepted_message_id: 'msg-001',
        accepted_proposal_id: 'prop-001',
      };

      expect(accept.accepted_message_id).toBe('msg-001');
      expect(accept.accepted_proposal_id).toBe('prop-001');
    });
  });

  // ── 4. ERROR vs ESCALATE separation (P0-5) ──────────────────

  describe('ERROR vs ESCALATE separation (P0-5)', () => {
    it('ERROR has code + retryable, ESCALATE has escalation_code', () => {
      const error: HnpErrorPayload = {
        code: 'INVALID_PROPOSAL',
        message: 'Price out of range',
        retryable: true,
      };

      const escalate: HnpEscalatePayload = {
        escalation_code: 'HUMAN_APPROVAL_REQUIRED',
        detail: 'Amount exceeds auto-approve threshold',
      };

      // ERROR payload structure
      expect(error.code).toBe('INVALID_PROPOSAL');
      expect(error.retryable).toBe(true);
      expect(error.message).toBeDefined();

      // ESCALATE payload structure — different shape
      expect(escalate.escalation_code).toBe('HUMAN_APPROVAL_REQUIRED');
      expect((escalate as any).code).toBeUndefined();
      expect((escalate as any).retryable).toBeUndefined();
    });
  });

  // ── 5. Profile creation ─────────────────────────────────────

  describe('Profile creation', () => {
    it('createHnpProfile produces a valid HnpWellKnownProfile', () => {
      const profile = createHnpProfile({
        endpoint: 'https://example.com/hnp',
        transports: [{ name: 'rest', endpoint: 'https://example.com/hnp' }],
      });

      expect(profile.hnp).toBeDefined();
      expect(profile.hnp.core_revisions).toContain('2026-03-09');
      expect(profile.hnp.preferred_core_revision).toBe('2026-03-09');
      expect(profile.hnp.transports).toHaveLength(1);
      expect(profile.hnp.capabilities['hnp.core.negotiation']).toBeDefined();
      expect(profile.hnp.capabilities['hnp.core.negotiation'].required).toBe(true);
    });

    it('accepts custom capabilities and auth', () => {
      const profile = createHnpProfile({
        endpoint: 'https://example.com/hnp',
        transports: [{ name: 'rest', endpoint: 'https://example.com/hnp' }],
        capabilities: {
          'hnp.ext.shipping': { versions: ['1.0.0'], required: false },
        },
        auth: { schemes: ['bearer'], jwks_uri: 'https://example.com/.well-known/jwks.json' },
      });

      expect(profile.hnp.capabilities['hnp.ext.shipping']).toBeDefined();
      expect(profile.hnp.auth?.schemes).toContain('bearer');
    });
  });

  // ── 6-9. Version negotiation (P0-1) ─────────────────────────

  describe('Version negotiation (P0-1)', () => {
    function makeProfile(
      revisions: string[],
      capabilities: Record<string, HnpCapabilitySupport> = {},
    ): HnpWellKnownProfile {
      return createHnpProfile({
        endpoint: 'https://example.com/hnp',
        transports: [{ name: 'rest', endpoint: 'https://example.com/hnp' }],
        capabilities,
        core_revisions: revisions,
      });
    }

    it('FULL: same revision → FULL compatibility', () => {
      const local = makeProfile(['2026-03-09']);
      const remote = makeProfile(['2026-03-09']);
      const result = negotiateProfile(local, remote);

      expect(result.compatibility).toBe('FULL');
      expect(result.selected_core_revision).toBe('2026-03-09');
    });

    it('DEGRADED: core compatible + optional capability mismatch', () => {
      const local = makeProfile(['2026-03-09'], {
        'hnp.ext.streaming': { versions: ['1.0.0'], required: false },
      });
      const remote = makeProfile(['2026-03-09'], {
        'hnp.ext.streaming': { versions: ['2.0.0'], required: false },
      });
      const result = negotiateProfile(local, remote);

      expect(result.compatibility).toBe('DEGRADED');
      expect(result.disabled_capabilities).toContain('hnp.ext.streaming');
    });

    it('INCOMPATIBLE: no core revision intersection', () => {
      const local = makeProfile(['2026-03-09']);
      const remote = makeProfile(['2025-01-01']);
      const result = negotiateProfile(local, remote);

      expect(result.compatibility).toBe('INCOMPATIBLE');
      expect(result.reason).toBe('UNSUPPORTED_VERSION');
    });

    it('INCOMPATIBLE: required capability major mismatch', () => {
      const local = makeProfile(['2026-03-09'], {
        'hnp.ext.escrow': { versions: ['1.0.0'], required: true },
      });
      const remote = makeProfile(['2026-03-09'], {
        'hnp.ext.escrow': { versions: ['2.0.0'], required: true },
      });
      const result = negotiateProfile(local, remote);

      expect(result.compatibility).toBe('INCOMPATIBLE');
      expect(result.reason).toContain('UNSUPPORTED_EXTENSION');
    });

    it('negotiateCoreRevision picks first local preference in intersection', () => {
      expect(negotiateCoreRevision(['2026-03-09', '2025-01-01'], ['2025-01-01', '2026-03-09']))
        .toBe('2026-03-09');
    });

    it('negotiateCapability selects highest exact match', () => {
      const result = negotiateCapability(
        'test',
        { versions: ['1.0.0', '1.1.0'], required: false },
        { versions: ['1.0.0', '1.1.0', '2.0.0'], required: false },
      );
      expect(result?.version).toBe('1.1.0');
    });
  });

  // ── 10-11. State transitions ────────────────────────────────

  describe('State transitions (version negotiation)', () => {
    it('NEGOTIATING_VERSION → version_agreed → CREATED', () => {
      expect(transition('NEGOTIATING_VERSION', 'version_agreed')).toBe('CREATED');
    });

    it('NEGOTIATING_VERSION → version_failed → FAILED_COMPATIBILITY (terminal)', () => {
      expect(transition('NEGOTIATING_VERSION', 'version_failed')).toBe('FAILED_COMPATIBILITY');
      // FAILED_COMPATIBILITY is terminal — no further transitions
      expect(transition('FAILED_COMPATIBILITY', 'first_offer')).toBeNull();
    });
  });
});
