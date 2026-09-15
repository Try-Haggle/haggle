import { createHash } from "node:crypto";
import { type Database, eq, listingDrafts, listingsPublished } from "@haggle/db";
import {
  type CategoryCriterion,
  SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA,
  SOFT_AGREEMENT_ACK_VERSION,
} from "@haggle/shared";
import { buyerShippingAddressSchema } from "../lib/negotiation-fulfillment.js";
import { readSellerCriteriaFromSnapshot } from "../negotiation/phase/seller-criteria-pause.js";
import { calculateFeeMinor, DEFAULT_HAGGLE_FEE_BPS } from "../payments/fee-policy.js";
import {
  extractSellerProductFacts,
  extractSellerRequiredCriteria,
} from "./listing-strategy.service.js";
import { getSessionById } from "./negotiation-session.service.js";

/** Disclosed card-rail buyer total rate (Haggle 1.5% + Onramp 1.5%). */
export const DISCLOSED_CARD_BUYER_TOTAL_BPS = 300;

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

export interface SoftAgreementAck {
  version: string;
  source: string;
  terms_hash: string;
  attested_at: string;
}

function fulfillmentTypeFromSnapshot(snapshot: Record<string, unknown>): string {
  const value = snapshot.fulfillment_type;
  if (value === "shipped") return "physical_shipping";
  if (
    value === "physical_shipping" ||
    value === "local_pickup" ||
    value === "digital_delivery" ||
    value === "external_platform_transfer" ||
    value === "onchain_transfer"
  ) {
    return value;
  }
  return "physical_shipping";
}

function addressKindForFulfillment(fulfillmentType: string): CheckoutAgreementAddressKind {
  if (fulfillmentType === "local_pickup") return "pickup";
  if (
    fulfillmentType === "digital_delivery" ||
    fulfillmentType === "external_platform_transfer" ||
    fulfillmentType === "onchain_transfer"
  ) {
    return "none";
  }
  return "delivery";
}

function formatFullAddressLines(raw: unknown): string[] {
  const parsed = buyerShippingAddressSchema.safeParse(raw);
  if (!parsed.success) return [];
  const a = parsed.data;
  const lines: string[] = [];
  if (a.name.trim()) lines.push(a.name.trim());
  if (a.street1.trim()) lines.push(a.street1.trim());
  if (a.street2?.trim()) lines.push(a.street2.trim());
  const cityBit = [a.city.trim(), `${a.state.trim()} ${a.zip.trim()}`.trim()]
    .filter(Boolean)
    .join(", ");
  if (cityBit) lines.push(cityBit);
  if (a.country && a.country !== "US") lines.push(a.country);
  if (a.phone?.trim()) lines.push(a.phone.trim());
  return lines;
}

