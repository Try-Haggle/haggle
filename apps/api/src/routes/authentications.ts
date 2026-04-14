import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import { disputeEvidence } from "@haggle/db";
import {
  AuthenticationService,
  LegitAuthAdapter,
  MockAuthAdapter,
  verifyLegitWebhook,
  type AuthenticationRecord,
  type HaggleCategory,
} from "@haggle/skill-legit";
import {
  createAuthenticationRecord,
  getAuthenticationById,
  getAuthenticationsByListingId,
  getAuthenticationsByOrderId,
  getAuthenticationByCaseId,
  updateAuthenticationRecord,
  insertAuthenticationEvent,
} from "../services/authentication-record.service.js";

const createAuthSchema = z.object({
  listing_id: z.string(),
  order_id: z.string().optional(),
  dispute_id: z.string().optional(),
  category: z.string(),
  turnaround: z.enum(["ultra_fast", "fast", "standard"]).optional(),
  requester: z.enum(["buyer", "seller"]),
  cost_minor: z.number().int().nonnegative(),
  publish_policy: z.enum(["wait_for_auth", "publish_immediately"]).optional(),
  auto_apply_result: z.boolean().optional(),
});

export function registerAuthenticationRoutes(app: FastifyInstance, db: Database) {
  const legitApiKey = process.env.LEGITAPP_API_KEY;
  const legitWebhookSecret = process.env.LEGITAPP_WEBHOOK_SECRET;

  // Build provider map
  const providers: Record<string, ConstructorParameters<typeof AuthenticationService>[0][string]> = {
    mock_auth: new MockAuthAdapter(),
  };

  if (legitApiKey) {
    providers.legitapp = new LegitAuthAdapter({
      api_key: legitApiKey,
      base_url: process.env.LEGITAPP_BASE_URL,
    });
  }

  const authService = new AuthenticationService(providers);

  // POST /authentications — request authentication
  app.post("/authentications", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createAuthSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_AUTH_REQUEST", issues: parsed.error.issues });
    }

    const { listing_id, order_id, dispute_id, category, turnaround, requester, cost_minor, publish_policy, auto_apply_result } = parsed.data;

    try {
      const providerName = legitApiKey ? "legitapp" : "mock_auth";
      const result = await authService.requestAuthentication(
        {
          order_id: order_id ?? listing_id,
          listing_id,
          category: category as HaggleCategory,
          turnaround,
          requester,
          cost_minor,
        },
        providerName,
      );

      // Persist to DB
      const row = await createAuthenticationRecord(db, {
        listingId: listing_id,
        orderId: order_id,
        disputeId: dispute_id,
        provider: result.record.provider,
        category,
        turnaround: turnaround ?? "standard",
        status: result.record.status,
        requestedBy: requester,
        costMinor: String(cost_minor),
        caseId: result.record.case_id,
        intentId: result.record.intent_id,
        submissionUrl: result.record.submission_url,
        publishPolicy: publish_policy,
        autoApplyResult: auto_apply_result,
      });

      return reply.code(201).send({ authentication: row });
    } catch (error) {
      return reply.code(400).send({
        error: "AUTH_REQUEST_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /authentications/:id
  app.get("/authentications/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const row = await getAuthenticationById(db, (request.params as { id: string }).id);
    if (!row) {
      return reply.code(404).send({ error: "AUTHENTICATION_NOT_FOUND" });
    }
    return reply.send({ authentication: row });
  });

  // GET /authentications/by-listing/:listingId
  app.get("/authentications/by-listing/:listingId", { preHandler: [requireAuth] }, async (request, reply) => {
    const rows = await getAuthenticationsByListingId(
      db,
      (request.params as { listingId: string }).listingId,
    );
    return reply.send({ authentications: rows });
  });

  // GET /authentications/by-order/:orderId
  app.get("/authentications/by-order/:orderId", { preHandler: [requireAuth] }, async (request, reply) => {
    const rows = await getAuthenticationsByOrderId(
      db,
      (request.params as { orderId: string }).orderId,
    );
    return reply.send({ authentications: rows });
  });

  // POST /authentications/:id/apply — manually apply authentication result
  app.post("/authentications/:id/apply", { preHandler: [requireAuth] }, async (request, reply) => {
    const row = await getAuthenticationById(db, (request.params as { id: string }).id);
    if (!row) {
      return reply.code(404).send({ error: "AUTHENTICATION_NOT_FOUND" });
    }

    if (row.status !== "COMPLETED") {
      return reply.code(400).send({ error: "AUTH_NOT_COMPLETED", message: "Authentication is not yet completed" });
    }

    if (row.result_applied) {
      return reply.code(400).send({ error: "ALREADY_APPLIED", message: "Result has already been applied" });
    }

    // Mark result as applied
    await updateAuthenticationRecord(db, row.id, { resultApplied: true });

    return reply.send({
      applied: true,
      authentication_id: row.id,
      verdict: row.verdict,
    });
  });

  // POST /authentications/webhooks/legitapp — receive LegitApp webhook
  app.post("/authentications/webhooks/legitapp", {
    config: { rawBody: true },
  }, async (request, reply) => {
    // Verify webhook signature — reject in production if secret is not configured
    const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
    if (!legitWebhookSecret && isProduction) {
      return reply.code(401).send({ error: "WEBHOOK_SECRET_NOT_CONFIGURED" });
    }
    if (legitWebhookSecret) {
      const rawBody = (request as unknown as { rawBody?: string | Buffer }).rawBody ?? JSON.stringify(request.body);
      const isValid = verifyLegitWebhook(
        rawBody,
        request.headers as Record<string, string>,
        legitWebhookSecret,
      );
      if (!isValid) {
        return reply.code(401).send({ error: "INVALID_WEBHOOK_SIGNATURE" });
      }
    }

    const body = request.body as Record<string, unknown>;
    const caseId = body.case_id as string | undefined;

    if (!caseId) {
      return reply.send({ accepted: true, skipped: true, reason: "no case_id in payload" });
    }

    // Look up auth record by case_id
    const authRow = await getAuthenticationByCaseId(db, caseId);
    if (!authRow) {
      return reply.send({ accepted: true, skipped: true, reason: "authentication not found for case_id" });
    }

    // Build an AuthenticationRecord for skill-legit processWebhook
    const record: AuthenticationRecord = {
      id: authRow.id,
      order_id: authRow.order_id ?? authRow.listing_id,
      listing_id: authRow.listing_id,
      case_id: authRow.case_id ?? "",
      intent_id: authRow.intent_id ?? "",
      submission_url: authRow.submission_url ?? "",
      provider: authRow.provider,
      category: authRow.category as AuthenticationRecord["category"],
      turnaround: authRow.turnaround as AuthenticationRecord["turnaround"],
      status: authRow.status as AuthenticationRecord["status"],
      verdict: authRow.verdict as AuthenticationRecord["verdict"],
      certificate_url: authRow.certificate_url ?? undefined,
      requested_by: authRow.requested_by as "buyer" | "seller",
      cost_minor: Number(authRow.cost_minor),
      created_at: authRow.created_at,
      updated_at: authRow.updated_at,
      events: [],
    };

    const result = authService.processWebhook(record, body);
    if (!result) {
      return reply.send({ accepted: true, no_change: true, reason: "webhook not recognized" });
    }

    const updated = result.record;

    // Update DB record
    await updateAuthenticationRecord(db, authRow.id, {
      status: updated.status,
      verdict: updated.verdict,
      certificateUrl: updated.certificate_url,
    });

    // Insert event
    const latestEvent = updated.events[updated.events.length - 1];
    if (latestEvent) {
      await insertAuthenticationEvent(db, {
        authenticationId: authRow.id,
        eventType: latestEvent.event_type,
        status: latestEvent.status,
        verdict: latestEvent.verdict,
        certificateUrl: latestEvent.certificate_url,
        occurredAt: latestEvent.occurred_at,
        raw: latestEvent.raw,
      });
    }

    // If dispute_id present, auto-attach dispute evidence
    if (authRow.dispute_id && updated.status === "COMPLETED" && updated.verdict) {
      const evidenceItems = authService.toDisputeEvidence(updated, authRow.dispute_id);
      for (const evi of evidenceItems) {
        await db.insert(disputeEvidence).values({
          id: evi.id,
          disputeId: evi.dispute_id,
          submittedBy: evi.submitted_by as "buyer" | "seller" | "system",
          type: evi.type as "text" | "image" | "tracking_snapshot" | "payment_proof" | "other",
          uri: evi.uri,
          text: evi.text,
          createdAt: new Date(evi.created_at),
        });
      }
    }

    // Auto-apply result if configured
    let autoApplied = false;
    if (authRow.auto_apply_result && updated.status === "COMPLETED") {
      await updateAuthenticationRecord(db, authRow.id, { resultApplied: true });
      autoApplied = true;
    }

    return reply.send({
      accepted: true,
      new_status: updated.status,
      verdict: updated.verdict,
      auto_applied: autoApplied,
    });
  });
}
