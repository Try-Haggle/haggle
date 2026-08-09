/**
 * L3 / H5-a — Sensor mapper.
 *
 * Turns deterministic conversation signals (regex extractor) into schema-defined
 * ExtractedFeatures. Only keys present in FEATURE_SCHEMA survive; everything else
 * is dropped (auditable determinism). No LLM, no I/O.
 *
 * `value === null` means "mentioned but value unknown" → applyFeatures routes it to
 * `missing` → Tag Garden question (H7).
 */

import { type ExtractedFeature, getFeatureDef, isKnownFeatureKey } from "@haggle/engine-core";
import type { ConversationSignal } from "../../services/conversation-signal-extractor.js";

const STORAGE_GB_TO_LABEL: Record<number, string> = {
  64: "64GB",
  128: "128GB",
  256: "256GB",
  512: "512GB",
  1024: "1TB",
};

/** (signal shape) → { schema key, value }. Returns null when the signal maps to nothing. */
function signalToFeatureFields(
  s: ConversationSignal,
): { key: string; value: ExtractedFeature["value"] } | null {
  switch (s.entityType) {
    case "battery_health": {
      const pct = s.metadata?.battery_health_pct;
      return typeof pct === "number" ? { key: "battery_health", value: pct } : null;
    }
    case "storage": {
      const gb = s.metadata?.storage_gb;
      const label = typeof gb === "number" ? STORAGE_GB_TO_LABEL[gb] : undefined;
      return label ? { key: "storage_capacity", value: label } : null;
    }
    case "carrier":
      return {
        key: "carrier_lock",
        value: s.normalizedValue === "unlocked" ? "unlocked" : "locked",
      };
    case "cosmetic":
      return { key: "cosmetic_grade", value: null }; // damage mentioned, grade unknown → H7
    case "verification":
      return { key: "imei_verification", value: null }; // mentioned, not verified → H7
    case "warranty":
      return { key: "warranty_period", value: null };
    case "return_policy":
      return { key: "return_policy", value: null };
    case "shipping":
      return { key: "shipping_method", value: null };
    case "fulfillment":
      return s.normalizedValue === "local_pickup"
        ? { key: "shipping_method", value: "local_pickup" }
        : null;
    default:
      return null;
  }
}

/**
 * Map conversation signals → ExtractedFeatures. Schema-gated and deduped by key.
 *
 * Dedupe rule: a CONCRETE value beats a "mentioned but unknown" (null) one for the
 * same key; otherwise the first occurrence wins. (Signal emission order is fixed but
 * NOT confidence-ranked, and two signals can collide on one key — e.g. `shipping` →
 * shipping_method:null and `fulfillment` → shipping_method:"local_pickup" — so plain
 * first-wins would let a null shadow a real value.)
 */
export function mapSignalsToFeatures(
  signals: readonly ConversationSignal[],
  source: ExtractedFeature["source"],
): ExtractedFeature[] {
  const byKey = new Map<string, ExtractedFeature>();
  for (const s of signals) {
    const mapped = signalToFeatureFields(s);
    if (!mapped || !isKnownFeatureKey(mapped.key)) continue;
    const existing = byKey.get(mapped.key);
    // Keep the existing entry unless we can upgrade a null to a concrete value.
    if (existing && (existing.value !== null || mapped.value === null)) continue;
    const def = getFeatureDef(mapped.key);
    if (!def) continue;
    byKey.set(mapped.key, {
      key: mapped.key,
      type: def.routing,
      value: mapped.value,
      ...(def.unit ? { unit: def.unit } : {}),
      source,
      ...(s.entityValue ? { raw_span: s.entityValue } : {}),
    });
  }
  return [...byKey.values()];
}
