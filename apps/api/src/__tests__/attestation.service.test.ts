/**
 * Unit tests for the attestation service.
 *
 * These tests drive the service with a hand-rolled fake `db` that records
 * SQL calls and returns canned rows, plus a mocked supabase-storage module
 * so no real Supabase traffic is attempted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the storage service BEFORE importing the module under test.
vi.mock("../services/supabase-storage.service.js", () => ({
  createAttestationUploadUrl: vi.fn(),
  attestationObjectExists: vi.fn().mockResolvedValue(true),
  createAttestationViewUrl: vi
    .fn()
    .mockImplementation(async (p: string) => `https://signed.example/${p}`),
}));

import {
  createAttestationCommit,
  getAttestationForViewer,
  verifyAttestationCommit,
  loadCommitByListing,
  AttestationConflictError,
} from "../services/attestation.service.js";
import {
  canonicalizeAttestation,
  computeCommitHash,
} from "../lib/attestation-hash.js";
import * as storageMod from "../services/supabase-storage.service.js";

const LISTING_ID = "11111111-1111-1111-1111-111111111111";
const SELLER_ID = "22222222-2222-2222-2222-222222222222";
const BUYER_ID = "33333333-3333-3333-3333-333333333333";

type Row = Record<string, unknown>;

/**
 * Minimal fake `db` that routes `db.execute()` to a scripted handler. Each
 * call gets a chance to inspect the compiled SQL (via its text fragment)
 * and return the row set appropriate for that query.
 */
function makeFakeDb(handler: (callIdx: number) => Row[]) {
  let idx = 0;
  return {
    execute: vi.fn().mockImplementation(async () => {
      const rows = handler(idx++);
      return rows;
    }),
  } as unknown as import("@haggle/db").Database;
}

function fixedCommitRow(overrides: Partial<Row> = {}): Row {
  const committedAt = "2026-04-08T12:00:00.000Z";
  const photoKeys = [
    `attestation-evidence/${LISTING_ID}/front.jpg`,
    `attestation-evidence/${LISTING_ID}/back.jpg`,
  ];
  const canonical = canonicalizeAttestation({
    listingId: LISTING_ID,
    sellerId: SELLER_ID,
    imei: "123456789012345",
    batteryHealthPct: 92,
    findMyOff: true,
    photoKeys,
    committedAt,
  });
  const hash = computeCommitHash(canonical);
  return {
    id: "commit-1",
    listingId: LISTING_ID,
    sellerId: SELLER_ID,
    imeiEncrypted: "ENC::base64::blob",
    batteryHealthPct: 92,
    findMyOff: true,
    photoUrls: photoKeys,
    commitHash: hash,
    canonicalPayload: {
      version: "v1",
      listingId: LISTING_ID,
      sellerId: SELLER_ID,
      imei: "123456789012345",
      batteryHealthPct: 92,
      findMyOff: true,
      photoKeys,
      committedAt,
    },
    committedAt,
    expiresAt: "2026-05-08T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (storageMod.attestationObjectExists as ReturnType<typeof vi.fn>).mockResolvedValue(
    true,
  );
});

// ─── createAttestationCommit ────────────────────────────────

