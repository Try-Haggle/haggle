import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import { listDisputeEvidenceSimilarityReviews } from "../services/dispute-record.service.js";

function row(id: string, createdAt: string) {
  return {
    id,
    dispute_id: "33333333-3333-4333-8333-333333333333",
    uploaded_by: "buyer",
    content_type: "image/jpeg",
    file_size_bytes: 1234,
    storage_path: `private/${id}.jpg`,
    similarity_distance: 4,
    similarity_signals: {
      distances: { dhash: 4, ahash: 2, color: 5 },
      matched_signals: ["dhash_near"],
    },
    matched_upload_id: "44444444-4444-4444-8444-444444444444",
    matched_storage_path: "private/reference.jpg",
    expires_at: "2026-07-13T00:00:00.000Z",
    created_at: createdAt,
  };
}

describe("dispute image similarity review queue", () => {
  it("returns an oldest-first opaque cursor page", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue([
        row("11111111-1111-4111-8111-111111111111", "2026-07-12T00:00:00.000Z"),
        row("22222222-2222-4222-8222-222222222222", "2026-07-12T00:01:00.000Z"),
      ]);
    const result = await listDisputeEvidenceSimilarityReviews({ execute } as unknown as Database, {
      limit: 1,
      now: new Date("2026-07-12T01:00:00.000Z"),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      waitingAgeSeconds: 3600,
      dueInSeconds: 82_800,
      matchedUploadId: "44444444-4444-4444-8444-444444444444",
      matchedStoragePath: "private/reference.jpg",
    });
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it("rejects malformed cursors before querying", async () => {
    const execute = vi.fn();
    await expect(
      listDisputeEvidenceSimilarityReviews({ execute } as unknown as Database, {
        cursor: "broken",
      }),
    ).rejects.toThrow("INVALID_SIMILARITY_REVIEW_CURSOR");
    expect(execute).not.toHaveBeenCalled();
  });
});
