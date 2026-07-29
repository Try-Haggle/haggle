DROP INDEX "dispute_precedents_source_dispute_unique";--> statement-breakpoint
ALTER TABLE "dispute_precedents" ADD CONSTRAINT "dispute_precedents_source_dispute_id_dispute_cases_id_fk" FOREIGN KEY ("source_dispute_id") REFERENCES "public"."dispute_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_precedents_current_source_unique" ON "dispute_precedents" USING btree ("source_dispute_id") WHERE "dispute_precedents"."status" IN ('CANDIDATE', 'DRAFT', 'APPROVED', 'EXCLUDED');--> statement-breakpoint
ALTER TABLE "dispute_precedents" ADD CONSTRAINT "dispute_precedents_status_valid" CHECK ("dispute_precedents"."status" IN ('CANDIDATE', 'DRAFT', 'APPROVED', 'RETIRED', 'EXCLUDED'));--> statement-breakpoint
ALTER TABLE "dispute_precedents" ADD CONSTRAINT "dispute_precedents_outcome_valid" CHECK ("dispute_precedents"."outcome" IN ('buyer_favor', 'seller_favor', 'partial_refund', 'no_action'));
