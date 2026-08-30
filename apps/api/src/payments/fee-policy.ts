export const HAGGLE_X402_FEE_BPS_ENV = "HAGGLE_X402_FEE_BPS";
export const DEFAULT_HAGGLE_FEE_BPS = 150;
export const MAX_HAGGLE_FEE_BPS = 1000;

export function readFeeBpsFromEnv(envName: string, fallbackBps: number): number {
  const raw = process.env[envName];
  const bps = raw === undefined ? fallbackBps : Number(raw);
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_HAGGLE_FEE_BPS) {
    throw new Error(`${envName} must be 0-${MAX_HAGGLE_FEE_BPS}, got ${raw ?? bps}`);
  }
  return bps;
}

export function readHaggleFeeBpsFromEnv(): number {
  return readFeeBpsFromEnv(HAGGLE_X402_FEE_BPS_ENV, DEFAULT_HAGGLE_FEE_BPS);
}

/** Card/onramp is percent-only. Do not add a Stripe-style $0.30. */
export const STRIPE_ONRAMP_FIXED_FEE_MINOR = 0;

export function calculateStripeOnrampFeeMinor(amountMinor: number, feeBps: number): number {
  return calculateFeeMinor(amountMinor, feeBps) + STRIPE_ONRAMP_FIXED_FEE_MINOR;
}

export function calculateFeeMinor(amountMinor: number, feeBps: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`amount_minor must be a non-negative integer, got ${amountMinor}`);
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_HAGGLE_FEE_BPS) {
    throw new Error(`feeBps must be 0-${MAX_HAGGLE_FEE_BPS}, got ${feeBps}`);
  }
  return Math.floor((amountMinor * feeBps) / 10_000);
}

export function calculateSellerFeeSplit(
  amountMinor: number,
  feeBps: number,
): { sellerAmountMinor: number; feeAmountMinor: number } {
  if (amountMinor <= 0) {
    throw new Error(`amount_minor must be positive, got ${amountMinor}`);
  }
  const feeAmountMinor = calculateFeeMinor(amountMinor, feeBps);
  return {
    sellerAmountMinor: amountMinor - feeAmountMinor,
    feeAmountMinor,
  };
}
