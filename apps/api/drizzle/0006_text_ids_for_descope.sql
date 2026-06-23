-- Descope tenant IDs (T...) and user IDs (U...) are not UUIDs.
-- Convert all identity columns from uuid to text so Descope IDs can be
-- stored directly without mapping.
-- All ALTER COLUMN statements are idempotent (skip if already text).

DO $$
DECLARE
  col_type text;
BEGIN
  -- 1. Fix the RLS function (return text, no ::uuid cast)
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION uar_current_tenant_id()
    RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting(''uar.tenant_id'', true), '') $$
  $fn$;

  -- 2. Helper: alter column only if it is currently uuid
  -- tenants.tenant_id
  SELECT data_type INTO col_type FROM information_schema.columns
    WHERE table_name='tenants' AND column_name='tenant_id';
  IF col_type = 'uuid' THEN
    ALTER TABLE tenants ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
    ALTER TABLE tenants ALTER COLUMN tenant_id DROP DEFAULT;
  END IF;

  -- user_identities.id
  SELECT data_type INTO col_type FROM information_schema.columns
    WHERE table_name='user_identities' AND column_name='id';
  IF col_type = 'uuid' THEN
    ALTER TABLE user_identities ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE user_identities ALTER COLUMN id DROP DEFAULT;
  END IF;

  -- user_identities.tenant_id
  SELECT data_type INTO col_type FROM information_schema.columns
    WHERE table_name='user_identities' AND column_name='tenant_id';
  IF col_type = 'uuid' THEN
    ALTER TABLE user_identities ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
  END IF;

  -- All other tenant_id FK columns
  FOR col_type IN SELECT table_name FROM information_schema.columns
    WHERE column_name='tenant_id' AND data_type='uuid'
      AND table_name IN (
        'applications','access_grants','external_accounts',
        'ingestion_runs','ingestion_observations','connector_credentials',
        'snapshots','snapshot_nodes','snapshot_edges',
        'review_campaigns','review_items','review_assignments','review_decisions'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id TYPE text USING tenant_id::text', col_type);
  END LOOP;

  -- reviewer_user_id columns
  FOR col_type IN SELECT table_name FROM information_schema.columns
    WHERE column_name='reviewer_user_id' AND data_type='uuid'
      AND table_name IN ('review_assignments','review_decisions')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN reviewer_user_id TYPE text USING reviewer_user_id::text', col_type);
  END LOOP;

  -- user_identity_id FK columns
  FOR col_type IN SELECT table_name FROM information_schema.columns
    WHERE column_name='user_identity_id' AND data_type='uuid'
      AND table_name IN ('external_accounts','access_grants')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN user_identity_id TYPE text USING user_identity_id::text', col_type);
  END LOOP;

END $$;
