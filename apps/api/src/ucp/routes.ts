// ============================================================
// UCP REST Endpoints
// Transport binding: REST (primary) per UCP Spec v2026-01-23
//
// POST   /checkout-sessions          → Create
// GET    /checkout-sessions/:id      → Get
// PUT    /checkout-sessions/:id      → Update
// POST   /checkout-sessions/:id/complete → Complete
// POST   /checkout-sessions/:id/cancel   → Cancel
// ============================================================

import type { FastifyInstance } from 'fastify';
import {
  createCheckoutStore,
  createCheckoutSession,
  getCheckoutSession,
  updateCheckoutSession,
  completeCheckoutSession,
  cancelCheckoutSession,
  parseUcpHeaders,
} from '@haggle/ucp-adapter';
import type {
  CreateCheckoutRequest,
  UpdateCheckoutRequest,
  CompleteCheckoutRequest,
} from '@haggle/ucp-adapter';

export function registerUcpRoutes(app: FastifyInstance) {
  const store = createCheckoutStore();

  // --- Middleware: parse UCP headers ---
  function extractHeaders(req: { headers: Record<string, string | string[] | undefined> }) {
    const flat: Record<string, string | undefined> = {};
    for (const [key, val] of Object.entries(req.headers)) {
      flat[key] = Array.isArray(val) ? val[0] : val;
    }
    return parseUcpHeaders(flat);
  }

  // POST /checkout-sessions
  app.post('/checkout-sessions', async (req, reply) => {
    const headers = extractHeaders(req);
    if ('error' in headers) {
      return reply.status(400).send({ error: headers.error });
    }

    const body = req.body as CreateCheckoutRequest;
    const result = createCheckoutSession(store, body, headers.idempotencyKey);

    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.status(201).send(result.session);
  });

  // GET /checkout-sessions/:id
  app.get('/checkout-sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = getCheckoutSession(store, id);

    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.send(result.session);
  });

  // PUT /checkout-sessions/:id
  app.put('/checkout-sessions/:id', async (req, reply) => {
    const headers = extractHeaders(req);
    if ('error' in headers) {
      return reply.status(400).send({ error: headers.error });
    }

    const { id } = req.params as { id: string };
    const body = req.body as UpdateCheckoutRequest;
    const result = updateCheckoutSession(store, id, body);

    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.send(result.session);
  });

  // POST /checkout-sessions/:id/complete
  app.post('/checkout-sessions/:id/complete', async (req, reply) => {
    const headers = extractHeaders(req);
    if ('error' in headers) {
      return reply.status(400).send({ error: headers.error });
    }

    const { id } = req.params as { id: string };
    const body = req.body as CompleteCheckoutRequest;
    const result = completeCheckoutSession(store, id, body, headers.idempotencyKey);

    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.send(result.session);
  });

  // POST /checkout-sessions/:id/cancel
  app.post('/checkout-sessions/:id/cancel', async (req, reply) => {
    const headers = extractHeaders(req);
    if ('error' in headers) {
      return reply.status(400).send({ error: headers.error });
    }

    const { id } = req.params as { id: string };
    const result = cancelCheckoutSession(store, id, headers.idempotencyKey);

    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.send(result.session);
  });
}
