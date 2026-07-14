import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { createShipmentApvFailureAlertPayloadOutbox } from
  "../services/shipment-apv-chaos-failure-alert-payload.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T12:30:00.000Z");
const checker = "66666666-6666-4666-8666-666666666666";
const grantId = "22222222-2222-4222-8222-222222222222";
const clientOutboxId = "11111111-1111-4111-8111-111111111111";
const fingerprint = "39bd711222a81681011ab563de9792d57d1fe98f509c2675b6285be528ab0b8b";
const payload = {
  schema_version: "shipment-apv-failure-alert-payload-v1",
  event_type: "shipment_apv_failure_alert",
  action: "review_warning",
  severity: "warning",
  reasons: ["rollback_verification_warning"],
  state_fingerprint: fingerprint,
};
const canonical = JSON.stringify({ action: payload.action, event_type: payload.event_type,
  reasons: payload.reasons, schema_version: payload.schema_version,
  severity: payload.severity, state_fingerprint: payload.state_fingerprint });
const sha256 = createHash("sha256").update(canonical).digest("hex");

const warningHealthRows = [{
  stage: "rollback_verification", failure_count: "1",
  first_failure_at: "2026-07-13T10:00:00.000Z",
  warning_observed_at: "2026-07-13T10:00:00.000Z",
  critical_observed_at: null,
  last_failure_at: "2026-07-13T10:05:00.000Z",
  retained_first_failure_at: "2026-07-13T10:00:00.000Z",
  retained_warning_observed_at: "2026-07-13T10:00:00.000Z",
  retained_critical_observed_at: null,
  retained_latest_bucket_start: "2026-07-13T10:00:00.000Z",
  retained_last_failure_at: "2026-07-13T10:05:00.000Z",
}];

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    grant_id: grantId,
    grant_status: "GRANTED_DRY_RUN",
    granted_by: checker,
    state_fingerprint: fingerprint,
    cooldown_expires_at: "2026-07-13T12:45:00.000Z",
    preview_action: "review_warning",
    preview_severity: "warning",
    preview_reasons: ["rollback_verification_warning"],
    outbox_id: null,
    client_outbox_id: null,
    outbox_payload: null,
    payload_sha256: null,
    outbox_status: null,
    created_by: null,
    outbox_created_at: null,
    ...overrides,
  };
}

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    client_outbox_id: clientOutboxId,
    delivery_grant_id: grantId,
    state_fingerprint: fingerprint,
    payload,
    payload_sha256: sha256,
    status: "UNSIGNED_DRY_RUN",
    created_by: checker,
    created_at: now.toISOString(),
    inserted: true,
    ...overrides,
  };
}

const input = { deliveryGrantId: grantId, clientOutboxId, createdBy: checker, now };

describe("shipment APV failure alert unsigned payload outbox", () => {
  it("stores a deterministic identifier-free payload and hash without signing or delivery", async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce(warningHealthRows)
      .mockResolvedValueOnce([outboxRow()]);
    const result = await createShipmentApvFailureAlertPayloadOutbox(
      { execute } as unknown as Pick<Database, "execute">, input);
    expect(result).toMatchObject({ status: "UNSIGNED_DRY_RUN", payload,
      payloadSha256: sha256, replayed: false, signed: false, signature: null,
      delivery: { enabled: false, attempted: false } });
    expect(JSON.stringify(result.payload)).not.toMatch(/user|request|actor|database|created_at/i);
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[3]![0]);
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_payload_outbox");
    expect(statement.params).toContain(sha256);
  });

  it("returns exact replay before binding and current-state lookup", async () => {
    const execute = vi.fn().mockResolvedValueOnce([outboxRow({ inserted: false })]);
    const result = await createShipmentApvFailureAlertPayloadOutbox(
      { execute } as unknown as Pick<Database, "execute">, input);
    expect(result).toMatchObject({ replayed: true, payloadSha256: sha256 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("requires the grant checker and an active cooldown", async () => {
    const actorExecute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()]);
    await expect(createShipmentApvFailureAlertPayloadOutbox(
      { execute: actorExecute } as unknown as Pick<Database, "execute">,
      { ...input, createdBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_ACTOR_MISMATCH");

    const expiredExecute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      bindingRow({ cooldown_expires_at: "2026-07-13T12:29:59.999Z" }),
    ]);
    await expect(createShipmentApvFailureAlertPayloadOutbox(
      { execute: expiredExecute } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_EXPIRED");
  });

  it("rejects changed current state before the outbox insert", async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()]).mockResolvedValueOnce([]);
    await expect(createShipmentApvFailureAlertPayloadOutbox(
      { execute } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("blocks a second client id for a grant that already has an outbox", async () => {
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      bindingRow({ outbox_id: "33333333-3333-4333-8333-333333333333",
        client_outbox_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        outbox_payload: payload, payload_sha256: sha256,
        outbox_status: "UNSIGNED_DRY_RUN", created_by: checker,
        outbox_created_at: now.toISOString() }),
    ]);
    await expect(createShipmentApvFailureAlertPayloadOutbox(
      { execute } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_ALREADY_CREATED");
  });

  it("fails closed when a client outbox id is rebound", async () => {
    const execute = vi.fn().mockResolvedValueOnce([outboxRow({
      created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", inserted: false,
    })]);
    await expect(createShipmentApvFailureAlertPayloadOutbox(
      { execute } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_REPLAY_CONFLICT");
  });
});
