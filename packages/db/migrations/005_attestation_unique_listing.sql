-- Migration: enforce append-only seller_attestation_commits by UNIQUE(listing_id)
--
-- Step 55 review (C2): prior implementation used a SELECT-then-INSERT TOCTOU
-- check for duplicate attestation commits. Two concurrent requests for the
-- same listing could both pass the SELECT and both INSERT, silently breaking
-- the append-only invariant.
--
-- This migration adds a UNIQUE constraint on listing_id. The service layer
-- now relies on Postgres error code 23505 to detect duplicates atomically.

ALTER TABLE seller_attestation_commits
  ADD CONSTRAINT uq_seller_attestation_commits_listing_id
  UNIQUE (listing_id);
