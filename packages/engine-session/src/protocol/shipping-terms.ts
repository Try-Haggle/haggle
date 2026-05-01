import { createHash } from 'node:crypto';
import type { HnpMoney } from './core.js';

export type HnpShippingMethod = 'carrier_delivery' | 'local_pickup' | 'seller_dropoff' | 'digital_transfer';
export type HnpShippingPayer = 'BUYER' | 'SELLER' | 'SPLIT';
export type HnpRiskTransferPoint = 'pickup_confirmed' | 'carrier_acceptance' | 'delivery_confirmed';

export interface HnpShippingWindow {
  earliest_at_ms: number;
  latest_at_ms: number;
}

export interface HnpShippingTerms {
  terms_id: string;
  method: HnpShippingMethod;
  payer: HnpShippingPayer;
  cost?: HnpMoney;
  carrier?: string;
  service_level?: string;
  insurance_required?: boolean;
  tracking_required?: boolean;
  pickup_window?: HnpShippingWindow;
  delivery_sla_days?: number;
  risk_transfer: HnpRiskTransferPoint;
  created_at_ms: number;
  terms_hash: string;
}

export interface CreateHnpShippingTermsInput {
  method: HnpShippingMethod;
  payer: HnpShippingPayer;
  cost?: HnpMoney;
  carrier?: string;
  service_level?: string;
  insurance_required?: boolean;
  tracking_required?: boolean;
  pickup_window?: HnpShippingWindow;
  delivery_sla_days?: number;
  risk_transfer?: HnpRiskTransferPoint;
  created_at_ms: number;
}

export interface HnpShippingTermsIssue {
  code:
    | 'NEGATIVE_COST'
    | 'NON_INTEGER_COST'
    | 'INVALID_PICKUP_WINDOW'
    | 'INVALID_PICKUP_TIMESTAMP'
    | 'INVALID_DELIVERY_SLA'
    | 'CARRIER_REQUIRED'
    | 'TRACKING_REQUIRED_FOR_CARRIER'
    | 'HASH_MISMATCH';
  field: string;
  message: string;
}

export type HnpShippingTermsValidationResult =
  | { ok: true; warnings: HnpShippingTermsIssue[] }
  | { ok: false; issues: HnpShippingTermsIssue[] };

export function createHnpShippingTerms(input: CreateHnpShippingTermsInput): HnpShippingTerms {
  const base = {
    method: input.method,
    payer: input.payer,
    cost: input.cost,
    carrier: input.carrier,
    service_level: input.service_level,
    insurance_required: input.insurance_required,
    tracking_required: input.tracking_required,
    pickup_window: input.pickup_window,
    delivery_sla_days: input.delivery_sla_days,
    risk_transfer: input.risk_transfer ?? defaultRiskTransfer(input.method),
    created_at_ms: input.created_at_ms,
  };
  const termsHash = computeHnpShippingTermsHash(base);
  return {
    terms_id: `ship_${termsHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    ...base,
    terms_hash: termsHash,
  };
}

export function computeHnpShippingTermsHash(
  value: Omit<HnpShippingTerms, 'terms_id' | 'terms_hash'>,
): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function validateHnpShippingTerms(
  terms: HnpShippingTerms,
  options: { verifyHash?: boolean } = {},
): HnpShippingTermsValidationResult {
  const issues: HnpShippingTermsIssue[] = [];

  if (terms.cost) {
    if (!Number.isInteger(terms.cost.units_minor)) {
      issues.push(issue('NON_INTEGER_COST', 'cost.units_minor', 'Shipping cost must be an integer minor-unit value.'));
    }
    if (terms.cost.units_minor < 0) {
      issues.push(issue('NEGATIVE_COST', 'cost.units_minor', 'Shipping cost cannot be negative.'));
    }
  }

  if (
    terms.pickup_window
    && (!Number.isFinite(terms.pickup_window.earliest_at_ms) || !Number.isFinite(terms.pickup_window.latest_at_ms))
  ) {
    issues.push(issue('INVALID_PICKUP_TIMESTAMP', 'pickup_window', 'Pickup window timestamps must be finite numbers.'));
  }

  if (
    terms.pickup_window
    && terms.pickup_window.earliest_at_ms > terms.pickup_window.latest_at_ms
  ) {
    issues.push(issue('INVALID_PICKUP_WINDOW', 'pickup_window', 'Pickup window earliest time must be before latest time.'));
  }

  if (terms.delivery_sla_days !== undefined && terms.delivery_sla_days <= 0) {
    issues.push(issue('INVALID_DELIVERY_SLA', 'delivery_sla_days', 'Delivery SLA must be positive.'));
  }

  if (terms.method === 'carrier_delivery' && !terms.carrier) {
    issues.push(issue('CARRIER_REQUIRED', 'carrier', 'Carrier delivery requires a carrier.'));
  }

  if (terms.method === 'carrier_delivery' && terms.tracking_required !== true) {
    issues.push(issue('TRACKING_REQUIRED_FOR_CARRIER', 'tracking_required', 'Carrier delivery must require tracking.'));
  }

  if (options.verifyHash) {
    const expectedHash = computeHnpShippingTermsHash({
      method: terms.method,
      payer: terms.payer,
      cost: terms.cost,
      carrier: terms.carrier,
      service_level: terms.service_level,
      insurance_required: terms.insurance_required,
      tracking_required: terms.tracking_required,
      pickup_window: terms.pickup_window,
      delivery_sla_days: terms.delivery_sla_days,
      risk_transfer: terms.risk_transfer,
      created_at_ms: terms.created_at_ms,
    });
    if (terms.terms_hash !== expectedHash) {
      issues.push(issue('HASH_MISMATCH', 'terms_hash', 'Shipping terms hash does not match terms contents.'));
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

function defaultRiskTransfer(method: HnpShippingMethod): HnpRiskTransferPoint {
  if (method === 'local_pickup' || method === 'seller_dropoff') return 'pickup_confirmed';
  if (method === 'carrier_delivery') return 'delivery_confirmed';
  return 'delivery_confirmed';
}

function issue(
  code: HnpShippingTermsIssue['code'],
  field: string,
  message: string,
): HnpShippingTermsIssue {
  return { code, field, message };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(record[key]);
      return acc;
    }, {});
}
