CREATE TABLE IF NOT EXISTS "api_rate_limit_windows" (
  "scope" text NOT NULL,
  "key_hash" text NOT NULL,
  "window_started_at" timestamptz NOT NULL,
  "request_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "api_rate_limit_windows_pk" PRIMARY KEY ("scope", "key_hash"),
  CONSTRAINT "api_rate_limit_windows_scope_check"
    CHECK ("scope" ~ '^[A-Za-z0-9:_-]{1,64}$'),
  CONSTRAINT "api_rate_limit_windows_key_hash_check"
    CHECK ("key_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "api_rate_limit_windows_count_check"
    CHECK ("request_count" BETWEEN 0 AND 10001),
  CONSTRAINT "api_rate_limit_windows_window_check"
    CHECK ("window_started_at" <= "updated_at")
);

CREATE INDEX IF NOT EXISTS "api_rate_limit_windows_updated_idx"
  ON "api_rate_limit_windows" ("updated_at");
