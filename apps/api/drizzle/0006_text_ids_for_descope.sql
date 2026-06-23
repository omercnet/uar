-- Descope tenant IDs (T...) and user IDs (U...) are not UUIDs.
-- Convert all identity columns from uuid to text so Descope IDs can be
-- stored directly without mapping.
-- Strategy: drop FK constraints + RLS policies, convert all columns in one
-- transaction, recreate FKs + policies. All idempotent.

DO $$
DECLARE tbl text; col text;
BEGIN
  -- 1. Drop all RLS policies that depend on uar_current_tenant_id()
  FOREACH tbl IN ARRAY ARRAY[
    'tenants','applications','user_identities','external_accounts','access_grants',
    'ingestion_runs','ingestion_observations','connector_credentials',
    'snapshots','snapshot_nodes','snapshot_edges',
    'review_campaigns','review_items','review_assignments','review_decisions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
  END LOOP;

  -- 2. Drop FK constraints that involve columns being changed
  -- (only the ones where source or target column type changes)
  FOREACH col IN ARRAY ARRAY[
    'access_grants_tenant_id_fk','access_grants_application_fk',
    'access_grants_external_account_fk','access_grants_user_identity_fk',
    'applications_tenant_id_fk',
    'connector_credentials_tenant_id_fk','connector_credentials_application_fk',
    'external_accounts_tenant_id_fk','external_accounts_application_fk','external_accounts_user_identity_fk',
    'ingestion_observations_tenant_id_fk','ingestion_observations_ingestion_run_fk',
    'ingestion_runs_tenant_id_fk',
    'review_campaigns_tenant_id_fk','review_campaigns_snapshot_fk',
    'review_items_tenant_id_fk','review_items_campaign_fk','review_items_snapshot_fk',
    'review_items_access_grant_fk','review_items_application_fk','review_items_external_account_fk',
    'review_assignments_tenant_id_fk','review_assignments_campaign_fk',
    'review_assignments_item_fk','review_assignments_reviewer_fk',
    'review_decisions_tenant_id_fk','review_decisions_campaign_fk',
    'review_decisions_item_fk','review_decisions_reviewer_fk',
    'snapshots_tenant_id_fk','snapshots_ingestion_run_fk',
    'snapshot_nodes_tenant_id_fk','snapshot_nodes_snapshot_fk',
    'snapshot_edges_tenant_id_fk','snapshot_edges_snapshot_fk',
    'snapshot_edges_source_node_fk','snapshot_edges_target_node_fk',
    'user_identities_tenant_id_fk'
  ] LOOP
    -- Find which table owns this constraint and drop it
    EXECUTE format(
      'DO $inner$ BEGIN ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I; EXCEPTION WHEN undefined_table THEN NULL; END $inner$',
      (SELECT tc.table_name FROM information_schema.table_constraints tc
       WHERE tc.constraint_name = col AND tc.constraint_type = 'FOREIGN KEY' LIMIT 1),
      col
    );
  END LOOP;

  -- 3. Convert all uuid identity columns to text
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='tenants' AND column_name='tenant_id') = 'uuid' THEN
    ALTER TABLE tenants ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
    ALTER TABLE tenants ALTER COLUMN tenant_id DROP DEFAULT;
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='user_identities' AND column_name='id') = 'uuid' THEN
    ALTER TABLE user_identities ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE user_identities ALTER COLUMN id DROP DEFAULT;
  END IF;
  FOREACH tbl IN ARRAY ARRAY[
    'user_identities','applications','ingestion_runs','ingestion_observations',
    'connector_credentials','snapshots','snapshot_nodes','snapshot_edges',
    'external_accounts','access_grants',
    'review_campaigns','review_items','review_assignments','review_decisions'
  ] LOOP
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

  -- 4. Recreate FK constraints
  ALTER TABLE applications ADD CONSTRAINT applications_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE user_identities ADD CONSTRAINT user_identities_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE ingestion_runs ADD CONSTRAINT ingestion_runs_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE ingestion_observations ADD CONSTRAINT ingestion_observations_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE ingestion_observations ADD CONSTRAINT ingestion_observations_ingestion_run_fk FOREIGN KEY (tenant_id, ingestion_run_id) REFERENCES ingestion_runs(tenant_id, id);
  ALTER TABLE connector_credentials ADD CONSTRAINT connector_credentials_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE connector_credentials ADD CONSTRAINT connector_credentials_application_fk FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id);
  ALTER TABLE external_accounts ADD CONSTRAINT external_accounts_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE external_accounts ADD CONSTRAINT external_accounts_application_fk FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id);
  ALTER TABLE external_accounts ADD CONSTRAINT external_accounts_user_identity_fk FOREIGN KEY (tenant_id, user_identity_id) REFERENCES user_identities(tenant_id, id);
  ALTER TABLE access_grants ADD CONSTRAINT access_grants_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE access_grants ADD CONSTRAINT access_grants_application_fk FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id);
  ALTER TABLE access_grants ADD CONSTRAINT access_grants_external_account_fk FOREIGN KEY (tenant_id, external_account_id) REFERENCES external_accounts(tenant_id, id);
  ALTER TABLE access_grants ADD CONSTRAINT access_grants_user_identity_fk FOREIGN KEY (tenant_id, user_identity_id) REFERENCES user_identities(tenant_id, id);
  ALTER TABLE snapshots ADD CONSTRAINT snapshots_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE snapshots ADD CONSTRAINT snapshots_ingestion_run_fk FOREIGN KEY (tenant_id, ingestion_run_id) REFERENCES ingestion_runs(tenant_id, id);
  ALTER TABLE snapshot_nodes ADD CONSTRAINT snapshot_nodes_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE snapshot_nodes ADD CONSTRAINT snapshot_nodes_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES snapshots(tenant_id, id);
  ALTER TABLE snapshot_edges ADD CONSTRAINT snapshot_edges_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE snapshot_edges ADD CONSTRAINT snapshot_edges_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES snapshots(tenant_id, id);
  ALTER TABLE snapshot_edges ADD CONSTRAINT snapshot_edges_source_node_fk FOREIGN KEY (tenant_id, snapshot_id, source_node_id) REFERENCES snapshot_nodes(tenant_id, snapshot_id, id);
  ALTER TABLE snapshot_edges ADD CONSTRAINT snapshot_edges_target_node_fk FOREIGN KEY (tenant_id, snapshot_id, target_node_id) REFERENCES snapshot_nodes(tenant_id, snapshot_id, id);
  ALTER TABLE review_campaigns ADD CONSTRAINT review_campaigns_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE review_campaigns ADD CONSTRAINT review_campaigns_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES snapshots(tenant_id, id);
  ALTER TABLE review_items ADD CONSTRAINT review_items_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE review_items ADD CONSTRAINT review_items_campaign_fk FOREIGN KEY (tenant_id, campaign_id) REFERENCES review_campaigns(tenant_id, id);
  ALTER TABLE review_items ADD CONSTRAINT review_items_snapshot_fk FOREIGN KEY (tenant_id, snapshot_id) REFERENCES snapshots(tenant_id, id);
  ALTER TABLE review_items ADD CONSTRAINT review_items_access_grant_fk FOREIGN KEY (tenant_id, access_grant_id) REFERENCES access_grants(tenant_id, id);
  ALTER TABLE review_items ADD CONSTRAINT review_items_application_fk FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id);
  ALTER TABLE review_items ADD CONSTRAINT review_items_external_account_fk FOREIGN KEY (tenant_id, external_account_id) REFERENCES external_accounts(tenant_id, id);
  ALTER TABLE review_assignments ADD CONSTRAINT review_assignments_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE review_assignments ADD CONSTRAINT review_assignments_campaign_fk FOREIGN KEY (tenant_id, campaign_id) REFERENCES review_campaigns(tenant_id, id);
  ALTER TABLE review_assignments ADD CONSTRAINT review_assignments_item_fk FOREIGN KEY (tenant_id, review_item_id) REFERENCES review_items(tenant_id, id);
  ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
  ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_campaign_fk FOREIGN KEY (tenant_id, campaign_id) REFERENCES review_campaigns(tenant_id, id);
  ALTER TABLE review_decisions ADD CONSTRAINT review_decisions_item_fk FOREIGN KEY (tenant_id, review_item_id) REFERENCES review_items(tenant_id, id);

END $$;
--> statement-breakpoint

-- 5. Drop and recreate the RLS function with text return type
DROP FUNCTION IF EXISTS uar_current_tenant_id();
--> statement-breakpoint

CREATE FUNCTION uar_current_tenant_id()
RETURNS text LANGUAGE sql STABLE AS
'SELECT NULLIF(current_setting(''uar.tenant_id'', true), '''')';
--> statement-breakpoint

-- 6. Recreate RLS policies (now using text comparison)
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
