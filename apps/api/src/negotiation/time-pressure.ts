import type { CoreMemory } from "./types.js";

export function computeSessionTimePressure(
  session: CoreMemory["session"],
  nowMs: number = Date.now(),
): number {
  const createdAtMs = finitePositive(session.created_at_ms);
  const deadlineAtMs = finitePositive(session.deadline_at_ms);

  if (createdAtMs && deadlineAtMs && deadlineAtMs > createdAtMs) {
    return clamp01((nowMs - createdAtMs) / (deadlineAtMs - createdAtMs));
  }

  const maxDurationMs = finitePositive(session.max_duration_ms);
  if (createdAtMs && maxDurationMs) {
    return clamp01((nowMs - createdAtMs) / maxDurationMs);
  }

  return session.max_rounds > 0
    ? clamp01(1 - session.rounds_remaining / session.max_rounds)
    : 0;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
