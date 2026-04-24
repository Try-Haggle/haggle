import type { FastifyInstance } from "fastify";
import { eq, settlementApprovals, type Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ApprovalState = typeof settlementApprovals.$inferSelect["approvalState"];

function mapRow(row: typeof settlementApprovals.$inferSelect) {
  return {
    id: row.id,
    listing_id: row.listingId,
    seller_id: row.sellerId,
    buyer_id: row.buyerId,
    approval_state: row.approvalState,
    seller_approval_mode: row.sellerApprovalMode,
    selected_payment_rail: row.selectedPaymentRail,
    currency: row.currency,
    final_amount_minor: row.finalAmountMinor,
    seller_approved_at: row.sellerApprovedAt,
    buyer_approved_at: row.buyerApprovedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerSettlementApprovalRoutes(app: FastifyInstance, db: Database) {
  // GET /settlement-approvals?user_id=... — 내 승인 대기 목록
  app.get<{ Querystring: { user_id: string } }>(
    "/settlement-approvals",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { user_id } = request.query;
      const requesterId = request.user!.id;
      if (!user_id) {
        return reply.code(400).send({ error: "MISSING_USER_ID" });
      }
      if (request.user?.role !== "admin" && user_id !== requesterId) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "Cannot query another user's approvals" });
      }

      const rows = await db.query.settlementApprovals.findMany({
        where: (fields, ops) =>
          ops.or(
            ops.eq(fields.buyerId, user_id),
            ops.eq(fields.sellerId, user_id),
          ),
        orderBy: (fields, ops) => ops.desc(fields.createdAt),
      });

      return reply.send({ approvals: rows.map(mapRow) });
    },
  );

  // GET /settlement-approvals/:id — 단일 조회
  app.get<{ Params: { id: string } }>(
    "/settlement-approvals/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const row = await db.query.settlementApprovals.findFirst({
        where: (fields, ops) => ops.eq(fields.id, request.params.id),
      });

      if (!row) {
        return reply.code(404).send({ error: "APPROVAL_NOT_FOUND" });
      }
      if (
        request.user?.role !== "admin" &&
        request.user!.id !== row.buyerId &&
        request.user!.id !== row.sellerId
      ) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }

      return reply.send({ approval: mapRow(row) });
    },
  );

  // PATCH /settlement-approvals/:id/seller-approve — 판매자 승인
  app.patch<{ Params: { id: string } }>(
    "/settlement-approvals/:id/seller-approve",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const row = await db.query.settlementApprovals.findFirst({
        where: (fields, ops) => ops.eq(fields.id, request.params.id),
      });

      if (!row) {
        return reply.code(404).send({ error: "APPROVAL_NOT_FOUND" });
      }

      // 권한 확인: 판매자만
      if (request.user!.id !== row.sellerId) {
        return reply.code(403).send({ error: "NOT_SELLER" });
      }

      // 상태 확인
      const approvableStates: ApprovalState[] = ["RESERVED_PENDING_APPROVAL", "AWAITING_SELLER_APPROVAL"];
      if (!approvableStates.includes(row.approvalState)) {
        return reply.code(409).send({
          error: "INVALID_STATE",
          message: `Cannot seller-approve from state ${row.approvalState}`,
        });
      }

      // 판매자 승인 → buyer도 이미 승인했으면 APPROVED, 아니면 AWAITING
      const nextState: ApprovalState = row.buyerApprovedAt ? "APPROVED" : "AWAITING_SELLER_APPROVAL";

      const [updated] = await db
        .update(settlementApprovals)
        .set({
          approvalState: nextState,
          sellerApprovedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(settlementApprovals.id, row.id))
        .returning();

      return reply.send({ approval: mapRow(updated), approval_state: nextState });
    },
  );

  // PATCH /settlement-approvals/:id/buyer-approve — 구매자 승인
  app.patch<{ Params: { id: string } }>(
    "/settlement-approvals/:id/buyer-approve",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const row = await db.query.settlementApprovals.findFirst({
        where: (fields, ops) => ops.eq(fields.id, request.params.id),
      });

      if (!row) {
        return reply.code(404).send({ error: "APPROVAL_NOT_FOUND" });
      }

      // 권한 확인: 구매자만
      if (request.user!.id !== row.buyerId) {
        return reply.code(403).send({ error: "NOT_BUYER" });
      }

      // 상태 확인
      const approvableStates: ApprovalState[] = [
        "RESERVED_PENDING_APPROVAL",
        "AWAITING_SELLER_APPROVAL",
      ];
      if (!approvableStates.includes(row.approvalState)) {
        return reply.code(409).send({
          error: "INVALID_STATE",
          message: `Cannot buyer-approve from state ${row.approvalState}`,
        });
      }

      // 구매자 승인 → seller도 이미 승인했으면 APPROVED
      const nextState: ApprovalState = row.sellerApprovedAt ? "APPROVED" : "RESERVED_PENDING_APPROVAL";

      const [updated] = await db
        .update(settlementApprovals)
        .set({
          approvalState: nextState,
          buyerApprovedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(settlementApprovals.id, row.id))
        .returning();

      return reply.send({ approval: mapRow(updated), approval_state: nextState });
    },
  );
}
