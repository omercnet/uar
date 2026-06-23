import { Signer } from '@aws-sdk/rds-signer';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export const DEFAULT_DATABASE_URL = 'postgres://uar:uar_dev_password@localhost:5433/uar';
export const APP_DATABASE_ROLE = 'uar_app';

type PostgresOptions = Parameters<typeof postgres>[1];
type DatabaseClientOptions = PostgresOptions & { readonly useAppRole?: boolean };

/**
 * Build a DATABASE_URL from Aurora IAM auth env vars (Vercel Aurora integration).
 *
 * When Vercel's Amazon Aurora PostgreSQL integration is used, it sets:
 *   PGHOST, PGPORT, PGUSER, PGDATABASE, PGSSLMODE,
 *   AWS_REGION, AWS_ROLE_ARN, AWS_RESOURCE_ARN, AWS_ACCOUNT_ID
 *
 * We use @aws-sdk/rds-signer to generate a short-lived IAM auth token and
 * embed it as the password in the connection URL. The token is valid for 15
 * minutes — long enough for a single request or migration run.
 */
async function buildAuroraUrl(): Promise<string | null> {
  const host = process.env.PGHOST;
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER;
  const database = process.env.PGDATABASE;
  const region = process.env.AWS_REGION;

  if (!host || !user || !database || !region) return null;

  const signer = new Signer({ hostname: host, port: Number(port), username: user, region });
  const token = await signer.getAuthToken();
  const ssl = process.env.PGSSLMODE !== 'disable' ? '?sslmode=require' : '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(token)}@${host}:${port}/${database}${ssl}`;
}

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * Create a Drizzle database client.
 *
 * Pass `databaseUrl` explicitly, or omit to use DATABASE_URL / the default.
 * For Aurora IAM auth, use `createDatabaseClientAsync()` instead.
 */
export function createDatabaseClient(databaseUrl = getDatabaseUrl(), options?: DatabaseClientOptions) {
  const client = postgres(databaseUrl, toPostgresOptions(options));
  const db = drizzle(client, { schema });
  return { client, db };
}

/**
 * Async variant that resolves Aurora IAM auth when DATABASE_URL is not set
 * but Aurora env vars (PGHOST, PGUSER, etc.) are present.
 */
export async function createDatabaseClientAsync(options?: DatabaseClientOptions) {
  const url = process.env.DATABASE_URL ?? (await buildAuroraUrl()) ?? DEFAULT_DATABASE_URL;
  return createDatabaseClient(url, options);
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
