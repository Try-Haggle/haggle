import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getShipmentApvRetentionAlertFixtureReadiness } from "../services/shipment-apv-retention-alert-fixture.service.js";

vi.unmock("@haggle/db");

describe("shipment APV retention alert fixture readiness", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  afterEach(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
    delete process.env.ENABLE_CRON;
    delete process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB;
  });

  it("reports a ready non-production fixture without mutating the database", async () => {
    process.env.NODE_ENV = "test";
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ status: "SUCCEEDED" }])
      .mockResolvedValueOnce([{ active: false }]);
    const result = await getShipmentApvRetentionAlertFixtureReadiness({
      execute,
    } as unknown as Database);
    expect(result).toMatchObject({
      eligible: true,
      status: "ready",
      reasons: [],
      singleton: { status: "SUCCEEDED" },
      executionLease: { available: true },
      schemaVersion: "shipment-apv-fixture-readiness-v1",
      validForSeconds: 5,
    });
    expect(result.stateFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(execute).toHaveBeenCalledTimes(2);
    const dialect = new PgDialect();
    const statements = execute.mock.calls.map(([statement]) =>
      dialect.sqlToQuery(statement).sql.trim().toLowerCase(),
    );
    expect(statements).toHaveLength(2);
    expect(statements.every((statement) => statement.startsWith("select"))).toBe(true);
    expect(statements.join(" ")).not.toMatch(/\b(insert|update|delete|truncate|alter|drop)\b/);
    const repeatExecute = vi
      .fn()
      .mockResolvedValueOnce([{ status: "SUCCEEDED" }])
      .mockResolvedValueOnce([{ active: false }]);
    const repeated = await getShipmentApvRetentionAlertFixtureReadiness({
      execute: repeatExecute,
    } as unknown as Database);
    expect(repeated.stateFingerprint).toBe(result.stateFingerprint);
    expect(repeated.recordedAt).toBeTruthy();
  });

  it("returns all allowlisted blockers without identifiers", async () => {
    process.env.NODE_ENV = "test";
    process.env.VERCEL_ENV = "production";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB = "true";
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ status: "RUNNING" }])
      .mockResolvedValueOnce([{ active: true }]);
    const result = await getShipmentApvRetentionAlertFixtureReadiness({
      execute,
    } as unknown as Database);
    expect(result).toMatchObject({
      eligible: false,
      status: "blocked",
      reasons: [
        "production_runtime",
        "retention_job_active",
        "retention_state_running",
        "fixture_lease_active",
      ],
      singleton: { status: "RUNNING" },
      executionLease: { available: false },
    });
    expect(result.stateFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/claim|leaseId|expiresAt|owner/i);
  });

  it("distinguishes a missing singleton from a running singleton", async () => {
    process.env.NODE_ENV = "test";
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ active: false }]);
    await expect(
      getShipmentApvRetentionAlertFixtureReadiness({ execute } as unknown as Database),
    ).resolves.toMatchObject({
      eligible: false,
      reasons: ["retention_state_missing"],
      singleton: { status: "MISSING" },
    });
  });

  it("changes the diagnostic fingerprint when a public readiness input changes", async () => {
    process.env.NODE_ENV = "test";
    const ready = await getShipmentApvRetentionAlertFixtureReadiness({
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ status: "SUCCEEDED" }])
        .mockResolvedValueOnce([{ active: false }]),
    } as unknown as Database);
    const busy = await getShipmentApvRetentionAlertFixtureReadiness({
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ status: "RUNNING" }])
        .mockResolvedValueOnce([{ active: false }]),
    } as unknown as Database);
    expect(busy.stateFingerprint).not.toBe(ready.stateFingerprint);
    expect(busy.reasons).toEqual(["retention_state_running"]);
  });
});
