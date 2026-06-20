CREATE OR REPLACE FUNCTION "uar_current_tenant_id"()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('uar.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenants_tenant_isolation" ON "tenants" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "applications_tenant_isolation" ON "applications" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "user_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "user_identities_tenant_isolation" ON "user_identities" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "external_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "external_accounts_tenant_isolation" ON "external_accounts" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "access_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "access_grants_tenant_isolation" ON "access_grants" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "ingestion_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ingestion_runs_tenant_isolation" ON "ingestion_runs" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "ingestion_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_observations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ingestion_observations_tenant_isolation" ON "ingestion_observations" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "snapshots_tenant_isolation" ON "snapshots" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "snapshot_nodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "snapshot_nodes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "snapshot_nodes_tenant_isolation" ON "snapshot_nodes" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "snapshot_edges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "snapshot_edges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "snapshot_edges_tenant_isolation" ON "snapshot_edges" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "connector_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "connector_credentials_tenant_isolation" ON "connector_credentials" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "review_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_campaigns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "review_campaigns_tenant_isolation" ON "review_campaigns" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "review_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "review_items_tenant_isolation" ON "review_items" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "review_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "review_assignments_tenant_isolation" ON "review_assignments" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());--> statement-breakpoint
ALTER TABLE "review_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "review_decisions_tenant_isolation" ON "review_decisions" USING ("tenant_id" = "uar_current_tenant_id"()) WITH CHECK ("tenant_id" = "uar_current_tenant_id"());
