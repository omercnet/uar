import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'tenants',
  {
    tenantId: uuid('tenant_id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique('tenants_slug_unique').on(table.slug)],
);
