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
    const pg = new PGlite(process.env.PGLITE_DIR ?? './data/pgdata');
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
