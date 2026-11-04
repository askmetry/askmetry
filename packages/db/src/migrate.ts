// Applies the versioned migrations in ../drizzle (generated with `pnpm db:generate`).
//
//   pnpm db:migrate                       # DATABASE_URL or the dev database on localhost:5433
//   node src/migrate.ts                   # same, inside the Docker image (`migrate` service)
//
// Three cases:
// - empty database: all migrations run.
// - database created earlier with `drizzle-kit push` (no drizzle.__drizzle_migrations yet): the schema is compared
//   with the baseline snapshot; if it matches, the baseline is recorded as applied WITHOUT running it, then any newer
//   migrations run. If it does not match, nothing is changed and the error explains how to fix it.
// - already migrated: only new migrations run; a second run does nothing.
//
// A session-level advisory lock serialises concurrent starts (drizzle's migrate() has none of its own).
// Runs with plain `node` (type stripping) – no TS-only runtime syntax (enums, namespaces, …); erasableSyntaxOnly enforces it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));
// Same defaults as drizzle-orm's pg migrator (pg-core/dialect.js); passed explicitly so both sides always agree.
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';
// Fixed key for pg_advisory_lock, shared by every Askmetry migrate run against the same database
const LOCK_NAME = 'askmetry:migrate';

type Log = (msg: string) => void;

interface SnapshotColumn { name: string; type: string; typeSchema?: string; notNull: boolean }
interface SnapshotTable {
  name: string; schema: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, { name: string }>;
  foreignKeys: Record<string, { name: string }>;
  compositePrimaryKeys: Record<string, { name: string }>;
  uniqueConstraints: Record<string, { name: string }>;
}
interface Snapshot {
  tables: Record<string, SnapshotTable>;
  enums: Record<string, { name: string; schema: string; values: string[] }>;
}

export class BaselineMismatchError extends Error {}

const norm = (t: string) => t.replace(/\s+/g, '').replace(/^"public"\.|^public\./, '').toLowerCase();

/** Compares the live database with a drizzle-kit snapshot; returns a list of human-readable differences. */
export async function diffAgainstSnapshot(client: pg.ClientBase, snapshot: Snapshot): Promise<string[]> {
  const problems: string[] = [];
  const cols = await client.query<{ schema: string; table: string; column: string; type: string; not_null: boolean }>(`
    select n.nspname as schema, c.relname as table, a.attname as column,
           format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      and n.nspname not in ('pg_catalog', 'information_schema')`);
  const live = new Map<string, Map<string, { type: string; notNull: boolean }>>();
  for (const r of cols.rows) {
    const key = `${r.schema}.${r.table}`;
    if (!live.has(key)) live.set(key, new Map());
    live.get(key)!.set(r.column, { type: r.type, notNull: r.not_null });
  }

  for (const t of Object.values(snapshot.tables)) {
    const key = `${t.schema || 'public'}.${t.name}`;
    const liveCols = live.get(key);
    if (!liveCols) { problems.push(`table ${key} is missing`); continue; }
    for (const c of Object.values(t.columns)) {
      const lc = liveCols.get(c.name);
      if (!lc) { problems.push(`column ${key}.${c.name} is missing`); continue; }
      if (norm(lc.type) !== norm(c.type)) problems.push(`column ${key}.${c.name} has type ${lc.type}, expected ${c.type}`);
      if (lc.notNull !== Boolean(c.notNull)) problems.push(`column ${key}.${c.name} is ${lc.notNull ? 'NOT NULL' : 'nullable'}, expected ${c.notNull ? 'NOT NULL' : 'nullable'}`);
    }
  }

  const enums = await client.query<{ schema: string; name: string; values: string[] }>(`
    select n.nspname as schema, t.typname as name, array_agg(e.enumlabel order by e.enumsortorder)::text[] as values
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
    group by 1, 2`);
  const liveEnums = new Map(enums.rows.map((r) => [`${r.schema}.${r.name}`, r.values]));
  for (const e of Object.values(snapshot.enums)) {
    const key = `${e.schema || 'public'}.${e.name}`;
    const values = liveEnums.get(key);
    if (!values) problems.push(`enum ${key} is missing`);
    else if (e.values.some((v) => !values.includes(v))) problems.push(`enum ${key} has values (${values.join(', ')}), expected (${e.values.join(', ')})`);
  }

  // Indexes and constraints by name (drizzle-kit names them deterministically, push and generate alike)
  const rels = await client.query<{ schema: string; name: string }>(`
    select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'i'
    union all
    select n.nspname, con.conname from pg_constraint con join pg_namespace n on n.oid = con.connamespace`);
  const liveNames = new Set(rels.rows.map((r) => `${r.schema}.${r.name}`));
  for (const t of Object.values(snapshot.tables)) {
    const schema = t.schema || 'public';
    const named = [
      ...Object.values(t.indexes).map((x) => ['index', x.name]),
      ...Object.values(t.foreignKeys).map((x) => ['foreign key', x.name]),
      ...Object.values(t.compositePrimaryKeys).map((x) => ['primary key', x.name]),
      ...Object.values(t.uniqueConstraints).map((x) => ['unique constraint', x.name]),
    ];
    for (const [kind, name] of named) {
      if (!liveNames.has(`${schema}.${name}`)) problems.push(`${kind} ${schema}.${name} (table ${t.name}) is missing`);
    }
  }
  return problems;
}

function readBaselineSnapshot(folder: string): { snapshot: Snapshot; tag: string } {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
  const first = journal.entries[0];
  if (!first) throw new Error(`no migrations in ${folder}`);
  const file = path.join(folder, 'meta', `${String(first.idx).padStart(4, '0')}_snapshot.json`);
  return { snapshot: JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot, tag: first.tag };
}

