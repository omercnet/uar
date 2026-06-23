import { pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'tenants',
  {
    tenantId: text('tenant_id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique('tenants_slug_unique').on(table.slug)],
);
