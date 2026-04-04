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
  getSettlementReleaseById: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByOrderId: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByPaymentIntentId: vi.fn().mockResolvedValue(null),
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
  getTrustScore: vi.fn().mockResolvedValue(null),
  upsertTrustScore: vi.fn().mockResolvedValue(null),
  getTrustSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/ds-rating.service.js", () => ({
  getDSRating: vi.fn().mockResolvedValue(null),
  upsertDSRating: vi.fn().mockResolvedValue(null),
  getDSPool: vi.fn().mockResolvedValue([]),
  getSpecializations: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/arp-segment.service.js", () => ({
  getSegment: vi.fn().mockResolvedValue(null),
  listSegments: vi.fn().mockResolvedValue([]),
  updateSegmentReviewHours: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/tag.service.js", () => ({
  getTagById: vi.fn().mockResolvedValue(null),
  getTagByNormalizedName: vi.fn().mockResolvedValue(null),
  listTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn().mockResolvedValue(null),
  updateTag: vi.fn().mockResolvedValue(null),
  getExpertTags: vi.fn().mockResolvedValue([]),
  upsertExpertTag: vi.fn().mockResolvedValue(null),
  createMergeLog: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/intent.service.js", () => ({
  getIntentById: vi.fn().mockResolvedValue(null),
  getActiveIntentsByCategory: vi.fn().mockResolvedValue([]),
  getIntentsByUserId: vi.fn().mockResolvedValue([]),
  createIntent: vi.fn().mockResolvedValue(null),
  updateIntentStatus: vi.fn().mockResolvedValue(null),
  getActiveIntentCount: vi.fn().mockResolvedValue(0),
  createMatch: vi.fn().mockResolvedValue(null),
  expireStaleIntents: vi.fn().mockResolvedValue(0),
}));

vi.mock("../services/skill.service.js", () => ({
  getSkillBySkillId: vi.fn().mockResolvedValue(null),
  listSkills: vi.fn().mockResolvedValue([]),
  createSkill: vi.fn().mockResolvedValue(null),
  updateSkillStatus: vi.fn().mockResolvedValue(null),
  updateSkillMetrics: vi.fn().mockResolvedValue(null),
  recordExecution: vi.fn().mockResolvedValue(null),
  getExecutionsBySkillId: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/draft.service.js", () => ({
  getDraftById: vi.fn().mockResolvedValue(null),
  listDrafts: vi.fn().mockResolvedValue([]),
  createDraft: vi.fn().mockResolvedValue(null),
  updateDraft: vi.fn().mockResolvedValue(null),
  deleteDraft: vi.fn().mockResolvedValue(null),
  publishDraft: vi.fn().mockResolvedValue(null),
}));

describe("Skill routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // ─── GET /skills ─────────────────────────────────────────────
  it("GET /skills returns 200 with empty array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/skills",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skills).toEqual([]);
  });

  // ─── POST /skills — validation ──────────────────────────────
  it("POST /skills returns 400 without body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/skills",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_SKILL_REQUEST");
  });

  // ─── GET /skills/resolve ────────────────────────────────────
  it("GET /skills/resolve returns 400 without hook_point", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/skills/resolve",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("MISSING_HOOK_POINT");
  });

  it("GET /skills/resolve returns 200 with hook_point param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/skills/resolve?hook_point=PRE_SESSION",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skills).toEqual([]);
  });

  // ─── GET /skills/:skillId ──────────────────────────────────
  it("GET /skills/:skillId returns 404 for unknown skill", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/skills/unknown-skill",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("SKILL_NOT_FOUND");
  });

  // ─── PATCH /skills/:skillId/activate — admin required ───────
  it("PATCH /skills/:skillId/activate returns 401 without auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/skills/unknown-skill/activate",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
  });
});
