import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import {
  type ConditionalSettlementPreflightConfig,
  type ConditionalSettlementPreflightResult,
  runConditionalSettlementPreflight,
  validateConditionalSettlementPreflightConfig,
} from "../services/conditional-settlement-preflight.service.js";
import {
  assertConditionalSettlementPreflightAlertTimingSafe,
  CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SOURCE,
  type ConditionalSettlementPreflightAlertConfig,
  type ConditionalSettlementPreflightAlertSnapshot,
  evaluateConditionalSettlementPreflightAlert,
  findLatestDeliveredConditionalSettlementPreflightIncident,
  resolveConditionalSettlementPreflightAlertConfigFromEnv,
  sendConditionalSettlementPreflightAlert,
} from "../services/conditional-settlement-preflight-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  webhookPayloadSha256,
} from "../services/webhook-event-claim.service.js";

const NON_ZERO_ADDRESS = /^0x(?!0{40}$)[0-9a-fA-F]{40}$/;

function fullConfigBlockers(probeBlockers: string[]): string[] {
  return [
    ...new Set([
      ...(process.env.HAGGLE_X402_MODE === "real" ? [] : ["x402_real_mode"]),
      ...probeBlockers,
      ...(NON_ZERO_ADDRESS.test(process.env.HAGGLE_X402_FEE_WALLET ?? "")
        ? []
        : ["fee_wallet_address"]),
    ]),
  ].sort();
}

export async function collectConditionalSettlementPreflightAlertSnapshot(
  options: {
    runProbe?: (
      config: ConditionalSettlementPreflightConfig,
    ) => Promise<ConditionalSettlementPreflightResult>;
    now?: Date;
  } = {},
): Promise<ConditionalSettlementPreflightAlertSnapshot> {
  const network = process.env.HAGGLE_X402_NETWORK ?? "base-sepolia";
  const validation = validateConditionalSettlementPreflightConfig({
    network,
    rpcUrl: process.env.HAGGLE_BASE_RPC_URL,
    settlementAddress: process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
    usdcAddress: process.env.HAGGLE_X402_USDC_ASSET_ADDRESS,
    relayerPrivateKey: process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY,
    requireHttps: process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production",
  });
  const probeBlockers = validation.ok ? [] : validation.blockedBy;
  const configBlockedBy = fullConfigBlockers(probeBlockers);
  if (!validation.ok) {
    return {
      status: "blocked",
      ready: false,
      probe_skipped: true,
      config_blocked_by: configBlockedBy,
      checks: {
        rpc_reachable: false,
        chain_id_match: false,
        settlement_bytecode: false,
        usdc_bytecode: false,
        signer_matches: false,
        usdc_allowed: false,
      },
      blocked_by: [],
      expected_chain_id: network === "base" ? 8453 : 84532,
      observed_chain_id: null,
      settlement_bytecode_bytes: 0,
      usdc_bytecode_bytes: 0,
      error_code: null,
      checked_at: (options.now ?? new Date()).toISOString(),
      duration_ms: 0,
    };
  }
  const probe = await (options.runProbe ?? runConditionalSettlementPreflight)(validation.config);
  const ready = probe.ready && configBlockedBy.length === 0;
  return {
    ...probe,
    status: probe.status === "unavailable" ? "unavailable" : ready ? "ready" : "blocked",
    ready,
    probe_skipped: false,
    config_blocked_by: configBlockedBy,
  };
}

export async function runConditionalSettlementPreflightAlert(
  db: Database,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    config?: ConditionalSettlementPreflightAlertConfig;
    claimSource?: string;
    runProbe?: (
      config: ConditionalSettlementPreflightConfig,
    ) => Promise<ConditionalSettlementPreflightResult>;
    collectSnapshot?: (now: Date) => Promise<ConditionalSettlementPreflightAlertSnapshot>;
  } = {},
) {
  const config = options.config ?? resolveConditionalSettlementPreflightAlertConfigFromEnv();
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const };
  assertConditionalSettlementPreflightAlertTimingSafe(config.timeoutMs);
  const now = options.now ?? new Date();
  const claimSource = options.claimSource ?? CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SOURCE;
  const snapshot = options.collectSnapshot
    ? await options.collectSnapshot(now)
    : await collectConditionalSettlementPreflightAlertSnapshot({ runProbe: options.runProbe, now });
  const assessment = evaluateConditionalSettlementPreflightAlert(snapshot);

  if (!assessment.wouldAlert) {
    const incident = await findLatestDeliveredConditionalSettlementPreflightIncident(
      db,
      claimSource,
    );
    if (!incident)
      return {
        status: "skipped" as const,
        reason: "healthy_no_delivered_incident" as const,
        snapshot,
        assessment,
      };
    const recoveryKey = `recovered:${incident.eventId}`;
    const claim = await claimWebhookEvent(db, {
      source: claimSource,
      eventId: `recovery_${createHash("sha256").update(recoveryKey).digest("hex")}`,
      payloadSha256: webhookPayloadSha256(recoveryKey),
    });
    if (claim.outcome !== "acquired") {
      const reason =
        claim.outcome === "retry_later"
          ? ("recovery_retry_backoff" as const)
          : claim.outcome === "payload_conflict"
            ? ("recovery_claim_payload_conflict" as const)
            : ("recovery_already_sent_or_in_progress" as const);
      return { status: "skipped" as const, reason, snapshot, assessment };
    }
    const recovery = {
      wouldAlert: true,
      severity: "recovery" as const,
      reasons: ["conditional_settlement_preflight_recovered"],
    };
    try {
      const alert = await sendConditionalSettlementPreflightAlert(snapshot, recovery, {
        config,
        deliveryId: claim.eventId,
        fetchImpl: options.fetchImpl,
        now,
      });
      if (alert.status === "delivered") {
        await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
        return { status: "recovered" as const, snapshot, assessment: recovery, alert };
      }
      await failWebhookEvent(db, claim);
      return {
        status: "failed" as const,
        phase: "recovery" as const,
        snapshot,
        assessment: recovery,
        alert,
      };
    } catch (error) {
      await failWebhookEvent(db, claim);
      throw error;
    }
  }

  const bucket = Math.floor(now.getTime() / (config.cooldownMinutes * 60_000));
  const cooldownKey = `${assessment.severity}:${assessment.reasons.join(",")}:${bucket}`;
  const claim = await claimWebhookEvent(db, {
    source: claimSource,
    eventId: `health_${createHash("sha256").update(cooldownKey).digest("hex")}`,
    payloadSha256: webhookPayloadSha256(cooldownKey),
  });
  if (claim.outcome !== "acquired") {
    const reason =
      claim.outcome === "retry_later"
        ? ("delivery_retry_backoff" as const)
        : claim.outcome === "payload_conflict"
          ? ("delivery_claim_payload_conflict" as const)
          : ("cooldown_or_in_progress" as const);
    return { status: "skipped" as const, reason, snapshot, assessment };
  }
  try {
    const alert = await sendConditionalSettlementPreflightAlert(snapshot, assessment, {
      config,
      deliveryId: claim.eventId,
      fetchImpl: options.fetchImpl,
      now,
    });
    if (alert.status === "delivered") {
      await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
      return { status: "delivered" as const, snapshot, assessment, alert };
    }
    await failWebhookEvent(db, claim);
    return { status: "failed" as const, snapshot, assessment, alert };
  } catch (error) {
    await failWebhookEvent(db, claim);
    throw error;
  }
}
