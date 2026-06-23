import { createServer, type Server } from 'node:http';

import type { TenantContext } from '@uar/core';

import { createDatabaseClient, getDatabaseUrl, type DatabaseClient } from '../../db/client.js';
import { migrateDatabase } from '../../db/migrate.js';
import { canConnect, resetUarDatabase } from '../../db/test-support.js';
import type { Route } from '../router.js';
import { createRouter } from '../router.js';

export const databaseUrl = getDatabaseUrl();
export const databaseReachable = await canConnect(databaseUrl);

export type TestServer = {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
};

export type InjectedServerInput = {
  readonly routes: readonly Route[];
  readonly db: DatabaseClient;
  readonly tenantContext: TenantContext;
};

export async function prepareMigratedDatabase(): Promise<ReturnType<typeof createDatabaseClient>> {
  await resetUarDatabase(databaseUrl);
  await migrateDatabase({ databaseUrl });

  return createDatabaseClient(databaseUrl, { max: 1 });
}

export async function startInjectedServer(input: InjectedServerInput): Promise<TestServer> {
  const routes = input.routes.map((route) => ({
    ...route,
    handler: (ctx) =>
      route.handler({
        req: ctx.req,
        res: ctx.res,
        params: ctx.params,
        url: ctx.url,
        db: input.db,
        tenantContext: input.tenantContext,
      }),
  })) satisfies readonly Route[];
  const server = createServer(createRouter(routes));

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return { baseUrl: serverBaseUrl(server), close: () => closeServer(server) };
}

function serverBaseUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP listener');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
