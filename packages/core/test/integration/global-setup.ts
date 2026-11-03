// Legt die Testdatenbank opengeo_test an (falls nötig) und spielt das Schema ein.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { TEST_DATABASE_URL } from '../../vitest.integration.config.ts';

export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/_test$/.test(dbName)) throw new Error(`Testdatenbank muss auf _test enden, nicht ${dbName}`);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [dbName]);
  if (!rowCount) await client.query(`create database "${dbName}"`);
  await client.end();

  const dbPkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db');
  execFileSync(path.join(dbPkg, 'node_modules/.bin/drizzle-kit'), ['push', '--force'], {
    cwd: dbPkg, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: 'pipe',
  });
}
