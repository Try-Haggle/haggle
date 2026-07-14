import { createHash, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { runConditionalSettlementPreflightAlert } from "../jobs/conditional-settlement-preflight-alert.js";
import type { ConditionalSettlementPreflightResult } from "./conditional-settlement-preflight.service.js";
import {
  claimVerifiedConditionalSettlementPreflightAlert,
  verifyConditionalSettlementPreflightAlert,
} from "./conditional-settlement-preflight-alert-verifier.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";
import { completeWebhookEvent } from "./webhook-event-claim.service.js";
import type { ConditionalSettlementPreflightAlertSnapshot } from "./conditional-settlement-preflight-alert.service.js";

const readyProbe: ConditionalSettlementPreflightResult = {
  status: "ready",
  ready: true,
  checks: { rpc_reachable: true, chain_id_match: true, settlement_bytecode: true,
    usdc_bytecode: true, signer_matches: true, usdc_allowed: true },
  blocked_by: [],
  expected_chain_id: 84532,
  observed_chain_id: 84532,
  settlement_bytecode_bytes: 4,
  usdc_bytecode_bytes: 4,
  error_code: null,
  checked_at: "2026-07-12T20:00:00.000Z",
  duration_ms: 1,
};

function snapshot(probe: ConditionalSettlementPreflightResult): ConditionalSettlementPreflightAlertSnapshot {
  return { ...probe, probe_skipped: false, config_blocked_by: [] };
}

export async function runConditionalSettlementPreflightAlertFixture(db: Database) {
  const fixtureId = randomUUID();
  const senderSource = `cycle83-preflight-alert-${fixtureId}`;
  const retrySenderSource = `${senderSource}-retry`;
  const concurrentSenderSource = `${senderSource}-concurrent`;
  const receiverSource = `${senderSource}-receiver`;
  const secret = "cycle83-preflight-alert-fixture-secret";
  const config = { url: "http://127.0.0.1:4177/mock-preflight-alert", secret,
    timeoutMs: 1000, cooldownMinutes: 15, allowInsecureHttp: true, allowPrivateNetwork: true };
  const states: string[] = [];
  const signatures: boolean[] = [];
  const receiverReplays: boolean[] = [];
  const capturedDeliveries: Array<{ rawBody: string; timestamp: string; deliveryId: string }> = [];
  let report: Record<string, unknown> | null = null;
  let cleanupCount = 0;
  let cleanupRemaining = -1;
  try {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const rawBody = String(init?.body ?? "");
      const timestamp = headers.get("x-haggle-alert-timestamp") ?? "";
      const deliveryId = headers.get("x-haggle-alert-delivery-id") ?? "";
      const verification = verifyConditionalSettlementPreflightAlert({
        rawBody,
        timestamp,
        signature: headers.get("x-haggle-alert-signature") ?? undefined,
        deliveryId,
        secret,
        nowMs: Date.parse(timestamp),
      });
      signatures.push(verification.ok);
      if (!verification.ok) return new Response("invalid", { status: 401 });
      const delivery = await claimVerifiedConditionalSettlementPreflightAlert(db, verification, receiverSource);
      if (delivery.outcome !== "accepted") return new Response("conflict", { status: 409 });
      if (!await completeWebhookEvent(db, delivery.claim, 202)) return new Response("incomplete", { status: 503 });
      const replay = await claimVerifiedConditionalSettlementPreflightAlert(db, verification, receiverSource);
      receiverReplays.push(replay.outcome === "replay_or_in_progress");
      const parsed = JSON.parse(rawBody) as { state?: string };
      states.push(String(parsed.state ?? ""));
      capturedDeliveries.push({ rawBody, timestamp, deliveryId });
      return new Response("accepted", { status: 202 });
    }) as typeof fetch;

    const runConcurrent = async (args: {
      source: string;
      now: Date;
      health: ConditionalSettlementPreflightAlertSnapshot;
    }) => {
      let releaseGate = () => {};
      const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
      let settledBeforeRelease = 0;
      let fetchCalls = 0;
      const gatedFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        fetchCalls += 1;
        await gate;
        return fetchImpl(url, init);
      }) as typeof fetch;
      const runs = Array.from({ length: 20 }, () => runConditionalSettlementPreflightAlert(db, {
        config, claimSource: args.source, now: args.now, fetchImpl: gatedFetch,
        collectSnapshot: async () => args.health,
      }));
      const markSettled = () => {
        settledBeforeRelease += 1;
        if (settledBeforeRelease >= 19) releaseGate();
      };
      for (const run of runs) {
        void run.then(markSettled, markSettled);
      }
      const safety = setTimeout(releaseGate, 5000);
      safety.unref();
      try {
        const results = await Promise.all(runs);
        return {
          delivered: results.filter((result) => result.status === "delivered" || result.status === "recovered").length,
          blocked: results.filter((result) => result.status === "skipped").length,
          fetchCalls,
        };
      } finally {
        clearTimeout(safety);
        releaseGate();
      }
    };

    const now = new Date();
    const blockedProbe = { ...readyProbe, status: "blocked" as const, ready: false,
      checks: { ...readyProbe.checks, signer_matches: false }, blocked_by: ["signer_matches"], checked_at: now.toISOString() };
    const firing = await runConditionalSettlementPreflightAlert(db, {
      config, claimSource: senderSource, fetchImpl, now, collectSnapshot: async () => snapshot(blockedProbe),
    });
    const duplicateFiring = await runConditionalSettlementPreflightAlert(db, {
      config, claimSource: senderSource, fetchImpl, now, collectSnapshot: async () => snapshot(blockedProbe),
    });
    const recoveryNow = new Date(now.getTime() + 1000);
    const recovery = await runConditionalSettlementPreflightAlert(db, {
      config, claimSource: senderSource, fetchImpl, now: recoveryNow,
      collectSnapshot: async () => snapshot({ ...readyProbe, checked_at: recoveryNow.toISOString() }),
    });
    const duplicateRecovery = await runConditionalSettlementPreflightAlert(db, {
      config, claimSource: senderSource, fetchImpl, now: new Date(recoveryNow.getTime() + 1),
      collectSnapshot: async () => snapshot({ ...readyProbe, checked_at: recoveryNow.toISOString() }),
    });

    const retryNow = new Date(recoveryNow.getTime() + 2000);
    const unavailableProbe = snapshot({ ...readyProbe, status: "unavailable", ready: false,
      checks: { rpc_reachable: false, chain_id_match: false, settlement_bytecode: false,
        usdc_bytecode: false, signer_matches: false, usdc_allowed: false },
      blocked_by: [], error_code: "RPC_TIMEOUT", checked_at: retryNow.toISOString() });
    const failedDelivery = await runConditionalSettlementPreflightAlert(db, {
      config, claimSource: retrySenderSource, now: retryNow,
      fetchImpl: (async () => new Response("fixture unavailable", { status: 503 })) as typeof fetch,
      collectSnapshot: async () => unavailableProbe,
    });
    const backoffRetry = await runConditionalSettlementPreflightAlert(db, {
      config, claimSource: retrySenderSource, now: retryNow, fetchImpl,
      collectSnapshot: async () => unavailableProbe,
    });
    const retryBucket = Math.floor(retryNow.getTime() / (config.cooldownMinutes * 60_000));
    const retryEventId = `health_${createHash("sha256").update(`critical:rpc_timeout:${retryBucket}`).digest("hex")}`;
    const released = await db.execute(sql`
      UPDATE webhook_idempotency SET next_attempt_at = now() - interval '1 second'
       WHERE source = ${retrySenderSource} AND idempotency_key = ${retryEventId} AND status = 'FAILED'
      RETURNING id
    `) as unknown as Array<{ id: string }>;
    const deliveredRetry = await runConditionalSettlementPreflightAlert(db, {
      config, claimSource: retrySenderSource, now: retryNow, fetchImpl,
      collectSnapshot: async () => unavailableProbe,
    });
    const retryAttemptRows = await db.execute(sql`
      SELECT attempt_count AS "attemptCount" FROM webhook_idempotency
       WHERE source = ${retrySenderSource} AND idempotency_key = ${retryEventId}
    `) as unknown as Array<{ attemptCount: number }>;
    const retryRecoveryNow = new Date(retryNow.getTime() + 1000);
    const retryRecovery = await runConditionalSettlementPreflightAlert(db, {
      config, claimSource: retrySenderSource, now: retryRecoveryNow, fetchImpl,
      collectSnapshot: async () => snapshot({ ...readyProbe, checked_at: retryRecoveryNow.toISOString() }),
    });
    const concurrentNow = new Date(retryRecoveryNow.getTime() + 2000);
    const chainMismatch = snapshot({ ...readyProbe, status: "blocked", ready: false,
      checks: { ...readyProbe.checks, chain_id_match: false }, blocked_by: ["chain_id_match"],
      observed_chain_id: 8453, checked_at: concurrentNow.toISOString() });
    const concurrentFiring = await runConcurrent({
      source: concurrentSenderSource, now: concurrentNow, health: chainMismatch,
    });
    const concurrentRecoveryNow = new Date(concurrentNow.getTime() + 1000);
    const concurrentRecovery = await runConcurrent({
      source: concurrentSenderSource,
      now: concurrentRecoveryNow,
      health: snapshot({ ...readyProbe, checked_at: concurrentRecoveryNow.toISOString() }),
    });

    let payloadConflict = false;
    const firstDelivery = capturedDeliveries[0];
    if (firstDelivery) {
      const parsed = JSON.parse(firstDelivery.rawBody) as Record<string, unknown>;
      parsed.reasons = ["fixture_changed_payload"];
      const changedBody = JSON.stringify(parsed);
      const changed = verifyConditionalSettlementPreflightAlert({
        rawBody: changedBody,
        timestamp: firstDelivery.timestamp,
        deliveryId: firstDelivery.deliveryId,
        signature: signWebhookClaimAlertPayload(secret, firstDelivery.timestamp, changedBody),
        secret,
        nowMs: Date.parse(firstDelivery.timestamp),
      });
      if (changed.ok) {
        payloadConflict = (await claimVerifiedConditionalSettlementPreflightAlert(db, changed, receiverSource)).outcome === "payload_conflict";
      }
    }
    const checks = {
      firing_delivered: firing.status === "delivered" && states[0] === "firing",
      sender_duplicate_blocked: duplicateFiring.status === "skipped" && duplicateFiring.reason === "cooldown_or_in_progress",
      recovery_delivered: recovery.status === "recovered" && states[1] === "recovered",
      duplicate_recovery_blocked: duplicateRecovery.status === "skipped"
        && duplicateRecovery.reason === "recovery_already_sent_or_in_progress",
      signatures_valid: signatures.length === 6 && signatures.every(Boolean),
      receiver_replay_blocked: receiverReplays.length === 6 && receiverReplays.every(Boolean),
      payload_conflict_isolated: payloadConflict,
      failed_delivery_recorded: failedDelivery.status === "failed",
      immediate_retry_respects_backoff: backoffRetry.status === "skipped" && backoffRetry.reason === "delivery_retry_backoff",
      fixture_backoff_release_scoped: released.length === 1,
      retry_attempt_delivered: deliveredRetry.status === "delivered" && retryAttemptRows[0]?.attemptCount === 2,
      retry_recovery_delivered: retryRecovery.status === "recovered",
      concurrent_firing_single_winner: concurrentFiring.delivered === 1
        && concurrentFiring.blocked === 19 && concurrentFiring.fetchCalls === 1,
      concurrent_recovery_single_winner: concurrentRecovery.delivered === 1
        && concurrentRecovery.blocked === 19 && concurrentRecovery.fetchCalls === 1,
      no_external_network: true,
    };
    report = {
      pass: false,
      checks,
      deliveries: { firing: states.filter((state) => state === "firing").length,
        recovery: states.filter((state) => state === "recovered").length },
      receiver: { verified: signatures.length, replay_blocked: receiverReplays.filter(Boolean).length,
        payload_conflict: payloadConflict },
      retry: { failed: failedDelivery.status === "failed", backoff_blocked: backoffRetry.reason === "delivery_retry_backoff",
        released: released.length, delivered: deliveredRetry.status === "delivered",
        attempt_count: retryAttemptRows[0]?.attemptCount ?? 0, recovered: retryRecovery.status === "recovered" },
      concurrency: { requests: 20, firing: concurrentFiring, recovery: concurrentRecovery },
      cleanup: { deleted: 0, remaining: -1 },
      recorded_at: new Date().toISOString(),
    };
  } finally {
    const deleted = await db.execute(sql`
      DELETE FROM webhook_idempotency
       WHERE source IN (${senderSource}, ${retrySenderSource}, ${concurrentSenderSource}, ${receiverSource}) RETURNING id
    `) as unknown as Array<{ id: string }>;
    cleanupCount = deleted.length;
    const remaining = await db.execute(sql`
      SELECT count(*)::int AS count FROM webhook_idempotency
       WHERE source IN (${senderSource}, ${retrySenderSource}, ${concurrentSenderSource}, ${receiverSource})
    `) as unknown as Array<{ count: number }>;
    cleanupRemaining = Number(remaining[0]?.count ?? -1);
  }
  if (!report) throw new Error("CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_FIXTURE_FAILED");
  const checks = report.checks as Record<string, boolean>;
  report.cleanup = { deleted: cleanupCount, remaining: cleanupRemaining };
  report.pass = Object.values(checks).every(Boolean) && cleanupCount === 12 && cleanupRemaining === 0;
  return report;
}
