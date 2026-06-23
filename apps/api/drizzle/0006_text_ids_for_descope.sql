-- Descope tenant IDs (T...) and user IDs (U...) are not UUIDs.
-- Convert all identity columns from uuid to text so Descope IDs can be
-- stored directly without mapping.

-- 1. Fix the RLS function first (return text, no ::uuid cast)
CREATE OR REPLACE FUNCTION "uar_current_tenant_id"()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('uar.tenant_id', true), '')
$$;
--> statement-breakpoint

-- 2. tenants PK: uuid -> text (no default — Descope ID is the value)
ALTER TABLE "tenants" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
--> statement-breakpoint

-- 3. user_identities: id uuid -> text (Descope sub is the PK)
ALTER TABLE "user_identities" ALTER COLUMN "id" TYPE text USING "id"::text;
ALTER TABLE "user_identities" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
--> statement-breakpoint

-- 4. All other tenant_id FK columns
ALTER TABLE "applications" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "access_grants" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "external_accounts" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "ingestion_runs" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "ingestion_observations" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "connector_credentials" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "snapshots" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "snapshot_nodes" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "snapshot_edges" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "review_campaigns" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "review_items" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "review_assignments" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
ALTER TABLE "review_decisions" ALTER COLUMN "tenant_id" TYPE text USING "tenant_id"::text;
--> statement-breakpoint

-- 5. reviewer_user_id columns (Descope user sub)
ALTER TABLE "review_assignments" ALTER COLUMN "reviewer_user_id" TYPE text USING "reviewer_user_id"::text;
ALTER TABLE "review_decisions" ALTER COLUMN "reviewer_user_id" TYPE text USING "reviewer_user_id"::text;
--> statement-breakpoint

-- 6. user_identity_id FK columns
ALTER TABLE "external_accounts" ALTER COLUMN "user_identity_id" TYPE text USING "user_identity_id"::text;
ALTER TABLE "access_grants" ALTER COLUMN "user_identity_id" TYPE text USING "user_identity_id"::text;
