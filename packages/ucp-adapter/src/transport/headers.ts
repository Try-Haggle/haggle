// ============================================================
// UCP Request Header Utilities
// Required headers: UCP-Agent, Idempotency-Key, Request-Id
// ============================================================

import type { UcpRequestHeaders } from '../checkout/types.js';

export interface ParsedUcpHeaders {
  agentProfile: string;
  idempotencyKey: string;
  requestId: string;
  signature?: string;
  authorization?: string;
}

export function parseUcpHeaders(
  headers: Record<string, string | undefined>,
): ParsedUcpHeaders | { error: string } {
  const agent = headers['ucp-agent'];
  const idempotencyKey = headers['idempotency-key'];
  const requestId = headers['request-id'];

  if (!agent) {
    return { error: 'Missing required header: UCP-Agent' };
  }
  if (!idempotencyKey) {
    return { error: 'Missing required header: Idempotency-Key' };
  }
  if (!requestId) {
    return { error: 'Missing required header: Request-Id' };
  }

  return {
    agentProfile: agent,
    idempotencyKey,
    requestId,
    signature: headers['request-signature'],
    authorization: headers['authorization'],
  };
}

export function buildUcpHeaders(
  profileUri: string,
  idempotencyKey: string,
  requestId: string,
): UcpRequestHeaders {
  return {
    'ucp-agent': `profile="${profileUri}"`,
    'idempotency-key': idempotencyKey,
    'request-id': requestId,
  };
}