function fulfillmentSummary(fulfillmentType: string, snapshot: Record<string, unknown>): string {
  const method =
    typeof snapshot.fulfillment_method === "string" ? snapshot.fulfillment_method : undefined;
  const rateNote = typeof snapshot.rate_note === "string" ? snapshot.rate_note.trim() : "";
  if (fulfillmentType === "local_pickup") {
    return rateNote || "Local pickup";
  }
  if (
    fulfillmentType === "digital_delivery" ||
    fulfillmentType === "external_platform_transfer" ||
    fulfillmentType === "onchain_transfer"
  ) {
    return rateNote || "Digital / no shipment";
  }
  if (method === "carrier" || fulfillmentType === "physical_shipping") {
    return rateNote || "Carrier shipping";
  }
  return rateNote || fulfillmentType;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function hashCheckoutAgreementTerms(
  display: Omit<CheckoutAgreementDisplay, "terms_hash">,
): string {
  const payload = {
    price_minor: display.price_minor,
    currency: display.currency,
    fulfillment_type: display.fulfillment_type,
    fulfillment_summary: display.fulfillment_summary,
    address: display.address,
    shipping_cost_minor: display.shipping_cost_minor,
    fees: {
      haggle_fee_bps: display.fees.haggle_fee_bps,
      card_buyer_total_bps: display.fees.card_buyer_total_bps,
      item_minor: display.fees.item_minor,
      shipping_minor: display.fees.shipping_minor,
      haggle_fee_minor: display.fees.haggle_fee_minor,
      card_fee_minor: display.fees.card_fee_minor,
      buyer_pays_wallet_minor: display.fees.buyer_pays_wallet_minor,
      buyer_pays_card_minor: display.fees.buyer_pays_card_minor,
    },
    criteria: display.criteria.map((c) => ({
      check_id: c.check_id,
      label: c.label,
      seller_value: c.seller_value,
      buyer_stance: c.buyer_stance,
    })),
  };
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

function buildCriteriaRows(
  listingSnapshot: Record<string, unknown> | null,
  sessionSnapshot: Record<string, unknown> | null,
): CheckoutAgreementCriterion[] {
  const sellerFacts = listingSnapshot ? extractSellerProductFacts(listingSnapshot) : [];
  const sellerRequired = listingSnapshot ? extractSellerRequiredCriteria(listingSnapshot) : [];
  const { buyerCriteria, sellerRequired: pauseRequired } = sessionSnapshot
    ? readSellerCriteriaFromSnapshot(sessionSnapshot)
    : { buyerCriteria: [] as CategoryCriterion[], sellerRequired: [] as CategoryCriterion[] };

  const buyerById = new Map(
    buyerCriteria
      .filter((c) => typeof c.checkId === "string")
      .map((c) => [c.checkId, c.stance?.trim() || null] as const),
  );
  const factById = new Map(sellerFacts.map((f) => [f.checkId, f] as const));

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const list of [
    sellerFacts.map((f) => f.checkId),
    sellerRequired.map((r) => r.checkId),
    pauseRequired.map((r) => r.checkId),
    buyerCriteria.map((c) => c.checkId),
  ]) {
    for (const id of list) {
      if (!id || seen.has(id)) continue;
      // Include buyer-only ids only when they have a stance
      if (
        !factById.has(id) &&
        !sellerRequired.some((r) => r.checkId === id) &&
        !pauseRequired.some((r) => r.checkId === id)
      ) {
        if (!buyerById.get(id)) continue;
      }
      seen.add(id);
      orderedIds.push(id);
    }
  }

  return orderedIds.map((checkId) => {
    const fact = factById.get(checkId);
    const requiredAsk = sellerRequired.find((r) => r.checkId === checkId)?.ask;
    const pauseAsk = pauseRequired.find((r) => r.checkId === checkId);
    const label =
      fact?.label ?? requiredAsk ?? pauseAsk?.buyerAskKo ?? pauseAsk?.questionKo ?? checkId;
    return {
      check_id: checkId,
      label,
      seller_value: fact?.value ?? null,
      buyer_stance: buyerById.get(checkId) ?? null,
    };
  });
}

export function buildCheckoutAgreementDisplay(input: {
  finalAmountMinor: number;
  currency: string;
  termsSnapshot: Record<string, unknown>;
  listingSnapshot?: Record<string, unknown> | null;
  sessionSnapshot?: Record<string, unknown> | null;
}): CheckoutAgreementDisplay {
  const fulfillmentType = fulfillmentTypeFromSnapshot(input.termsSnapshot);
  const kind = addressKindForFulfillment(fulfillmentType);
  const addressLines =
    kind === "delivery" || kind === "pickup"
      ? formatFullAddressLines(input.termsSnapshot.buyer_shipping_address)
      : [];

  const shippingRaw = input.termsSnapshot.shipping_cost_minor;
  const shippingCostMinor =
    typeof shippingRaw === "number" && Number.isInteger(shippingRaw) && shippingRaw >= 0
      ? shippingRaw
      : typeof shippingRaw === "string" && /^\d+$/.test(shippingRaw)
        ? Number(shippingRaw)
        : null;

  const itemMinor = input.finalAmountMinor;
  const shippingMinor = shippingCostMinor ?? 0;
  const haggleFeeMinor = calculateFeeMinor(itemMinor, DEFAULT_HAGGLE_FEE_BPS);
  const cardFeeMinor = calculateFeeMinor(itemMinor, DISCLOSED_CARD_BUYER_TOTAL_BPS);

  const withoutHash: Omit<CheckoutAgreementDisplay, "terms_hash"> = {
    price_minor: itemMinor,
    currency: input.currency,
    fulfillment_type: fulfillmentType,
    fulfillment_summary: fulfillmentSummary(fulfillmentType, input.termsSnapshot),
    address: {
      kind,
      lines:
        kind === "none"
          ? ["N/A"]
          : addressLines.length > 0
            ? addressLines
            : kind === "pickup"
              ? ["Pickup location to be confirmed"]
              : ["Address missing from Soft agreement"],
    },
    shipping_cost_minor: shippingCostMinor,
    fees: {
      haggle_fee_bps: DEFAULT_HAGGLE_FEE_BPS,
      card_buyer_total_bps: DISCLOSED_CARD_BUYER_TOTAL_BPS,
      item_minor: itemMinor,
      shipping_minor: shippingMinor,
      haggle_fee_minor: haggleFeeMinor,
      card_fee_minor: cardFeeMinor,
      buyer_pays_wallet_minor: itemMinor + shippingMinor + haggleFeeMinor,
      buyer_pays_card_minor: itemMinor + shippingMinor + cardFeeMinor,
    },
    criteria: buildCriteriaRows(input.listingSnapshot ?? null, input.sessionSnapshot ?? null),
  };

  return {
    ...withoutHash,
    terms_hash: hashCheckoutAgreementTerms(withoutHash),
  };
}

export function isCheckoutAgreementRenderable(display: CheckoutAgreementDisplay): boolean {
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

export function getSoftAgreementAckError(
  ack: SoftAgreementAck | null | undefined,
  expectedTermsHash: string | null,
): string | null {
  if (!ack) return "soft agreement acknowledgement is required";
  if (ack.version !== SOFT_AGREEMENT_ACK_VERSION) return "soft agreement version is not supported";
  if (ack.source !== SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA) {
    return "soft agreement source must be buyer_ui_cta (tool/MCP attest is not allowed)";
  }
  if (!ack.terms_hash?.startsWith("sha256:")) {
    return "soft agreement terms_hash is invalid";
  }
  if (expectedTermsHash && ack.terms_hash !== expectedTermsHash) {
    return "soft agreement terms_hash does not match the Soft snapshot";
  }
  if (!ack.attested_at || Number.isNaN(Date.parse(ack.attested_at))) {
    return "soft agreement attested_at is invalid";
  }
  return null;
}

async function loadListingNegotiationSnapshot(
  db: Database,
  listingId: string,
): Promise<Record<string, unknown> | null> {
  let draft = (
    await db
      .select({ snapshot: listingDrafts.negotiationAgentSnapshot })
      .from(listingDrafts)
      .where(eq(listingDrafts.id, listingId))
      .limit(1)
  )[0];
  if (!draft) {
    draft = (
      await db
        .select({ snapshot: listingDrafts.negotiationAgentSnapshot })
        .from(listingsPublished)
        .innerJoin(listingDrafts, eq(listingDrafts.id, listingsPublished.draftId))
        .where(eq(listingsPublished.id, listingId))
        .limit(1)
    )[0];
  }
  if (draft?.snapshot && typeof draft.snapshot === "object" && !Array.isArray(draft.snapshot)) {
    return draft.snapshot as Record<string, unknown>;
  }
  return null;
}

export async function loadCheckoutAgreementDisplay(
  db: Database,
  row: {
    id: string;
    listingId: string;
    finalAmountMinor: string | number;
    currency: string;
    termsSnapshot: unknown;
  },
): Promise<CheckoutAgreementDisplay> {
  const termsSnapshot =
    row.termsSnapshot && typeof row.termsSnapshot === "object" && !Array.isArray(row.termsSnapshot)
      ? (row.termsSnapshot as Record<string, unknown>)
      : {};

  const session = await getSessionById(db, row.id);
  const sessionSnapshot = (session?.negotiationAgentSnapshot ?? null) as Record<
    string,
    unknown
  > | null;
  const listingSnapshot = await loadListingNegotiationSnapshot(db, row.listingId);
  const amount =
    typeof row.finalAmountMinor === "number" ? row.finalAmountMinor : Number(row.finalAmountMinor);

  return buildCheckoutAgreementDisplay({
    finalAmountMinor: amount,
    currency: row.currency,
    termsSnapshot,
    listingSnapshot,
    sessionSnapshot,
  });
}

/** Load Soft snapshot and verify buyer_ui_cta ack terms_hash (Hard prepare fail-close). */
export async function verifySoftAgreementTermsHash(
  db: Database,
  approvalId: string,
  ack: SoftAgreementAck,
): Promise<string | null> {
  const row = await db.query.settlementApprovals.findFirst({
    where: (fields, ops) => ops.eq(fields.id, approvalId),
  });
  if (!row) return "settlement approval not found for soft agreement verification";
  const display = await loadCheckoutAgreementDisplay(db, row);
  if (!isCheckoutAgreementRenderable(display)) {
    return "soft agreement display is incomplete";
  }
  return getSoftAgreementAckError(ack, display.terms_hash);
}
