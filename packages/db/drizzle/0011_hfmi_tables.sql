-- HFMI (Haggle Fair Market Index) tables
-- Raw price observations + fitted hedonic regression coefficients

CREATE TABLE IF NOT EXISTS "hfmi_price_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" text NOT NULL,
  "model" text NOT NULL,
  "storage_gb" integer,
  "battery_health_pct" integer,
  "cosmetic_grade" text,
  "carrier_locked" boolean NOT NULL DEFAULT false,
  "observed_price_usd" numeric(10, 2) NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "external_id" text,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hfmi_obs_source_model_at"
  ON "hfmi_price_observations" ("source", "model", "observed_at");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_hfmi_obs_source_external_id"
  ON "hfmi_price_observations" ("source", "external_id");

CREATE TABLE IF NOT EXISTS "hfmi_model_coefficients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "model" text NOT NULL,
  "fitted_at" timestamp with time zone NOT NULL,
  "coefficients" jsonb NOT NULL,
  "r_squared" numeric(5, 4) NOT NULL,
  "sample_size" integer NOT NULL,
  "residual_std" numeric(10, 6) NOT NULL,
  "fit_version" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hfmi_coef_model_fitted"
  ON "hfmi_model_coefficients" ("model", "fitted_at");
