import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateShipmentApvChaosFailureAlertPreview,
  getShipmentApvChaosFailureAlertPreview,
} from "../services/shipment-apv-chaos-failure-alert-preview.service.js";
import { evaluateShipmentApvChaosFailurePolicy } from "../services/shipment-apv-chaos-failure-metric.service.js";

vi.unmock("@haggle/db");

const now = "2026-07-13T12:30:00.000Z";

function health(input: {
  counts?: [number, number, number];
  phase?: "active" | "recovered" | "clear";
  warningAt?: string | null;
  criticalAt?: string | null;
}) {
  const counts = input.counts ?? [0, 0, 0];
  const policy = evaluateShipmentApvChaosFailurePolicy({
    rollback_verification: counts[0],
    rollback_failure_isolation: counts[1],
    fixture_execution: counts[2],
  });
  const phase = input.phase ?? (counts.some(Boolean) ? "active" : "clear");
  const firstObservedAt = phase === "clear" ? null : "2026-07-13T10:00:00.000Z";
  const lastFailureAt = phase === "clear" ? null : "2026-07-13T10:05:00.000Z";
  return {
    status: policy.status,
    windowHours: 24,
    retentionDays: 30,
    total: counts.reduce((sum, count) => sum + count, 0),
    stages: {
      rollback_verification: { count: counts[0], lastFailureAt },
      rollback_failure_isolation: { count: counts[1], lastFailureAt: null },
      fixture_execution: { count: counts[2], lastFailureAt: null },
    },
    policy: { version: policy.version, reasons: policy.reasons, thresholds: policy.thresholds },
    lifecycle: {
      phase,
      firstObservedAt,
      warningObservedAt: input.warningAt ?? null,
      criticalObservedAt: input.criticalAt ?? null,
      recoveredAt: phase === "recovered" ? "2026-07-13T12:00:00.000Z" : null,
      lastFailureAt,
    },
    lastFailureAt: phase === "active" ? lastFailureAt : null,
    recordedAt: now,
  } as const;
}

describe("shipment APV failure alert preview", () => {
  it("requires explicit review for an active warning without delivering", () => {
    const preview = evaluateShipmentApvChaosFailureAlertPreview(
      health({ counts: [1, 0, 0], warningAt: "2026-07-13T10:00:00.000Z" }),
    );
    expect(preview).toMatchObject({
      mode: "preview_only",
      action: "review_warning",
      severity: "warning",
      reasons: ["rollback_verification_warning"],
      approval: { required: true, state: "not_requested" },
      delivery: { enabled: false, attempted: false },
      cooldown: { windowMinutes: 15, scope: "state_fingerprint", enforced: false },
    });
  });

  it("separates critical escalation from warning review", () => {
    expect(
      evaluateShipmentApvChaosFailureAlertPreview(
        health({
          counts: [3, 0, 0],
          warningAt: "2026-07-13T10:00:00.000Z",
          criticalAt: "2026-07-13T10:02:00.000Z",
        }),
      ),
    ).toMatchObject({
      action: "escalate_critical",
      severity: "critical",
      reasons: ["rollback_verification_critical"],
    });
  });

  it("previews recovery only when a threshold was previously crossed", () => {
    const recovered = evaluateShipmentApvChaosFailureAlertPreview(
      health({
        phase: "recovered",
        warningAt: "2026-07-12T10:00:00.000Z",
        criticalAt: "2026-07-12T10:02:00.000Z",
      }),
    );
    expect(recovered).toMatchObject({
      action: "review_recovery",
      severity: "critical",
      reasons: ["recovered_from_critical"],
      approval: { required: true },
    });
    expect(
      evaluateShipmentApvChaosFailureAlertPreview(health({ phase: "recovered" })),
    ).toMatchObject({
      action: "none",
      severity: "healthy",
      approval: { required: false, state: "not_required" },
    });
  });

  it("returns a non-actionable preview for a clear or below-threshold active state", () => {
    expect(evaluateShipmentApvChaosFailureAlertPreview(health({ phase: "clear" }))).toMatchObject({
      action: "none",
      severity: "healthy",
      delivery: { attempted: false },
    });
    expect(
      evaluateShipmentApvChaosFailureAlertPreview(health({ counts: [0, 0, 1] })),
    ).toMatchObject({ action: "none", severity: "healthy" });
  });

  it("fails closed for an unsupported policy version or reason", () => {
    const unsupportedVersion = health({ counts: [1, 0, 0], warningAt: "2026-07-13T10:00:00.000Z" });
    const unsupportedReason = health({ counts: [1, 0, 0], warningAt: "2026-07-13T10:00:00.000Z" });
    expect(() =>
      evaluateShipmentApvChaosFailureAlertPreview({
        ...unsupportedVersion,
        policy: { ...unsupportedVersion.policy, version: "future-policy" },
      } as never),
    ).toThrow("SHIPMENT_APV_FAILURE_ALERT_PREVIEW_POLICY_UNAVAILABLE");
    expect(() =>
      evaluateShipmentApvChaosFailureAlertPreview({
        ...unsupportedReason,
        policy: { ...unsupportedReason.policy, reasons: ["unknown_reason"] },
      } as never),
    ).toThrow("SHIPMENT_APV_FAILURE_ALERT_PREVIEW_POLICY_UNAVAILABLE");
  });

  it("uses a deterministic identifier-free fingerprint that changes with public state", () => {
    const warning = evaluateShipmentApvChaosFailureAlertPreview(
      health({ counts: [1, 0, 0], warningAt: "2026-07-13T10:00:00.000Z" }),
    );
    const repeated = evaluateShipmentApvChaosFailureAlertPreview(
      health({ counts: [1, 0, 0], warningAt: "2026-07-13T10:00:00.000Z" }),
    );
    const critical = evaluateShipmentApvChaosFailureAlertPreview(
      health({
        counts: [3, 0, 0],
        warningAt: "2026-07-13T10:00:00.000Z",
        criticalAt: "2026-07-13T10:02:00.000Z",
      }),
    );
    expect(warning.stateFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(repeated.stateFingerprint).toBe(warning.stateFingerprint);
    expect(critical.stateFingerprint).not.toBe(warning.stateFingerprint);
    expect(JSON.stringify(warning)).not.toMatch(
      /"(?:user_id|request_id|failure_id|owner_id|lease_id|token)"/i,
    );
  });

  it("loads the preview with one read-only aggregate statement", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const preview = await getShipmentApvChaosFailureAlertPreview(
      { execute } as unknown as Pick<Database, "execute">,
      new Date(now),
    );
    expect(preview).toMatchObject({ action: "none", mode: "preview_only" });
    expect(execute).toHaveBeenCalledOnce();
    const statement = new PgDialect()
      .sqlToQuery(execute.mock.calls[0]![0])
      .sql.trim()
      .toLowerCase();
    expect(statement).toMatch(/^select\b/);
    expect(statement).not.toMatch(/\b(insert|update|delete|truncate|alter|drop)\b/);
  });
});
