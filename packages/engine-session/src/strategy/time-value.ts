import { computeCounterOffer } from '@haggle/engine-core';

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TimeValueWindow = {
  listedAtMs: number;
  deadlineAtMs: number;
  totalMs: number;
  elapsedMs: number;
  remainingMs: number;
  progress: number;
};

export type TimeCurvePriceInput = {
  startPrice: number;
  limitPrice: number;
  listedAtMs: number;
  deadlineAtMs: number;
  nowMs?: number;
  beta: number;
};

export function buildTimeValueWindow(input: {
  listedAtMs?: number | null;
  deadlineAtMs?: number | null;
  nowMs?: number;
  fallbackTotalMs?: number;
}): TimeValueWindow {
  const nowMs = input.nowMs ?? Date.now();
  const listedAtMs = Number.isFinite(input.listedAtMs) ? Number(input.listedAtMs) : nowMs;
  const fallbackTotalMs = Math.max(1, input.fallbackTotalMs ?? DEFAULT_WINDOW_MS);
  const rawDeadlineAtMs = Number.isFinite(input.deadlineAtMs)
    ? Number(input.deadlineAtMs)
    : listedAtMs + fallbackTotalMs;
  const deadlineAtMs = Math.max(listedAtMs + 1, rawDeadlineAtMs);
  const totalMs = Math.max(1, deadlineAtMs - listedAtMs);
  const elapsedMs = Math.min(totalMs, Math.max(0, nowMs - listedAtMs));
  const remainingMs = Math.max(0, deadlineAtMs - nowMs);

  return {
    listedAtMs,
    deadlineAtMs,
    totalMs,
    elapsedMs,
    remainingMs,
    progress: elapsedMs / totalMs,
  };
}

export function computeTimeCurvePrice(input: TimeCurvePriceInput): number {
  const window = buildTimeValueWindow({
    listedAtMs: input.listedAtMs,
    deadlineAtMs: input.deadlineAtMs,
    nowMs: input.nowMs,
  });

  return computeCounterOffer({
    p_start: input.startPrice,
    p_limit: input.limitPrice,
    t: window.elapsedMs,
    T: window.totalMs,
    beta: input.beta,
  });
}
