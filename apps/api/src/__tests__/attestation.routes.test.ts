/**
 * Route-level integration tests for /api/attestation/*.
 *
 * The service layer is mocked entirely — these tests verify wiring,
 * requireAuth, status codes, and the 404-obfuscation access matrix on
 * GET.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";

// Mock the service BEFORE importing getTestApp (which creates the server).
vi.mock("../services/attestation.service.js", () => ({
  createAttestationCommit: vi.fn(),
  getAttestationForViewer: vi.fn(),
  getListingSellerId: vi.fn(),
  AttestationConflictError: class AttestationConflictError extends Error {
    constructor(listingId: string) {
      super(`conflict ${listingId}`);
      this.name = "AttestationConflictError";
    }
  },
}));

vi.mock("../services/supabase-storage.service.js", () => ({
  createAttestationUploadUrl: vi.fn(),
  attestationObjectExists: vi.fn().mockResolvedValue(true),
  createAttestationViewUrl: vi.fn(),
}));

import { getTestApp, closeTestApp } from "./helpers.js";
import * as svc from "../services/attestation.service.js";
import * as storage from "../services/supabase-storage.service.js";

const SELLER_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_ID = "99999999-9999-9999-9999-999999999999";
const LISTING_ID = "11111111-1111-1111-1111-111111111111";

function tokenFor(userId: string, role?: string): string {
  // The auth middleware decodes (without verifying) when
  // SUPABASE_JWT_SECRET is not set — which is the case in tests.
  return jwt.sign({ sub: userId, role }, "test-secret");
}

describe("Attestation routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (svc.getListingSellerId as ReturnType<typeof vi.fn>).mockResolvedValue(SELLER_ID);
    (storage.createAttestationUploadUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
      uploadUrl: "https://signed.example/upload",
      storagePath: `attestation-evidence/${LISTING_ID}/front.jpg`,
      token: "tok",
      expiresIn: 600,
    });
  });

  // ─── POST /api/attestation/presigned-upload ──────────────

  it("presign returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/presigned-upload",
      payload: { listingId: LISTING_ID, filename: "front.jpg", contentType: "image/jpeg" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("presign returns 400 on missing fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/presigned-upload",
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
      payload: { listingId: LISTING_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_PRESIGN_REQUEST");
  });

  it("presign returns 400 on disallowed filename characters", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/presigned-upload",
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
      payload: {
        listingId: LISTING_ID,
        filename: "../evil.jpg",
        contentType: "image/jpeg",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_PATH");
  });

  it("presign returns 403 when caller is not the seller", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/presigned-upload",
      headers: { authorization: `Bearer ${tokenFor(OTHER_ID)}` },
      payload: {
        listingId: LISTING_ID,
        filename: "front.jpg",
        contentType: "image/jpeg",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("presign returns 404 when listing does not exist", async () => {
    (svc.getListingSellerId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/presigned-upload",
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
      payload: {
        listingId: LISTING_ID,
        filename: "front.jpg",
        contentType: "image/jpeg",
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("presign returns 200 with upload URL on happy path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/presigned-upload",
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
      payload: {
        listingId: LISTING_ID,
        filename: "front.jpg",
        contentType: "image/jpeg",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadUrl).toBe("https://signed.example/upload");
    expect(body.storagePath).toContain(LISTING_ID);
    expect(body.expiresIn).toBe(600);
  });

  // ─── POST /api/attestation/commit ────────────────────────

  const validCommitPayload = {
    listingId: LISTING_ID,
    imei: "123456789012345",
    batteryHealthPct: 92,
    findMyOff: true,
    photoStoragePaths: [`attestation-evidence/${LISTING_ID}/front.jpg`],
  };

  it("commit returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/commit",
      payload: validCommitPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("commit returns 400 on invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/commit",
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
      payload: { listingId: LISTING_ID, imei: "abc" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_COMMIT_REQUEST");
  });

  it("commit returns 403 when caller is not the seller", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/commit",
      headers: { authorization: `Bearer ${tokenFor(OTHER_ID)}` },
      payload: validCommitPayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it("commit returns 409 on duplicate", async () => {
    (svc.createAttestationCommit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new svc.AttestationConflictError(LISTING_ID),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/commit",
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
      payload: validCommitPayload,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ATTESTATION_ALREADY_COMMITTED");
  });

  it("commit returns 201 with commit info on happy path", async () => {
    (svc.createAttestationCommit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      commitId: "commit-1",
      commitHash: "a".repeat(64),
      committedAt: "2026-04-08T12:00:00.000Z",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/attestation/commit",
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
      payload: validCommitPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().commitId).toBe("commit-1");
    expect(res.json().commitHash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ─── GET /api/attestation/:listingId ─────────────────────

  it("GET returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/attestation/${LISTING_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET returns 404 when service returns null (not found or not authorized)", async () => {
    (svc.getAttestationForViewer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/attestation/${LISTING_ID}`,
      headers: { authorization: `Bearer ${tokenFor(OTHER_ID)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET returns 200 with commit view for authorized caller", async () => {
    (svc.getAttestationForViewer as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      commitId: "commit-1",
      listingId: LISTING_ID,
      sellerId: SELLER_ID,
      imeiEncrypted: "ENC::blob",
      batteryHealthPct: 92,
      findMyOff: true,
      photos: [
        {
          storagePath: `attestation-evidence/${LISTING_ID}/front.jpg`,
          viewUrl: "https://signed.example/view",
        },
      ],
      commitHash: "a".repeat(64),
      committedAt: "2026-04-08T12:00:00.000Z",
      expiresAt: "2026-05-08T12:00:00.000Z",
      viewerRole: "seller",
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/attestation/${LISTING_ID}`,
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.viewerRole).toBe("seller");
    expect(body.imeiEncrypted).toBe("ENC::blob");
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].viewUrl).toBe("https://signed.example/view");
  });

  it("GET returns 404 on malformed listingId segment", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/attestation/..%2Fevil",
      headers: { authorization: `Bearer ${tokenFor(SELLER_ID)}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
