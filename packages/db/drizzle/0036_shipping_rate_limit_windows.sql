CREATE TABLE IF NOT EXISTS "shipping_rate_limit_windows" (
  "key" text PRIMARY KEY,
  "window_started_at" timestamptz NOT NULL,
  "request_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipping_rate_limit_windows_count_check" CHECK ("request_count" >= 0)
);

CREATE INDEX IF NOT EXISTS "shipping_rate_limit_windows_updated_idx"
  ON "shipping_rate_limit_windows" ("updated_at");
