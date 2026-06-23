import { resolve } from 'node:path';

import { createDatabaseClient, migrateDatabase } from '@uar/api';

/**
 * Playwright globalSetup for the full-flow e2e against the REAL api server.
 *
 * The api DB-gated unit tests drop/recreate tables between runs, so the schema
 * is left empty after `pnpm -r test`. This setup drops + re-migrates a clean
 * schema (creating the `uar_app` RLS role via migration 0005) and seeds the
 * STUB_AUTHZ tenant + reviewer identity the server runs as. Migrations and seeds
 * run on the owner/superuser connection (useAppRole: false) so they bypass RLS.
 */
export const E2E_TENANT_ID = '11111111-1111-4111-8111-111111111111';
export const E2E_REVIEWER_USER_ID = '22222222-2222-4222-8222-222222222222';

export default async function globalSetup(): Promise<void> {
  const reset = createDatabaseClient(undefined, { useAppRole: false });
  try {
    await reset.client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await reset.client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await reset.client.unsafe('CREATE SCHEMA public');
  } finally {
    await reset.client.end({ timeout: 5 });
  }

  await migrateDatabase({ migrationsFolder: resolve(process.cwd(), 'apps/api/drizzle') });

  const seed = createDatabaseClient(undefined, { useAppRole: false });
  try {
    await seed.client`INSERT INTO tenants (tenant_id, slug, name) VALUES (${E2E_TENANT_ID}, 'e2e', 'E2E Tenant') ON CONFLICT DO NOTHING`;
    await seed.client`INSERT INTO user_identities (id, tenant_id, primary_email, display_name) VALUES (${E2E_REVIEWER_USER_ID}, ${E2E_TENANT_ID}, 'reviewer@e2e.test', 'E2E Reviewer') ON CONFLICT DO NOTHING`;
  } finally {
    await seed.client.end({ timeout: 5 });
  }
}
