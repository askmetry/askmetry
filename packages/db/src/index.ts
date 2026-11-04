import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export * from './schema.ts';
export { schema };

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://askmetry:askmetry@localhost:5433/askmetry',
  max: 10,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export const closeDb = () => pool.end();
