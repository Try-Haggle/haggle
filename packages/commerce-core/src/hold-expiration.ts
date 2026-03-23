import type { HoldSnapshot } from "./approval-policy.js";

export interface HoldExpirationResult {
  expired: boolean;
  expires_at?: string;
  remaining_ms?: number;
}

export function checkHoldExpiration(
  hold: HoldSnapshot | undefined,
  now: string,
): HoldExpirationResult {
  if (!hold || !hold.expires_at) {
    return { expired: false };
  }

  const expiresAt = new Date(hold.expires_at).getTime();
  const nowTime = new Date(now).getTime();
  const remaining = expiresAt - nowTime;

  return {
    expired: remaining <= 0,
    expires_at: hold.expires_at,
    remaining_ms: Math.max(0, remaining),
  };
}