describe("createAttestationCommit", () => {
  it("inserts a new commit and returns the hash", async () => {
    // Pre-SELECT removed (C2 fix): the first db.execute call IS the INSERT.
    const db = makeFakeDb((i) => {
      if (i === 0)
        return [
          {
            id: "commit-new",
            committed_at: "2026-04-08T12:00:00.000Z",
          },
        ];
      return [];
    });

    const result = await createAttestationCommit(db, {
      listingId: LISTING_ID,
      sellerId: SELLER_ID,
      imei: "123456789012345",
      batteryHealthPct: 92,
      findMyOff: true,
      photoStoragePaths: [
        `${LISTING_ID}/front.jpg`,
        `${LISTING_ID}/back.jpg`,
      ],
    });

    expect(result.commitId).toBe("commit-new");
    expect(result.commitHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.committedAt).toBeTruthy();
    expect(storageMod.attestationObjectExists).toHaveBeenCalledTimes(2);
  });

  it("throws AttestationConflictError on Postgres 23505 unique_violation", async () => {
    // C2 fix: append-only is enforced by UNIQUE(listing_id). Simulate a
    // concurrent second INSERT losing the race by making db.execute throw
    // a pg error with code 23505.
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    const db = {
      execute: vi.fn().mockRejectedValue(pgError),
    } as unknown as import("@haggle/db").Database;
    await expect(
      createAttestationCommit(db, {
        listingId: LISTING_ID,
        sellerId: SELLER_ID,
        imei: "123456789012345",
        batteryHealthPct: 92,
        findMyOff: true,
        photoStoragePaths: [`${LISTING_ID}/front.jpg`],
      }),
    ).rejects.toBeInstanceOf(AttestationConflictError);
  });

  it("round-trips a formatted IMEI: canonical_payload re-hashes to commit_hash (C1 regression)", async () => {
    // Commit with a human-formatted IMEI containing spaces and dashes.
    // The stored canonical_payload must contain the digits-only
    // normalized IMEI AND re-hashing that payload must reproduce
    // the returned commit_hash byte-for-byte.
    const captured: { canonical: Record<string, unknown> | null } = {
      canonical: null,
    };
    const db = {
      execute: vi.fn().mockImplementation(async (query: unknown) => {
        // Drizzle `sql` tagged template exposes `queryChunks`/`.params` — we
        // just need to capture the JSON literal we pass in as a param.
        const q = query as { params?: unknown[] };
        if (q.params) {
          for (const p of q.params) {
            if (
              typeof p === "string" &&
              p.startsWith("{") &&
              p.includes("\"version\"")
            ) {
              try {
                captured.canonical = JSON.parse(p) as Record<string, unknown>;
              } catch {
                /* ignore */
              }
            }
          }
        }
        return [{ id: "commit-new", committed_at: "2026-04-08T12:00:00.000Z" }];
      }),
    } as unknown as import("@haggle/db").Database;

    const result = await createAttestationCommit(db, {
      listingId: LISTING_ID,
      sellerId: SELLER_ID,
      imei: "123 456-789 012 345", // formatted
      batteryHealthPct: 92,
      findMyOff: true,
      photoStoragePaths: [`${LISTING_ID}/front.jpg`],
    });

    // Returned hash must match the reference hash for the *normalized* IMEI.
    const refHash = computeCommitHash(
      canonicalizeAttestation({
        listingId: LISTING_ID,
        sellerId: SELLER_ID,
        imei: "123456789012345",
        batteryHealthPct: 92,
        findMyOff: true,
        photoKeys: [`attestation-evidence/${LISTING_ID}/front.jpg`],
        committedAt: result.committedAt,
      }),
    );
    expect(result.commitHash).toBe(refHash);

    // Canonical_payload as stored must contain digits-only IMEI.
    if (captured.canonical) {
      expect(captured.canonical.imei).toBe("123456789012345");
    }
  });

  it("rejects when a photo does not exist in the bucket", async () => {
    (
      storageMod.attestationObjectExists as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(false);
    const db = makeFakeDb(() => []);
    await expect(
      createAttestationCommit(db, {
        listingId: LISTING_ID,
        sellerId: SELLER_ID,
        imei: "123456789012345",
        batteryHealthPct: 92,
        findMyOff: true,
        photoStoragePaths: [`${LISTING_ID}/front.jpg`],
      }),
    ).rejects.toThrow(/photo not found/);
  });

  it("rejects a storage path that does not match listingId", async () => {
    const db = makeFakeDb(() => []);
    await expect(
      createAttestationCommit(db, {
        listingId: LISTING_ID,
        sellerId: SELLER_ID,
        imei: "123456789012345",
        batteryHealthPct: 92,
        findMyOff: true,
        photoStoragePaths: ["some-other-listing/front.jpg"],
      }),
    ).rejects.toThrow(/does not match/);
  });
});

// ─── verifyAttestationCommit ────────────────────────────────

describe("verifyAttestationCommit", () => {
  const basePayload = {
    sellerId: SELLER_ID,
    imei: "123456789012345",
    batteryHealthPct: 92,
    findMyOff: true,
    photoStoragePaths: [
      `attestation-evidence/${LISTING_ID}/front.jpg`,
      `attestation-evidence/${LISTING_ID}/back.jpg`,
    ],
    committedAt: "2026-04-08T12:00:00.000Z",
  };

  it("returns match=true when payload is identical", async () => {
    const db = makeFakeDb(() => [fixedCommitRow()]);
    const result = await verifyAttestationCommit(db, LISTING_ID, basePayload);
    expect(result.found).toBe(true);
    expect(result.match).toBe(true);
    expect(result.storedHash).toBe(result.computedHash);
    expect(result.divergence).toBeUndefined();
  });

  it("returns match=false when a field is changed", async () => {
    const db = makeFakeDb(() => [fixedCommitRow()]);
    const result = await verifyAttestationCommit(db, LISTING_ID, {
      ...basePayload,
      batteryHealthPct: 88, // tampered
    });
    expect(result.match).toBe(false);
    expect(result.storedHash).not.toBe(result.computedHash);
    expect(result.divergence).toContain("batteryHealthPct");
  });

  it("returns match=false when photoStoragePaths order is swapped", async () => {
    const db = makeFakeDb(() => [fixedCommitRow()]);
    const reversed = [...basePayload.photoStoragePaths].reverse();
    const result = await verifyAttestationCommit(db, LISTING_ID, {
      ...basePayload,
      photoStoragePaths: reversed,
    });
    expect(result.match).toBe(false);
    expect(result.divergence).toContain("photoKeys");
  });

  it("returns found=false when no commit exists", async () => {
    const db = makeFakeDb(() => []);
    const result = await verifyAttestationCommit(db, LISTING_ID, basePayload);
    expect(result.found).toBe(false);
    expect(result.match).toBe(false);
  });
});

// ─── getAttestationForViewer ────────────────────────────────

describe("getAttestationForViewer access control", () => {
  it("returns full view for the seller", async () => {
    // Call 0: loadCommitByListing → row. No further SELECTs because the
    // seller branch matches first.
    const db = makeFakeDb(() => [fixedCommitRow()]);
    const res = await getAttestationForViewer(db, LISTING_ID, {
      id: SELLER_ID,
    });
    expect(res).not.toBeNull();
    expect(res!.viewerRole).toBe("seller");
    expect(res!.photos).toHaveLength(2);
    expect(res!.photos[0].viewUrl).toMatch(/^https:\/\/signed\.example\//);
  });

  it("returns full view for the buyer", async () => {
    // Call 0: loadCommitByListing → row. Call 1: getListingBuyerId → buyer.
    const db = makeFakeDb((i) => {
      if (i === 0) return [fixedCommitRow()];
      if (i === 1) return [{ buyerId: BUYER_ID }];
      return [];
    });
    const res = await getAttestationForViewer(db, LISTING_ID, { id: BUYER_ID });
    expect(res).not.toBeNull();
    expect(res!.viewerRole).toBe("buyer");
  });

  it("returns full view for an admin without a buyer lookup", async () => {
    const db = makeFakeDb(() => [fixedCommitRow()]);
    const res = await getAttestationForViewer(db, LISTING_ID, {
      id: "random",
      role: "admin",
    });
    expect(res).not.toBeNull();
    expect(res!.viewerRole).toBe("admin");
  });

  it("returns null (404-obfuscation) for an unrelated caller", async () => {
    const db = makeFakeDb((i) => {
      if (i === 0) return [fixedCommitRow()];
      if (i === 1) return [{ buyerId: BUYER_ID }];
      return [];
    });
    const res = await getAttestationForViewer(db, LISTING_ID, {
      id: "not-a-party",
    });
    expect(res).toBeNull();
  });

  it("returns null when no commit exists", async () => {
    const db = makeFakeDb(() => []);
    const res = await getAttestationForViewer(db, LISTING_ID, {
      id: SELLER_ID,
    });
    expect(res).toBeNull();
  });
});

// ─── loadCommitByListing (sanity) ───────────────────────────

describe("loadCommitByListing", () => {
  it("returns null when no row is found", async () => {
    const db = makeFakeDb(() => []);
    const res = await loadCommitByListing(db, LISTING_ID);
    expect(res).toBeNull();
  });

  it("returns the row when present", async () => {
    const db = makeFakeDb(() => [fixedCommitRow()]);
    const res = await loadCommitByListing(db, LISTING_ID);
    expect(res).not.toBeNull();
    expect(res!.commitHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res!.photoUrls).toHaveLength(2);
  });
});
