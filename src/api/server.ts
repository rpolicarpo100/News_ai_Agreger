/**
 * HTTP API + server-rendered frontend.
 *
 * Every endpoint returns real rows or an explicit empty/unavailable state.
 * There is no code path in this file that manufactures an event, a score or a view.
 */
import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDb, migrate } from '../db/index.js';
import { runIngestion, registerSources } from '../ingestion/ingest.js';
import { runClustering } from '../pipeline/cluster.js';
import { runIntelligenceCycle, processEvent } from '../agents/orchestrator.js';
import { freshness, relativePt } from '../pipeline/freshness.js';
import { recordView, viewCounts } from '../pipeline/views.js';
import { secureHeaders, rateLimit, requireAdmin, clientIp } from './security.js';
import { allFlags, setFlag, FLAGS, getFlag } from '../core/flags.js';
import { audit } from '../core/audit.js';
import { CATEGORY_LABELS_PT } from '../pipeline/classify.js';
import { renderHome, renderEvent, renderList, renderMap, renderAbout, renderSupport, renderStatus } from '../web/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(secureHeaders);

// ---------------------------------------------------------------- helpers
async function publishedEvents(opts: {
  category?: string; country?: string; limit?: number; offset?: number;
  minConfidence?: number; minImpact?: number; order?: 'recent' | 'relevance' | 'impact' | 'trending' | 'views';
  sinceHours?: number;
} = {}) {
  const db = await getDb();
  const params: any[] = [];
  const where: string[] = [`e.status='PUBLISHED'`, `NOT e.is_test_data`];
  if (opts.category) { params.push(opts.category); where.push(`e.category=$${params.length}`); }
  if (opts.country) { params.push(opts.country.toUpperCase()); where.push(`e.country=$${params.length}`); }
  if (opts.sinceHours) { params.push(new Date(Date.now() - opts.sinceHours * 3600e3).toISOString()); where.push(`e.last_activity_at > $${params.length}`); }
  if (opts.minConfidence != null) { params.push(opts.minConfidence); where.push(`COALESCE(sc.confidence,-1) >= $${params.length}`); }
  if (opts.minImpact != null) { params.push(opts.minImpact); where.push(`COALESCE(sc.life_impact,-1) >= $${params.length}`); }

  const order = {
    recent: 'e.last_activity_at DESC',
    relevance: 'sc.relevance DESC NULLS LAST, e.last_activity_at DESC',
    impact: 'sc.life_impact DESC NULLS LAST, e.last_activity_at DESC',
    trending: 'sc.trending DESC NULLS LAST, e.last_activity_at DESC',
    views: 'vw.total DESC NULLS LAST, e.last_activity_at DESC',
  }[opts.order ?? 'recent'];

  params.push(Math.min(opts.limit ?? 30, 100));
  const limitIdx = params.length;
  params.push(opts.offset ?? 0);

  return db.query<any>(
    `SELECT e.*, sc.relevance, sc.confidence, sc.life_impact, sc.trending, sc.evidence_strength, sc.source_reliability,
            COALESCE(vw.total,0) AS views_total, COALESCE(vw.h24,0) AS views_24h
     FROM event e
     LEFT JOIN LATERAL (
       SELECT
         MAX(value) FILTER (WHERE kind='relevance')         AS relevance,
         MAX(value) FILTER (WHERE kind='confidence')        AS confidence,
         MAX(value) FILTER (WHERE kind='life_impact')       AS life_impact,
         MAX(value) FILTER (WHERE kind='trending')          AS trending,
         MAX(value) FILTER (WHERE kind='evidence_strength') AS evidence_strength,
         MAX(value) FILTER (WHERE kind='source_reliability') AS source_reliability
       FROM (SELECT DISTINCT ON (kind) kind, value FROM score WHERE event_id=e.id ORDER BY kind, computed_at DESC) s
     ) sc ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE counted) AS total,
              COUNT(*) FILTER (WHERE counted AND at > now() - interval '24 hours') AS h24
       FROM event_view WHERE event_id=e.id
     ) vw ON TRUE
     WHERE ${where.join(' AND ')}
     ORDER BY ${order} LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`, params);
}

