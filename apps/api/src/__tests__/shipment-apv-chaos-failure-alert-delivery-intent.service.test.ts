import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createShipmentApvFailureAlertDeliveryIntent } from "../services/shipment-apv-chaos-failure-alert-delivery-intent.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T12:30:00.000Z");
const checker = "66666666-6666-4666-8666-666666666666";
const signatureId = "55555555-5555-4555-8555-555555555555";
const outboxId = "33333333-3333-4333-8333-333333333333";
const clientIntentId = "11111111-1111-4111-8111-111111111111";
const intentId = "77777777-7777-4777-8777-777777777777";
const fingerprint = "39bd711222a81681011ab563de9792d57d1fe98f509c2675b6285be528ab0b8b";
const payloadSha256 = "c".repeat(64);
const keyId = "a".repeat(24);
const blockingReasons = [
  "independent_trust_anchor_missing",
  "receiver_endpoint_missing",
  "receiver_credential_missing",
];

const warningHealthRows = [
  {
    stage: "rollback_verification",
    failure_count: "1",
    first_failure_at: "2026-07-13T10:00:00.000Z",
    warning_observed_at: "2026-07-13T10:00:00.000Z",
    critical_observed_at: null,
    last_failure_at: "2026-07-13T10:05:00.000Z",
    retained_first_failure_at: "2026-07-13T10:00:00.000Z",
    retained_warning_observed_at: "2026-07-13T10:00:00.000Z",
    retained_critical_observed_at: null,
    retained_latest_bucket_start: "2026-07-13T10:00:00.000Z",
    retained_last_failure_at: "2026-07-13T10:05:00.000Z",
  },
];

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    signature_id: signatureId,
    payload_outbox_id: outboxId,
    payload_sha256: payloadSha256,
    key_id: keyId,
    signed_by: checker,
    state_fingerprint: fingerprint,
    cooldown_expires_at: "2026-07-13T12:45:00.000Z",
    key_event_type: "REGISTERED",
    intent_id: null,
    client_delivery_intent_id: null,
    intent_status: null,
    blocking_reasons: null,
    http_request_created: null,
    delivery_attempted: null,
    requested_by: null,
    intent_created_at: null,
    ...overrides,
  };
}

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: intentId,
    client_delivery_intent_id: clientIntentId,
    payload_signature_id: signatureId,
    payload_outbox_id: outboxId,
    payload_sha256: payloadSha256,
    key_id: keyId,
    status: "BLOCKED_CONFIGURATION_DRY_RUN",
    blocking_reasons: blockingReasons,
    http_request_created: false,
    delivery_attempted: false,
    requested_by: checker,
    created_at: now.toISOString(),
    inserted: true,
    ...overrides,
  };
}

const input = {
  payloadSignatureId: signatureId,
  clientDeliveryIntentId: clientIntentId,
  requestedBy: checker,
  now,
};

describe("shipment APV failure alert blocked delivery intents", () => {
  it("appends a persistent non-executable intent with fixed blockers", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce(warningHealthRows)
      .mockResolvedValueOnce([intentRow()]);
    const result = await createShipmentApvFailureAlertDeliveryIntent(
      { execute } as unknown as Pick<Database, "execute">,
      input,
    );
    expect(result).toMatchObject({
      status: "BLOCKED_CONFIGURATION_DRY_RUN",
      blockingReasons,
      persistent: true,
      executable: false,
      replayed: false,
      http: { requestCreated: false },
      delivery: { enabled: false, attempted: false },
    });
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[3]![0]);
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_delivery_intents",
    );
  });

  it("returns exact replay before live binding and state checks", async () => {
    const execute = vi.fn().mockResolvedValueOnce([intentRow({ inserted: false })]);
    const result = await createShipmentApvFailureAlertDeliveryIntent(
      { execute } as unknown as Pick<Database, "execute">,
      input,
    );
    expect(result).toMatchObject({ replayed: true, status: "BLOCKED_CONFIGURATION_DRY_RUN" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("requires the signature actor, active cooldown, and active registry key", async () => {
    const actorExecute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([bindingRow()]);
    await expect(
      createShipmentApvFailureAlertDeliveryIntent(
        { execute: actorExecute } as unknown as Pick<Database, "execute">,
        { ...input, requestedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_ACTOR_MISMATCH");

    const expiredExecute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow({ cooldown_expires_at: "2026-07-13T12:29:59.999Z" })]);
    await expect(
      createShipmentApvFailureAlertDeliveryIntent(
        { execute: expiredExecute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_EXPIRED");

    const retiredExecute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow({ key_event_type: "RETIRED" })]);
    await expect(
      createShipmentApvFailureAlertDeliveryIntent(
        { execute: retiredExecute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_NOT_ACTIVE");
  });

  it("rejects a changed current state before storing an intent", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce([]);
    await expect(
      createShipmentApvFailureAlertDeliveryIntent(
        { execute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
  });

  it("rejects a second client id for an already planned signature", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        bindingRow({
          intent_id: intentId,
          client_delivery_intent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          intent_status: "BLOCKED_CONFIGURATION_DRY_RUN",
          blocking_reasons: blockingReasons,
          http_request_created: false,
          delivery_attempted: false,
          requested_by: checker,
          intent_created_at: now.toISOString(),
        }),
      ]);
    await expect(
      createShipmentApvFailureAlertDeliveryIntent(
        { execute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_ALREADY_CREATED");
  });

  it("fails closed when a client intent id is rebound", async () => {
    const execute = vi.fn().mockResolvedValueOnce([
      intentRow({
        requested_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        inserted: false,
      }),
    ]);
    await expect(
      createShipmentApvFailureAlertDeliveryIntent(
        { execute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_REPLAY_CONFLICT");
  });
});
