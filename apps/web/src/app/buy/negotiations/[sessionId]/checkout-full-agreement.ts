export type CheckoutAgreementAddressKind = "delivery" | "pickup" | "none";

export interface CheckoutAgreementCriterion {
  check_id: string;
  label: string;
  seller_value: string | null;
  buyer_stance: string | null;
}

export interface CheckoutAgreementDisplay {
  price_minor: number;
  currency: string;
  fulfillment_type: string;
  fulfillment_summary: string;
  address: {
    kind: CheckoutAgreementAddressKind;
    lines: string[];
  };
  shipping_cost_minor: number | null;
  fees: {
    haggle_fee_bps: number;
    card_buyer_total_bps: number;
    item_minor: number;
    shipping_minor: number;
    haggle_fee_minor: number;
    card_fee_minor: number;
    buyer_pays_wallet_minor: number;
    buyer_pays_card_minor: number;
  };
  criteria: CheckoutAgreementCriterion[];
  terms_hash: string;
}

/** SoT §1 + §3: every required block rendered before 이대로 결제 may enable. */
export function isFullAgreementRenderable(
  display: CheckoutAgreementDisplay | null | undefined,
): boolean {
  if (!display) return false;
  if (!(display.price_minor > 0) || !display.currency) return false;
  if (!display.fulfillment_type || !display.fulfillment_summary) return false;
  if (
    !display.address?.kind ||
    !Array.isArray(display.address.lines) ||
    display.address.lines.length === 0
  ) {
    return false;
  }
  if (display.address.kind === "delivery") {
    const joined = display.address.lines.join(" ");
    if (/Address missing/i.test(joined)) return false;
  }
  if (!display.fees || display.fees.item_minor <= 0) return false;
  if (!Array.isArray(display.criteria)) return false;
  if (!display.terms_hash?.startsWith("sha256:")) return false;
  return true;
}
