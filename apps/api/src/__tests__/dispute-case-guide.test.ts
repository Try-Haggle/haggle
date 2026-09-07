import type { Database } from "@haggle/db";
import { validateCaseGuideOutput } from "@haggle/dispute-core";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPUTE_CASE_GUIDE_FORBIDDEN_MONEY_SIDE_EFFECTS } from "../lib/dispute-case-guide-money-guard.js";
import { registerDisputeCaseGuideRoutes } from "../routes/dispute-case-guide.js";

vi.mock("../services/dispute-record.service.js", () => ({
  getDisputeById: vi.fn(),
  updateDisputeRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/payment-record.service.js", () => ({
  getCommerceOrderByOrderId: vi.fn(),
}));

vi.mock("../services/dispute-resolution-finalizer.js", () => ({
  finalizeDisputeResolution: vi.fn(),
}));

vi.mock("../services/dispute-ai.service.js", () => ({
  buildDisputeAiCaseContextFromDispute: vi.fn((dispute, options = {}) => ({
    dispute_id: dispute.id,
    tier: options.tier ?? 1,
    opened_by: dispute.opened_by,
    reason_code: dispute.reason_code,
    transaction: {
      amount_minor: options.transaction?.amount_minor ?? 0,
      currency: options.transaction?.currency ?? "USDC",
      status: options.transaction?.status ?? "UNKNOWN",
    },
    party_statements: {
      buyer: dispute.evidence?.find(
        (e: { submitted_by: string; text?: string }) => e.submitted_by === "buyer",
      )?.text,
      seller: dispute.evidence?.find(
        (e: { submitted_by: string; text?: string }) => e.submitted_by === "seller",
      )?.text,
    },
    evidence: dispute.evidence ?? [],
    policy: options.policy,
  })),
  createDisputeAiProvider: vi.fn(() => ({ completeJson: vi.fn() })),
  runCaseGuide: vi.fn(),
}));

import { runCaseGuide } from "../services/dispute-ai.service.js";
import { finalizeDisputeResolution } from "../services/dispute-resolution-finalizer.js";
import { getDisputeById } from "../services/dispute-record.service.js";
import { getCommerceOrderByOrderId } from "../services/payment-record.service.js";

const mockGetDisputeById = getDisputeById as ReturnType<typeof vi.fn>;
const mockGetCommerceOrderByOrderId = getCommerceOrderByOrderId as ReturnType<typeof vi.fn>;
const mockRunCaseGuide = runCaseGuide as ReturnType<typeof vi.fn>;
const mockFinalizeDisputeResolution = finalizeDisputeResolution as ReturnType<typeof vi.fn>;

const AUTH_HEADERS = {
  authorization:
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJzdWIiOiJ0ZXN0LXVzZXItMDAxIiwiZW1haWwiOiJ0ZXN0QGhhZ2dsZS5haSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0" +
    ".fakesig",
};

const SELLER_HEADERS = {
  authorization:
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJzdWIiOiJ0ZXN0LXNlbGxlci0wMDEiLCJlbWFpbCI6InNlbGxlckBoYWdnbGUuYWkiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9" +
    ".fakesig",
};

const STRANGER_HEADERS = {
  authorization:
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJzdWIiOiJzdHJhbmdlci0wMDEiLCJlbWFpbCI6InN0cmFuZ2VyQGhhZ2dsZS5haSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0" +
    ".fakesig",
};

function fakeDispute(overrides: Record<string, unknown> = {}) {
  return {
    id: "some-id",
    order_id: "ord_1",
    opened_by: "buyer",
    reason_code: "ITEM_NOT_AS_DESCRIBED",
    status: "OPEN",
    evidence: [
      {
        id: "ev_1",
        dispute_id: "some-id",
        submitted_by: "buyer",
        type: "text",
        text: "Battery health is 82% not 95%.",
        created_at: "2026-09-07T00:00:00.000Z",
      },
    ],
    metadata: { tier: 1 },
    ...overrides,
  };
}

function fakeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord_1",
    buyerId: "test-user-001",
    sellerId: "test-seller-001",
    amountMinor: "50000",
    status: "IN_DISPUTE",
    ...overrides,
  };
}

function validCaseGuideOutput(party: "buyer" | "seller") {
  return {
    schema_version: "dispute_ai_case_guide_v1" as const,
    role: "case_guide" as const,
    party,
    claim_summary:
      party === "buyer"
        ? "You claim a battery condition mismatch versus the listing."
        : "Buyer claims a battery condition mismatch versus your listing.",
    message:
      party === "buyer"
        ? "Upload a diagnostic screenshot that shows current battery health."
        : "Upload pre-shipment diagnostic evidence with timestamp.",
    evidence_requests:
      party === "buyer"
        ? ["Battery health screenshot", "Listing screenshot"]
        : ["Pre-shipment diagnostic screenshot"],
    risk_flags: [] as string[],
    next_actions:
      party === "buyer" ? ["Upload battery screenshot."] : ["Upload shipment-time evidence."],
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (request) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return;
    const payloadPart = auth.slice("Bearer ".length).split(".")[1];
    if (!payloadPart) return;
    try {
      const json = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
        sub?: string;
        role?: string;
      };
      request.user = {
        id: json.sub ?? "unknown",
        role: json.role === "admin" ? "admin" : "authenticated",
      };
    } catch {
      // ignore malformed tokens
    }
  });
  registerDisputeCaseGuideRoutes(app, {} as Database);
  await app.ready();
  return app;
}

