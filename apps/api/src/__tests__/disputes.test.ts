import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, AUTH_HEADERS, ADMIN_HEADERS } from "./helpers.js";

// --- Mock service layers ---
vi.mock("../services/payment-record.service.js", () => ({
  createAgentPaymentGrantRecord: vi.fn().mockResolvedValue(null),
  getAgentPaymentGrantById: vi.fn().mockResolvedValue(null),
  createPaymentDisclosureRecord: vi.fn().mockResolvedValue(null),
  createPaymentAuthorizationRecord: vi.fn().mockResolvedValue(null),
  createPaymentSettlementRecord: vi.fn().mockResolvedValue(null),
  createRefundRecord: vi.fn().mockResolvedValue(null),
  createStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  ensureCommerceOrderForApproval: vi.fn().mockResolvedValue(null),
  getPaymentIntentById: vi.fn().mockResolvedValue(null),
  getPaymentIntentRowById: vi.fn().mockResolvedValue(null),
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
  createDisputeEvidenceUploadRecord: vi.fn().mockResolvedValue(null),
  getDisputeEvidenceUploadByPath: vi.fn().mockResolvedValue(null),
  markDisputeEvidenceUploadCommitted: vi.fn().mockResolvedValue(null),
  createDisputeResolutionRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-storage.service.js", () => ({
  createDisputeUploadUrl: vi.fn().mockImplementation(async (objectPath: string) => ({
    uploadUrl: `https://upload.example/${objectPath}`,
    storagePath: `dispute-evidence/${objectPath}`,
    token: "upload-token",
    expiresIn: 600,
  })),
  disputeEvidenceExists: vi.fn().mockResolvedValue(true),
  createDisputeViewUrl: vi.fn().mockResolvedValue("https://view.example/signed"),
}));

