import { defineConfig } from 'drizzle-kit';

const defaultDatabaseUrl = 'postgres://uar:uar_dev_password@localhost:5433/uar';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  },
});
