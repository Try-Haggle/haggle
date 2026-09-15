import { SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA, SOFT_AGREEMENT_ACK_VERSION } from "@haggle/shared";

/** Buyer UI-only Soft → Hard attestation. Never mint from MCP/tools. */
export function createSoftAgreementAck(termsHash: string) {
  return {
    version: SOFT_AGREEMENT_ACK_VERSION,
    source: SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA,
    terms_hash: termsHash,
    attested_at: new Date().toISOString(),
  };
}