describe("F1 Case Guide first-party HTTP goldens", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDisputeById.mockResolvedValue(fakeDispute());
    mockGetCommerceOrderByOrderId.mockResolvedValue(fakeOrder());
    mockRunCaseGuide.mockImplementation(async (_ctx, party: "buyer" | "seller") => ({
      ok: true,
      role: "case_guide",
      displayName: "Case Guide",
      schemaName: "dispute_ai_case_guide_v1",
      contextHash: "hash_case_guide_test",
      output: validCaseGuideOutput(party),
      model: "deepseek-v4-flash",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("harness validate accepts dispute_ai_case_guide_v1 for guided party", () => {
    const buyerOut = validCaseGuideOutput("buyer");
    const sellerOut = validCaseGuideOutput("seller");
    expect(validateCaseGuideOutput(buyerOut, "buyer")).toEqual([]);
    expect(validateCaseGuideOutput(sellerOut, "seller")).toEqual([]);
    expect(validateCaseGuideOutput(buyerOut, "seller")).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "party" })]),
    );
  });

  it("buyer happy path returns Case Guide schema + money_moved false", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/case-guide",
      headers: AUTH_HEADERS,
      payload: { party: "buyer", message: "Help me organize battery evidence." },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      dispute_id: "some-id",
      role: "case_guide",
      display_name: "Case Guide",
      schema_name: "dispute_ai_case_guide_v1",
      party: "buyer",
      money_moved: false,
      auto_applied: false,
      case_guide: {
        schema_version: "dispute_ai_case_guide_v1",
        role: "case_guide",
        party: "buyer",
      },
    });
    expect(validateCaseGuideOutput(body.case_guide, "buyer")).toEqual([]);
    expect(mockRunCaseGuide).toHaveBeenCalledTimes(1);
    expect(mockFinalizeDisputeResolution).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/case-guide",
      payload: { party: "buyer" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockRunCaseGuide).not.toHaveBeenCalled();
  });

  it("rejects cross-user stranger with 403", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/case-guide",
      headers: STRANGER_HEADERS,
      payload: { party: "buyer" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
    expect(mockRunCaseGuide).not.toHaveBeenCalled();
  });

  it("rejects buyer requesting seller party (IDOR / party mismatch)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/case-guide",
      headers: AUTH_HEADERS,
      payload: { party: "seller", message: "spoof" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: "CASE_GUIDE_PARTY_MISMATCH",
      authenticated_party: "buyer",
      requested_party: "seller",
    });
    expect(mockRunCaseGuide).not.toHaveBeenCalled();
  });

  it("allows seller for seller party scope", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/case-guide",
      headers: SELLER_HEADERS,
      payload: { party: "seller", context: "Need counter-evidence checklist." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      party: "seller",
      display_name: "Case Guide",
      money_moved: false,
      case_guide: { party: "seller", role: "case_guide" },
    });
  });

  it("returns 400 on invalid body", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/case-guide",
      headers: AUTH_HEADERS,
      payload: { party: "admin" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_CASE_GUIDE_REQUEST");
  });

  it("money-inert: Case Guide path never calls finalize/refund/release", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/disputes/some-id/case-guide",
      headers: AUTH_HEADERS,
      payload: { party: "buyer" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().money_moved).toBe(false);
    expect(mockFinalizeDisputeResolution).not.toHaveBeenCalled();

    const fs = await import("node:fs/promises");
    const pathMod = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = pathMod.dirname(fileURLToPath(import.meta.url));
    const routeSrc = await fs.readFile(
      pathMod.resolve(dir, "../routes/dispute-case-guide.ts"),
      "utf8",
    );
    const serviceSrc = await fs.readFile(
      pathMod.resolve(dir, "../services/dispute-case-guide.service.ts"),
      "utf8",
    );
    expect(routeSrc).toMatch(/Case Guide/);
    expect(routeSrc).not.toMatch(/await finalizeDisputeResolution\(/);
    expect(routeSrc).not.toMatch(/from "\.\.\/services\/dispute-resolution-finalizer/);
    expect(routeSrc).not.toMatch(
      /executeRefund|refundDeposit|createRefundRecord|createSettlementReleaseRecord/,
    );
    expect(serviceSrc).not.toMatch(/await finalizeDisputeResolution\(/);
    expect(serviceSrc).not.toMatch(/from "\.\/dispute-resolution-finalizer/);
    expect(DISPUTE_CASE_GUIDE_FORBIDDEN_MONEY_SIDE_EFFECTS).toContain("finalizeDisputeResolution");
  });
});
