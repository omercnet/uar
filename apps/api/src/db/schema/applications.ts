import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    connectorId: text('connector_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'applications_tenant_id_fk',
    }),
    unique('applications_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('applications_tenant_key_unique').on(table.tenantId, table.key),
    index('applications_tenant_id_idx').on(table.tenantId),
  ],
);
