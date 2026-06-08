import { pathToFileURL } from 'node:url';

import { createDatabaseClient } from './client.js';
import {
  accessGrants,
  applications,
  externalAccounts,
  ingestionObservations,
  ingestionRuns,
  tenants,
  userIdentities,
} from './schema/index.js';

const seedTenantId = '11111111-1111-4111-8111-111111111111';
const seedUserIdentityId = '22222222-2222-4222-8222-222222222222';
const seedApplicationId = '33333333-3333-4333-8333-333333333333';
const seedExternalAccountId = '44444444-4444-4444-8444-444444444444';
const seedAccessGrantId = '55555555-5555-4555-8555-555555555555';
const seedIngestionRunId = '66666666-6666-4666-8666-666666666666';
const seedObservationId = '77777777-7777-4777-8777-777777777777';

export async function seedDatabase(): Promise<void> {
  const { client, db } = createDatabaseClient();

  try {
    await db
      .insert(tenants)
      .values({
        tenantId: seedTenantId,
        slug: 'acme',
        name: 'Acme Corp',
      })
      .onConflictDoNothing();

    await db
      .insert(userIdentities)
      .values({
        id: seedUserIdentityId,
        tenantId: seedTenantId,
        primaryEmail: 'ada@example.com',
        displayName: 'Ada Lovelace',
      })
      .onConflictDoNothing();

    await db
      .insert(applications)
      .values({
        id: seedApplicationId,
        tenantId: seedTenantId,
        key: 'github',
        name: 'GitHub',
        connectorId: 'github-oauth',
      })
      .onConflictDoNothing();

    await db
      .insert(externalAccounts)
      .values({
        id: seedExternalAccountId,
        tenantId: seedTenantId,
        applicationId: seedApplicationId,
        userIdentityId: seedUserIdentityId,
        externalId: 'ada-github',
        displayName: 'ada-github',
      })
      .onConflictDoNothing();

    await db
      .insert(accessGrants)
      .values({
        id: seedAccessGrantId,
        tenantId: seedTenantId,
        applicationId: seedApplicationId,
        externalAccountId: seedExternalAccountId,
        userIdentityId: seedUserIdentityId,
        grantType: 'role',
        grantValue: 'admin',
        source: 'seed',
      })
      .onConflictDoNothing();

    await db
      .insert(ingestionRuns)
      .values({
        id: seedIngestionRunId,
        tenantId: seedTenantId,
        connectorId: 'github-oauth',
        status: 'completed',
        finishedAt: new Date(),
        cursor: { next: null },
      })
      .onConflictDoNothing();

    await db
      .insert(ingestionObservations)
      .values({
        id: seedObservationId,
        tenantId: seedTenantId,
        ingestionRunId: seedIngestionRunId,
        recordType: 'external_account',
        payload: {
          applicationKey: 'github',
          externalId: 'ada-github',
        },
      })
      .onConflictDoNothing();
  } finally {
    await client.end({ timeout: 5 });
  }
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];

  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  await seedDatabase();
}
