import postgres from 'postgres';

export type SqlClient = ReturnType<typeof postgres>;

export const tenantScopedTables = [
  'tenants',
  'applications',
  'user_identities',
  'external_accounts',
  'access_grants',
  'ingestion_runs',
  'ingestion_observations',
  'snapshots',
  'snapshot_nodes',
  'snapshot_edges',
  'connector_credentials',
  'review_campaigns',
  'review_items',
  'review_assignments',
  'review_decisions',
] as const;

export async function canConnect(url: string): Promise<boolean> {
  const sql = postgres(url, {
    connect_timeout: 1,
    idle_timeout: 1,
    max: 1,
  });

  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function resetUarDatabase(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });

  try {
    await sql`drop table if exists review_decisions cascade`;
    await sql`drop table if exists review_assignments cascade`;
    await sql`drop table if exists review_items cascade`;
    await sql`drop table if exists review_campaigns cascade`;
    await sql`drop table if exists snapshot_edges cascade`;
    await sql`drop table if exists snapshot_nodes cascade`;
    await sql`drop table if exists snapshots cascade`;
    await sql`drop table if exists ingestion_observations cascade`;
    await sql`drop table if exists access_grants cascade`;
    await sql`drop table if exists connector_credentials cascade`;
    await sql`drop table if exists external_accounts cascade`;
    await sql`drop table if exists ingestion_runs cascade`;
    await sql`drop table if exists applications cascade`;
    await sql`drop table if exists user_identities cascade`;
    await sql`drop table if exists tenants cascade`;
    await sql`drop function if exists enforce_snapshot_lifecycle_transition() cascade`;
    await sql`drop function if exists reject_frozen_snapshot_record_mutation() cascade`;
    await sql`drop function if exists uar_current_tenant_id() cascade`;
    await sql`drop type if exists review_decision_action cascade`;
    await sql`drop type if exists review_item_status cascade`;
    await sql`drop type if exists review_campaign_status cascade`;
    await sql`drop type if exists snapshot_lifecycle cascade`;
    await sql`drop schema if exists drizzle cascade`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function setTenantContext(sql: SqlClient, tenantId: string): Promise<void> {
  await sql`select set_config('uar.tenant_id', ${tenantId}, false)`;
}
