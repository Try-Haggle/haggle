import { describe, it, expect } from 'vitest';
import { parseUcpHeaders, buildUcpHeaders } from '../src/index.js';

describe('parseUcpHeaders', () => {
  it('parses valid headers', () => {
    const result = parseUcpHeaders({
      'ucp-agent': 'profile="https://platform.example/profile.json"',
      'idempotency-key': '550e8400-e29b-41d4-a716-446655440000',
      'request-id': 'req-123',
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.agentProfile).toBe('profile="https://platform.example/profile.json"');
      expect(result.idempotencyKey).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.requestId).toBe('req-123');
      expect(result.signature).toBeUndefined();
    }
  });

  it('includes optional headers when present', () => {
    const result = parseUcpHeaders({
      'ucp-agent': 'profile="https://example.com"',
      'idempotency-key': 'key-1',
      'request-id': 'req-1',
      'request-signature': 'jws-sig',
      authorization: 'Bearer token123',
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.signature).toBe('jws-sig');
      expect(result.authorization).toBe('Bearer token123');
    }
  });

  it('returns error when UCP-Agent is missing', () => {
    const result = parseUcpHeaders({
      'idempotency-key': 'key-1',
      'request-id': 'req-1',
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('UCP-Agent');
    }
  });

  it('returns error when Idempotency-Key is missing', () => {
    const result = parseUcpHeaders({
      'ucp-agent': 'profile="https://example.com"',
      'request-id': 'req-1',
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Idempotency-Key');
    }
  });

  it('returns error when Request-Id is missing', () => {
    const result = parseUcpHeaders({
      'ucp-agent': 'profile="https://example.com"',
      'idempotency-key': 'key-1',
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Request-Id');
    }
  });
});

describe('buildUcpHeaders', () => {
  it('builds headers with correct format', () => {
    const headers = buildUcpHeaders(
      'https://tryhaggle.ai/profile.json',
      'idem-key-123',
      'req-456',
    );

    expect(headers['ucp-agent']).toBe('profile="https://tryhaggle.ai/profile.json"');
    expect(headers['idempotency-key']).toBe('idem-key-123');
    expect(headers['request-id']).toBe('req-456');
  });
});
