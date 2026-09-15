/**
 * Fase 0 — prova de conceito do Worker.
 *
 * Objectivo: demonstrar, contra a base real, os dois riscos maiores da port
 * Express→Hono antes de escrever milhares de linhas:
 *   1. ligações TCP+TLS ao Postgres (Supabase) a partir do runtime workerd;
 *   2. o modelo de resposta da app (dados reais ou estado vazio explícito).
 *
 * Driver: `pg` (node-postgres) — o mesmo da app real (src/db/index.ts), com
 * exemplo de primeira classe na documentação Cloudflare/Hyperdrive.
 * Nota: `max: 1` e fecho no fim do pedido — o workerd não mantém sockets
 * entre invocações com a fiabilidade do Node de longa duração.
 */
import { Hono } from 'hono';
import pg from 'pg';

type Bindings = { DATABASE_URL?: string };
const app = new Hono<{ Bindings: Bindings }>();

function pool(env: Bindings): pg.Pool {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida (wrangler secret put DATABASE_URL)');
  return new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 8000,
  });
}

app.get('/api/health', async (c) => {
  const p = pool(c.env);
  try {
    const r = await p.query('SELECT version() AS v');
    return c.json({ status: 'ok', db: 'up', postgres: String(r.rows[0].v).slice(0, 34), runtime: 'cloudflare-workers' });
  } catch (e) {
    return c.json({ status: 'degraded', db: 'down', error: String((e as Error).message).slice(0, 120) }, 503);
  } finally {
    await p.end().catch(() => {});
  }
});

app.get('/api/status', async (c) => {
  const p = pool(c.env);
  try {
    const tables = await p.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`);
    return c.json({ db: 'up', tables_public: tables.rows[0].n, note: tables.rows[0].n === 0 ? 'schema ainda não migrado pela app' : 'schema presente' });
  } catch (e) {
    return c.json({ db: 'down', error: String((e as Error).message).slice(0, 120) }, 503);
  } finally {
    await p.end().catch(() => {});
  }
});

app.get('/', (c) => c.text('Global News Intelligence — Worker (Fase 0). Endpoints: /api/health, /api/status'));

export default app;
