import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import {
  createGroup,
  getGroupById,
  updateGroupStatus,
} from "../services/negotiation-group.service.js";
import {
  createSession,
  getSessionsByGroupId,
} from "../services/negotiation-session.service.js";
import { executeGroupOrchestration } from "../lib/group-executor.js";
import type { EventDispatcher } from "../lib/event-dispatcher.js";

// ── Zod Schemas ────────────────────────────────────────────

const createGroupSchema = z.object({
  topology: z.enum(["1_BUYER_N_SELLERS", "N_BUYERS_1_SELLER"]),
  anchor_user_id: z.string().uuid(),
  intent_id: z.string().uuid().optional(),
  max_sessions: z.number().int().min(1).max(50).optional(),
});

const addSessionSchema = z.object({
  listing_id: z.string().uuid(),
  strategy_id: z.string().min(1),
  role: z.enum(["BUYER", "SELLER"]),
  buyer_id: z.string().uuid(),
  seller_id: z.string().uuid(),
  counterparty_id: z.string().uuid(),
  strategy_snapshot: z.record(z.unknown()),
  expires_at: z.string().datetime().optional(),
});

// ── Route Registration ─────────────────────────────────────

export function registerGroupRoutes(
  app: FastifyInstance,
  db: Database,
  eventDispatcher: EventDispatcher,
) {
  // POST /negotiations/groups — 그룹 생성
  app.post(
    "/negotiations/groups",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = createGroupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_GROUP_REQUEST", issues: parsed.error.issues });
      }

      const data = parsed.data;
      const group = await createGroup(db, {
        topology: data.topology,
        anchorUserId: data.anchor_user_id,
        intentId: data.intent_id,
        maxSessions: data.max_sessions,
      });

      return reply.code(201).send({ group });
    },
  );

  // GET /negotiations/groups/:id — 그룹 + 세션 목록
  app.get<{ Params: { id: string } }>(
    "/negotiations/groups/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const group = await getGroupById(db, request.params.id);
      if (!group) {
        return reply.code(404).send({ error: "GROUP_NOT_FOUND" });
      }

      const sessions = await getSessionsByGroupId(db, group.id);

      return reply.send({
        group: {
          id: group.id,
          topology: group.topology,
          anchor_user_id: group.anchorUserId,
          status: group.status,
          max_sessions: group.maxSessions,
          batna: group.batna,
          best_session_id: group.bestSessionId,
          version: group.version,
          created_at: group.createdAt,
          updated_at: group.updatedAt,
        },
        sessions: sessions.map((s) => ({
          id: s.id,
          listing_id: s.listingId,
          role: s.role,
          status: s.status,
          current_round: s.currentRound,
          last_offer_price_minor: s.lastOfferPriceMinor,
          last_utility: s.lastUtility,
          created_at: s.createdAt,
        })),
      });
    },
  );

  // POST /negotiations/groups/:id/sessions — 그룹에 세션 추가
  app.post<{ Params: { id: string } }>(
    "/negotiations/groups/:id/sessions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const group = await getGroupById(db, request.params.id);
      if (!group) {
        return reply.code(404).send({ error: "GROUP_NOT_FOUND" });
      }

      if (group.status !== "ACTIVE") {
        return reply.code(409).send({ error: "GROUP_NOT_ACTIVE", message: `Group status is ${group.status}` });
      }

      // Check capacity
      const existing = await getSessionsByGroupId(db, group.id);
      if (existing.length >= group.maxSessions) {
        return reply.code(409).send({ error: "GROUP_CAPACITY_EXCEEDED", max: group.maxSessions });
      }

      const parsed = addSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_SESSION_REQUEST", issues: parsed.error.issues });
      }

      const data = parsed.data;
      const session = await createSession(db, {
        listingId: data.listing_id,
        strategyId: data.strategy_id,
        role: data.role,
        buyerId: data.buyer_id,
        sellerId: data.seller_id,
        counterpartyId: data.counterparty_id,
        strategySnapshot: data.strategy_snapshot,
        groupId: group.id,
        expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
      });

      return reply.code(201).send({ session });
    },
  );

  // POST /negotiations/groups/:id/orchestrate — 수동 오케스트레이션
  app.post<{ Params: { id: string } }>(
    "/negotiations/groups/:id/orchestrate",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const actions = await executeGroupOrchestration(db, request.params.id, eventDispatcher);
      return reply.send({ actions });
    },
  );

  // PATCH /negotiations/groups/:id/cancel — 그룹 취소
  app.patch<{ Params: { id: string } }>(
    "/negotiations/groups/:id/cancel",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const group = await getGroupById(db, request.params.id);
      if (!group) {
        return reply.code(404).send({ error: "GROUP_NOT_FOUND" });
      }

      if (group.status !== "ACTIVE") {
        return reply.code(409).send({ error: "GROUP_NOT_ACTIVE", message: `Group status is ${group.status}` });
      }

      const updated = await updateGroupStatus(db, group.id, group.version, "CANCELLED");
      if (!updated) {
        return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
      }

      return reply.send({ updated: true, status: "CANCELLED" });
    },
  );
}
