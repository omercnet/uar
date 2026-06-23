import type { EncryptedSecretEnvelope } from '@uar/core';
import { foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { applications } from './applications.js';
import { tenants } from './tenants.js';

export const connectorCredentials = pgTable(
  'connector_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: uuid('application_id').notNull(),
    name: text('name').notNull(),
    encryptedSecret: jsonb('encrypted_secret').$type<EncryptedSecretEnvelope>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.tenantId],
      name: 'connector_credentials_tenant_id_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
      name: 'connector_credentials_application_fk',
    }),
    unique('connector_credentials_tenant_id_id_unique').on(table.tenantId, table.id),
    unique('connector_credentials_tenant_application_name_unique').on(
      table.tenantId,
      table.applicationId,
      table.name,
    ),
    index('connector_credentials_tenant_id_idx').on(table.tenantId),
  ],
);
