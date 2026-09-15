/**
 * Global News Intelligence — Cloudflare Worker (Fase 1)
 *
 * Rotas públicas de API (JSON) que provam a camada de dados completa
 * a funcionar no edge da Cloudflare via Hyperdrive → Supabase.
 *
 * Rotas HTML (server-rendering) ficam para a Fase 2.
 * Ingestão fica para a Fase 3 (Edge Function agendada no Supabase).
 */
import { Hono } from 'hono';
import pg from 'pg';
import { publishedEvents, eventDetail, systemStatus, searchEvents, mapEvents } from './data';
import { registerHtmlRoutes } from './html';

type Bindings = { DATABASE_URL?: string; HYPERDRIVE?: Hyperdrive };
type Variables = { pool: pg.Pool };
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* ---------------------------------------------------------------- middleware: pool per request */

app.use('*', async (c, next) => {
  const url = c.env.HYPERDRIVE ? c.env.HYPERDRIVE.connectionString : c.env.DATABASE_URL;
  if (!url) return c.json({ error: 'DATABASE_URL não definida' }, 503);
  const p = new pg.Pool({ connectionString: url, ssl: c.env.HYPERDRIVE ? false : { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 8000 });
  c.set('pool', p);
  try { await next(); } finally { await p.end().catch(() => {}); }
});

/* ---------------------------------------------------------------- GET /api/health */

app.get('/api/health', async (c) => {
  const p = c.get('pool');
  try {
    const r = await p.query('SELECT version() AS v');
    return c.json({ status: 'ok', db: 'up', postgres: String(r.rows[0].v).slice(0, 34), via: c.env.HYPERDRIVE ? 'hyperdrive' : 'direct', runtime: 'cloudflare-workers' });
  } catch (e) {
    return c.json({ status: 'degraded', db: 'down', error: String((e as Error).message).slice(0, 120) }, 503);
  }
});

/* ---------------------------------------------------------------- GET /api/status */

app.get('/api/status', async (c) => {
  const p = c.get('pool');
  try {
    const status = await systemStatus(p);
    return c.json(status);
  } catch (e) {
    return c.json({ error: String((e as Error).message).slice(0, 200) }, 500);
  }
});

/* ---------------------------------------------------------------- GET /api/events */

app.get('/api/events', async (c) => {
  const p = c.get('pool');
  try {
    const events = await publishedEvents(p, {
      category: c.req.query('category') ?? undefined,
      country: c.req.query('country') ?? undefined,
      order: (c.req.query('order') as any) ?? 'recent',
      limit: Number(c.req.query('limit') ?? 30),
      offset: Number(c.req.query('offset') ?? 0),
      sinceHours: Number(c.req.query('since_hours') || 0) || undefined,
      minConfidence: c.req.query('min_confidence') != null ? Number(c.req.query('min_confidence')) : undefined,
      minImpact: c.req.query('min_impact') != null ? Number(c.req.query('min_impact')) : undefined,
    });
    return c.json({ events, total: events.length });
  } catch (e) {
    return c.json({ error: String((e as Error).message).slice(0, 200) }, 500);
  }
});

/* ---------------------------------------------------------------- GET /api/events/:id */

app.get('/api/events/:id', async (c) => {
  const p = c.get('pool');
  try {
    const detail = await eventDetail(p, c.req.param('id'));
    if (!detail) return c.json({ error: 'not_found' }, 404);
    return c.json(detail);
  } catch (e) {
    return c.json({ error: String((e as Error).message).slice(0, 200) }, 500);
  }
});

/* ---------------------------------------------------------------- GET /api/search */

app.get('/api/search', async (c) => {
  const p = c.get('pool');
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'q parameter required' }, 400);
  try {
    const events = await searchEvents(p, q);
    return c.json({ events, total: events.length, query: q });
  } catch (e) {
    return c.json({ error: String((e as Error).message).slice(0, 200) }, 500);
  }
});

/* ---------------------------------------------------------------- GET /api/map */

app.get('/api/map', async (c) => {
  const p = c.get('pool');
  try {
    const points = await mapEvents(p);
    return c.json({ points, total: points.length });
  } catch (e) {
    return c.json({ error: String((e as Error).message).slice(0, 200) }, 500);
  }
});

/* ---------------------------------------------------------------- GET /api/sources */

app.get('/api/sources', async (c) => {
  const p = c.get('pool');
  try {
    const r = await p.query(
      `SELECT s.id, s.name, s.homepage_url, s.origin_type, s.publisher_group, s.reliability_score,
              h.status, h.last_success_at, h.last_error, h.items_last_run, h.response_ms
       FROM source s LEFT JOIN source_health h ON h.source_id=s.id ORDER BY s.name`);
    return c.json({ sources: r.rows });
  } catch (e) {
    return c.json({ error: String((e as Error).message).slice(0, 200) }, 500);
  }
});

registerHtmlRoutes(app);

export default app;
