// Cost + time estimation for a planned run. PURE — no side effects.
// The numbers below are ASSUMPTIONS surfaced so a dry-run can show "what this
// will cost" before any money is spent. Tune them as real telemetry arrives.
import type { ScenarioCase } from "./types.js";

// Server hard cap on negotiation rounds (apps/api AUTO_PLAY_MAX_ROUNDS = 8).
// Each round is one DeepSeek call, so this is the max calls per negotiation.
export const MAX_ROUNDS_PER_NEGOTIATION = 8;

// Observed wall time for one full negotiation in Step 1 (~123s). Rough — real
// time varies with round count and API latency.
export const SECONDS_PER_NEGOTIATION = 125;

// USD per negotiation round. MEASURED from the DeepSeek dashboard (2026-07-17):
// one round ≈ $0.01 (V4 Pro reasoning model, ~2.4k tokens/round). Kept explicit
// so the dry-run never hides cost.
export const USD_PER_ROUND_CALL = 0.01;

export interface RunEstimate {
  cases: number;
  repeat: number;
  negotiations: number; // cases × repeat
  maxRoundCalls: number; // upper bound on DeepSeek calls
  estUsd: number; // upper-bound dollar estimate
  estSeconds: number; // sequential wall-time estimate
}

export function estimateRun(cases: ScenarioCase[], repeat: number): RunEstimate {
  const negotiations = cases.length * repeat;
  const maxRoundCalls = negotiations * MAX_ROUNDS_PER_NEGOTIATION;
  return {
    cases: cases.length,
    repeat,
    negotiations,
    maxRoundCalls,
    estUsd: maxRoundCalls * USD_PER_ROUND_CALL,
    estSeconds: negotiations * SECONDS_PER_NEGOTIATION,
  };
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
