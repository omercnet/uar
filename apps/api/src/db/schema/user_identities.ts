import { foreignKey, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const userIdentities = pgTable(
  'user_identities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    primaryEmail: text('primary_email').notNull(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'user_identities_tenant_id_fk',
    }),
    unique('user_identities_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('user_identities_tenant_email_unique').on(table.tenantId, table.primaryEmail),
    index('user_identities_tenant_id_idx').on(table.tenantId),
  ],
);
