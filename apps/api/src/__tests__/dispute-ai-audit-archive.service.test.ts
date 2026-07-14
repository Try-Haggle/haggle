import { generateKeyPairSync } from "node:crypto";
import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDisputeAiAssessmentEventHash,
  listDisputeAiAssessmentEvents,
} from "../services/dispute-ai-assessment-event.service.js";
import {
  type DisputeAiAuditArchiveRecord,
  deliverDisputeAiAuditArchive,
  enqueueDisputeAiAuditArchive,
  enqueuePendingDisputeAiAudits,
  getDisputeAiAuditArchiveCoverage,
  getDisputeAiAuditArchiveHealth,
  getDisputeAiAuditArchivePolicyStatus,
  getDisputeAiAuditDiscoveryFailureHealth,
  listDisputeAiAuditArchiveFailures,
  listDisputeAiAuditDiscoveryFailures,
  retryDisputeAiAuditDiscoveryFailure,
} from "../services/dispute-ai-audit-archive.service.js";

vi.mock("../services/dispute-ai-assessment-event.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/dispute-ai-assessment-event.service.js")>()),
  listDisputeAiAssessmentEvents: vi.fn(),
}));

const disputeId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-07-12T15:00:00.000Z");

function event() {
  const value = {
    id: "event-1",
    disputeId,
    eventType: "COMPLETED" as const,
    revision: 1,
    evidenceSnapshotHash: "evidence-1",
    policyVersion: "policy-1",
    model: "deepseek-v4-pro",
    contextHash: "context-1",
    requestedBy: "admin-1",
    forced: false,
    payload: { conclusion: "buyer_favor" },
    createdAt: "2026-07-12T14:59:00.000Z",
    previousEventHash: null,
    eventHash: null as string | null,
  };
  value.eventHash = buildDisputeAiAssessmentEventHash(value, null);
  return value;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    archive_key: `dai_${"a".repeat(64)}`,
    dispute_id: disputeId,
    event_count: 1,
    events_sha256: "b".repeat(64),
    chain_head_event_hash: event().eventHash,
    payload: { manifest: { event_count: 1 } },
    payload_sha256: "c".repeat(64),
    status: "PENDING",
    attempt_count: 0,
    next_attempt_at: now,
    lease_token: null,
    lease_expires_at: null,
    last_error: null,
    http_status: null,
    receipt_id: null,
    receipt_sha256: null,
    delivered_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("dispute AI audit archive", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.HAGGLE_AUDIT_ARCHIVE_URL;
    delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
  });

  it("rejects empty audit snapshots", async () => {
    vi.mocked(listDisputeAiAssessmentEvents).mockResolvedValueOnce([]);
    await expect(enqueueDisputeAiAuditArchive({} as Database, { disputeId })).rejects.toThrow(
      "AI_AUDIT_ARCHIVE_NO_EVENTS",
    );
  });

  it("rejects legacy events that were never hash-chain sealed", async () => {
    vi.mocked(listDisputeAiAssessmentEvents).mockResolvedValueOnce([
      { ...event(), eventHash: null },
    ] as any);
    await expect(enqueueDisputeAiAuditArchive({} as Database, { disputeId })).rejects.toThrow(
      "AI_AUDIT_CHAIN_UNSEALED",
    );
  });

  it("enqueues one signed snapshot and returns the same row on replay", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    vi.mocked(listDisputeAiAssessmentEvents).mockResolvedValue([event()] as any);
    const inserted = row();
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([inserted])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([inserted]),
    } as unknown as Database;
    const first = await enqueueDisputeAiAuditArchive(db, { disputeId, now, privateKey });
    const duplicate = await enqueueDisputeAiAuditArchive(db, { disputeId, now, privateKey });
    expect(first).toMatchObject({ outcome: "enqueued", archive: { disputeId, eventCount: 1 } });
    expect(duplicate).toMatchObject({ outcome: "duplicate", archive: { id: inserted.id } });
    expect(first.archive.archiveKey).toMatch(/^dai_[0-9a-f]{64}$/);
  });

  it("requires a matching bounded WORM receipt", async () => {
    const archive = {
      ...row(),
      archiveKey: `dai_${"a".repeat(64)}`,
      payloadSha256: "c".repeat(64),
    } as unknown as DisputeAiAuditArchiveRecord;
    const config = {
      url: "https://archive.example/audits",
      timeoutMs: 1000,
      maxAttempts: 3,
      allowInsecureHttp: false,
      allowPrivateNetwork: false,
    };
    const goodFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ receipt_id: "receipt-1", stored_sha256: archive.payloadSha256 }),
          { status: 201 },
        ),
      );
    await expect(
      deliverDisputeAiAuditArchive(archive, config, { fetchImpl: goodFetch }),
    ).resolves.toMatchObject({ status: "delivered", receiptSha256: archive.payloadSha256 });
    const mismatchFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ receipt_id: "receipt-2", stored_sha256: "0".repeat(64) }), {
        status: 201,
      }),
    );
    await expect(
      deliverDisputeAiAuditArchive(archive, config, { fetchImpl: mismatchFetch }),
    ).resolves.toMatchObject({ status: "failed", error: "ARCHIVE_RECEIPT_HASH_MISMATCH" });
  });

  it("rejects private archive targets and reports partial configuration", async () => {
    const archive = {
      ...row(),
      archiveKey: `dai_${"a".repeat(64)}`,
    } as unknown as DisputeAiAuditArchiveRecord;
    await expect(
      deliverDisputeAiAuditArchive(archive, {
        url: "https://127.0.0.1/audits",
        timeoutMs: 1000,
        maxAttempts: 3,
        allowInsecureHttp: false,
        allowPrivateNetwork: false,
      }),
    ).rejects.toThrow("private network");
    process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 = "configured";
    expect(getDisputeAiAuditArchivePolicyStatus()).toMatchObject({
      configurationState: "partial",
      jobEnabled: false,
    });
  });

  it("maps aggregate dead-letter health without leaking archive identifiers", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        pending: 0,
        processing: 0,
        failed: 0,
        dead_letter: 1,
        stale_processing: 0,
        retry_ready: 0,
        overdue_unfinished: 1,
        oldest_unfinished_age_seconds: 1200,
      },
    ]);
    const result = await getDisputeAiAuditArchiveHealth({ execute } as unknown as Database, now);
    expect(result).toMatchObject({
      status: "critical",
      deadLetter: 1,
      overdueUnfinished: 1,
      oldestUnfinishedAgeSeconds: 1200,
    });
    expect(JSON.stringify(result)).not.toContain(disputeId);
  });

  it("reports current snapshot coverage and blocked chains without identifiers", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        total_chains: 10,
        eligible_chains: 8,
        archived_current: 6,
        eligible_unarchived: 2,
        overdue_eligible_unarchived: 1,
        blocked_unsealed: 1,
        blocked_oversized: 1,
        oldest_unarchived_age_seconds: 1200,
      },
    ]);
    const result = await getDisputeAiAuditArchiveCoverage({ execute } as unknown as Database, now);
    expect(result).toMatchObject({
      status: "critical",
      totalChains: 10,
      archivedCurrent: 6,
      eligibleUnarchived: 2,
      coveragePercent: 75,
      blockedUnsealed: 1,
      blockedOversized: 1,
    });
    expect(JSON.stringify(result)).not.toContain(disputeId);
  });

  it("treats an empty eligible population as fully covered", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        total_chains: 0,
        eligible_chains: 0,
        archived_current: 0,
        eligible_unarchived: 0,
        overdue_eligible_unarchived: 0,
        blocked_unsealed: 0,
        blocked_oversized: 0,
        oldest_unarchived_age_seconds: null,
      },
    ]);
    await expect(
      getDisputeAiAuditArchiveCoverage({ execute } as unknown as Database, now),
    ).resolves.toMatchObject({
      status: "healthy",
      coveragePercent: 100,
      oldestUnarchivedAgeSeconds: null,
    });
  });

  it("returns payload-free cursor failures and rejects malformed cursors before DB", async () => {
    const failed = row({
      status: "DEAD_LETTER",
      attempt_count: 3,
      last_error: "receipt mismatch",
      http_status: 201,
    });
    const execute = vi
      .fn()
      .mockResolvedValue([failed, { ...failed, id: "44444444-4444-4444-8444-444444444444" }]);
    const result = await listDisputeAiAuditArchiveFailures({ execute } as unknown as Database, {
      limit: 1,
      now,
    });
    expect(result.items[0]).toMatchObject({ disputeId, status: "DEAD_LETTER", attemptCount: 3 });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain("archiveKey");
    expect(JSON.stringify(result)).not.toContain("manifest");
    const noQuery = vi.fn();
    await expect(
      listDisputeAiAuditArchiveFailures({ execute: noQuery } as unknown as Database, {
        cursor: "broken",
      }),
    ).rejects.toThrow("INVALID_AI_AUDIT_ARCHIVE_FAILURE_CURSOR");
    expect(noQuery).not.toHaveBeenCalled();
  });

  it("isolates a deterministic poison chain and continues with the next dispute", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 = privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64");
    const invalid = { ...event(), eventHash: "0".repeat(64) };
    vi.mocked(listDisputeAiAssessmentEvents)
      .mockResolvedValueOnce([invalid] as any)
      .mockResolvedValueOnce([event()] as any);
    const execute = vi.fn().mockResolvedValueOnce([
      { disputeId, eventCount: 1 },
      { disputeId: "33333333-3333-4333-8333-333333333333", eventCount: 1 },
    ]);
    const poisonTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ eligible: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const healthyTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ eligible: true }])
        .mockResolvedValueOnce([row({ dispute_id: "33333333-3333-4333-8333-333333333333" })])
        .mockResolvedValueOnce([]),
    };
    const transactions = [poisonTx, healthyTx];
    const db = {
      execute,
      transaction: vi.fn(async (callback: (tx: typeof poisonTx) => unknown) =>
        callback(transactions.shift()!),
      ),
    };
    await expect(
      enqueuePendingDisputeAiAudits(db as unknown as Database, { now }),
    ).resolves.toEqual({ discovered: 2, enqueued: 1, isolated: 1, contended: 0, stale: 0 });
    expect(execute).toHaveBeenCalledOnce();
    expect(poisonTx.execute).toHaveBeenCalledTimes(4);
    expect(healthyTx.execute).toHaveBeenCalledTimes(4);
  });

  it("skips a contended dispute and rechecks stale candidates without reading audit payloads", async () => {
    const execute = vi.fn().mockResolvedValueOnce([
      { disputeId, eventCount: 1 },
      { disputeId: "33333333-3333-4333-8333-333333333333", eventCount: 1 },
    ]);
    const contendedTx = { execute: vi.fn().mockResolvedValueOnce([{ acquired: false }]) };
    const staleTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ eligible: false }]),
    };
    const transactions = [contendedTx, staleTx];
    const db = {
      execute,
      transaction: vi.fn(async (callback: (tx: typeof contendedTx | typeof staleTx) => unknown) =>
        callback(transactions.shift()!),
      ),
    };
    await expect(
      enqueuePendingDisputeAiAudits(db as unknown as Database, { now }),
    ).resolves.toEqual({ discovered: 2, enqueued: 0, isolated: 0, contended: 1, stale: 1 });
    expect(listDisputeAiAssessmentEvents).not.toHaveBeenCalled();
  });

  it("scans past a contended head candidate to process an unlocked dispute within the work limit", async () => {
    const unlockedDisputeId = "33333333-3333-4333-8333-333333333333";
    const execute = vi.fn().mockResolvedValueOnce([
      { disputeId, eventCount: 1 },
      { disputeId: unlockedDisputeId, eventCount: 1 },
    ]);
    const contendedTx = { execute: vi.fn().mockResolvedValueOnce([{ acquired: false }]) };
    const healthyTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ eligible: true }])
        .mockResolvedValueOnce([row({ dispute_id: unlockedDisputeId })])
        .mockResolvedValueOnce([]),
    };
    const transactions = [contendedTx, healthyTx];
    const db = {
      execute,
      transaction: vi.fn(async (callback: (tx: typeof contendedTx | typeof healthyTx) => unknown) =>
        callback(transactions.shift()!),
      ),
    };
    const unlockedEvent = {
      ...event(),
      disputeId: unlockedDisputeId,
      eventHash: null as string | null,
    };
    unlockedEvent.eventHash = buildDisputeAiAssessmentEventHash(unlockedEvent, null);
    vi.mocked(listDisputeAiAssessmentEvents).mockResolvedValueOnce([unlockedEvent] as any);
    const { privateKey } = generateKeyPairSync("ed25519");
    await expect(
      enqueuePendingDisputeAiAudits(db as unknown as Database, { now, limit: 1, privateKey }),
    ).resolves.toEqual({ discovered: 2, enqueued: 1, isolated: 0, contended: 1, stale: 0 });
    expect(healthyTx.execute).toHaveBeenCalledTimes(4);
  });

  it("does not hide a global signing configuration failure as a per-dispute failure", async () => {
    delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
    vi.mocked(listDisputeAiAssessmentEvents).mockResolvedValueOnce([event()] as any);
    const execute = vi.fn().mockResolvedValueOnce([{ disputeId, eventCount: 1 }]);
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ eligible: true }]),
    };
    const db = {
      execute,
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    await expect(enqueuePendingDisputeAiAudits(db as unknown as Database, { now })).rejects.toThrow(
      "DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64",
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reports aggregate discovery failure health and payload-free queue rows", async () => {
    const healthDb = {
      execute: vi.fn().mockResolvedValue([
        {
          open: 1,
          retry_requested: 1,
          unresolved: 2,
          invalid_chain: 1,
          too_large: 1,
          unsealed: 0,
          resolved_last_24h: 3,
          oldest_open_age_seconds: 900,
        },
      ]),
    } as unknown as Database;
    await expect(getDisputeAiAuditDiscoveryFailureHealth(healthDb, now)).resolves.toMatchObject({
      status: "critical",
      open: 1,
      retryRequested: 1,
      unresolved: 2,
      invalidChain: 1,
      tooLarge: 1,
      resolvedLast24h: 3,
    });
    const failureRow = {
      id: "22222222-2222-4222-8222-222222222222",
      dispute_id: disputeId,
      event_count: 2,
      failure_code: "AI_AUDIT_CHAIN_INVALID",
      status: "OPEN",
      attempt_count: 1,
      first_failed_at: new Date(now.getTime() - 60_000),
      last_failed_at: now,
    };
    const listed = await listDisputeAiAuditDiscoveryFailures(
      { execute: vi.fn().mockResolvedValue([failureRow]) } as unknown as Database,
      { now },
    );
    expect(listed.items[0]).toMatchObject({
      disputeId,
      eventCount: 2,
      failureCode: "AI_AUDIT_CHAIN_INVALID",
      status: "OPEN",
      ageSeconds: 60,
    });
    expect(JSON.stringify(listed)).not.toContain("payload");
  });

  it("enables a retry and records the operator action in the same transaction", async () => {
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: "22222222-2222-4222-8222-222222222222",
            status: "OPEN",
            failure_code: "AI_AUDIT_CHAIN_INVALID",
            attempt_count: 1,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const db = {
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    } as unknown as Database;
    await expect(
      retryDisputeAiAuditDiscoveryFailure(db, {
        disputeId,
        eventCount: 2,
        actorId: "99999999-9999-4999-8999-999999999999",
        reason: "The repaired chain was independently verified.",
        now,
      }),
    ).resolves.toEqual({ outcome: "retry_enabled" });
    expect(tx.execute).toHaveBeenCalledTimes(3);
  });

  it("does not create a second operator action while a retry is already awaiting the worker", async () => {
    const tx = {
      execute: vi.fn().mockResolvedValueOnce([
        {
          id: "22222222-2222-4222-8222-222222222222",
          status: "RETRY_REQUESTED",
          failure_code: "AI_AUDIT_CHAIN_INVALID",
          attempt_count: 1,
        },
      ]),
    };
    const db = {
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    } as unknown as Database;
    await expect(
      retryDisputeAiAuditDiscoveryFailure(db, {
        disputeId,
        eventCount: 2,
        actorId: "99999999-9999-4999-8999-999999999999",
        reason: "The repaired chain was independently verified.",
        now,
      }),
    ).resolves.toEqual({ outcome: "retry_already_requested" });
    expect(tx.execute).toHaveBeenCalledOnce();
  });
});
