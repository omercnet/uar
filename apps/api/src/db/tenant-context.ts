import { sql } from 'drizzle-orm';

import type { DatabaseClient } from './client.js';

type TenantTransactionCallback = Parameters<DatabaseClient['transaction']>[0];

export type TenantDb = Parameters<TenantTransactionCallback>[0];

export class BlankTenantIdError extends Error {
  readonly tenantId: string;

  constructor(tenantId: string) {
    super('Tenant ID must be non-empty.');
    this.name = 'BlankTenantIdError';
    this.tenantId = tenantId;
  }
}

export async function withTenantTransaction<Result>(
  db: DatabaseClient,
  tenantId: string,
  fn: (tx: TenantDb) => Promise<Result>,
): Promise<Result> {
  const normalizedTenantId = tenantId.trim();

  if (normalizedTenantId.length === 0) {
    throw new BlankTenantIdError(tenantId);
  }

  return db.transaction(async (tx) => {
    // Security invariant: parameterized tenantId prevents SQL injection into set_config.
    // Security invariant: third arg true makes the GUC LOCAL to this transaction for pooled connections.
    await tx.execute(sql`select set_config('uar.tenant_id', ${normalizedTenantId}, true)`);

    return fn(tx);
  });
}
