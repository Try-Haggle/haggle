/**
 * Route tests for /admin/* (Step 58 Part A + Part B).
 *
 * Auth-gate focused. Service layers are mocked; we verify wiring,
 * request shape, Zod validation paths, and audit-log side effects.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { getTestApp, closeTestApp } from "./helpers.js";

// ─── Mock service layers ─────────────────────────────────────────────

vi.mock("../services/admin-inbox.service.js", () => ({
  getInboxSummary: vi.fn().mockResolvedValue({
    tags: { pending: 0, autoPromoteReady: 0 },
    disputes: { open: 0, underReview: 0, waiting: 0 },
    payments: { failed: 0 },
    computedAt: new Date().toISOString(),
  }),
  listPendingTags: vi.fn().mockResolvedValue([]),
  listActiveDisputes: vi.fn().mockResolvedValue([]),
  listFailedPayments: vi.fn().mockResolvedValue([]),
  getInboxDetail: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/tag-promotion.service.js", () => ({
  runPromotionJob: vi.fn().mockResolvedValue({
    suggestionsPromoted: 0,
    suggestionsMerged: 0,
    tagsCandidateToEmerging: 0,
    tagsEmergingToOfficial: 0,
    perCategory: {},
    durationMs: 1,
    errors: [],
  }),
}));

// The in-memory store powers the promotion-rule service mock and lets the
// audit-log assertion peek at what was written.
const ruleStore = new Map<string, Record<string, unknown>>();
const auditLog: Array<Record<string, unknown>> = [];
let lastRunRow: Record<string, unknown> | null = null;

vi.mock("../services/promotion-rule.service.js", () => ({
  listPromotionRules: vi.fn(async () => Array.from(ruleStore.values())),
  getPromotionRule: vi.fn(async (_db: unknown, category: string) =>
    ruleStore.get(category) ?? null,
  ),
  upsertPromotionRule: vi.fn(
    async (
      _db: unknown,
      category: string,
      input: Record<string, unknown>,
    ) => {
      const row = { category, ...input, updatedAt: new Date() };
      ruleStore.set(category, row);
      return row;
    },
  ),
  deletePromotionRule: vi.fn(async (_db: unknown, category: string) => {
    ruleStore.delete(category);
  }),
  getLastPromotionRun: vi.fn(async () => lastRunRow),
}));

vi.mock("../services/admin-action-log.service.js", () => ({
  writeAuditLog: vi.fn(async (_db: unknown, params: Record<string, unknown>) => {
    auditLog.push(params);
  }),
}));

// ─── Mutation action mocks (Step 58 Part B) ─────────────────────────

const approveSuggestionMock = vi.fn();
const rejectSuggestionMock = vi.fn();
const mergeSuggestionMock = vi.fn();

vi.mock("../services/tag-suggestion.service.js", () => ({
  approveSuggestion: (...args: unknown[]) => approveSuggestionMock(...args),
  rejectSuggestion: (...args: unknown[]) => rejectSuggestionMock(...args),
  mergeSuggestion: (...args: unknown[]) => mergeSuggestionMock(...args),
}));

const disputeStore = new Map<string, Record<string, unknown>>();

vi.mock("../services/dispute-record.service.js", () => ({
  getDisputeById: vi.fn(async (_db: unknown, id: string) =>
    disputeStore.get(id) ?? null,
  ),
  updateDisputeRecord: vi.fn(async (_db: unknown, dispute: Record<string, unknown>) => {
    disputeStore.set(dispute.id as string, dispute);
  }),
  createDisputeResolutionRecord: vi.fn(async () => {}),
}));

vi.mock("../services/dispute-resolution-finalizer.js", () => ({
  finalizeDisputeResolution: vi.fn(async (_db: unknown, dispute: Record<string, unknown>, resolution: Record<string, unknown>, resolvedDispute: Record<string, unknown>) => {
    disputeStore.set(dispute.id as string, resolvedDispute);
    return {
      dispute: resolvedDispute,
      auto_refund: null,
      deposit_refund: null,
      resolution,
    };
  }),
}));

const paymentStore = new Map<string, Record<string, unknown>>();
const setProviderContextMock = vi.fn(
  async (_db: unknown, id: string, ctx: Record<string, unknown>) => {
    const existing = paymentStore.get(id);
    if (existing) {
      paymentStore.set(id, { ...existing, providerContext: ctx });
    }
  },
);

vi.mock("../services/payment-record.service.js", () => ({
  getPaymentIntentRowById: vi.fn(async (_db: unknown, id: string) =>
    paymentStore.get(id) ?? null,
  ),
  setPaymentIntentProviderContext: (...args: unknown[]) =>
    setProviderContextMock(...(args as [unknown, string, Record<string, unknown>])),
  // Unused by admin.ts but imported elsewhere (kept for safety in case other
  // route files registered in the same test app import this module).
  getPaymentIntentById: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn().mockResolvedValue(null),
  updateStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  createPaymentAuthorizationRecord: vi.fn().mockResolvedValue(null),
  createPaymentSettlementRecord: vi.fn().mockResolvedValue(null),
  createRefundRecord: vi.fn().mockResolvedValue(null),
  getCommerceOrderByOrderId: vi.fn().mockResolvedValue(null),
  updateCommerceOrderStatus: vi.fn().mockResolvedValue(null),
  ensureCommerceOrderForApproval: vi.fn().mockResolvedValue(null),
  getSettlementApprovalById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn().mockResolvedValue(null),
}));

// DisputeService is used directly by admin.ts for resolve; stub the
// constructor to return a deterministic resolve() that just stamps the
// outcome onto the dispute.
vi.mock("@haggle/dispute-core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@haggle/dispute-core",
  );
  return {
    ...actual,
    DisputeService: class {
      resolve(
        dispute: Record<string, unknown>,
        input: { outcome: string; summary: string; refund_amount_minor?: number },
      ) {
        return {
          dispute: {
            ...dispute,
            status:
              input.outcome === "buyer_favor"
                ? "RESOLVED_BUYER_FAVOR"
                : input.outcome === "seller_favor"
                  ? "RESOLVED_SELLER_FAVOR"
                  : "PARTIAL_REFUND",
            resolution: {
              outcome: input.outcome,
              summary: input.summary,
              refund_amount_minor: input.refund_amount_minor,
            },
          },
          value: {
            outcome: input.outcome,
            summary: input.summary,
            refund_amount_minor: input.refund_amount_minor,
            resolved_at: new Date().toISOString(),
          },
          trust_triggers: [],
        };
      }
    },
  };
});

// ─── Service mocks required by unrelated route files ────────────────

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

vi.mock("../services/draft.service.js", () => ({
  getDraftById: vi.fn().mockResolvedValue(null),
  listDrafts: vi.fn().mockResolvedValue([]),
  createDraft: vi.fn().mockResolvedValue(null),
  updateDraft: vi.fn().mockResolvedValue(null),
  deleteDraft: vi.fn().mockResolvedValue(null),
  publishDraft: vi.fn().mockResolvedValue(null),
}));

// ─── Helpers ─────────────────────────────────────────────────────────

function mintToken(role: "admin" | "user") {
  return jwt.sign(
    { sub: role === "admin" ? "admin-user-1" : "user-1", role },
    "test-secret",
  );
}

const adminAuth = { authorization: `Bearer ${mintToken("admin")}` };
const userAuth = { authorization: `Bearer ${mintToken("user")}` };

describe("Admin routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // 1
  it("GET /admin/inbox/summary returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/inbox/summary",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
  });

  // 2
  it("GET /admin/inbox/summary returns 403 with non-admin token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/inbox/summary",
      headers: userAuth,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ADMIN_REQUIRED");
  });

  // 3
  it("GET /admin/inbox/summary returns 200 for admin with expected shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/inbox/summary",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tags).toBeDefined();
    expect(body.disputes).toBeDefined();
    expect(body.payments).toBeDefined();
    expect(body.computedAt).toBeDefined();
  });

  // 4
  it("GET /admin/inbox/tags returns 200 with items array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/inbox/tags",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  // 5
  it("GET /admin/inbox/:type/:id with invalid type returns 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/inbox/bogus/123",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_INBOX_TYPE");
  });

  // 6
  it("GET /admin/inbox/tag/:id returns 404 when detail missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/inbox/tag/unknown-id",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("NOT_FOUND");
  });

  // 7
  it("POST /admin/jobs/tag-promote returns 200 with report shape", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/jobs/tag-promote",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.report).toBeDefined();
    expect(body.report.perCategory).toBeDefined();
    expect(Array.isArray(body.report.errors)).toBe(true);
  });

  // 8
  it("GET /admin/jobs/tag-promote/last returns lastRun:null when empty", async () => {
    lastRunRow = null;
    const res = await app.inject({
      method: "GET",
      url: "/admin/jobs/tag-promote/last",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lastRun).toBeNull();
  });

  // 9
  it("PUT /admin/promotion-rules/default upserts and writes audit log", async () => {
    auditLog.length = 0;
    ruleStore.clear();
    const res = await app.inject({
      method: "PUT",
      url: "/admin/promotion-rules/default",
      headers: adminAuth,
      payload: {
        candidateMinUse: 5,
        emergingMinUse: 20,
        candidateMinAgeDays: 0,
        emergingMinAgeDays: 7,
        suggestionAutoPromoteCount: 10,
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rule).toBeDefined();
    expect(ruleStore.has("default")).toBe(true);
    expect(auditLog.length).toBe(1);
    expect(auditLog[0].actionType).toBe("rule.update");
    expect(auditLog[0].targetId).toBe("default");
  });

  // 10
  it("DELETE /admin/promotion-rules/default is blocked with 400", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/promotion-rules/default",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CANNOT_DELETE_DEFAULT_RULE");
  });

  // 11
  it("DELETE /admin/promotion-rules/:category returns 404 when not found", async () => {
    ruleStore.clear();
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/promotion-rules/does-not-exist",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("RULE_NOT_FOUND");
  });

  // 12
  it("PUT /admin/promotion-rules/default with invalid body returns 400", async () => {
    auditLog.length = 0;
    const res = await app.inject({
      method: "PUT",
      url: "/admin/promotion-rules/default",
      headers: adminAuth,
      payload: {
        // candidateMinUse missing, emergingMinUse wrong type
        emergingMinUse: "not-a-number",
        candidateMinAgeDays: 0,
        emergingMinAgeDays: 7,
        suggestionAutoPromoteCount: 10,
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_RULE_BODY");
    // Validation failure must not write to the audit log.
    expect(auditLog.length).toBe(0);
  });

  // 13
  it("GET /admin/promotion-rules/:nonexistent returns 404", async () => {
    ruleStore.clear();
    const res = await app.inject({
      method: "GET",
      url: "/admin/promotion-rules/nonexistent-category",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("RULE_NOT_FOUND");
  });

  // 14
  it("PUT /admin/promotion-rules/newcategory creates rule and writes audit log", async () => {
    auditLog.length = 0;
    ruleStore.clear();
    const res = await app.inject({
      method: "PUT",
      url: "/admin/promotion-rules/newcategory",
      headers: adminAuth,
      payload: {
        candidateMinUse: 3,
        emergingMinUse: 15,
        candidateMinAgeDays: 1,
        emergingMinAgeDays: 5,
        suggestionAutoPromoteCount: 8,
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rule).toBeDefined();
    expect(ruleStore.has("newcategory")).toBe(true);
    expect(auditLog.length).toBe(1);
    expect(auditLog[0].actionType).toBe("rule.update");
    expect(auditLog[0].targetId).toBe("newcategory");
    expect(auditLog[0].targetType).toBe("tag_promotion_rule");
    // `before` should be null since this is a fresh create.
    const payload = auditLog[0].payload as { before: unknown; after: unknown };
    expect(payload.before).toBeNull();
    expect(payload.after).not.toBeNull();
  });

  // ─── Step 58 Part B: mutation actions ─────────────────────────

  // 15
  it("POST /admin/actions/tag-approve happy path writes audit log", async () => {
    auditLog.length = 0;
    approveSuggestionMock.mockResolvedValueOnce({
      ok: true,
      tagId: "tag-1",
      merged: false,
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/tag-approve",
      headers: adminAuth,
      payload: { suggestionId: "sugg-1", category: "electronics" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.ok).toBe(true);
    expect(approveSuggestionMock).toHaveBeenCalledWith(
      expect.anything(),
      "sugg-1",
      expect.objectContaining({
        category: "electronics",
        reviewedBy: "admin-user-1",
      }),
    );
    expect(auditLog.length).toBe(1);
    expect(auditLog[0].actionType).toBe("tag.approve");
    expect(auditLog[0].targetType).toBe("tag_suggestion");
    expect(auditLog[0].targetId).toBe("sugg-1");
  });

  // 16
  it("POST /admin/actions/tag-approve returns 409 when already approved", async () => {
    auditLog.length = 0;
    approveSuggestionMock.mockResolvedValueOnce({
      ok: false,
      error: "Already APPROVED",
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/tag-approve",
      headers: adminAuth,
      payload: { suggestionId: "sugg-2" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TAG_APPROVE_FAILED");
    expect(auditLog.length).toBe(0);
  });

  // 17
  it("POST /admin/actions/tag-reject happy path", async () => {
    auditLog.length = 0;
    rejectSuggestionMock.mockResolvedValueOnce({ ok: true });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/tag-reject",
      headers: adminAuth,
      payload: { suggestionId: "sugg-3", reason: "spam" },
    });
    expect(res.statusCode).toBe(200);
    expect(auditLog.length).toBe(1);
    expect(auditLog[0].actionType).toBe("tag.reject");
    expect((auditLog[0].payload as { reason: unknown }).reason).toBe("spam");
  });

  // 18
  it("POST /admin/actions/tag-merge happy path", async () => {
    auditLog.length = 0;
    mergeSuggestionMock.mockResolvedValueOnce({ ok: true });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/tag-merge",
      headers: adminAuth,
      payload: { suggestionId: "sugg-4", targetTagId: "tag-42" },
    });
    expect(res.statusCode).toBe(200);
    expect(mergeSuggestionMock).toHaveBeenCalledWith(
      expect.anything(),
      "sugg-4",
      "tag-42",
      "admin-user-1",
    );
    expect(auditLog.length).toBe(1);
    expect(auditLog[0].actionType).toBe("tag.merge");
    expect(
      (auditLog[0].payload as { targetTagId: unknown }).targetTagId,
    ).toBe("tag-42");
  });

  // 19
  it("POST /admin/actions/dispute-escalate happy path updates tier", async () => {
    auditLog.length = 0;
    disputeStore.clear();
    disputeStore.set("d-1", {
      id: "d-1",
      status: "OPEN",
      metadata: { tier: 1 },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/dispute-escalate",
      headers: adminAuth,
      payload: { disputeId: "d-1", toTier: 2, reason: "buyer appeal" },
    });
    expect(res.statusCode).toBe(200);
    const updated = disputeStore.get("d-1") as { metadata: { tier: number } };
    expect(updated.metadata.tier).toBe(2);
    expect(auditLog.length).toBe(1);
    expect(auditLog[0].actionType).toBe("dispute.escalate");
  });

  // 20
  it("POST /admin/actions/dispute-escalate returns 404 when dispute missing", async () => {
    disputeStore.clear();
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/dispute-escalate",
      headers: adminAuth,
      payload: { disputeId: "missing", toTier: 2 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  // 21
  it("POST /admin/actions/dispute-resolve happy path", async () => {
    auditLog.length = 0;
    disputeStore.clear();
    disputeStore.set("d-2", {
      id: "d-2",
      status: "UNDER_REVIEW",
      metadata: { tier: 1 },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/dispute-resolve",
      headers: adminAuth,
      payload: {
        disputeId: "d-2",
        outcome: "buyer_favor",
        summary: "Buyer win",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(auditLog.length).toBe(1);
    expect(auditLog[0].actionType).toBe("dispute.resolve");
  });

  // 22
  it("POST /admin/actions/dispute-resolve returns 400 on invalid outcome", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/dispute-resolve",
      headers: adminAuth,
      payload: { disputeId: "d-3", outcome: "BUYER_WIN" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_BODY");
  });

  // 23
  it("POST /admin/actions/payment-mark-review happy path", async () => {
    auditLog.length = 0;
    paymentStore.clear();
    paymentStore.set("pi-1", {
      id: "pi-1",
      status: "FAILED",
      providerContext: { foo: "bar" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/payment-mark-review",
      headers: adminAuth,
      payload: { paymentIntentId: "pi-1", note: "needs manual check" },
    });
    expect(res.statusCode).toBe(200);
    expect(setProviderContextMock).toHaveBeenCalled();
    const ctx = setProviderContextMock.mock.calls[0][2];
    expect(ctx.manual_review).toBe(true);
    expect(ctx.note).toBe("needs manual check");
    expect(ctx.foo).toBe("bar");
    expect(auditLog.length).toBe(1);
    expect(auditLog[0].actionType).toBe("payment.mark_review");
  });

  // 24
  it("POST /admin/actions/payment-mark-review returns 409 on non-FAILED", async () => {
    paymentStore.clear();
    paymentStore.set("pi-2", {
      id: "pi-2",
      status: "SETTLED",
      providerContext: null,
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/payment-mark-review",
      headers: adminAuth,
      payload: { paymentIntentId: "pi-2", note: "late review" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("PAYMENT_INTENT_NOT_FAILED");
  });

  // 25
  it("POST /admin/actions/dispute-escalate returns 409 when tier not advancing", async () => {
    auditLog.length = 0;
    disputeStore.clear();
    disputeStore.set("d-tier", {
      id: "d-tier",
      status: "OPEN",
      metadata: { tier: 2 },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/dispute-escalate",
      headers: adminAuth,
      payload: { disputeId: "d-tier", toTier: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DISPUTE_TIER_NOT_ADVANCING");
    expect(auditLog.length).toBe(0);
  });

  // 26
  it("POST /admin/actions/dispute-escalate returns 409 when already resolved", async () => {
    auditLog.length = 0;
    disputeStore.clear();
    disputeStore.set("d-resolved", {
      id: "d-resolved",
      status: "RESOLVED_BUYER_FAVOR",
      metadata: { tier: 1 },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/dispute-escalate",
      headers: adminAuth,
      payload: { disputeId: "d-resolved", toTier: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DISPUTE_ALREADY_RESOLVED");
    expect(auditLog.length).toBe(0);
  });

  // 27
  it("POST /admin/actions/dispute-resolve returns 409 when already resolved", async () => {
    auditLog.length = 0;
    disputeStore.clear();
    disputeStore.set("d-done", {
      id: "d-done",
      status: "RESOLVED_BUYER_FAVOR",
      metadata: { tier: 1 },
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/dispute-resolve",
      headers: adminAuth,
      payload: {
        disputeId: "d-done",
        outcome: "buyer_favor",
        summary: "second attempt",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DISPUTE_ALREADY_RESOLVED");
    expect(auditLog.length).toBe(0);
  });

  // 28
  it("POST /admin/actions/payment-mark-review returns 404 when intent missing", async () => {
    auditLog.length = 0;
    paymentStore.clear();
    const res = await app.inject({
      method: "POST",
      url: "/admin/actions/payment-mark-review",
      headers: adminAuth,
      payload: { paymentIntentId: "pi-missing", note: "review" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("PAYMENT_INTENT_NOT_FOUND");
    expect(auditLog.length).toBe(0);
  });
});
