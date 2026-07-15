import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateShipmentApvChaosFailurePolicy,
  getShipmentApvChaosFailureHealth,
  recordShipmentApvChaosFailure,
} from "../services/shipment-apv-chaos-failure-metric.service.js";

vi.unmock("@haggle/db");

describe("shipment APV chaos failure metrics", () => {
  it("records one bounded hourly stage bucket", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await recordShipmentApvChaosFailure({ execute } as unknown as Pick<Database, "execute">, {
      stage: "rollback_verification",
      now: new Date("2026-07-13T12:34:56.000Z"),
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects an unknown stage before touching the database", async () => {
    const execute = vi.fn();
    await expect(
      recordShipmentApvChaosFailure({ execute } as unknown as Pick<Database, "execute">, {
        stage: "secret_database_stage" as never,
      }),
    ).rejects.toThrow("INVALID_SHIPMENT_APV_CHAOS_FAILURE_STAGE");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns a fixed identifier-free 24 hour stage aggregate", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        stage: "rollback_verification",
        failure_count: "3",
        first_failure_at: "2026-07-13T10:00:00.000Z",
        warning_observed_at: "2026-07-13T10:00:00.000Z",
        critical_observed_at: "2026-07-13T11:00:00.000Z",
        last_failure_at: "2026-07-13T11:00:00.000Z",
        retained_latest_bucket_start: "2026-07-13T11:00:00.000Z",
        retained_last_failure_at: "2026-07-13T11:00:00.000Z",
      },
      {
        stage: "fixture_execution",
        failure_count: "2147483648",
        first_failure_at: "2026-07-13T12:00:00.000Z",
        warning_observed_at: "2026-07-13T12:00:00.000Z",
        critical_observed_at: "2026-07-13T12:00:00.000Z",
        last_failure_at: "2026-07-13T12:00:00.000Z",
        retained_latest_bucket_start: "2026-07-13T12:00:00.000Z",
        retained_last_failure_at: "2026-07-13T12:00:00.000Z",
      },
      {
        stage: "secret_database_stage",
        failure_count: "99",
        last_failure_at: "2026-07-13T13:00:00.000Z",
      },
    ]);
    await expect(
      getShipmentApvChaosFailureHealth(
        { execute } as unknown as Pick<Database, "execute">,
        new Date("2026-07-13T12:30:00.000Z"),
      ),
    ).resolves.toEqual({
      status: "critical",
      windowHours: 24,
      retentionDays: 30,
      total: 2_147_483_647,
      stages: {
        rollback_verification: { count: 3, lastFailureAt: "2026-07-13T11:00:00.000Z" },
        rollback_failure_isolation: { count: 0, lastFailureAt: null },
        fixture_execution: { count: 2_147_483_647, lastFailureAt: "2026-07-13T12:00:00.000Z" },
      },
      policy: {
        version: "shipment-apv-chaos-failure-policy-v1",
        reasons: ["rollback_verification_critical", "fixture_execution_critical"],
        thresholds: {
          rollback_verification: { warning: 1, critical: 3 },
          rollback_failure_isolation: { warning: 1, critical: 3 },
          fixture_execution: { warning: 3, critical: 10 },
        },
      },
      lifecycle: {
        phase: "active",
        firstObservedAt: "2026-07-13T10:00:00.000Z",
        warningObservedAt: "2026-07-13T10:00:00.000Z",
        criticalObservedAt: "2026-07-13T11:00:00.000Z",
        recoveredAt: null,
        lastFailureAt: "2026-07-13T12:00:00.000Z",
      },
      lastFailureAt: "2026-07-13T12:00:00.000Z",
      recordedAt: "2026-07-13T12:30:00.000Z",
    });
  });

  it("uses fixed warning and critical boundaries per stage", () => {
    const evaluate = (rollback: number, isolation: number, execution: number) =>
      evaluateShipmentApvChaosFailurePolicy({
        rollback_verification: rollback,
        rollback_failure_isolation: isolation,
        fixture_execution: execution,
      });
    expect(evaluate(0, 0, 0)).toMatchObject({ status: "healthy", reasons: [] });
    expect(evaluate(1, 0, 0)).toMatchObject({
      status: "warning",
      reasons: ["rollback_verification_warning"],
    });
    expect(evaluate(3, 0, 0)).toMatchObject({
      status: "critical",
      reasons: ["rollback_verification_critical"],
    });
    expect(evaluate(0, 0, 2)).toMatchObject({ status: "healthy", reasons: [] });
    expect(evaluate(0, 0, 3)).toMatchObject({
      status: "warning",
      reasons: ["fixture_execution_warning"],
    });
    expect(evaluate(0, 0, 10)).toMatchObject({
      status: "critical",
      reasons: ["fixture_execution_critical"],
    });
    expect(evaluate(0, 0, 0).version).toBe("shipment-apv-chaos-failure-policy-v1");
  });

  it("derives a recovered lifecycle from the latest retained hourly bucket", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        stage: "rollback_verification",
        failure_count: "0",
        first_failure_at: null,
        warning_observed_at: null,
        critical_observed_at: null,
        last_failure_at: null,
        retained_first_failure_at: "2026-07-12T12:01:00.000Z",
        retained_warning_observed_at: "2026-07-12T12:01:00.000Z",
        retained_critical_observed_at: null,
        retained_latest_bucket_start: "2026-07-12T12:00:00.000Z",
        retained_last_failure_at: "2026-07-12T12:05:00.000Z",
      },
    ]);
    const health = await getShipmentApvChaosFailureHealth(
      { execute } as unknown as Pick<Database, "execute">,
      new Date("2026-07-13T12:30:00.000Z"),
    );
    expect(health).toMatchObject({
      status: "healthy",
      total: 0,
      lifecycle: {
        phase: "recovered",
        firstObservedAt: "2026-07-12T12:01:00.000Z",
        warningObservedAt: "2026-07-12T12:01:00.000Z",
        criticalObservedAt: null,
        recoveredAt: "2026-07-13T12:00:00.000Z",
        lastFailureAt: "2026-07-12T12:05:00.000Z",
      },
    });
  });

  it("returns a clear lifecycle when no retained bucket exists", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const health = await getShipmentApvChaosFailureHealth(
      { execute } as unknown as Pick<Database, "execute">,
      new Date("2026-07-13T12:30:00.000Z"),
    );
    expect(health).toMatchObject({
      status: "healthy",
      total: 0,
      lifecycle: {
        phase: "clear",
        firstObservedAt: null,
        warningObservedAt: null,
        criticalObservedAt: null,
        recoveredAt: null,
        lastFailureAt: null,
      },
    });
  });

  it("derives lifecycle health with one read-only statement", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await getShipmentApvChaosFailureHealth(
      { execute } as unknown as Pick<Database, "execute">,
      new Date("2026-07-13T12:30:00.000Z"),
    );
    expect(execute).toHaveBeenCalledOnce();
    const statement = new PgDialect()
      .sqlToQuery(execute.mock.calls[0]![0])
      .sql.trim()
      .toLowerCase();
    expect(statement).toMatch(/^select\b/);
    expect(statement).not.toMatch(/\b(insert|update|delete|truncate|alter|drop)\b/);
  });
});
