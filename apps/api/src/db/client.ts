import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export const DEFAULT_DATABASE_URL = 'postgres://uar:uar_dev_password@localhost:5433/uar';
export const APP_DATABASE_ROLE = 'uar_app';

type PostgresOptions = Parameters<typeof postgres>[1];
type DatabaseClientOptions = PostgresOptions & { readonly useAppRole?: boolean };

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function createDatabaseClient(databaseUrl = getDatabaseUrl(), options?: DatabaseClientOptions) {
  const client = postgres(databaseUrl, toPostgresOptions(options));
  const db = drizzle(client, { schema });

  return { client, db };
}

function toPostgresOptions(options: DatabaseClientOptions | undefined): PostgresOptions {
  const { useAppRole = true, ...postgresOptions } = options ?? {};
  if (!useAppRole) {
    return postgresOptions;
  }

  return {
    ...postgresOptions,
    connection: {
      ...postgresOptions.connection,
      options: `-c role=${APP_DATABASE_ROLE}`,
    },
  };
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>['db'];
export type DatabaseConnection = ReturnType<typeof postgres>;
