import { describe, expect, it } from 'vitest';
import {
  HNP_CORE_ISSUES,
  createHnpAgreementObject,
  computeHnpProposalHash,
  hnpProposalEnvelopeToLegacyMessage,
  isHnpCoreIssueId,
  isHnpProposalEnvelope,
  isSupportedIssueId,
  isVendorIssueId,
  legacyMessageToHnpEnvelope,
  proposalMatchesAcceptedHash,
} from '../src/index.js';
import type { HnpEnvelope, HnpProposalPayload, HnpMessage } from '../src/index.js';

describe('HNP legacy adapter', () => {
  it('converts a legacy offer into a canonical proposal envelope', () => {
    const legacy: HnpMessage = {
      session_id: 'sess-1',
      round: 2,
      type: 'OFFER',
      price: 499.99,
      sender_role: 'BUYER',
      timestamp: 1_777_000_000_000,
      metadata: {
        message_id: 'msg-1',
        idempotency_key: 'idem-1',
        sender_agent_id: 'buyer-agent',
        proposal_id: 'prop-1',
      },
    };

    const envelope = legacyMessageToHnpEnvelope(legacy);

    expect(envelope).toMatchObject({
      spec_version: '2026-03-09',
      capability: 'hnp.core.negotiation',
      session_id: 'sess-1',
      message_id: 'msg-1',
      idempotency_key: 'idem-1',
      sequence: 2,
      sender_agent_id: 'buyer-agent',
      sender_role: 'BUYER',
      type: 'OFFER',
    });
    expect(envelope.payload).toMatchObject({
      proposal_id: 'prop-1',
      total_price: { currency: 'USD', units_minor: 49999 },
    });
  });

  it('converts a canonical proposal envelope back to a legacy message', () => {
    const envelope: HnpEnvelope<HnpProposalPayload> = {
      spec_version: '2026-03-09',
      capability: 'hnp.core.negotiation',
      session_id: 'sess-1',
      message_id: 'msg-1',
      idempotency_key: 'idem-1',
      sequence: 2,
      sent_at_ms: 1_777_000_000_000,
      expires_at_ms: 1_777_000_060_000,
      sender_agent_id: 'seller-agent',
      sender_role: 'SELLER',
      type: 'COUNTER',
      payload: {
        proposal_id: 'prop-1',
        issues: [],
        total_price: { currency: 'USD', units_minor: 52500 },
        proposal_hash: 'sha256:test',
      },
    };

    expect(isHnpProposalEnvelope(envelope)).toBe(true);

    const legacy = hnpProposalEnvelopeToLegacyMessage(envelope);

    expect(legacy).toMatchObject({
      session_id: 'sess-1',
      round: 2,
      type: 'COUNTER',
      price: 525,
      sender_role: 'SELLER',
      timestamp: 1_777_000_000_000,
    });
    expect(legacy.metadata).toMatchObject({
      message_id: 'msg-1',
      proposal_id: 'prop-1',
      proposal_hash: 'sha256:test',
      currency: 'USD',
    });
  });
});

describe('HNP issue registry', () => {
  it('recognizes core and vendor issue ids', () => {
    expect(HNP_CORE_ISSUES).toContain('hnp.issue.price.total');
    expect(isHnpCoreIssueId('hnp.issue.condition.battery_health')).toBe(true);
    expect(isVendorIssueId('com.haggle.issue.memory_hint')).toBe(true);
    expect(isVendorIssueId('memory_hint')).toBe(false);
  });

  it('checks extension namespaces without requiring Haggle-specific fields', () => {
    expect(isSupportedIssueId('hnp.issue.price.total', [])).toBe(true);
    expect(isSupportedIssueId('com.vendor.issue.trade_in.value', ['com.vendor.issue.trade_in'])).toBe(true);
    expect(isSupportedIssueId('com.other.issue.trade_in.value', ['com.vendor.issue.trade_in'])).toBe(false);
  });
});

describe('HNP proposal binding', () => {
  it('computes stable proposal hashes independent of issue order', () => {
    const proposal = {
      proposal_id: 'prop-1',
      issues: [
        { issue_id: 'hnp.issue.condition.grade', value: 'A', kind: 'NEGOTIABLE' as const },
        { issue_id: 'hnp.issue.price.total', value: 50000, unit: 'USD', kind: 'NEGOTIABLE' as const },
      ],
      total_price: { currency: 'USD', units_minor: 50000 },
      settlement_preconditions: ['tracked_shipping_required', 'escrow_authorized'],
    };
    const reordered = {
      ...proposal,
      issues: [...proposal.issues].reverse(),
      settlement_preconditions: ['escrow_authorized', 'tracked_shipping_required', 'escrow_authorized'],
    };

    const hash = computeHnpProposalHash(proposal);

    expect(hash).toMatch(/^sha256:/);
    expect(computeHnpProposalHash(reordered)).toBe(hash);
    expect(proposalMatchesAcceptedHash(proposal, hash)).toBe(true);
    expect(proposalMatchesAcceptedHash({ ...proposal, total_price: { currency: 'USD', units_minor: 50100 } }, hash)).toBe(false);
  });
});

describe('HNP agreement object', () => {
  it('creates a stable machine-verifiable agreement hash', () => {
    const agreement = createHnpAgreementObject({
      session_id: 'sess-1',
      accepted_message_id: 'msg-1',
      accepted_proposal_id: 'prop-1',
      accepted_proposal_hash: 'sha256:proposal',
      agreed_price: { currency: 'USD', units_minor: 50000 },
      accepted_issues: [{ issue_id: 'hnp.issue.price.total', value: 50000, unit: 'USD', kind: 'NEGOTIABLE' }],
      parties: [
        { agent_id: 'buyer-agent', role: 'BUYER' },
        { agent_id: 'seller-agent', role: 'SELLER' },
      ],
      settlement_preconditions: ['escrow_authorized'],
      created_at_ms: 1_777_000_000_000,
    });

    expect(agreement.agreement_id).toMatch(/^agr_/);
    expect(agreement.agreement_hash).toMatch(/^sha256:/);
    expect(agreement.accepted_proposal_hash).toBe('sha256:proposal');
  });
});
