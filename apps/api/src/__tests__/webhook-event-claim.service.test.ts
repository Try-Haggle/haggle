import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import {
  claimWebhookEvent,
  cleanupWebhookChaosTestClaims,
  completeWebhookEvent,
  expireWebhookClaimForChaosTest,
  failWebhookEvent,
  getWebhookClaimHealth,
  releaseWebhookFailureBackoffForChaosTest,
  renewWebhookEventClaim,
  webhookPayloadSha256,
} from "../services/webhook-event-claim.service.js";

function fakeDb(...results: unknown[]) {
  return {
    execute: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? [])),
  } as unknown as Database;
}

describe("webhook event claims", () => {
  it("hashes the exact signed payload bytes", () => {
    expect(webhookPayloadSha256(Buffer.from("signed-body"))).toMatch(/^[0-9a-f]{64}$/);
    expect(webhookPayloadSha256(Buffer.from("signed-body"))).not.toBe(
      webhookPayloadSha256(Buffer.from("changed-body")),
    );
  });

  it("summarizes provider claim health without exposing event payloads", async () => {
    const db = fakeDb([
      {
        source: "easypost",
        processing: "2",
        completed: "8",
        failed: "1",
        stale_processing: "1",
        retry_ready: "1",
        max_attempt_count: "3",
        oldest_unfinished_age_seconds: "91.4",
      },
      {
        source: "stripe",
        processing: "0",
        completed: "4",
        failed: "0",
        stale_processing: "0",
        retry_ready: "0",
        max_attempt_count: "1",
        oldest_unfinished_age_seconds: null,
      },
    ]);
    await expect(getWebhookClaimHealth(db)).resolves.toMatchObject({
      status: "critical",
      totals: { processing: 2, completed: 12, failed: 1, staleProcessing: 1, retryReady: 1 },
      sources: [
        { source: "easypost", maxAttemptCount: 3, oldestUnfinishedAgeSeconds: 91 },
        { source: "stripe", oldestUnfinishedAgeSeconds: null },
      ],
    });
  });

  it("returns an acquired lease from the atomic upsert", async () => {
    const db = fakeDb([
      {
        claimId: "11111111-1111-4111-8111-111111111111",
        attemptCount: 2,
        leaseExpiresAt: new Date("2026-07-12T00:01:00.000Z"),
      },
    ]);
    await expect(
      claimWebhookEvent(db, {
        source: "stripe",
        eventId: "evt_1",
        payloadSha256: "a".repeat(64),
      }),
    ).resolves.toMatchObject({ outcome: "acquired", attemptCount: 2 });
  });

  it("distinguishes completed duplicates from in-progress work", async () => {
    const duplicateDb = fakeDb(
      [],
      [{ status: "COMPLETED", payloadSha256: "a".repeat(64), nextAttemptAt: null }],
    );
    await expect(
      claimWebhookEvent(duplicateDb, {
        source: "x402",
        eventId: "evt_done",
        payloadSha256: "a".repeat(64),
      }),
    ).resolves.toMatchObject({ outcome: "duplicate" });

    const busyDb = fakeDb(
      [],
      [{ status: "PROCESSING", payloadSha256: "a".repeat(64), nextAttemptAt: null }],
    );
    await expect(
      claimWebhookEvent(busyDb, {
        source: "x402",
        eventId: "evt_busy",
        payloadSha256: "a".repeat(64),
      }),
    ).resolves.toMatchObject({ outcome: "in_progress" });
  });

  it("returns a bounded retry delay for failed work still in backoff", async () => {
    const retryDb = fakeDb(
      [],
      [
        {
          status: "FAILED",
          payloadSha256: "a".repeat(64),
          nextAttemptAt: new Date(Date.now() + 7_000),
        },
      ],
    );
    const result = await claimWebhookEvent(retryDb, {
      source: "x402",
      eventId: "evt_retry",
      payloadSha256: "a".repeat(64),
    });
    expect(result).toMatchObject({ outcome: "retry_later" });
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(300);
  });

  it("rejects the same provider event id with different signed bytes", async () => {
    const db = fakeDb(
      [],
      [{ status: "COMPLETED", payloadSha256: "b".repeat(64), nextAttemptAt: null }],
    );
    await expect(
      claimWebhookEvent(db, {
        source: "easypost",
        eventId: "evt_changed",
        payloadSha256: "a".repeat(64),
      }),
    ).resolves.toMatchObject({ outcome: "payload_conflict" });
  });

  it("completes and fails only through the claim token", async () => {
    const claim = {
      outcome: "acquired" as const,
      source: "stripe",
      eventId: "evt_terminal",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    };
    const completeDb = fakeDb([{ id: "row" }]);
    await expect(completeWebhookEvent(completeDb, claim, 200)).resolves.toBe(true);
    const failDb = fakeDb([]);
    await expect(failWebhookEvent(failDb, claim)).resolves.toBeUndefined();
    expect(
      (failDb as unknown as { execute: ReturnType<typeof vi.fn> }).execute,
    ).toHaveBeenCalledOnce();
  });

  it("renews only the current processing claim", async () => {
    const claim = {
      outcome: "acquired" as const,
      source: "easypost",
      eventId: "evt_renew",
      claimId: "11111111-1111-4111-8111-111111111111",
    };
    await expect(renewWebhookEventClaim(fakeDb([{ id: "row" }]), claim)).resolves.toBe(true);
    await expect(renewWebhookEventClaim(fakeDb([]), claim)).resolves.toBe(false);
  });

  it("fails closed when a stale claim tries to seal success", async () => {
    const claim = {
      outcome: "acquired" as const,
      source: "stripe",
      eventId: "evt_lost",
      claimId: "11111111-1111-4111-8111-111111111111",
    };
    await expect(completeWebhookEvent(fakeDb([]), claim, 200)).rejects.toThrow(
      "WEBHOOK_CLAIM_LOST",
    );
  });

  it("limits destructive chaos helpers to isolated test rows", async () => {
    const db = fakeDb();
    await expect(expireWebhookClaimForChaosTest(db, "stripe", "evt_1")).rejects.toThrow(
      "WEBHOOK_CHAOS_SOURCE_REQUIRED",
    );
    await expect(releaseWebhookFailureBackoffForChaosTest(db, "easypost", "evt_1")).rejects.toThrow(
      "WEBHOOK_CHAOS_SOURCE_REQUIRED",
    );
    await expect(
      cleanupWebhookChaosTestClaims(db, "haggle-chaos-test", "chaos_unscoped_"),
    ).rejects.toThrow("INVALID_WEBHOOK_CHAOS_PREFIX");
    expect((db as unknown as { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled();
  });
});
