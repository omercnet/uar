import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { applications } from './applications.js';
import { externalAccounts } from './external_accounts.js';
import { tenants } from './tenants.js';
import { userIdentities } from './user_identities.js';

export const accessGrants = pgTable(
  'access_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: uuid('application_id').notNull(),
    externalAccountId: uuid('external_account_id').notNull(),
    userIdentityId: text('user_identity_id'),
    grantType: text('grant_type').notNull(),
    grantValue: text('grant_value').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'access_grants_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
      name: 'access_grants_application_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.externalAccountId],
      foreignColumns: [externalAccounts.tenantId, externalAccounts.id],
      name: 'access_grants_external_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.userIdentityId],
      foreignColumns: [userIdentities.tenantId, userIdentities.id],
      name: 'access_grants_user_identity_fk',
    }),
    unique('access_grants_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('access_grants_tenant_account_grant_unique').on(
      table.tenantId,
      table.externalAccountId,
      table.grantType,
      table.grantValue,
    ),
    index('access_grants_tenant_id_idx').on(table.tenantId),
  ],
);
