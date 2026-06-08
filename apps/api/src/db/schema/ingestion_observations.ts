import { foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { ingestionRuns } from './ingestion_runs.js';
import { tenants } from './tenants.js';

// APPEND-ONLY: never UPDATE or DELETE rows.
export const ingestionObservations = pgTable(
  'ingestion_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    ingestionRunId: uuid('ingestion_run_id').notNull(),
    recordType: text('record_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'ingestion_observations_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.ingestionRunId],
      foreignColumns: [ingestionRuns.tenantId, ingestionRuns.id],
      name: 'ingestion_observations_ingestion_run_fk',
    }),
    unique('ingestion_observations_tenant_id_id_unique').on(table.tenantId, table.id),
    index('ingestion_observations_tenant_id_idx').on(table.tenantId),
  ],
);
