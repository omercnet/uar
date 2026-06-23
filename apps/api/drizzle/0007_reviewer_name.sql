-- Store reviewer display name at write time so we can show "Reviewed by Alice Smith"
-- without needing a management API key to look up users later.
ALTER TABLE "review_decisions" ADD COLUMN IF NOT EXISTS "reviewer_name" text;
--> statement-breakpoint
ALTER TABLE "review_assignments" ADD COLUMN IF NOT EXISTS "reviewer_name" text;
