import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disputeSimilarityReviewExpiryPolicy,
  expireDisputeSimilarityReviews,
  listDisputeSimilarityReviewExpiryEvents,
} from "../services/dispute-similarity-review-expiry.service.js";

describe("dispute similarity review automatic expiry", () => {
  afterEach(() => {
    delete process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB;
    delete process.env.DISPUTE_SIMILARITY_REVIEW_EXPIRY_BATCH_SIZE;
  });

  it("uses bounded disabled-by-default policy", () => {
    expect(disputeSimilarityReviewExpiryPolicy()).toEqual({ enabled: false, batchSize: 50 });
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB = "true";
    process.env.DISPUTE_SIMILARITY_REVIEW_EXPIRY_BATCH_SIZE = "500";
    expect(disputeSimilarityReviewExpiryPolicy()).toEqual({ enabled: true, batchSize: 500 });
    process.env.DISPUTE_SIMILARITY_REVIEW_EXPIRY_BATCH_SIZE = "501";
    expect(disputeSimilarityReviewExpiryPolicy().batchSize).toBe(50);
  });

  it("rejects invalid batch size before querying", async () => {
    const execute = vi.fn();
    await expect(
      expireDisputeSimilarityReviews({ execute } as unknown as Database, { batchSize: 0 }),
    ).rejects.toThrow("INVALID_SIMILARITY_REVIEW_EXPIRY_BATCH_SIZE");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns the number of atomic update-plus-event transitions", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        {
          uploadId: "11111111-1111-4111-8111-111111111111",
          disputeId: "33333333-3333-4333-8333-333333333333",
          expiresAt: "2026-07-11T23:59:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);
    const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => unknown) =>
      callback({ execute }),
    );
    const result = await expireDisputeSimilarityReviews({ transaction } as unknown as Database, {
      now: new Date("2026-07-12T00:00:00.000Z"),
      batchSize: 50,
    });
    expect(result).toEqual({ expired: 1, recordedAt: "2026-07-12T00:00:00.000Z" });
    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns a newest-first opaque cursor page with safe event fields", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        upload_id: "22222222-2222-4222-8222-222222222222",
        dispute_id: "33333333-3333-4333-8333-333333333333",
        event_type: "AUTO_EXPIRED",
        actor_id: null,
        metadata: {
          reason: "REVIEW_WINDOW_EXPIRED",
          review_expires_at: "2026-07-12T00:00:00.000Z",
          hidden: "do-not-return",
        },
        created_at: "2026-07-12T00:01:00.000Z",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        upload_id: "55555555-5555-4555-8555-555555555555",
        dispute_id: "66666666-6666-4666-8666-666666666666",
        event_type: "AUTO_EXPIRED",
        actor_id: null,
        metadata: {},
        created_at: "2026-07-12T00:00:00.000Z",
      },
    ]);
    const result = await listDisputeSimilarityReviewExpiryEvents(
      { execute } as unknown as Database,
      { limit: 1 },
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        eventId: "11111111-1111-4111-8111-111111111111",
        actorKind: "system",
        reason: "REVIEW_WINDOW_EXPIRED",
        reviewExpiresAt: "2026-07-12T00:00:00.000Z",
      }),
    ]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("rejects a malformed event cursor before querying", async () => {
    const execute = vi.fn();
    await expect(
      listDisputeSimilarityReviewExpiryEvents({ execute } as unknown as Database, {
        cursor: "broken",
      }),
    ).rejects.toThrow("INVALID_SIMILARITY_REVIEW_EXPIRY_CURSOR");
    expect(execute).not.toHaveBeenCalled();
  });
});
