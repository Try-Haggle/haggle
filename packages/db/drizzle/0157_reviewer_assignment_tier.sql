-- Legacy assignments cannot reliably distinguish T2 votes from a later T3 case.
-- Preserve them as T2; T3 must receive a fresh, independent panel.
ALTER TABLE "reviewer_assignments" ADD COLUMN "tier" integer NOT NULL DEFAULT 2;
ALTER TABLE "reviewer_assignments" ADD CONSTRAINT "reviewer_assignments_tier_check" CHECK ("tier" IN (2, 3));
CREATE INDEX "idx_reviewer_assignments_dispute_tier" ON "reviewer_assignments" ("dispute_id", "tier");
-- Keep dispute/reviewer uniqueness: a juror cannot judge their own appealed decision.
UPDATE dispute_cases SET metadata = metadata - 'panel_review_evaluation'
WHERE metadata->>'tier' = '3';
-- Slots represent pending votes, not historical assignments.
UPDATE reviewer_profiles rp SET active_slots = (
  SELECT COALESCE(SUM(ra.slot_cost), 0)::int FROM reviewer_assignments ra
  JOIN dispute_cases dc ON dc.id = ra.dispute_id
  WHERE ra.reviewer_id = rp.user_id AND ra.vote_value IS NULL
    AND ra.tier = COALESCE((dc.metadata->>'tier')::int, 1)
    AND dc.status = 'UNDER_REVIEW'
), updated_at = now();
