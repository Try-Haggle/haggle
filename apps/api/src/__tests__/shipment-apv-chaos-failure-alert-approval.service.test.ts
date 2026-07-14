import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createShipmentApvFailureAlertApprovalRequest } from "../services/shipment-apv-chaos-failure-alert-approval.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T12:30:00.000Z");
const actor = "99999999-9999-4999-8999-999999999999";
const clientRequestId = "88888888-8888-4888-8888-888888888888";
const currentFingerprint = "39bd711222a81681011ab563de9792d57d1fe98f509c2675b6285be528ab0b8b";
const staleFingerprint = "a".repeat(64);

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

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    client_request_id: clientRequestId,
    state_fingerprint: currentFingerprint,
    preview_action: "review_warning",
    preview_severity: "warning",
    preview_reasons: ["rollback_verification_warning"],
    requested_by: actor,
    created_at: now.toISOString(),
    expires_at: "2026-07-13T12:45:00.000Z",
    inserted: true,
    ...overrides,
  };
}

describe("shipment APV failure alert approval requests", () => {
  it("creates one immutable pending request bound to the current public state", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(warningHealthRows)
      .mockResolvedValueOnce([requestRow()]);
    const result = await createShipmentApvFailureAlertApprovalRequest(
      { execute } as unknown as Pick<Database, "execute">,
      { clientRequestId, stateFingerprint: currentFingerprint, requestedBy: actor, now },
    );
    expect(result).toMatchObject({
      status: "PENDING",
      action: "review_warning",
      severity: "warning",
      replayed: false,
      expiresAt: "2026-07-13T12:45:00.000Z",
      delivery: { enabled: false, attempted: false },
    });
    expect(execute).toHaveBeenCalledTimes(3);
    const lookup = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(lookup.sql.trim().toLowerCase()).toMatch(/^select\b/);
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[2]![0]);
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_approval_requests",
    );
    expect(statement.params).toContain(actor);
  });

  it("rejects clear state and changed fingerprints before writing", async () => {
    const clearExecute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(
      createShipmentApvFailureAlertApprovalRequest(
        { execute: clearExecute } as unknown as Pick<Database, "execute">,
        { clientRequestId, stateFingerprint: staleFingerprint, requestedBy: actor, now },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_NOT_ACTIONABLE");
    expect(clearExecute).toHaveBeenCalledTimes(2);

    const changedExecute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(warningHealthRows);
    await expect(
      createShipmentApvFailureAlertApprovalRequest(
        { execute: changedExecute } as unknown as Pick<Database, "execute">,
        { clientRequestId, stateFingerprint: staleFingerprint, requestedBy: actor, now },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
    expect(changedExecute).toHaveBeenCalledTimes(2);
  });

  it("returns exact idempotent replay before consulting changed current state", async () => {
    const execute = vi.fn().mockResolvedValueOnce([requestRow({ inserted: false })]);
    const result = await createShipmentApvFailureAlertApprovalRequest(
      { execute } as unknown as Pick<Database, "execute">,
      {
        clientRequestId,
        stateFingerprint: currentFingerprint,
        requestedBy: actor,
        now,
      },
    );
    expect(result).toMatchObject({
      replayed: true,
      status: "PENDING",
      delivery: { enabled: false, attempted: false },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("fails closed when a client request id is reused with different binding", async () => {
    const execute = vi.fn().mockResolvedValueOnce([
      requestRow({
        requested_by: "11111111-1111-4111-8111-111111111111",
        inserted: false,
      }),
    ]);
    await expect(
      createShipmentApvFailureAlertApprovalRequest(
        { execute } as unknown as Pick<Database, "execute">,
        {
          clientRequestId,
          stateFingerprint: currentFingerprint,
          requestedBy: actor,
          now,
        },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REPLAY_CONFLICT");
  });

  it("derives expiry without mutating the append-only request", async () => {
    const execute = vi.fn().mockResolvedValueOnce([
      requestRow({
        created_at: "2026-07-13T12:10:00.000Z",
        expires_at: "2026-07-13T12:25:00.000Z",
        inserted: false,
      }),
    ]);
    const result = await createShipmentApvFailureAlertApprovalRequest(
      { execute } as unknown as Pick<Database, "execute">,
      {
        clientRequestId,
        stateFingerprint: currentFingerprint,
        requestedBy: actor,
        now,
      },
    );
    expect(result).toMatchObject({ status: "EXPIRED", replayed: true });
  });
});
