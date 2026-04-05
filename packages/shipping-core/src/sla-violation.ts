import type { SlaCheckResult, SlaCompensation, SlaConfig } from "./types.js";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MAX_COMPENSATION_RATE = 0.2;

/**
 * Determine compensation rate based on days late.
 *
 * 1 day  -> 2 %
 * 2 days -> 5 %
 * 3+     -> 10 %
 */
function rateForDaysLate(daysLate: number): number {
  if (daysLate <= 0) return 0;
  if (daysLate === 1) return 0.02;
  if (daysLate === 2) return 0.05;
  return 0.1;
}

/**
 * Compute compensation for an SLA violation.
 *
 * @param days_late       Whole days past deadline (after grace).
 * @param transaction_amount_cents  Transaction value in cents.
 */
export function computeCompensation(
  days_late: number,
  transaction_amount_cents: number,
): SlaCompensation {
  if (days_late <= 0) {
    return { days_late: 0, rate: 0, amount_cents: 0, capped: false };
  }

  const rate = rateForDaysLate(days_late);
  const uncapped = Math.round(transaction_amount_cents * rate);
  const cap = Math.round(transaction_amount_cents * MAX_COMPENSATION_RATE);
  const capped = uncapped > cap;
  const amount_cents = capped ? cap : uncapped;

  return {
    days_late,
    rate,
    amount_cents,
    capped,
  };
}

/**
 * Check the current SLA status given timestamps.
 *
 * @param config       SLA configuration.
 * @param shipped_at   ISO timestamp of shipment, or null if not yet shipped.
 * @param now          ISO timestamp representing "now".
 * @param approval_at  ISO timestamp when the transaction was approved (SLA clock start).
 */
export function checkSla(
  config: SlaConfig,
  shipped_at: string | null,
  now: string,
  approval_at: string,
): SlaCheckResult {
  const approvalMs = new Date(approval_at).getTime();
  const nowMs = new Date(now).getTime();

  const deadlineMs = approvalMs + config.sla_days * MS_PER_DAY;
  const graceEndMs = deadlineMs + config.grace_hours * MS_PER_HOUR;
  const hardDeadlineMs = approvalMs + config.hard_deadline_days * MS_PER_DAY;

  const elapsedMs = nowMs - approvalMs;
  const days_elapsed = elapsedMs / MS_PER_DAY;

  // --- Shipped before now? ---
  if (shipped_at !== null) {
    const shippedMs = new Date(shipped_at).getTime();
    if (shippedMs <= deadlineMs) {
      return {
        status: "FULFILLED",
        days_elapsed,
        days_late: 0,
        in_grace_period: false,
        compensation_rate: 0,
        compensation_cents: 0,
        can_cancel: false,
        auto_cancel: false,
      };
    }
  }

  // --- Past hard deadline -> auto-cancel ---
  if (nowMs >= hardDeadlineMs) {
    return {
      status: "CANCELLED",
      days_elapsed,
      days_late: Math.ceil((nowMs - deadlineMs) / MS_PER_DAY),
      in_grace_period: false,
      compensation_rate: 0,
      compensation_cents: 0,
      can_cancel: true,
      auto_cancel: true,
    };
  }

  // --- Past grace period -> violated ---
  if (nowMs > graceEndMs) {
    const daysLate = Math.ceil((nowMs - deadlineMs) / MS_PER_DAY);
    const rate = rateForDaysLate(daysLate);
    return {
      status: "VIOLATED",
      days_elapsed,
      days_late: daysLate,
      in_grace_period: false,
      compensation_rate: rate,
      compensation_cents: 0, // caller uses computeCompensation for exact amount
      can_cancel: true,
      auto_cancel: false,
    };
  }

  // --- Past deadline but within grace ---
  if (nowMs > deadlineMs) {
    return {
      status: "GRACE_PERIOD",
      days_elapsed,
      days_late: 0,
      in_grace_period: true,
      compensation_rate: 0,
      compensation_cents: 0,
      can_cancel: false,
      auto_cancel: false,
    };
  }

  // --- Active ---
  return {
    status: "ACTIVE",
    days_elapsed,
    days_late: 0,
    in_grace_period: false,
    compensation_rate: 0,
    compensation_cents: 0,
    can_cancel: false,
    auto_cancel: false,
  };
}
