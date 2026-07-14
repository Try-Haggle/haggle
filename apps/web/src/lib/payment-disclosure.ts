import { PAYMENT_DISCLOSURE_TEXT_HASH, PAYMENT_DISCLOSURE_VERSION } from "@haggle/shared";

export {
  PAYMENT_DISCLOSURE_TEXT,
  PAYMENT_DISCLOSURE_TEXT_HASH,
  PAYMENT_DISCLOSURE_VERSION,
} from "@haggle/shared";

export function createPaymentDisclosureAck(options: { stripeFallback?: boolean } = {}) {
  return {
    version: PAYMENT_DISCLOSURE_VERSION,
    text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
    accepted_at: new Date().toISOString(),
    no_custody: true,
    buyer_approved_rules: true,
    stripe_fallback: Boolean(options.stripeFallback),
    stablecoin_not_investment: true,
  };
}
