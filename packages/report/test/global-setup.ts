// Testdatenbank askmetry_test auf den aktuellen Migrationsstand bringen – ohne sie neu anzulegen
// (andere Test-Suites nutzen sie parallel; unsere Daten tragen ein Präfix und werden aufgeräumt).
import { runMigrations } from '@askmetry/db/migrate';
import pg from 'pg';
import { TEST_DATABASE_URL } from '../vitest.config.ts';

export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/_test$/.test(dbName)) throw new Error(`Testdatenbank muss auf _test enden, nicht ${dbName}`);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const r = await client.query('select 1 from pg_database where datname = $1', [dbName]);
    if (!r.rowCount) await client.query(`create database "${dbName}"`);
  } finally {
    await client.end();
  }
  await runMigrations(TEST_DATABASE_URL, { log: () => {} });
}
