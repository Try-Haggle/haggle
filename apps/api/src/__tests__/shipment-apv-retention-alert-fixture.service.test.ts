import { describe, expect, it } from "vitest";
import {
  verifyShipmentApvFixtureRollbackFailureIsolation,
  verifyShipmentApvRetentionAlertFixtureCleanupIsolation,
} from "../services/shipment-apv-retention-alert-fixture.service.js";

describe("shipment APV retention alert fixture cleanup", () => {
  it("continues cleanup after isolated failures and never masks a failed release", async () => {
    await expect(verifyShipmentApvRetentionAlertFixtureCleanupIsolation()).resolves.toEqual({
      pass: true,
      checks: {
        release_attempted_after_restore_failure: true,
        claims_attempted_after_restore_failure: true,
        release_attempted_after_claim_failure: true,
        release_failure_not_masked: true,
      },
    });
  });

  it("fails closed and continues rollback cleanup after injected database failures", async () => {
    await expect(verifyShipmentApvFixtureRollbackFailureIsolation()).resolves.toEqual({
      pass: true,
      checks: {
        cleanup_attempted_after_case_failure: true,
        case_failure_not_masked: true,
        remaining_checked_after_delete_failure: true,
        delete_failure_not_masked: true,
        read_failure_not_treated_as_zero: true,
        injected_errors_redacted: true,
      },
    });
  });
});