export interface MigrateResult { baselined: boolean; applied: number; total: number }

export async function runMigrations(
  databaseUrl: string,
  { log = console.log, migrationsFolder = MIGRATIONS_FOLDER }: { log?: Log; migrationsFolder?: string } = {},
): Promise<MigrateResult> {
  const migrations = readMigrationFiles({ migrationsFolder });
  if (!migrations.length) throw new Error(`no migrations found in ${migrationsFolder}`);
  // drizzle decides by timestamp only (created_at < folderMillis), so the journal must be strictly increasing
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.folderMillis <= migrations[i - 1]!.folderMillis) {
      throw new Error(`migration #${i} in ${migrationsFolder}/meta/_journal.json is not newer than #${i - 1} ("when" must increase); regenerate it with pnpm db:generate`);
    }
  }
  const tableSql = `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`;

  // One dedicated connection: the advisory lock is per session, and drizzle's transaction must run on the same session.
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [LOCK_NAME]);
    // Fail instead of hanging forever if old web/worker containers still hold locks on a table a migration alters
    await client.query("set lock_timeout = '60s'");

    const countApplied = async () => {
      const { rows } = await client.query<{ n: number }>(
        `select case when to_regclass($1) is null then -1 else 0 end::int as n`, [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`]);
      if (rows[0]!.n < 0) return 0;
      const r = await client.query<{ n: number }>(`select count(*)::int as n from ${tableSql}`);
      return r.rows[0]!.n;
    };

    const before = await countApplied();
    let baselined = false;
    if (before === 0) {
      const { snapshot, tag } = readBaselineSnapshot(migrationsFolder);
      const tables = Object.values(snapshot.tables).map((t) => `${t.schema || 'public'}.${t.name}`);
      const { rows } = await client.query<{ n: number }>(
        'select count(*)::int as n from unnest($1::text[]) t where to_regclass(quote_ident(split_part(t, \'.\', 1)) || \'.\' || quote_ident(split_part(t, \'.\', 2))) is not null',
        [tables]);
      const existing = rows[0]!.n;
      if (existing > 0) {
        // Created with `drizzle-kit push` before migrations existed: adopt it if (and only if) it matches the baseline.
        const problems = await diffAgainstSnapshot(client, snapshot);
        if (problems.length) {
          throw new BaselineMismatchError([
            `The database already contains Askmetry tables (${existing} of ${tables.length}) but no migration history,`,
            `and its schema does not match the baseline migration ${tag}. Nothing was changed.`,
            '',
            'Differences:',
            ...problems.slice(0, 50).map((p) => `  - ${p}`),
            ...(problems.length > 50 ? [`  … and ${problems.length - 50} more`] : []),
            '',
            'How to fix:',
            '  1. Back up the database (pg_dump).',
            '  2. Bring the schema to exactly the baseline state with drizzle-kit push, from a source checkout at the commit',
            `     that added drizzle/${tag}.sql (git log --diff-filter=A -- packages/db/drizzle/${tag}.sql):`,
            '       DATABASE_URL=postgres://… pnpm --filter @askmetry/db exec drizzle-kit push',
            '     It lists the changes and asks before anything that would drop data.',
            `     Docker: check out the commit BEFORE that one (its migrate service still uses drizzle-kit push) and run`,
            '       docker compose run --rm --build -it migrate',
            '     then check out the current version again.',
            '  3. Run the migration again (pnpm db:migrate, or `docker compose up -d`). It then records the baseline as applied.',
            'If the database is not an Askmetry database at all, point DATABASE_URL at an empty database instead.',
          ].join('\n'));
        }
        await client.query(`create schema if not exists "${MIGRATIONS_SCHEMA}"`);
        // Same DDL as drizzle-orm's migrate(), so it keeps working with the table afterwards
        await client.query(`create table if not exists ${tableSql} (id serial primary key, hash text not null, created_at bigint)`);
        const base = migrations[0]!;
        await client.query(`insert into ${tableSql} (hash, created_at) values ($1, $2)`, [base.hash, base.folderMillis]);
        baselined = true;
        log(`Existing schema matches baseline ${tag}: recorded as applied (not executed).`);
      }
    }

    // drizzle would silently skip a migration older than the newest applied one (e.g. two branches merged out of order)
    if (before > 0 || baselined) {
      const { rows: recorded } = await client.query<{ created_at: string }>(`select created_at from ${tableSql}`);
      const done = new Set(recorded.map((r) => Number(r.created_at)));
      const newest = Math.max(...done);
      const skipped = migrations.filter((m) => m.folderMillis <= newest && !done.has(m.folderMillis));
      if (skipped.length) {
        throw new Error(`${skipped.length} migration(s) are older than the newest applied one and would never run `
          + `(when: ${skipped.map((m) => m.folderMillis).join(', ')}). Regenerate them on top of the current migrations.`);
      }
    }

    await migrate(drizzle(client), { migrationsFolder, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE });
    const after = await countApplied();
    const applied = after - before - (baselined ? 1 : 0);
    log(applied > 0
      ? `Applied ${applied} migration(s); ${after} of ${migrations.length} recorded.`
      : `Database is up to date (${after} of ${migrations.length} migrations recorded).`);
    return { baselined, applied, total: after };
  } finally {
    // Closing the session also releases the advisory lock
    await client.end().catch(() => {});
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL ?? 'postgres://askmetry:askmetry@localhost:5433/askmetry';
  runMigrations(url).then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err instanceof BaselineMismatchError ? `Migration aborted.\n${err.message}` : err);
      process.exit(1);
    },
  );
}
