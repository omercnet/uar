import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export const DEFAULT_DATABASE_URL = 'postgres://uar:uar_dev_password@localhost:5433/uar';

type PostgresOptions = Parameters<typeof postgres>[1];

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function createDatabaseClient(databaseUrl = getDatabaseUrl(), options?: PostgresOptions) {
  const client = options === undefined ? postgres(databaseUrl) : postgres(databaseUrl, options);
  const db = drizzle(client, { schema });

  return { client, db };
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>['db'];
export type DatabaseConnection = ReturnType<typeof postgres>;
