import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { applications } from './applications.js';
import { tenants } from './tenants.js';
import { userIdentities } from './user_identities.js';

export const externalAccounts = pgTable(
  'external_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    applicationId: uuid('application_id').notNull(),
    userIdentityId: uuid('user_identity_id'),
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'external_accounts_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
      name: 'external_accounts_application_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.userIdentityId],
      foreignColumns: [userIdentities.tenantId, userIdentities.id],
      name: 'external_accounts_user_identity_fk',
    }),
    unique('external_accounts_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('external_accounts_tenant_application_external_id_unique').on(
      table.tenantId,
      table.applicationId,
      table.externalId,
    ),
    index('external_accounts_tenant_id_idx').on(table.tenantId),
  ],
);
