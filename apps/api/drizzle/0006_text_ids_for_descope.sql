-- Descope tenant IDs (T...) and user IDs (U...) are not UUIDs.
-- Convert all identity columns from uuid to text so Descope IDs can be
-- stored directly without mapping. All statements are idempotent.

CREATE OR REPLACE FUNCTION uar_current_tenant_id()
RETURNS text LANGUAGE sql STABLE AS
'SELECT NULLIF(current_setting(''uar.tenant_id'', true), '''')';
--> statement-breakpoint

DO $$
DECLARE
  tbl text;
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='tenants' AND column_name='tenant_id') = 'uuid' THEN
    ALTER TABLE tenants ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
    ALTER TABLE tenants ALTER COLUMN tenant_id DROP DEFAULT;
  END IF;

  IF (SELECT data_type FROM information_schema.columns WHERE table_name='user_identities' AND column_name='id') = 'uuid' THEN
    ALTER TABLE user_identities ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE user_identities ALTER COLUMN id DROP DEFAULT;
  END IF;

  IF (SELECT data_type FROM information_schema.columns WHERE table_name='user_identities' AND column_name='tenant_id') = 'uuid' THEN
    ALTER TABLE user_identities ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
  END IF;

  FOREACH tbl IN ARRAY ARRAY['applications','access_grants','external_accounts','ingestion_runs','ingestion_observations','connector_credentials','snapshots','snapshot_nodes','snapshot_edges','review_campaigns','review_items','review_assignments','review_decisions'] LOOP
    IF (SELECT data_type FROM information_schema.columns WHERE table_name=tbl AND column_name='tenant_id') = 'uuid' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id TYPE text USING tenant_id::text', tbl);
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY['review_assignments','review_decisions'] LOOP
    IF (SELECT data_type FROM information_schema.columns WHERE table_name=tbl AND column_name='reviewer_user_id') = 'uuid' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN reviewer_user_id TYPE text USING reviewer_user_id::text', tbl);
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY['external_accounts','access_grants'] LOOP
    IF (SELECT data_type FROM information_schema.columns WHERE table_name=tbl AND column_name='user_identity_id') = 'uuid' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN user_identity_id TYPE text USING user_identity_id::text', tbl);
    END IF;
  END LOOP;
END $$;
