/**
 * Database access layer.
 *
 * Two drivers, one SQL dialect (PostgreSQL):
 *   - DATABASE_URL set  -> node-postgres against Render Postgres
 *   - otherwise         -> PGlite (embedded Postgres) at ./data/pgdata
 *
 * There is no third "mock" driver on purpose: the app must never run against
 * fabricated data. If the database is unreachable the API fails loudly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Db {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  driver: 'postgres' | 'pglite';
}

let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX ?? 8),
    });
    db = {
      driver: 'postgres',
      async query(sql, params = []) {
        const r = await pool.query(sql, params);
        return r.rows as any[];
      },
      async exec(sql) {
        await pool.query(sql);
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR ?? './data/pgdata';
    let pg: InstanceType<typeof PGlite>;
    try {
      pg = new PGlite(dir);
      // Force initialisation now so a corrupt directory fails here, where it can
      // be handled, rather than on the first real query.
      await pg.query('SELECT 1');
    } catch (err) {
      // A local PGlite directory can be left unusable by an unclean shutdown.
      // This is the embedded DEV database only: every row in it is re-derivable
      // by re-running ingestion against the live feeds, so recreating it loses
      // nothing real. Production uses DATABASE_URL and never takes this path.
      if (process.env.NODE_ENV === 'production' || process.env.PGLITE_NO_RESET === 'true') throw err;
      const { rmSync, mkdirSync } = await import('node:fs');
      console.warn(`[db] embedded database at ${dir} is unreadable (${String((err as Error)?.message ?? err).slice(0, 120)}).`);
      console.warn('[db] recreating it — dev data only, and it is re-fetched from the real sources on the next cycle.');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      pg = new PGlite(dir);
      await pg.query('SELECT 1');
    }
    db = {
      driver: 'pglite',
      async query(sql, params = []) {
        const r = await pg.query(sql, params);
        return r.rows as any[];
      },
      async exec(sql) {
        await pg.exec(sql);
      },
    };
  }
  return db;
}

export async function migrate(): Promise<void> {
  const d = await getDb();
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await d.exec(sql);
}

/** Positional params: PGlite and pg both use $1..$n, so nothing to translate. */
export function nowIso(): string {
  return new Date().toISOString();
}
