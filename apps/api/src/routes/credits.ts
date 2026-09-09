/**
 * Soft-AI credit balance surfaces (Eng1 C1).
 * SoT: docs/wip/credit-ledger-sot.md §6
 */

import type { Database } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { ensureAccountWithSignupGrant } from "../services/credit-ledger.service.js";

export function registerCreditRoutes(app: FastifyInstance, db: Database) {
  // GET /credits/balance — current Soft credit balance (+ unlimited affordance).
  app.get("/credits/balance", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const view = await ensureAccountWithSignupGrant(db, userId, {
      haggleEnv: process.env.HAGGLE_ENV,
    });
    return reply.send({
      account_id: view.account_id,
      balance: view.balance,
      unlimited: view.unlimited,
      currency: "soft_ai_credits",
    });
  });
}