vi.mock("../services/dispute-deposit.service.js", () => ({
  getDepositByDisputeId: vi.fn().mockResolvedValue(null),
  createDeposit: vi.fn().mockResolvedValue(null),
  getPendingExpiredDeposits: vi.fn().mockResolvedValue([]),
  updateDepositStatus: vi.fn().mockResolvedValue(null),
  updateDepositMetadata: vi.fn().mockResolvedValue(null),
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

// Import mocked service functions for per-test overrides
import {
  getCommerceOrderByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import {
  createDisputeRecord,
  createDisputeEvidenceUploadRecord,
  getDisputeEvidenceUploadByPath,
  getDisputeById,
  getDisputeByOrderId,
  markDisputeEvidenceUploadCommitted,
  addDisputeEvidenceRecord,
  updateDisputeRecord,
} from "../services/dispute-record.service.js";
import { createDeposit } from "../services/dispute-deposit.service.js";
import {
  createDisputeUploadUrl,
  disputeEvidenceExists,
} from "../services/dispute-storage.service.js";

const mockGetCommerceOrderByOrderId = getCommerceOrderByOrderId as ReturnType<typeof vi.fn>;
const mockUpdateCommerceOrderStatus = updateCommerceOrderStatus as ReturnType<typeof vi.fn>;
const mockCreateDisputeRecord = createDisputeRecord as ReturnType<typeof vi.fn>;
const mockCreateDisputeEvidenceUploadRecord = createDisputeEvidenceUploadRecord as ReturnType<typeof vi.fn>;
const mockGetDisputeEvidenceUploadByPath = getDisputeEvidenceUploadByPath as ReturnType<typeof vi.fn>;
const mockGetDisputeById = getDisputeById as ReturnType<typeof vi.fn>;
const mockGetDisputeByOrderId = getDisputeByOrderId as ReturnType<typeof vi.fn>;
const mockMarkDisputeEvidenceUploadCommitted = markDisputeEvidenceUploadCommitted as ReturnType<typeof vi.fn>;
const mockAddDisputeEvidenceRecord = addDisputeEvidenceRecord as ReturnType<typeof vi.fn>;
const mockUpdateDisputeRecord = updateDisputeRecord as ReturnType<typeof vi.fn>;
const mockCreateDeposit = createDeposit as ReturnType<typeof vi.fn>;
const mockCreateDisputeUploadUrl = createDisputeUploadUrl as ReturnType<typeof vi.fn>;
const mockDisputeEvidenceExists = disputeEvidenceExists as ReturnType<typeof vi.fn>;

/** Fake order that satisfies the ownership middleware. */
function fakeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord_123",
    buyerId: "test-user-001",
    sellerId: "test-seller-001",
    amountMinor: 50000,
    status: "DELIVERED",
    ...overrides,
  };
}

/** Fake dispute record. */
function fakeDispute(overrides: Record<string, unknown> = {}) {
  return {
    id: "some-id",
    order_id: "ord_123",
    reason_code: "ITEM_NOT_AS_DESCRIBED",
    opened_by: "buyer",
    status: "OPEN",
    evidence: [],
    metadata: { tier: 1 },
    ...overrides,
  };
}

describe("Dispute routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCommerceOrderByOrderId.mockResolvedValue(null);
    mockGetDisputeById.mockResolvedValue(null);
    mockGetDisputeByOrderId.mockResolvedValue(null);
    mockCreateDisputeRecord.mockResolvedValue(null);
    mockUpdateCommerceOrderStatus.mockResolvedValue(null);
    mockCreateDisputeEvidenceUploadRecord.mockResolvedValue(null);
    mockGetDisputeEvidenceUploadByPath.mockResolvedValue(null);
    mockMarkDisputeEvidenceUploadCommitted.mockResolvedValue(null);
    mockAddDisputeEvidenceRecord.mockResolvedValue(null);
    mockUpdateDisputeRecord.mockResolvedValue(null);
    mockCreateDeposit.mockResolvedValue(null);
    mockCreateDisputeUploadUrl.mockImplementation(async (objectPath: string) => ({
      uploadUrl: `https://upload.example/${objectPath}`,
      storagePath: `dispute-evidence/${objectPath}`,
      token: "upload-token",
      expiresIn: 600,
    }));
    mockDisputeEvidenceExists.mockResolvedValue(true);
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // POST /orders/:orderId/disputes - hardened public open path
  it("POST /orders/:orderId/disputes derives buyer role and freezes the order", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Battery health was listed as 92%, but the phone reports 72%.",
        client_request_id: "open-001",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.opened_by).toBe("buyer");
    expect(body.order_status).toBe("IN_DISPUTE");
    expect(body.idempotent).toBe(false);
    expect(body.dispute.opened_by).toBe("buyer");
    expect(body.dispute.metadata.client_request_id).toBe("open-001");
    expect(mockCreateDisputeRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      order_id: "ord_123",
      opened_by: "buyer",
    }));
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(expect.anything(), "ord_123", "IN_DISPUTE");
  });

  it("POST /orders/:orderId/disputes rejects users who are not order parties", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder({
      buyerId: "someone-else",
      sellerId: "another-user",
    }));

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Battery condition is materially different.",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  it("POST /orders/:orderId/disputes rejects non-disputable order states", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder({ status: "PAYMENT_PENDING" }));
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_RECEIVED",
        summary: "I have not received the item.",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ORDER_NOT_DISPUTABLE");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  it("POST /orders/:orderId/disputes returns existing dispute for matching idempotency key", async () => {
    const existing = fakeDispute({
      id: "dsp_existing",
      metadata: { client_request_id: "open-001", tier: 1 },
    });
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder({ status: "IN_DISPUTE" }));
    mockGetDisputeByOrderId.mockResolvedValueOnce(existing);

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Retrying the same open request.",
        client_request_id: "open-001",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().idempotent).toBe(true);
    expect(res.json().dispute.id).toBe("dsp_existing");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  it("POST /orders/:orderId/disputes blocks a second active dispute", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder({ status: "IN_DISPUTE" }));
    mockGetDisputeByOrderId.mockResolvedValueOnce(fakeDispute({
      id: "dsp_existing",
      metadata: { client_request_id: "open-001", tier: 1 },
    }));

    const res = await app.inject({
      method: "POST",
      url: "/orders/ord_123/disputes",
      headers: AUTH_HEADERS,
      payload: {
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        summary: "Trying to create a different active dispute.",
        client_request_id: "open-002",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ACTIVE_DISPUTE_EXISTS");
    expect(mockCreateDisputeRecord).not.toHaveBeenCalled();
  });

  // POST /disputes - schema validation
  it("POST /disputes returns 400 without body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_DISPUTE_REQUEST");
  });

  it("POST /disputes returns 400 with missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: { order_id: "ord_123" }, // missing reason_code and opened_by
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_DISPUTE_REQUEST");
    expect(res.json().issues).toBeDefined();
  });

  it("POST /disputes rejects oversized evidence text", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: {
        order_id: "ord_123",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        opened_by: "buyer",
        evidence: [
          {
            submitted_by: "buyer",
            type: "text",
            text: "x".repeat(10_001),
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_DISPUTE_REQUEST");
  });

  it("POST /disputes returns 400 with invalid reason_code", async () => {
    // Route checks order existence before reason_code validity
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes",
      headers: AUTH_HEADERS,
      payload: {
        order_id: "ord_123",
        reason_code: "TOTALLY_INVALID_CODE",
        opened_by: "buyer",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_REASON_CODE");
  });

  // GET /disputes/:id
  it("GET /disputes/:id returns 404 for nonexistent dispute", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/disputes/nonexistent-id",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  // GET /disputes/by-order/:orderId
  it("GET /disputes/by-order/:orderId returns 404 for unknown order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/disputes/by-order/ord_unknown",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  it("POST /disputes/:id/evidence/upload-url records a pending upload intent", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/upload-url",
      headers: AUTH_HEADERS,
      payload: {
        filename: "battery.png",
        content_type: "image/png",
        file_size_bytes: 1234,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().evidence_type).toBe("image");
    expect(res.json().storage_path).toContain("dispute-evidence/some-id/");
    expect(mockCreateDisputeEvidenceUploadRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      disputeId: "some-id",
      uploadedBy: "buyer",
      evidenceType: "image",
      contentType: "image/png",
      fileSizeBytes: 1234,
    }));
  });

  it("POST /disputes/:id/evidence/commit rejects unissued storage paths", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
        description: "Battery screen",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("UPLOAD_INTENT_NOT_FOUND");
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/commit rejects type mismatches", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      disputeId: "some-id",
      uploadedBy: "buyer",
      evidenceType: "image",
      contentType: "image/png",
      fileSizeBytes: 1234,
      storagePath: "dispute-evidence/some-id/uploaded.png",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      committedEvidenceId: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "video",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("EVIDENCE_TYPE_MISMATCH");
    expect(mockAddDisputeEvidenceRecord).not.toHaveBeenCalled();
  });

  it("POST /disputes/:id/evidence/commit commits a matching pending upload", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockGetDisputeEvidenceUploadByPath.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      disputeId: "some-id",
      uploadedBy: "buyer",
      evidenceType: "image",
      contentType: "image/png",
      fileSizeBytes: 1234,
      storagePath: "dispute-evidence/some-id/uploaded.png",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      committedEvidenceId: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/evidence/commit",
      headers: AUTH_HEADERS,
      payload: {
        storage_path: "dispute-evidence/some-id/uploaded.png",
        type: "image",
        description: "Battery screen",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().evidence.uri).toBe("dispute-evidence/some-id/uploaded.png");
    expect(mockDisputeEvidenceExists).toHaveBeenCalledWith("some-id/uploaded.png");
    expect(mockAddDisputeEvidenceRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      dispute_id: "some-id",
      submitted_by: "buyer",
      type: "image",
      uri: "dispute-evidence/some-id/uploaded.png",
    }));
    expect(mockMarkDisputeEvidenceUploadCommitted).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
      expect.any(String),
    );
  });

  // POST /disputes/deposits/expire (requireAdmin)
  it("POST /disputes/deposits/expire returns 200 with forfeited count", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/deposits/expire",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.forfeited_count).toBeDefined();
    expect(typeof body.forfeited_count).toBe("number");
    // With mock returning empty array, count should be 0
    expect(body.forfeited_count).toBe(0);
  });

  // POST /disputes/:id/escalate
  it("POST /disputes/:id/escalate returns 404 for nonexistent dispute", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/disputes/nonexistent/escalate",
      headers: AUTH_HEADERS,
      payload: { escalated_by: "buyer" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DISPUTE_NOT_FOUND");
  });

  it("POST /disputes/:id/escalate returns 400 with invalid body", async () => {
    // requireDisputeParty middleware needs dispute + order to exist
    mockGetDisputeById.mockResolvedValueOnce(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/escalate",
      headers: AUTH_HEADERS,
      payload: { escalated_by: "invalid_role" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_ESCALATE_REQUEST");
  });

  it("POST /disputes/:id/escalate rejects escalated_by spoofing for non-admin parties", async () => {
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/escalate",
      headers: AUTH_HEADERS,
      payload: { escalated_by: "seller" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ESCALATION_PARTY_MISMATCH");
    expect(mockUpdateDisputeRecord).not.toHaveBeenCalled();
    expect(mockCreateDeposit).not.toHaveBeenCalled();
  });

  // POST /disputes/:id/deposit
  it("POST /disputes/:id/deposit returns 404 when no deposit exists", async () => {
    // requireDisputeParty middleware needs dispute + order to exist
    mockGetDisputeById.mockResolvedValueOnce(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce(fakeOrder());

    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/deposit",
      headers: AUTH_HEADERS,
      payload: { amount_cents: 500 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("DEPOSIT_NOT_FOUND");
  });
});
