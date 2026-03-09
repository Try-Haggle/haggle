// ============================================================
// GET /.well-known/ucp — UCP Profile Discovery Endpoint
// ============================================================

import type { FastifyInstance } from 'fastify';
import { buildDefaultHaggleProfile } from '@haggle/ucp-adapter';

export function registerWellKnownUcp(app: FastifyInstance) {
  const baseUrl = process.env.UCP_BASE_URL || 'https://api.tryhaggle.ai/ucp/v1';
  const profile = buildDefaultHaggleProfile(baseUrl);

  app.get('/.well-known/ucp', async (_req, reply) => {
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, max-age=3600')
      .send(profile);
  });
}
