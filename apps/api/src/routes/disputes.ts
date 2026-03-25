import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { DisputeService, validateEvidenceForReasonCode, REASON_CODE_REGISTRY } from "@haggle/dispute-core";
import type { DisputeCase, DisputeEvidence, DisputeReasonCode } from "@haggle/dispute-core";
import {
  createDisputeRecord,
  getDisputeById,
  getDisputeByOrderId,
  updateDisputeRecord,
  addDisputeEvidenceRecord,
  createDisputeResolutionRecord,
} from "../services/dispute-record.service.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";

const openDisputeSchema = z.object({
  order_id: z.string(),
  reason_code: z.string(),
  opened_by: z.enum(["buyer", "seller", "system"]),
  evidence: z
    .array(
      z.object({
        submitted_by: z.enum(["buyer", "seller", "system"]),
        type: z.enum(["text", "image", "tracking_snapshot", "payment_proof", "other"]),
        uri: z.string().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

const addEvidenceSchema = z.object({
  submitted_by: z.enum(["buyer", "seller", "system"]),
  type: z.enum(["text", "image", "tracking_snapshot", "payment_proof", "other"]),
  uri: z.string().optional(),
  text: z.string().optional(),
});

const resolveDisputeSchema = z.object({
  outcome: z.enum(["buyer_favor", "seller_favor", "partial_refund"]),
  summary: z.string(),
  refund_amount_minor: z.number().optional(),
});

export function registerDisputeRoutes(app: FastifyInstance, db: Database) {
  const disputeService = new DisputeService();

  // POST /disputes — open a new dispute
  app.post("/disputes", async (request, reply) => {
    const parsed = openDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_DISPUTE_REQUEST", issues: parsed.error.issues });
    }

    const reasonCode = parsed.data.reason_code as DisputeReasonCode;
    if (!(reasonCode in REASON_CODE_REGISTRY)) {
      return reply.code(400).send({ error: "INVALID_REASON_CODE", reason_code: parsed.data.reason_code });
    }

    const evidence = (parsed.data.evidence ?? []).map((e) => ({
      submitted_by: e.submitted_by,
      type: e.type,
      uri: e.uri,
      text: e.text,
    }));

    const result = disputeService.openCase({
      order_id: parsed.data.order_id,
      reason_code: reasonCode,
      opened_by: parsed.data.opened_by,
      initial_evidence: evidence,
    });

    await createDisputeRecord(db, result.dispute);

    return reply.code(201).send(result);
  });

  // GET /disputes/:id
  app.get("/disputes/:id", async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }
    return reply.send({ dispute });
  });

  // GET /disputes/by-order/:orderId
  app.get("/disputes/by-order/:orderId", async (request, reply) => {
    const dispute = await getDisputeByOrderId(db, (request.params as { orderId: string }).orderId);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }
    return reply.send({ dispute });
  });

  // POST /disputes/:id/review — start review
  app.post("/disputes/:id/review", async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.startReview(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REVIEW_START_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/request-buyer-evidence
  app.post("/disputes/:id/request-buyer-evidence", async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.requestBuyerEvidence(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REQUEST_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/request-seller-evidence
  app.post("/disputes/:id/request-seller-evidence", async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.requestSellerEvidence(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REQUEST_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/evidence — add evidence
  app.post("/disputes/:id/evidence", async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    const parsed = addEvidenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_EVIDENCE", issues: parsed.error.issues });
    }

    try {
      const result = disputeService.addEvidence(dispute, parsed.data);
      await updateDisputeRecord(db, result.dispute);
      if (result.value) {
        await addDisputeEvidenceRecord(db, result.value);
      }

      // Validate evidence completeness
      const validation = validateEvidenceForReasonCode(
        dispute.reason_code as DisputeReasonCode,
        result.dispute.evidence,
      );

      return reply.send({ ...result, evidence_validation: validation });
    } catch (error) {
      return reply.code(400).send({
        error: "ADD_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/resolve — resolve the dispute
  app.post("/disputes/:id/resolve", async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    const parsed = resolveDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_RESOLUTION", issues: parsed.error.issues });
    }

    try {
      const result = disputeService.resolve(dispute, parsed.data);
      await updateDisputeRecord(db, result.dispute);
      if (result.value) {
        await createDisputeResolutionRecord(db, dispute.id, result.value);
      }
      if (result.trust_triggers.length > 0) {
        // Need buyer/seller IDs — get from the order or dispute record
        const fullDispute = await getDisputeById(db, dispute.id);
        if (fullDispute) {
          await applyTrustTriggers(db, {
            order_id: fullDispute.order_id,
            buyer_id: "", // TODO: resolve from order
            seller_id: "", // TODO: resolve from order
            triggers: result.trust_triggers,
          });
        }
      }
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "RESOLUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/close — close the dispute
  app.post("/disputes/:id/close", async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.closeCase(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "CLOSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