function decorate(rows: any[]) {
  return rows.map((e) => {
    const f = freshness(e.category, e.last_activity_at);
    return {
      ...e,
      category_label: CATEGORY_LABELS_PT[e.category] ?? e.category,
      freshness: f.state,
      age_hours: Number(f.ageHours.toFixed(2)),
      updated_label: relativePt(e.last_activity_at),
      url: `/event/${e.id}/${e.slug}`,
    };
  });
}

// ---------------------------------------------------------------- JSON API
const api = express.Router();
api.use(rateLimit(120, 60_000));

api.get('/health', async (_req, res) => {
  const db = await getDb();
  try {
    const [{ n }] = await db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM event`);
    res.json({ status: 'ok', driver: db.driver, events: Number(n), time: new Date().toISOString() });
  } catch (err: any) {
    res.status(503).json({ status: 'degraded', error: String(err?.message ?? err) });
  }
});

api.get('/events', async (req, res) => {
  const rows = await publishedEvents({
    category: req.query.category as string | undefined,
    country: req.query.country as string | undefined,
    order: req.query.order as any,
    limit: Number(req.query.limit ?? 30),
    offset: Number(req.query.offset ?? 0),
    minConfidence: req.query.min_confidence ? Number(req.query.min_confidence) : undefined,
    minImpact: req.query.min_impact ? Number(req.query.min_impact) : undefined,
    sinceHours: req.query.since_hours ? Number(req.query.since_hours) : undefined,
  });
  res.json({ count: rows.length, events: decorate(rows), note: rows.length ? undefined : 'NO VERIFIED DATA AVAILABLE' });
});

api.get('/events/:id', async (req, res) => {
  const data = await eventDetail(String(req.params.id));
  if (!data) { res.status(404).json({ error: 'not_found' }); return; }
  res.json(data);
});

api.post('/events/:id/view', rateLimit(60, 60_000), async (req, res) => {
  const db = await getDb();
  const ex = await db.query(`SELECT 1 FROM event WHERE id=$1 AND status='PUBLISHED'`, [req.params.id]);
  if (!ex.length) { res.status(404).json({ error: 'not_found' }); return; }
  const out = await recordView(String(req.params.id), clientIp(req), String(req.headers['user-agent'] ?? ''));
  const counts = await viewCounts(String(req.params.id));
  res.json({ ...out, views: counts.total });
});

api.get('/sources', async (_req, res) => {
  const db = await getDb();
  const rows = await db.query(
    `SELECT s.id, s.name, s.homepage_url, s.feed_url, s.origin_type, s.country, s.language,
            s.publisher_group, s.reliability_score, s.reliability_basis, s.enabled, s.blocked,
            h.status, h.last_success_at, h.last_error, h.response_ms, h.items_last_run, h.consecutive_fail,
            (SELECT COUNT(*) FROM article a WHERE a.source_id=s.id) AS articles
     FROM source s LEFT JOIN source_health h ON h.source_id=s.id ORDER BY s.name`);
  res.json({ sources: rows });
});

api.get('/status', async (_req, res) => res.json(await systemStatus()));

api.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) { res.json({ query: q, results: [], note: 'INSUFFICIENT QUERY' }); return; }
  const db = await getDb();
  const parsed = parseNaturalQuery(q);
  const params: any[] = [`%${parsed.text.toLowerCase()}%`];
  const where = [`e.status='PUBLISHED'`, `(LOWER(e.title) LIKE $1 OR LOWER(COALESCE(e.place,'')) LIKE $1 OR EXISTS (SELECT 1 FROM article a WHERE a.event_id=e.id AND LOWER(a.title) LIKE $1))`];
  if (parsed.category) { params.push(parsed.category); where.push(`e.category=$${params.length}`); }
  if (parsed.country) { params.push(parsed.country); where.push(`e.country=$${params.length}`); }
  if (parsed.sinceHours) { params.push(new Date(Date.now() - parsed.sinceHours * 3600e3).toISOString()); where.push(`e.last_activity_at > $${params.length}`); }
  let having = '';
  if (parsed.minImpact != null) { params.push(parsed.minImpact); having = `AND COALESCE((SELECT value FROM score WHERE event_id=e.id AND kind='life_impact' ORDER BY computed_at DESC LIMIT 1),-1) >= $${params.length}`; }
  const rows = await db.query<any>(
    `SELECT e.* FROM event e WHERE ${where.join(' AND ')} ${having} ORDER BY e.last_activity_at DESC LIMIT 40`, params);
  res.json({ query: q, interpreted: parsed, count: rows.length, results: decorate(rows), note: rows.length ? undefined : 'NO VERIFIED DATA AVAILABLE' });
});

function parseNaturalQuery(q: string) {
  const lower = q.toLowerCase();
  const out: any = { text: q, category: null, country: null, minImpact: null, sinceHours: null };
  const impact = lower.match(/(?:life impact|impacto)\s*(?:above|acima de|>)?\s*(\d{1,3})/);
  if (impact) { out.minImpact = Number(impact[1]); out.text = out.text.replace(impact[0], '').trim(); }
  if (/\b(today|hoje|últimas 24|last 24)\b/.test(lower)) { out.sinceHours = 24; out.text = out.text.replace(/\b(today|hoje)\b/gi, '').trim(); }
  for (const [cat, label] of Object.entries(CATEGORY_LABELS_PT)) {
    if (lower.includes(label.toLowerCase()) || lower.includes(cat.replace('_', ' '))) { out.category = cat; break; }
  }
  const cc = lower.match(/\b(portugal|spain|espanha|france|frança|germany|alemanha|italy|itália|ukraine|ucrânia|russia|rússia|japan|japão|brazil|brasil|china|india|índia)\b/);
  if (cc) {
    const map: Record<string, string> = { portugal: 'PT', spain: 'ES', espanha: 'ES', france: 'FR', 'frança': 'FR', germany: 'DE', alemanha: 'DE', italy: 'IT', 'itália': 'IT', ukraine: 'UA', 'ucrânia': 'UA', russia: 'RU', 'rússia': 'RU', japan: 'JP', 'japão': 'JP', brazil: 'BR', brasil: 'BR', china: 'CN', india: 'IN', 'índia': 'IN' };
    out.country = map[cc[1]];
  }
  if (!out.text) out.text = '';
  return out;
}

api.get('/map', async (_req, res) => {
  const db = await getDb();
  const rows = await db.query<any>(
    `SELECT id, slug, title, category, lat, lon, geo_precision, place, country, last_activity_at
     FROM event WHERE status='PUBLISHED' AND lat IS NOT NULL AND lon IS NOT NULL
     ORDER BY last_activity_at DESC LIMIT 300`);
  res.json({ count: rows.length, points: rows, note: rows.length ? 'Points with geo_precision=approximate are gazetteer centroids, not reported coordinates.' : 'NO VERIFIED DATA AVAILABLE' });
});

app.use('/api', api);

// ---------------------------------------------------------------- admin API
const admin = express.Router();
admin.use(rateLimit(60, 60_000), requireAdmin);

admin.get('/flags', async (_req, res) => res.json(await allFlags()));
admin.post('/flags', async (req, res) => {
  const { key, value, reason } = req.body ?? {};
  if (!Object.values(FLAGS).includes(key) || typeof value !== 'string') { res.status(400).json({ error: 'invalid_flag' }); return; }
  await setFlag(key, value, 'admin', String(reason ?? 'no reason given'));
  res.json({ ok: true, flags: await allFlags() });
});
admin.post('/sources/:id/block', async (req, res) => {
  const db = await getDb();
  await db.query(`UPDATE source SET blocked=$2 WHERE id=$1`, [req.params.id, req.body?.blocked !== false]);
  await audit({ actor: 'admin', action: 'block_source', objectType: 'source', objectId: req.params.id, newState: req.body?.blocked !== false, reason: String(req.body?.reason ?? 'admin action') });
  res.json({ ok: true });
});
admin.get('/review-queue', async (_req, res) => {
  const db = await getDb();
  res.json({ items: await db.query(`SELECT r.*, e.title FROM review_queue r JOIN event e ON e.id=r.event_id WHERE r.state='open' ORDER BY r.priority DESC, r.created_at LIMIT 100`) });
});
admin.post('/review-queue/:id/resolve', async (req, res) => {
  const db = await getDb();
  const { decision, reason } = req.body ?? {};
  if (!['approved', 'rejected', 'held'].includes(decision)) { res.status(400).json({ error: 'invalid_decision' }); return; }
  const rows = await db.query<any>(`SELECT * FROM review_queue WHERE id=$1`, [Number(req.params.id)]);
  if (!rows.length) { res.status(404).json({ error: 'not_found' }); return; }
  await db.query(`UPDATE review_queue SET state=$2, resolved_by='admin', resolved_at=now() WHERE id=$1`, [Number(req.params.id), decision]);
  if (decision === 'approved') {
    await db.query(`UPDATE event SET status='PUBLISHED', published_at=COALESCE(published_at, now()) WHERE id=$1`, [rows[0].event_id]);
  }
  await audit({ actor: 'admin', action: 'review_resolve', objectType: 'event', objectId: rows[0].event_id, prevState: rows[0].state, newState: decision, reason: String(reason ?? 'human review') });
  res.json({ ok: true });
});
admin.get('/audit', async (req, res) => {
  const db = await getDb();
  res.json({ entries: await db.query(`SELECT * FROM audit_log ORDER BY at DESC LIMIT $1`, [Math.min(Number(req.query.limit ?? 100), 500)]) });
});
admin.post('/pipeline/run', async (_req, res) => {
  const ing = await runIngestion();
  const cl = await runClustering();
  const cy = await runIntelligenceCycle();
  res.json({ ingestion: ing, clustering: cl, intelligence: { processed: cy.length, published: cy.filter((c) => c.published).length } });
});
app.use('/api/admin', admin);

// ---------------------------------------------------------------- event detail
export async function eventDetail(id: string) {
  const db = await getDb();
  const ev = await db.query<any>(`SELECT * FROM event WHERE id=$1`, [id]);
  if (!ev.length) return null;
  const e = ev[0];
  const [articles, timeline, conflicts, scores, changes, runs, review, states] = await Promise.all([
    db.query(`SELECT a.id, a.url, a.title, a.summary, a.published_at, s.name AS source_name, s.homepage_url,
                     s.origin_type, s.publisher_group, s.reliability_score, s.reliability_basis
              FROM article a JOIN source s ON s.id=a.source_id WHERE a.event_id=$1 ORDER BY a.published_at NULLS LAST`, [id]),
    db.query(`SELECT t.at, t.label, t.article_id, s.name AS source_name, a.url
              FROM timeline_entry t LEFT JOIN source s ON s.id=t.source_id LEFT JOIN article a ON a.id=t.article_id
              WHERE t.event_id=$1 ORDER BY t.at ASC`, [id]),
    db.query(`SELECT * FROM conflict WHERE event_id=$1 AND NOT resolved`, [id]),
    db.query(`SELECT DISTINCT ON (kind) kind, value, factors, formula_ver, computed_at FROM score WHERE event_id=$1 ORDER BY kind, computed_at DESC`, [id]),
    db.query(`SELECT * FROM score_change WHERE event_id=$1 ORDER BY at DESC LIMIT 10`, [id]),
    db.query(`SELECT agent, agent_version, mode, model, model_version, status, confidence, output, started_at, duration_ms
              FROM agent_run WHERE event_id=$1 ORDER BY started_at DESC LIMIT 20`, [id]),
    db.query(`SELECT decision, findings, at FROM supervisor_review WHERE event_id=$1 ORDER BY at DESC LIMIT 1`, [id]),
    db.query(`SELECT from_state, to_state, reason, actor, at FROM event_state_history WHERE event_id=$1 ORDER BY at DESC LIMIT 20`, [id]),
  ]);
  const views = await viewCounts(id);
  const f = freshness(e.category, e.last_activity_at);

  // Related events (Section 29): shared country or category, overlapping window.
  const related = await db.query<any>(
    `SELECT id, slug, title, category, country, last_activity_at FROM event
     WHERE status='PUBLISHED' AND id<>$1 AND (country=$2 OR category=$3)
     ORDER BY ABS(EXTRACT(EPOCH FROM (last_activity_at - $4::timestamptz))) ASC LIMIT 6`,
    [id, e.country, e.category, e.last_activity_at]);

  const groups = new Map<string, string[]>();
  for (const a of articles as any[]) {
    const g = groups.get(a.publisher_group) ?? [];
    g.push(a.source_name); groups.set(a.publisher_group, g);
  }

  return {
    event: {
      ...e,
      category_label: CATEGORY_LABELS_PT[e.category] ?? e.category,
      freshness: f.state, age_hours: Number(f.ageHours.toFixed(2)), updated_label: relativePt(e.last_activity_at),
      url: `/event/${e.id}/${e.slug}`,
    },
    views,
    scores, score_changes: changes, articles, timeline, conflicts, agent_runs: runs,
    supervisor: review[0] ?? null, state_history: states, related,
    source_agreement: {
      independent_publisher_groups: groups.size,
      groups: [...groups.entries()].map(([group, names]) => ({ group, sources: [...new Set(names)] })),
      note: groups.size < 2 ? 'Single publisher group — no independent confirmation yet.' : 'Multiple independent publisher groups reported this event.',
    },
  };
}

export async function systemStatus() {
  const db = await getDb();
  const [counts] = await db.query<any>(`
    SELECT (SELECT COUNT(*) FROM article) AS articles,
           (SELECT COUNT(*) FROM event) AS events,
           (SELECT COUNT(*) FROM event WHERE status='PUBLISHED') AS published,
           (SELECT COUNT(*) FROM review_queue WHERE state='open') AS review_open,
           (SELECT COUNT(*) FROM conflict WHERE NOT resolved) AS conflicts,
           (SELECT COUNT(*) FROM event_view WHERE counted) AS views,
           (SELECT COUNT(*) FROM source WHERE enabled AND NOT blocked) AS sources_enabled,
           (SELECT COUNT(*) FROM audit_log) AS audit_entries`);
  const health = await db.query(`SELECT s.id, s.name, h.status, h.last_success_at, h.last_error, h.items_last_run, h.response_ms
                                 FROM source s LEFT JOIN source_health h ON h.source_id=s.id ORDER BY h.status, s.name`);
  return {
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])),
    flags: await allFlags(),
    sources: health,
    ai_analysis: (await getFlag(FLAGS.AI_ANALYSIS)) === 'on'
      ? 'deterministic agents active; no LLM provider configured (LLM agents report UNAVAILABLE rather than guessing)'
      : 'disabled by administrator',
    driver: db.driver,
    time: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- HTML routes
app.get('/', async (_req, res) => {
  const [breaking, trending, top, natural, conflict, economy, tech] = await Promise.all([
    publishedEvents({ order: 'recent', limit: 6, sinceHours: 12 }),
    publishedEvents({ order: 'trending', limit: 6 }),
    publishedEvents({ order: 'relevance', limit: 8 }),
    publishedEvents({ category: 'natural_events', limit: 4 }),
    publishedEvents({ category: 'war_conflict', limit: 4 }),
    publishedEvents({ category: 'economy', limit: 4 }),
    publishedEvents({ category: 'technology', limit: 4 }),
  ]);
  const status = await systemStatus();
  res.type('html').send(renderHome({
    breaking: decorate(breaking), trending: decorate(trending), top: decorate(top),
    natural: decorate(natural), conflict: decorate(conflict), economy: decorate(economy), tech: decorate(tech),
    status,
  }));
});

// Express 5 removed the `:slug?` optional-parameter syntax; register both forms.
app.get(['/event/:id', '/event/:id/:slug'], async (req, res) => {
  const data = await eventDetail(String(req.params.id));
  if (!data) { res.status(404).type('html').send(renderList({ title: 'Evento não encontrado', events: [], note: 'NO VERIFIED DATA AVAILABLE' })); return; }
  await recordView(String(req.params.id), clientIp(req), String(req.headers['user-agent'] ?? ''));
  res.type('html').send(renderEvent(data));
});

app.get('/category/:cat', async (req, res) => {
  const rows = await publishedEvents({ category: req.params.cat, limit: 50, order: 'recent' });
  res.type('html').send(renderList({ title: CATEGORY_LABELS_PT[req.params.cat] ?? req.params.cat, events: decorate(rows) }));
});
app.get('/country/:cc', async (req, res) => {
  const rows = await publishedEvents({ country: req.params.cc, limit: 50, order: 'recent' });
  res.type('html').send(renderList({ title: `País: ${req.params.cc.toUpperCase()}`, events: decorate(rows) }));
});
app.get('/trending', async (_req, res) => {
  const rows = await publishedEvents({ order: 'trending', limit: 50 });
  res.type('html').send(renderList({ title: 'Trending Now', events: decorate(rows), note: 'Trending é calculado exclusivamente a partir de visualizações contadas. Eventos sem actividade real aparecem com N/A.' }));
});
app.get('/most-viewed', async (req, res) => {
  const rows = await publishedEvents({ order: 'views', limit: 50, sinceHours: Number(req.query.h ?? 24) });
  res.type('html').send(renderList({ title: `Mais Vistos — últimas ${Number(req.query.h ?? 24)}h`, events: decorate(rows) }));
});
app.get('/today', async (_req, res) => {
  const rows = await publishedEvents({ sinceHours: 24, limit: 80, order: 'relevance' });
  res.type('html').send(renderList({ title: 'Hoje no Mundo', events: decorate(rows), grouped: true }));
});
app.get('/breaking', async (_req, res) => {
  const rows = await publishedEvents({ sinceHours: 6, limit: 40, order: 'recent' });
  res.type('html').send(renderList({ title: 'Breaking', events: decorate(rows) }));
});
app.get('/map', async (_req, res) => {
  const db = await getDb();
  const points = await db.query<any>(
    `SELECT id, slug, title, category, lat, lon, geo_precision, place, country FROM event
     WHERE status='PUBLISHED' AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY last_activity_at DESC LIMIT 300`);
  res.type('html').send(renderMap(points));
});
app.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  if (!q) { res.type('html').send(renderList({ title: 'Pesquisa', events: [], note: 'Introduza uma pesquisa.' })); return; }
  const db = await getDb();
  const rows = await db.query<any>(
    `SELECT e.* FROM event e WHERE e.status='PUBLISHED' AND (LOWER(e.title) LIKE $1 OR LOWER(COALESCE(e.place,'')) LIKE $1)
     ORDER BY e.last_activity_at DESC LIMIT 50`, [`%${q.toLowerCase()}%`]);
  res.type('html').send(renderList({ title: `Pesquisa: ${q}`, events: decorate(rows) }));
});
app.get('/status', async (_req, res) => res.type('html').send(renderStatus(await systemStatus())));
app.get('/about', async (_req, res) => res.type('html').send(renderAbout()));
app.get('/support', async (_req, res) => res.type('html').send(renderSupport()));

// ---------------------------------------------------------------- SEO
app.get('/robots.txt', (_req, res) => {
  res.type('text').send(`User-agent: *\nAllow: /\nSitemap: ${publicBase()}/sitemap.xml\n`);
});
app.get('/sitemap.xml', async (_req, res) => {
  const db = await getDb();
  const rows = await db.query<any>(`SELECT id, slug, last_activity_at FROM event WHERE status='PUBLISHED' ORDER BY last_activity_at DESC LIMIT 5000`);
  const base = publicBase();
  const urls = ['', '/today', '/trending', '/breaking', '/map', '/about']
    .map((p) => `<url><loc>${base}${p}</loc></url>`)
    .concat(rows.map((r) => `<url><loc>${base}/event/${r.id}/${r.slug}</loc><lastmod>${new Date(r.last_activity_at).toISOString()}</lastmod></url>`));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
});

export function publicBase(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

app.use((_req, res) => res.status(404).type('html').send(renderList({ title: '404', events: [], note: 'Página não encontrada.' })));

// ---------------------------------------------------------------- bootstrap
export async function bootstrap(): Promise<void> {
  await migrate();
  await registerSources();
}
