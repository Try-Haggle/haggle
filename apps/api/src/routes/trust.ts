import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { computeTrustScore } from "@haggle/trust-core";
import type { TrustInput } from "@haggle/trust-core";
import {
  getTrustScore,
  upsertTrustScore,
  getTrustSnapshot,
} from "../services/trust-score.service.js";

const computeTrustSchema = z.object({
  role: z.enum(["buyer", "seller", "combined"]),
  completed_transactions: z.number().int().min(0),
  raw_inputs: z
    .record(z.number())
    .optional(),
  sla_penalty: z
    .object({
      sla_violation_count: z.number().int().min(0),
    })
    .optional(),
});

export function registerTrustRoutes(app: FastifyInstance, db: Database) {
  // GET /trust/:actorId
  app.get<{ Params: { actorId: string } }>(
    "/trust/:actorId",
    async (request, reply) => {
      const { actorId } = request.params;
      const row = await getTrustScore(db, actorId);
      if (!row) {
        return reply.code(404).send({ error: "TRUST_SCORE_NOT_FOUND" });
      }
      return reply.send({ trust_score: row });
    },
  );

  // GET /trust/:actorId/:role
  app.get<{ Params: { actorId: string; role: string } }>(
    "/trust/:actorId/:role",
    async (request, reply) => {
      const { actorId, role } = request.params;
      if (role !== "buyer" && role !== "seller" && role !== "combined") {
        return reply.code(400).send({ error: "INVALID_ROLE", message: "Role must be buyer, seller, or combined" });
      }
      const row = await getTrustScore(db, actorId, role);
      if (!row) {
        return reply.code(404).send({ error: "TRUST_SCORE_NOT_FOUND" });
      }
      return reply.send({ trust_score: row });
    },
  );

  // POST /trust/:actorId/compute
  app.post<{ Params: { actorId: string } }>(
    "/trust/:actorId/compute",
    async (request, reply) => {
      const { actorId } = request.params;
      const parsed = computeTrustSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_COMPUTE_REQUEST", issues: parsed.error.issues });
      }

      const { role, completed_transactions, raw_inputs, sla_penalty } = parsed.data;

      const input: TrustInput = (raw_inputs ?? {}) as TrustInput;

      const result = computeTrustScore(input, {
        role,
        completed_transactions,
        sla_penalty,
      });

      const persisted = await upsertTrustScore(db, {
        actorId,
        actorRole: role,
        score: String(result.score),
        status: result.status,
        completedTransactions: completed_transactions,
        weightsVersion: result.weights_version,
        rawScore: String(result.raw_score),
        slaPenaltyFactor: String(result.sla_penalty_factor),
        rawInputs: raw_inputs,
      });

      return reply.send({ trust_score: result, persisted: true, record: persisted });
    },
  );

  // GET /trust/:actorId/snapshot
  app.get<{ Params: { actorId: string } }>(
    "/trust/:actorId/snapshot",
    async (request, reply) => {
      const { actorId } = request.params;
      const data = await getTrustSnapshot(db, actorId);
      if (!data) {
        return reply.code(404).send({ error: "TRUST_SNAPSHOT_NOT_FOUND" });
      }
      return reply.send({ raw_inputs: data });
    },
  );
}
