CREATE TABLE IF NOT EXISTS dispute_evidence_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL,
  uploaded_by text NOT NULL,
  evidence_type text NOT NULL,
  content_type text NOT NULL,
  file_size_bytes integer NOT NULL,
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  committed_evidence_id uuid,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispute_evidence_uploads_uploaded_by_chk CHECK (uploaded_by IN ('buyer', 'seller', 'system')),
  CONSTRAINT dispute_evidence_uploads_evidence_type_chk CHECK (evidence_type IN ('image', 'video')),
  CONSTRAINT dispute_evidence_uploads_status_chk CHECK (status IN ('PENDING', 'COMMITTED', 'EXPIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS dispute_evidence_uploads_storage_path_unique
  ON dispute_evidence_uploads (storage_path);

CREATE INDEX IF NOT EXISTS dispute_evidence_uploads_dispute_status_idx
  ON dispute_evidence_uploads (dispute_id, status);

CREATE INDEX IF NOT EXISTS dispute_evidence_uploads_expires_at_idx
  ON dispute_evidence_uploads (expires_at);
