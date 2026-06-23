-- Descope tenant IDs (T...) and user IDs (U...) are not UUIDs.
-- Convert all identity columns from uuid to text so Descope IDs can be
-- stored directly without mapping. All statements are idempotent.

-- 1. Drop all RLS policies that depend on uar_current_tenant_id()
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tenants','applications','user_identities','external_accounts','access_grants',
    'ingestion_runs','ingestion_observations','connector_credentials',
    'snapshots','snapshot_nodes','snapshot_edges',
    'review_campaigns','review_items','review_assignments','review_decisions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
  END LOOP;
END $$;
--> statement-breakpoint

-- 2. Drop and recreate the function with text return type
DROP FUNCTION IF EXISTS uar_current_tenant_id();
--> statement-breakpoint

CREATE FUNCTION uar_current_tenant_id()
RETURNS text LANGUAGE sql STABLE AS
'SELECT NULLIF(current_setting(''uar.tenant_id'', true), '''')';
--> statement-breakpoint

-- 3. Convert uuid columns to text in FK dependency order (parents before children)
-- Level 0: tenants (PK, no FK deps)
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='tenants' AND column_name='tenant_id') = 'uuid' THEN
    ALTER TABLE tenants ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
    ALTER TABLE tenants ALTER COLUMN tenant_id DROP DEFAULT;
  END IF;
END $$;
--> statement-breakpoint

-- Level 1: user_identities.id (referenced by external_accounts, access_grants)
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='user_identities' AND column_name='id') = 'uuid' THEN
    ALTER TABLE user_identities ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE user_identities ALTER COLUMN id DROP DEFAULT;
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='user_identities' AND column_name='tenant_id') = 'uuid' THEN
    ALTER TABLE user_identities ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
  END IF;
END $$;
--> statement-breakpoint

-- Level 1: applications (FK to tenants only)
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='applications' AND column_name='tenant_id') = 'uuid' THEN
    ALTER TABLE applications ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
  END IF;
END $$;
--> statement-breakpoint

-- Level 1: ingestion_runs, ingestion_observations, connector_credentials, snapshots (FK to tenants)
DO $$ BEGIN
  DECLARE tbl text;
  FOREACH tbl IN ARRAY ARRAY['ingestion_runs','ingestion_observations','connector_credentials','snapshots','snapshot_nodes','snapshot_edges'] LOOP
    IF (SELECT data_type FROM information_schema.columns WHERE table_name=tbl AND column_name='tenant_id') = 'uuid' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id TYPE text USING tenant_id::text', tbl);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- Level 2: external_accounts (FK to tenants + applications + user_identities)
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='external_accounts' AND column_name='tenant_id') = 'uuid' THEN
    ALTER TABLE external_accounts ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='external_accounts' AND column_name='user_identity_id') = 'uuid' THEN
    ALTER TABLE external_accounts ALTER COLUMN user_identity_id TYPE text USING user_identity_id::text;
  END IF;
END $$;
--> statement-breakpoint

-- Level 3: access_grants (FK to tenants + applications + external_accounts + user_identities)
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='access_grants' AND column_name='tenant_id') = 'uuid' THEN
    ALTER TABLE access_grants ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='access_grants' AND column_name='user_identity_id') = 'uuid' THEN
    ALTER TABLE access_grants ALTER COLUMN user_identity_id TYPE text USING user_identity_id::text;
  END IF;
END $$;
--> statement-breakpoint

-- Level 3: review tables (FK to tenants + snapshots + access_grants)
DO $$ BEGIN
  DECLARE tbl text;
  FOREACH tbl IN ARRAY ARRAY['review_campaigns','review_items','review_assignments','review_decisions'] LOOP
    IF (SELECT data_type FROM information_schema.columns WHERE table_name=tbl AND column_name='tenant_id') = 'uuid' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id TYPE text USING tenant_id::text', tbl);
    END IF;
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY['review_assignments','review_decisions'] LOOP
    IF (SELECT data_type FROM information_schema.columns WHERE table_name=tbl AND column_name='reviewer_user_id') = 'uuid' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN reviewer_user_id TYPE text USING reviewer_user_id::text', tbl);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- 4. Recreate RLS policies (now using text comparison)
CREATE POLICY "tenants_tenant_isolation" ON "tenants" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "applications_tenant_isolation" ON "applications" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "user_identities_tenant_isolation" ON "user_identities" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "external_accounts_tenant_isolation" ON "external_accounts" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "access_grants_tenant_isolation" ON "access_grants" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "ingestion_runs_tenant_isolation" ON "ingestion_runs" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "ingestion_observations_tenant_isolation" ON "ingestion_observations" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "snapshots_tenant_isolation" ON "snapshots" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "snapshot_nodes_tenant_isolation" ON "snapshot_nodes" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "snapshot_edges_tenant_isolation" ON "snapshot_edges" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "connector_credentials_tenant_isolation" ON "connector_credentials" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "review_campaigns_tenant_isolation" ON "review_campaigns" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "review_items_tenant_isolation" ON "review_items" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "review_assignments_tenant_isolation" ON "review_assignments" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());--> statement-breakpoint
CREATE POLICY "review_decisions_tenant_isolation" ON "review_decisions" USING ("tenant_id" = uar_current_tenant_id()) WITH CHECK ("tenant_id" = uar_current_tenant_id());
