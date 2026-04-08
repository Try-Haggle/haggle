import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * HFMI fitted hedonic regression coefficients (per-SKU, versioned).
 *
 * Written by the nightly fit job (cron 03:00 UTC). Never updated in place —
 * each nightly fit inserts a new row. Active row is selected by (model,
 * fitted_at DESC) filtered by quality gates (r_squared >= 0.50,
 * sample_size >= 30). See docs/mvp/2026-04-08_hfmi-spec.md §6.
 */
export const hfmiModelCoefficients = pgTable(
  "hfmi_model_coefficients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    model: text("model").notNull(),
    fittedAt: timestamp("fitted_at", { withTimezone: true }).notNull(),
    // { intercept, storage_256, storage_512, storage_1024, battery,
    //   cosmetic_b, cosmetic_c, carrier_locked, days_since_listing,
    //   residual_std }
    coefficients: jsonb("coefficients")
      .notNull()
      .$type<Record<string, number>>(),
    rSquared: numeric("r_squared", { precision: 5, scale: 4 }).notNull(),
    sampleSize: integer("sample_size").notNull(),
    residualStd: numeric("residual_std", { precision: 10, scale: 6 }).notNull(),
    // Bumped on formula changes. e.g. 'v0.1.0'.
    fitVersion: text("fit_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_hfmi_coef_model_fitted").on(table.model, table.fittedAt),
  ],
);
