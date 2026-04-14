import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";

/**
 * HFMI (Haggle Fair Market Index) — raw price observations.
 *
 * Append-only ingestion log. One row per (source, external_id) observation.
 * v0 primary source is eBay Browse API (active listings, correction factor
 * applied at fit time). Terapeak manual weekly CSV uploads use
 * `source = 'terapeak_manual'` to calibrate the correction factor.
 *
 * See docs/mvp/2026-04-08_hfmi-spec.md §7 for schema rationale.
 */
export const hfmiPriceObservations = pgTable(
  "hfmi_price_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source", {
      enum: [
        "ebay_browse",
        "ebay_sold",
        "terapeak_manual",
        "marketplace_insights",
        "gazelle",
        "backmarket",
        "haggle_internal",
      ],
    }).notNull(),
    // e.g. 'iphone_14_pro', 'iphone_15_pro_max'
    model: text("model").notNull(),
    storageGb: integer("storage_gb"),
    batteryHealthPct: integer("battery_health_pct"),
    cosmeticGrade: text("cosmetic_grade", { enum: ["A", "B", "C"] }),
    carrierLocked: boolean("carrier_locked").notNull().default(false),
    observedPriceUsd: numeric("observed_price_usd", {
      precision: 10,
      scale: 2,
    }).notNull(),
    /** Fee-normalized price: seller net on Haggle (1.5% fee) equivalent.
     *  Formula: observed × (1 - source_fee) / (1 - 0.015)
     *  haggle_internal = observed (no adjustment). */
    adjustedPriceUsd: numeric("adjusted_price_usd", {
      precision: 10,
      scale: 2,
    }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    // e.g. eBay itemId — used for dedup across re-fetches.
    externalId: text("external_id"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_hfmi_obs_source_model_at").on(
      table.source,
      table.model,
      table.observedAt,
    ),
    unique("uq_hfmi_obs_source_external_id").on(
      table.source,
      table.externalId,
    ),
  ],
);
