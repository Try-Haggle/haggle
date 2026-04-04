import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp } from "./helpers.js";

// ─── Mock service layers ─────────────────────────────────────────────
vi.mock("../services/payment-record.service.js", () => ({
  createPaymentAuthorizationRecord: vi.fn().mockResolvedValue(null),
  createPaymentSettlementRecord: vi.fn().mockResolvedValue(null),
  createRefundRecord: vi.fn().mockResolvedValue(null),
  createStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  ensureCommerceOrderForApproval: vi.fn().mockResolvedValue(null),
  getPaymentIntentById: vi.fn().mockResolvedValue(null),
  getSettlementApprovalById: vi.fn().mockResolvedValue(null),
  updateCommerceOrderStatus: vi.fn().mockResolvedValue(null),
  updateStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  getCommerceOrderByOrderId: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  createSettlementReleaseRecord: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByOrderId: vi.fn().mockResolvedValue(null),
  updateSettlementReleaseRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/shipment-record.service.js", () => ({
  createShipmentRecord: vi.fn().mockResolvedValue(null),
  getShipmentById: vi.fn().mockResolvedValue(null),
  getShipmentByOrderId: vi.fn().mockResolvedValue(null),
  updateShipmentRecord: vi.fn().mockResolvedValue(null),
  insertShipmentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-record.service.js", () => ({
  createDisputeRecord: vi.fn().mockResolvedValue(null),
  getDisputeById: vi.fn().mockResolvedValue(null),
  getDisputeByOrderId: vi.fn().mockResolvedValue(null),
  updateDisputeRecord: vi.fn().mockResolvedValue(null),
  addDisputeEvidenceRecord: vi.fn().mockResolvedValue(null),
  createDisputeResolutionRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-deposit.service.js", () => ({
  getDepositByDisputeId: vi.fn().mockResolvedValue(null),
  createDeposit: vi.fn().mockResolvedValue(null),
  getPendingExpiredDeposits: vi.fn().mockResolvedValue([]),
  updateDepositStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/authentication-record.service.js", () => ({
  getAuthenticationByOrderId: vi.fn().mockResolvedValue(null),
  createAuthenticationRecord: vi.fn().mockResolvedValue(null),
  updateAuthenticationRecord: vi.fn().mockResolvedValue(null),
  getAuthenticationById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-score.service.js", () => ({
  computeAndStoreTrustScore: vi.fn().mockResolvedValue(null),
  getTrustScore: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/ds-rating.service.js", () => ({
  submitDSRating: vi.fn().mockResolvedValue(null),
  getDSRatings: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/arp-segment.service.js", () => ({
  getARPSegment: vi.fn().mockResolvedValue(null),
  computeAndStoreARPSegment: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/tag.service.js", () => ({
  getTagsForUser: vi.fn().mockResolvedValue([]),
  addTag: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/intent.service.js", () => ({
  getIntentById: vi.fn().mockResolvedValue(null),
  createIntent: vi.fn().mockResolvedValue(null),
  listIntents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/skill.service.js", () => ({
  getSkillById: vi.fn().mockResolvedValue(null),
  listSkills: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/draft.service.js", () => ({
  getDraftById: vi.fn().mockResolvedValue(null),
  listDrafts: vi.fn().mockResolvedValue([]),
  createDraft: vi.fn().mockResolvedValue(null),
  updateDraft: vi.fn().mockResolvedValue(null),
  deleteDraft: vi.fn().mockResolvedValue(null),
  publishDraft: vi.fn().mockResolvedValue(null),
}));

describe("Dispute routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // ─── POST /disputes — schema validation ──────────────────────
  it("POST /disputes returns 400 without body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_DISPUTE_REQUEST");
  });

  it("POST /disputes returns 400 with missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      payload: { order_id: "ord_123" }, // missing reason_code and opened_by
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_DISPUTE_REQUEST");
    expect(res.json().issues).toBeDefined();
  });

  it("POST /disputes returns 400 with invalid reason_code", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      payload: {
        order_id: "ord_123",
        reason_code: "TOTALLY_INVALID_CODE",
        opened_by: "buyer",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_REASON_CODE");
  });

  // ─── GET /disputes/:id ───────────────────────────────────────
  it("GET /disputes/:id returns 404 for nonexistent dispute", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/disputes/nonexistent-id",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  // ─── GET /disputes/by-order/:orderId ──────────────────────────
  it("GET /disputes/by-order/:orderId returns 404 for unknown order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/disputes/by-order/ord_unknown",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  // ─── POST /disputes/deposits/expire ──────────────────────────
  it("POST /disputes/deposits/expire returns 200 with forfeited count", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/deposits/expire",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.forfeited_count).toBeDefined();
    expect(typeof body.forfeited_count).toBe("number");
    // With mock returning empty array, count should be 0
    expect(body.forfeited_count).toBe(0);
  });

  // ─── POST /disputes/:id/escalate ─────────────────────────────
  it("POST /disputes/:id/escalate returns 404 for nonexistent dispute", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/nonexistent/escalate",
      payload: { escalated_by: "buyer" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  it("POST /disputes/:id/escalate returns 400 with invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/escalate",
      payload: { escalated_by: "invalid_role" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_ESCALATE_REQUEST");
  });

  // ─── POST /disputes/:id/deposit ──────────────────────────────
  it("POST /disputes/:id/deposit returns 404 when no deposit exists", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/deposit",
      payload: { amount_cents: 500 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DEPOSIT_NOT_FOUND");
  });
});
