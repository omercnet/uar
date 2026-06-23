import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { migrate as runDrizzleMigrations } from 'drizzle-orm/postgres-js/migrator';

import { createDatabaseClient, createDatabaseClientAsync } from './client.js';

export interface MigrateDatabaseOptions {
  databaseUrl?: string;
  migrationsFolder?: string;
}

export async function migrateDatabase(options: MigrateDatabaseOptions = {}): Promise<void> {
  const {
    databaseUrl,
    migrationsFolder = process.env.UAR_MIGRATIONS_FOLDER ?? resolve(process.cwd(), 'drizzle'),
  } = options;

  // If an explicit URL was provided use it directly; otherwise resolve via
  // Aurora IAM auth (PGHOST + AWS_* env vars) or fall back to DATABASE_URL.
  const { client, db } = databaseUrl
    ? createDatabaseClient(databaseUrl, { max: 1, useAppRole: false })
    : await createDatabaseClientAsync({ max: 1, useAppRole: false });

  try {
    await runDrizzleMigrations(db, { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  await migrateDatabase();
}
