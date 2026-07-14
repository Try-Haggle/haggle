import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createShipmentApvFailureAlertDeliveryGrant } from "../services/shipment-apv-chaos-failure-alert-delivery-grant.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T12:30:00.000Z");
const checker = "66666666-6666-4666-8666-666666666666";
const maker = "99999999-9999-4999-8999-999999999999";
const decisionId = "44444444-4444-4444-8444-444444444444";
const clientGrantId = "33333333-3333-4333-8333-333333333333";
const grantId = "22222222-2222-4222-8222-222222222222";
const fingerprint = "39bd711222a81681011ab563de9792d57d1fe98f509c2675b6285be528ab0b8b";

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
    decision_id: decisionId,
    decision: "APPROVED",
    decided_by: checker,
    state_fingerprint: fingerprint,
    requested_by: maker,
    request_expires_at: "2026-07-13T12:45:00.000Z",
    grant_id: null,
    client_grant_id: null,
    grant_status: null,
    granted_by: null,
    granted_at: null,
    cooldown_expires_at: null,
    ...overrides,
  };
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: grantId,
    client_grant_id: clientGrantId,
    approval_decision_id: decisionId,
    state_fingerprint: fingerprint,
    status: "GRANTED_DRY_RUN",
    granted_by: checker,
    granted_at: now.toISOString(),
    cooldown_expires_at: "2026-07-13T12:45:00.000Z",
    inserted: true,
    ...overrides,
  };
}

const input = { approvalDecisionId: decisionId, clientGrantId, grantedBy: checker, now, grantId };

describe("shipment APV failure alert dry-run delivery grants", () => {
  it("atomically claims cooldown and appends a non-delivering grant", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce(warningHealthRows)
      .mockResolvedValueOnce([grantRow()]);
    const result = await createShipmentApvFailureAlertDeliveryGrant(
      { execute } as unknown as Pick<Database, "execute">,
      input,
    );
    expect(result).toMatchObject({
      schemaVersion: "shipment-apv-failure-alert-delivery-grant-v1",
      status: "GRANTED_DRY_RUN",
      replayed: false,
      dryRun: true,
      payloadPrepared: false,
      signatureCreated: false,
      delivery: { enabled: false, attempted: false },
    });
    expect(execute).toHaveBeenCalledTimes(4);
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[3]![0]);
    expect(statement.sql.toLowerCase()).toContain("with claimed as");
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_cooldown_claims",
    );
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_delivery_grants",
    );
  });

  it("returns exact immutable replay before checking binding or current state", async () => {
    const execute = vi.fn().mockResolvedValueOnce([grantRow({ inserted: false })]);
    const result = await createShipmentApvFailureAlertDeliveryGrant(
      { execute } as unknown as Pick<Database, "execute">,
      input,
    );
    expect(result).toMatchObject({ replayed: true, status: "GRANTED_DRY_RUN" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("requires an approved decision and the original checker actor", async () => {
    const rejectedExecute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow({ decision: "REJECTED" })]);
    await expect(
      createShipmentApvFailureAlertDeliveryGrant(
        { execute: rejectedExecute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_DECISION_NOT_APPROVED");

    const actorExecute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([bindingRow()]);
    await expect(
      createShipmentApvFailureAlertDeliveryGrant(
        { execute: actorExecute } as unknown as Pick<Database, "execute">,
        { ...input, grantedBy: "11111111-1111-4111-8111-111111111111" },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_GRANT_ACTOR_MISMATCH");
  });

  it("rejects expired approval windows and changed current state", async () => {
    const expiredExecute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow({ request_expires_at: "2026-07-13T12:29:59.999Z" })]);
    await expect(
      createShipmentApvFailureAlertDeliveryGrant(
        { execute: expiredExecute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REQUEST_EXPIRED");

    const changedExecute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce([]);
    await expect(
      createShipmentApvFailureAlertDeliveryGrant(
        { execute: changedExecute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
  });

  it("returns a bounded cooldown conflict when another grant owns the fingerprint", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce(warningHealthRows)
      .mockResolvedValueOnce([]);
    await expect(
      createShipmentApvFailureAlertDeliveryGrant(
        { execute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_ACTIVE");
  });

  it("rejects a second client id for an already granted decision", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        bindingRow({
          grant_id: grantId,
          client_grant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          grant_status: "GRANTED_DRY_RUN",
          granted_by: checker,
          granted_at: now.toISOString(),
          cooldown_expires_at: "2026-07-13T12:45:00.000Z",
        }),
      ]);
    await expect(
      createShipmentApvFailureAlertDeliveryGrant(
        { execute } as unknown as Pick<Database, "execute">,
        input,
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_ALREADY_GRANTED");
  });

  it("recovers an exact replay after a concurrent unique violation", async () => {
    const unique = Object.assign(new Error("unique"), { code: "23505" });
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce(warningHealthRows)
      .mockRejectedValueOnce(unique)
      .mockResolvedValueOnce([grantRow({ inserted: false })]);
    const result = await createShipmentApvFailureAlertDeliveryGrant(
      { execute } as unknown as Pick<Database, "execute">,
      input,
    );
    expect(result).toMatchObject({ replayed: true, id: grantId });
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
