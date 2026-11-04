import { defineConfig } from 'drizzle-kit';

// Schema changes: edit src/schema.ts, then `pnpm db:generate` and commit the new file in ./drizzle.
// `pnpm db:migrate` applies the migrations (also done by the Docker `migrate` service on every start).
// `pnpm db:push` (dev convenience) syncs the schema directly, without a migration – never on shared/production databases.
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://askmetry:askmetry@localhost:5433/askmetry' },
});
