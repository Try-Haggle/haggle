-- Existing seller-only deposits remain legacy records and cannot be treated as
-- funded collateral for the new two-party review policy.
ALTER TABLE "dispute_deposits" ADD COLUMN "party" text NOT NULL DEFAULT 'seller';
ALTER TABLE "dispute_deposits" ADD COLUMN "policy_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "dispute_deposits" ADD CONSTRAINT "dispute_deposits_party_check" CHECK ("party" IN ('buyer', 'seller'));
ALTER TABLE "dispute_deposits" ADD CONSTRAINT "dispute_deposits_policy_version_check" CHECK ("policy_version" IN (1, 2));
CREATE UNIQUE INDEX "dispute_deposits_v2_dispute_tier_party_uidx"
  ON "dispute_deposits" ("dispute_id", "tier", "party") WHERE "policy_version" = 2;
CREATE INDEX "idx_dispute_deposits_v2_dispute_tier"
  ON "dispute_deposits" ("dispute_id", "tier") WHERE "policy_version" = 2;
