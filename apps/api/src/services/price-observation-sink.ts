/**
 * Price Observation Sink — records agreed prices into HFMI.
 *
 * On negotiation.agreed → INSERT into hfmi_price_observations
 * with source='haggle_internal'. This builds the internal data moat:
 * more Haggle trades → better HFMI → better negotiations → more trades.
 *
 * Principle: data is collected but NEVER constrains negotiations.
 * This is reference data for HFMI + future Intelligence API.
 */

import { hfmiPriceObservations, type Database } from "@haggle/db";
import { extractTagAttributes } from "./hfmi-tag-resolver.js";

export interface AgreedPriceEvent {
  sessionId: string;
  finalPriceMinor: number;
  buyerId: string;
  sellerId: string;
  listingId: string;
  /** Tag garden from the listing (if available) */
  tagGarden?: Array<{ name: string; category?: string }> | Record<string, string>;
  /** Category from the listing */
  category?: string;
}

/**
 * Record an agreed negotiation price as an HFMI observation.
 * Non-fatal: errors are logged but never block the transaction.
 */
export async function recordAgreedPrice(
  db: Database,
  event: AgreedPriceEvent,
): Promise<void> {
  try {
    // Extract model/storage/condition from tag garden
    const tagAttrs = event.tagGarden
      ? extractTagAttributes(event.tagGarden)
      : {};

    // Derive model name — try tag garden first, then category fallback
    const model = tagAttrs.model
      ?? event.category?.toLowerCase().replace(/[\s-]+/g, "_")
      ?? "unknown";

    if (model === "unknown") {
      // No model info — still record with category for aggregate stats
      console.warn("[price-sink] no model for session", event.sessionId);
    }

    const priceUsd = event.finalPriceMinor / 100;

    await db
      .insert(hfmiPriceObservations)
      .values({
        source: "haggle_internal",
        model,
        storageGb: tagAttrs.storage_gb ?? null,
        batteryHealthPct: null, // not available at deal time
        cosmeticGrade: (tagAttrs.condition as "A" | "B" | "C") ?? null,
        carrierLocked: false,
        observedPriceUsd: String(priceUsd),
        observedAt: new Date(),
        externalId: `haggle_${event.sessionId}`,
        rawPayload: {
          session_id: event.sessionId,
          buyer_id: event.buyerId,
          seller_id: event.sellerId,
          listing_id: event.listingId,
          final_price_minor: event.finalPriceMinor,
          category: event.category,
          recorded_at: new Date().toISOString(),
        },
      })
      .onConflictDoNothing(); // idempotent — same session won't double-record

    console.info(
      "[price-sink] recorded: %s %s $%s (session: %s)",
      model,
      tagAttrs.storage_gb ? `${tagAttrs.storage_gb}GB` : "",
      priceUsd.toFixed(2),
      event.sessionId,
    );
  } catch (err) {
    // Non-fatal: price recording failure must never block the deal
    console.error("[price-sink] failed to record price:", (err as Error).message);
  }
}
