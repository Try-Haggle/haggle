// ============================================================
// UCP Order Webhook Endpoint
// POST /webhooks/partners/:partnerId/events/order
// ============================================================

import type { FastifyInstance } from 'fastify';
import {
  createOrderStore,
  createBridgeStore,
  verifyWebhookSignature,
  processOrderWebhook,
} from '@haggle/ucp-adapter';
import type { OrderWebhookPayload } from '@haggle/ucp-adapter';

export function registerWebhookRoutes(
  app: FastifyInstance,
  bridgeStore: ReturnType<typeof createBridgeStore>,
) {
  const orderStore = createOrderStore();

  app.post('/webhooks/partners/:partnerId/events/order', async (req, reply) => {
    const signature = req.headers['request-signature'] as string | undefined;
    const rawBody = JSON.stringify(req.body);

    // Verify signature
    const verification = verifyWebhookSignature(signature, rawBody, []);
    if (!verification.ok) {
      return reply.status(401).send({ error: verification.error });
    }

    // Process webhook — must respond 2xx quickly per spec
    const payload = req.body as OrderWebhookPayload;
    const result = processOrderWebhook(orderStore, bridgeStore, payload);

    if (!result.ok) {
      return reply.status(400).send({ error: result.error });
    }

    return reply.status(200).send({ ok: true });
  });
}
