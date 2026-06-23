import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { migrate as runDrizzleMigrations } from 'drizzle-orm/postgres-js/migrator';

import { createDatabaseClient, getDatabaseUrl } from './client.js';

export interface MigrateDatabaseOptions {
  databaseUrl?: string;
  migrationsFolder?: string;
}

export async function migrateDatabase(options: MigrateDatabaseOptions = {}): Promise<void> {
  const { databaseUrl = getDatabaseUrl(), migrationsFolder = resolve(process.cwd(), 'drizzle') } = options;
  const { client, db } = createDatabaseClient(databaseUrl, { max: 1, useAppRole: false });

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
