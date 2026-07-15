ALTER TABLE "dispute_evidence_uploads"
  ADD COLUMN IF NOT EXISTS "average_hash" text,
  ADD COLUMN IF NOT EXISTS "color_histogram" jsonb,
  ADD COLUMN IF NOT EXISTS "similarity_signals" jsonb;

ALTER TABLE "dispute_evidence_uploads"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_uploads_average_hash_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_uploads_color_histogram_chk";

ALTER TABLE "dispute_evidence_uploads"
  ADD CONSTRAINT "dispute_evidence_uploads_average_hash_chk"
    CHECK ("average_hash" IS NULL OR "average_hash" ~ '^[01]{64}$'),
  ADD CONSTRAINT "dispute_evidence_uploads_color_histogram_chk"
    CHECK (
      "color_histogram" IS NULL OR (
        jsonb_typeof("color_histogram") = 'array'
        AND jsonb_array_length("color_histogram") = 12
      )
    );
