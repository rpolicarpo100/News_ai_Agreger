/**
 * HTTP API + server-rendered frontend.
 *
 * Every endpoint returns real rows or an explicit empty/unavailable state.
 * There is no code path in this file that manufactures an event, a score or a view.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getDb, migrate } from '../db/index.js';
import { runIngestion, registerSources } from '../ingestion/ingest.js';
import { runClustering } from '../pipeline/cluster.js';
import { runIntelligenceCycle, processEvent, setState } from '../agents/orchestrator.js';
import { freshness, relativePt } from '../pipeline/freshness.js';
import { buildGraph, relatedEvents } from '../pipeline/graph.js';
import { recordView, viewCounts } from '../pipeline/views.js';
import { secureHeaders, rateLimit, requireAdmin, clientIp } from './security.js';
import { allFlags, setFlag, FLAGS, getFlag } from '../core/flags.js';
import { audit, securityEvent } from '../core/audit.js';
import { CATEGORY_LABELS_PT } from '../pipeline/classify.js';
import { normaliseLang, normaliseTheme, langFromHeader, translator, CATEGORY_LABELS, type Lang, type Theme } from '../web/i18n.js';
import { renderHome, renderEvent, renderList, renderMap, renderAbout, renderSupport, renderStatus } from '../web/render.js';
import { renderLogin, renderControlCenter, renderAdminSources, renderReviewQueue, renderAdminEvents, renderAudit, renderSecurity } from '../web/admin.js';
import { requireSession, requireCsrf, issueSession, clearSession, csrfToken, verifyAdminToken, sessionValid } from './session.js';
import { isLocked, recordFailure, recordSuccess } from './loginguard.js';
import { renderAuth, renderMyIntelligence } from '../web/account.js';
import {
  createUser, authenticate, createSession, resolveSession, revokeSession,
  listFollows, addFollow, removeFollow, toggleBookmark, exportUserData, deleteUser,
  FOLLOW_KINDS, SESSION_DAYS, type FollowKind,
} from '../core/users.js';
import { parseCookies } from './session.js';
import { loadSupportConfig } from '../core/support.js';
import {
  createRule, listRules, deleteRule, setRuleEnabled, runAlerts,
  listNotifications, unreadCount, markAllRead, buildDailyBrief,
} from '../pipeline/alerts.js';
import { renderAlerts, renderInbox, renderBrief } from '../web/alerts.js';
import { isLlmAvailable, describeLlm, getLlmUsage } from '../agents/llm.js';
import { runRetention, databaseSize, DEFAULT_POLICY } from '../pipeline/retention.js';
import { qrSvg } from '../core/qr.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(secureHeaders);

// ---------------------------------------------------------------- helpers
async function publishedEvents(opts: {
  category?: string; country?: string; limit?: number; offset?: number;
  minConfidence?: number; minImpact?: number; order?: 'recent' | 'relevance' | 'impact' | 'trending' | 'views' | 'confidence';
  dir?: 'asc' | 'desc';
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

  // Direcção da ordenação. NULLS LAST é mantido em AMBAS as direcções de
  // propósito: um score N/A não é "o valor mais baixo", é ausência de dados
  // (§21). Ao ordenar do menor para o maior, os N/A não podem aparecer no topo
  // como se fossem zeros — ficam sempre no fim, em qualquer direcção.
  const d = opts.dir === 'asc' ? 'ASC' : 'DESC';
  const byScore = (col: string) => `${col} ${d} NULLS LAST, e.last_activity_at DESC`;
  const ORDERS: Record<string, string> = {
    recent: `e.last_activity_at ${d}`,
    relevance: byScore('sc.relevance'),
    confidence: byScore('sc.confidence'),
    impact: byScore('sc.life_impact'),
    life_impact: byScore('sc.life_impact'),  // alias usado nos URLs
    trending: byScore('sc.trending'),
    views: byScore('vw.total'),
  };
  // Uma chave desconhecida tem de cair no padrão, nunca produzir `undefined`
  // dentro do SQL — foi o que aconteceu com order=life_impact e devolveu 500.
  const order = ORDERS[opts.order ?? 'recent'] ?? ORDERS.recent;

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

function decorate(rows: any[], lang: Lang = 'pt') {
  return rows.map((e) => {
    const f = freshness(e.category, e.last_activity_at);
    return {
      ...e,
      category_label: catLabel(e.category, lang),
      freshness: f.state,
      age_hours: Number(f.ageHours.toFixed(2)),
      updated_label: relativePt(e.last_activity_at),
      url: `/event/${e.id}/${e.slug}`,
    };
  });
}

// ---------------------------------------------------------------- preferências (§61)
// Idioma e tema vêm, por ordem: parâmetro ?lang= / ?theme=, cookie, cabeçalho
// Accept-Language do browser, e por fim o padrão. O parâmetro grava o cookie,
// para que a escolha persista sem precisar de conta.
const PREF_MAX_AGE = 365 * 24 * 3600;

function prefCookie(name: string, value: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // SameSite=Lax e sem HttpOnly: não é um segredo, é uma preferência de
  // apresentação, e nada de sensível depende dela.
  return `${name}=${value}; Path=/; Max-Age=${PREF_MAX_AGE}; SameSite=Lax${secure}`;
}

app.use((req, res, next) => {
  const cookies = parseCookies(req);
  let lang: Lang;
  let theme: Theme;

  if (req.query.lang !== undefined) {
    lang = normaliseLang(req.query.lang);
    res.append('Set-Cookie', prefCookie('gni_lang', lang));
  } else if (cookies.gni_lang) {
    lang = normaliseLang(cookies.gni_lang);
  } else {
    lang = langFromHeader(req.headers['accept-language'] as string | undefined);
  }

  if (req.query.theme !== undefined) {
    theme = normaliseTheme(req.query.theme);
    res.append('Set-Cookie', prefCookie('gni_theme', theme));
  } else {
    theme = normaliseTheme(cookies.gni_theme);
  }

  (req as any).prefs = { lang, theme, path: req.originalUrl.split('#')[0] };
  next();
});

/** Preferências do pedido, para passar aos renderizadores. */
function prefsOf(req: Request) {
  return (req as any).prefs ?? { lang: 'pt' as Lang, theme: 'dark' as Theme, path: '/' };
}

/** Rótulo de categoria no idioma do pedido. */
function catLabel(key: string, lang: Lang): string {
  return CATEGORY_LABELS[lang]?.[key] ?? CATEGORY_LABELS_PT[key] ?? key;
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
    dir: req.query.dir === 'asc' ? 'asc' : 'desc',
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
admin.get('/storage', async (_req, res) => {
  res.json({ size: await databaseSize(), policy: DEFAULT_POLICY, preview: await runRetention(DEFAULT_POLICY, true) });
});

admin.post('/retention/run', async (req, res) => {
  const dryRun = req.body?.dryRun !== false;
  res.json(await runRetention(DEFAULT_POLICY, dryRun));
});

admin.get('/audit', async (req, res) => {
  const db = await getDb();
  res.json({ entries: await db.query(`SELECT * FROM audit_log ORDER BY at DESC LIMIT $1`, [Math.min(Number(req.query.limit ?? 100), 500)]) });
});
admin.post('/pipeline/run', async (_req, res) => {
  const ing = await runIngestion();
  const cl = await runClustering();
  const cy = await runIntelligenceCycle();
  const gr = await buildGraph();
  res.json({ ingestion: ing, clustering: cl, intelligence: { processed: cy.length, published: cy.filter((c) => c.published).length }, graph: gr });
});
app.use('/api/admin', admin);

// ---------------------------------------------------------------- cron trigger
// Ingestão sem depender do GitHub Actions (o cron da conta ficou bloqueado por
// facturação): um pinger externo gratuito (cron-job.org, UptimeRobot, Healthchecks.io) chama este endpoint nos intervalos configurados.
// Protecções: CRON_TOKEN obrigatório (503 se ausente — seguro por omissão),
// comparação timing-safe, 404 em token errado, um único ciclo em execução
// (409 para chamadas concorrentes), e o ciclo respeita a flag ingestion do
// Admin Center. Responde 202 imediatamente: o ciclo corre em fundo, o pinger
// nunca espera.
let cronRunning = false;
app.all('/api/cron/run', async (req, res) => {
  const expected = process.env.CRON_TOKEN ?? '';
  if (!expected) { res.status(503).json({ error: 'cron_disabled' }); return; }
  const provided = createHash('sha256').update(String(req.header('x-cron-token') ?? '')).digest();
  const wanted = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(provided, wanted)) { res.status(404).json({ error: 'not_found' }); return; }
  if (cronRunning) { res.status(409).json({ error: 'cycle_already_running' }); return; }
  cronRunning = true;
  res.status(202).json({ accepted: true });
  void (async () => {
    const t0 = Date.now();
    try {
      if ((await getFlag(FLAGS.INGESTION)) === 'off') { console.log('[cron] ingestion desligada por flag; ciclo ignorado'); return; }
      const ing = await runIngestion();
      const cl = await runClustering();
      const cy = await runIntelligenceCycle();
      const gr = await buildGraph();
      const al = await runAlerts();
      let retention: Awaited<ReturnType<typeof runRetention>> | null = null;
      try {
        const db = await getDb();
        const rows = await db.query<{ value: string }>(`SELECT value FROM system_flag WHERE key='retention_last_run_at'`);
        const last = rows[0]?.value;
        if (!last || Date.now() - new Date(last).getTime() > 24 * 3600e3) {
          retention = await runRetention();
          await db.query(
            `INSERT INTO system_flag (key, value, updated_by) VALUES ('retention_last_run_at',$1,'cron-endpoint')
             ON CONFLICT (key) DO UPDATE SET value=$1, updated_by='cron-endpoint', updated_at=now()`,
            [new Date().toISOString()],
          );
        }
      } catch (e) { console.error('[cron] retention failed:', e); }
      console.log(`[cron] ciclo completo em ${Date.now() - t0}ms: ingested=${ing.totalInserted} processed=${cy.length} published=${cy.filter((c) => c.published).length} edges=${gr.edges} notifs=${al.notificationsCreated}`);
    } catch (err) {
      console.error('[cron] cycle failed:', err);
    } finally {
      cronRunning = false;
    }
  })();
});

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

  // Related events (§29): typed, evidenced edges from the event graph.
  const related = await relatedEvents(id, 8);

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
    ai_analysis: (await getFlag(FLAGS.AI_ANALYSIS)) !== 'on'
      ? 'disabled by administrator (emergency control)'
      : isLlmAvailable()
        ? `deterministic agents active; LLM extraction enabled via ${describeLlm()}. Every LLM claim is verified verbatim against its cited article; unverifiable output is discarded.`
        : 'deterministic agents active; no LLM provider configured, so LLM agents report UNAVAILABLE rather than guessing',
    llm: { available: isLlmAvailable(), provider: describeLlm(), usage: getLlmUsage() },
    driver: db.driver,
    time: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- HTML routes
app.get('/', async (req, res) => {
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
  const pf = prefsOf(req);
  const L = pf.lang;
  res.type('html').send(renderHome({
    breaking: decorate(breaking, L), trending: decorate(trending, L), top: decorate(top, L),
    natural: decorate(natural, L), conflict: decorate(conflict, L),
    economy: decorate(economy, L), tech: decorate(tech, L),
    status,
  }, pf));
});

// Express 5 removed the `:slug?` optional-parameter syntax; register both forms.
app.get(['/event/:id', '/event/:id/:slug'], async (req, res) => {
  const data = await eventDetail(String(req.params.id));
  if (!data) { res.status(404).type('html').send(renderList({ title: 'Evento não encontrado', events: [], note: 'NO VERIFIED DATA AVAILABLE' })); return; }
  await recordView(String(req.params.id), clientIp(req), String(req.headers['user-agent'] ?? ''));

  // Personalised controls only when a real session exists.
  const sess = await currentUser(req);
  let viewer: { csrf: string; following: boolean; bookmarked: boolean } | undefined;
  if (sess) {
    const db = await getDb();
    const [f, b] = await Promise.all([
      db.query(`SELECT 1 FROM follow WHERE user_id=$1 AND kind='event' AND value=$2`, [sess.user.id, String(req.params.id)]),
      db.query(`SELECT 1 FROM bookmark WHERE user_id=$1 AND event_id=$2`, [sess.user.id, String(req.params.id)]),
    ]);
    viewer = { csrf: sess.csrf, following: f.length > 0, bookmarked: b.length > 0 };
  }
  res.type('html').send(renderEvent(data, viewer, prefsOf(req)));
});

/** Lista global com ordenação (§52). Destino dos controlos "Ordenar por". */
app.get('/events', async (req, res) => {
  const order = String(req.query.order ?? 'recent');
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const apiOrder = order === 'life_impact' ? 'impact' : order;
  const rows = await publishedEvents({ order: apiOrder as any, dir, limit: 60 });
  const labels: Record<string, string> = {
    recent: 'mais recentes', impact: 'Life Impact', life_impact: 'Life Impact',
    confidence: 'Confidence', relevance: 'Relevance',
  };
  const sentido = dir === 'asc' ? 'do menor para o maior' : 'do maior para o menor';
  res.type('html').send(renderList({
    title: translator(prefsOf(req).lang)('list.allEvents'),
    events: decorate(rows),
    note: order === 'recent'
      ? 'Ordenado por actividade mais recente.'
      : `Ordenado por ${labels[order] ?? order}, ${sentido}. Eventos cujo score é N/A aparecem no fim: um valor desconhecido não é tratado como zero.`,
    sort: { path: '/events', order, dir, lang: prefsOf(req).lang },
    prefs: prefsOf(req),
  }));
});

app.get('/category/:cat', async (req, res) => {
  const order = String(req.query.order ?? 'recent');
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const cat = String(req.params.cat);
  const rows = await publishedEvents({
    category: cat, limit: 50,
    order: (order === 'life_impact' ? 'impact' : order) as any, dir,
  });
  res.type('html').send(renderList({
    title: catLabel(cat, prefsOf(req).lang),
    events: decorate(rows, prefsOf(req).lang),
    sort: { path: `/category/${cat}`, order, dir, lang: prefsOf(req).lang },
    current: `/category/${cat}`,
    prefs: prefsOf(req),
  }));
});
app.get('/country/:cc', async (req, res) => {
  const order = String(req.query.order ?? 'recent');
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const cc = String(req.params.cc);
  const rows = await publishedEvents({
    country: cc, limit: 50,
    order: (order === 'life_impact' ? 'impact' : order) as any, dir,
  });
  res.type('html').send(renderList({
    title: `${translator(prefsOf(req).lang)('list.country')}: ${cc.toUpperCase()}`,
    events: decorate(rows, prefsOf(req).lang),
    sort: { path: `/country/${cc}`, order, dir, lang: prefsOf(req).lang },
    prefs: prefsOf(req),
  }));
});
app.get('/trending', async (req, res) => {
  const rows = await publishedEvents({ order: 'trending', limit: 50 });
  res.type('html').send(renderList({ title: translator(prefsOf(req).lang)('list.trending'), events: decorate(rows, prefsOf(req).lang), note: 'Trending é calculado exclusivamente a partir de visualizações contadas. Eventos sem actividade real aparecem com N/A.', prefs: prefsOf(req), current: '/trending' }));
});
app.get('/most-viewed', async (req, res) => {
  const rows = await publishedEvents({ order: 'views', limit: 50, sinceHours: Number(req.query.h ?? 24) });
  res.type('html').send(renderList({ title: `${translator(prefsOf(req).lang)('nav.mostViewed')} — ${Number(req.query.h ?? 24)}h`, events: decorate(rows, prefsOf(req).lang), prefs: prefsOf(req) }));
});
app.get('/today', async (req, res) => {
  const order = String(req.query.order ?? 'relevance');
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const rows = await publishedEvents({
    sinceHours: 24, limit: 80,
    order: (order === 'life_impact' ? 'impact' : order) as any, dir,
  });
  res.type('html').send(renderList({
    title: translator(prefsOf(req).lang)('list.today'), events: decorate(rows, prefsOf(req).lang), grouped: true,
    sort: { path: '/today', order, dir, lang: prefsOf(req).lang }, current: '/today',
    prefs: prefsOf(req),
  }));
});
app.get('/breaking', async (req, res) => {
  const rows = await publishedEvents({ sinceHours: 6, limit: 40, order: 'recent' });
  res.type('html').send(renderList({ title: translator(prefsOf(req).lang)('list.breaking'), events: decorate(rows, prefsOf(req).lang), prefs: prefsOf(req), current: '/breaking' }));
});
app.get('/map', async (req, res) => {
  const db = await getDb();
  const points = await db.query<any>(
    `SELECT id, slug, title, category, lat, lon, geo_precision, place, country FROM event
     WHERE status='PUBLISHED' AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY last_activity_at DESC LIMIT 300`);
  res.type('html').send(renderMap(points, prefsOf(req)));
});
app.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  if (!q) { res.type('html').send(renderList({ title: 'Pesquisa', events: [], note: 'Introduza uma pesquisa.' })); return; }
  const db = await getDb();
  const rows = await db.query<any>(
    `SELECT e.* FROM event e WHERE e.status='PUBLISHED' AND (LOWER(e.title) LIKE $1 OR LOWER(COALESCE(e.place,'')) LIKE $1)
     ORDER BY e.last_activity_at DESC LIMIT 50`, [`%${q.toLowerCase()}%`]);
  res.type('html').send(renderList({ title: `${translator(prefsOf(req).lang)('list.search')}: ${q}`, events: decorate(rows, prefsOf(req).lang), prefs: prefsOf(req) }));
});
app.get('/status', async (req, res) => res.type('html').send(renderStatus(await systemStatus(), prefsOf(req))));
app.get('/about', async (req, res) => res.type('html').send(renderAbout(prefsOf(req))));
app.get('/support', async (req, res) => {
  const cfg = loadSupportConfig();
  res.type('html').send(renderSupport({
    configured: cfg.configured,
    problems: cfg.problems,
    methods: cfg.methods.map((m) => ({
      id: m.id, label: m.label, value: m.value, href: m.href, note: m.note, problem: m.problem,
      qrSvg: qrSvg(m.qrPayload, { size: 190, label: `Código QR para ${m.label}` }),
    })),
  }, prefsOf(req)));
});

// ---------------------------------------------------------------- SEO
app.get('/robots.txt', (_req, res) => {
  res.type('text').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin\nDisallow: /my\nDisallow: /account\nSitemap: ${publicBase()}/sitemap.xml\n`);
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

// ---------------------------------------------------------------- ADMIN UI (§68)
// Browser-facing admin. Auth is an httpOnly signed cookie exchanged for the
// server-side ADMIN_TOKEN; the token itself never reaches the browser.
const adminForms = express.Router();
adminForms.use(express.urlencoded({ extended: false, limit: '32kb' }));

function flashFrom(req: Request): { kind: string; msg: string } | undefined {
  const ok = req.query.ok ? String(req.query.ok) : '';
  const err = req.query.err ? String(req.query.err) : '';
  if (ok) return { kind: 'ok', msg: ok.slice(0, 300) };
  if (err) return { kind: 'err', msg: err.slice(0, 300) };
  return undefined;
}

adminForms.get('/login', (req, res) => {
  if (!process.env.ADMIN_TOKEN) {
    res.status(503).type('html').send(renderLogin('/admin', 'ADMIN_TOKEN não está configurado neste servidor. A área de administração está fechada por omissão.'));
    return;
  }
  if (sessionValid(req)) { res.redirect(302, '/admin'); return; }
  const lock = isLocked(clientIp(req));
  res.type('html').send(renderLogin(String(req.query.next ?? '/admin'), req.query.err ? String(req.query.err) : undefined, lock.secondsLeft));
});

adminForms.post('/login', rateLimit(20, 60_000), async (req, res) => {
  const ip = clientIp(req);
  const lock = isLocked(ip);
  if (lock.locked) {
    res.status(429).type('html').send(renderLogin('/admin', undefined, lock.secondsLeft));
    return;
  }
  const token = String((req.body ?? {}).token ?? '');
  if (!verifyAdminToken(token)) {
    await recordFailure(ip);
    res.status(401).type('html').send(renderLogin(String((req.body ?? {}).next ?? '/admin'), 'Token inválido.', isLocked(ip).secondsLeft));
    return;
  }
  recordSuccess(ip);
  issueSession(res);
  await audit({ actor: 'admin', action: 'login', objectType: 'session', reason: `admin session opened from ${ip}` });
  const next = String((req.body ?? {}).next ?? '/admin');
  res.redirect(302, next.startsWith('/admin') ? next : '/admin');
});

adminForms.post('/logout', async (req, res) => {
  if (sessionValid(req)) {
    await audit({ actor: 'admin', action: 'logout', objectType: 'session', reason: 'admin session closed' });
  }
  clearSession(res);
  res.redirect(302, '/admin/login');
});

// Everything below requires a valid session.
adminForms.use(requireSession);

adminForms.get('/', async (req, res) => {
  const db = await getDb();
  const [status, recentAudit, recentSecurity] = await Promise.all([
    systemStatus(),
    db.query(`SELECT at, actor, action, object_type, reason FROM audit_log ORDER BY at DESC LIMIT 8`),
    db.query(`SELECT at, kind, severity FROM security_event ORDER BY at DESC LIMIT 8`),
  ]);
  res.type('html').send(renderControlCenter({ status, recentAudit, recentSecurity }, csrfToken(req), flashFrom(req)));
});

adminForms.get('/sources', async (req, res) => {
  const db = await getDb();
  const sources = await db.query(
    `SELECT s.id, s.name, s.homepage_url, s.origin_type, s.country, s.language, s.publisher_group,
            s.reliability_score, s.reliability_basis, s.blocked,
            h.status, h.items_last_run, h.response_ms, h.last_error,
            (SELECT COUNT(*) FROM article a WHERE a.source_id=s.id) AS articles
     FROM source s LEFT JOIN source_health h ON h.source_id=s.id ORDER BY s.name`);
  res.type('html').send(renderAdminSources(sources, csrfToken(req), flashFrom(req)));
});

adminForms.get('/review', async (req, res) => {
  const db = await getDb();
  const items = await db.query(
    `SELECT r.id, r.event_id, r.reason, r.priority, r.created_at, e.title
     FROM review_queue r JOIN event e ON e.id=r.event_id
     WHERE r.state='open' ORDER BY r.priority DESC, r.created_at ASC LIMIT 60`);
  res.type('html').send(renderReviewQueue(items, csrfToken(req), flashFrom(req)));
});

adminForms.get('/events', async (req, res) => {
  const db = await getDb();
  const q = String(req.query.q ?? '').trim();
  const params: any[] = [];
  let where = '';
  if (q) { params.push(`%${q.toLowerCase()}%`); where = `WHERE LOWER(e.title) LIKE $1 OR LOWER(e.id) LIKE $1`; }
  params.push(60);
  const events = await db.query(
    `SELECT e.id, e.slug, e.title, e.category, e.status, e.verification, e.article_count, e.independent_sources,
            (SELECT value FROM score WHERE event_id=e.id AND kind='confidence' ORDER BY computed_at DESC LIMIT 1) AS confidence
     FROM event e ${where} ORDER BY e.last_activity_at DESC LIMIT $${params.length}`, params);
  res.type('html').send(renderAdminEvents(events, q, csrfToken(req), flashFrom(req)));
});

adminForms.get('/audit', async (req, res) => {
  const db = await getDb();
  const entries = await db.query(`SELECT * FROM audit_log ORDER BY at DESC LIMIT 200`);
  res.type('html').send(renderAudit(entries, flashFrom(req)));
});

adminForms.get('/security', async (req, res) => {
  const db = await getDb();
  const events = await db.query(`SELECT * FROM security_event ORDER BY at DESC LIMIT 200`);
  res.type('html').send(renderSecurity(events, flashFrom(req)));
});

// ---- mutating routes: CSRF + mandatory reason ----
adminForms.use(requireCsrf);

function reasonOf(req: Request): string | null {
  const r = String((req.body ?? {}).reason ?? '').trim();
  return r.length >= 3 ? r.slice(0, 400) : null;
}

adminForms.post('/flags', async (req, res) => {
  const { key, value } = req.body ?? {};
  const reason = reasonOf(req);
  if (!reason) { res.redirect(302, '/admin?err=' + encodeURIComponent('É obrigatório indicar um motivo.')); return; }
  if (!Object.values(FLAGS).includes(key) || typeof value !== 'string') {
    res.redirect(302, '/admin?err=' + encodeURIComponent('Flag inválida.')); return;
  }
  await setFlag(key, value, 'admin', reason);
  res.redirect(302, '/admin?ok=' + encodeURIComponent(`${key} → ${value}`));
});

adminForms.post('/sources/:id/block', async (req, res) => {
  const db = await getDb();
  const reason = reasonOf(req);
  if (!reason) { res.redirect(302, '/admin/sources?err=' + encodeURIComponent('É obrigatório indicar um motivo.')); return; }
  const blocked = String((req.body ?? {}).blocked) === 'true';
  const id = String(req.params.id);
  const prev = await db.query<{ blocked: boolean }>(`SELECT blocked FROM source WHERE id=$1`, [id]);
  if (!prev.length) { res.redirect(302, '/admin/sources?err=' + encodeURIComponent('Fonte não encontrada.')); return; }
  await db.query(`UPDATE source SET blocked=$2 WHERE id=$1`, [id, blocked]);
  await audit({ actor: 'admin', action: 'block_source', objectType: 'source', objectId: id,
    prevState: prev[0].blocked, newState: blocked, reason });
  res.redirect(302, '/admin/sources?ok=' + encodeURIComponent(`${id} ${blocked ? 'bloqueada' : 'desbloqueada'}`));
});

adminForms.post('/review/:id/resolve', async (req, res) => {
  const db = await getDb();
  const reason = reasonOf(req);
  if (!reason) { res.redirect(302, '/admin/review?err=' + encodeURIComponent('É obrigatório indicar um motivo.')); return; }
  const decision = String((req.body ?? {}).decision ?? '');
  if (!['approved', 'rejected', 'held'].includes(decision)) {
    res.redirect(302, '/admin/review?err=' + encodeURIComponent('Decisão inválida.')); return;
  }
  const rows = await db.query<any>(`SELECT * FROM review_queue WHERE id=$1`, [Number(req.params.id)]);
  if (!rows.length) { res.redirect(302, '/admin/review?err=' + encodeURIComponent('Item não encontrado.')); return; }
  await db.query(`UPDATE review_queue SET state=$2, resolved_by='admin', resolved_at=now() WHERE id=$1`,
    [Number(req.params.id), decision]);
  if (decision === 'approved') {
    // setState must run BEFORE any direct status write, otherwise it sees no
    // transition and skips the history entry (§32: never silently overwrite).
    await setState(rows[0].event_id, 'PUBLISHED', 'admin', `human review approved: ${reason}`);
    await db.query(`UPDATE event SET published_at=COALESCE(published_at, now()) WHERE id=$1`, [rows[0].event_id]);
  }
  await audit({ actor: 'admin', action: 'review_resolve', objectType: 'event', objectId: rows[0].event_id,
    prevState: rows[0].state, newState: decision, reason });
  res.redirect(302, '/admin/review?ok=' + encodeURIComponent(`Evento ${decision}`));
});

adminForms.post('/events/:id/status', async (req, res) => {
  const db = await getDb();
  const reason = reasonOf(req);
  if (!reason) { res.redirect(302, '/admin/events?err=' + encodeURIComponent('É obrigatório indicar um motivo.')); return; }
  const status = String((req.body ?? {}).status ?? '');
  if (!['PUBLISHED', 'SUPERVISOR_REVIEW', 'ARCHIVED'].includes(status)) {
    res.redirect(302, '/admin/events?err=' + encodeURIComponent('Estado inválido.')); return;
  }
  const id = String(req.params.id);
  const prev = await db.query<{ status: string }>(`SELECT status FROM event WHERE id=$1`, [id]);
  if (!prev.length) { res.redirect(302, '/admin/events?err=' + encodeURIComponent('Evento não encontrado.')); return; }
  // setState writes both the event row and its state history (§32: never silent).
  await setState(id, status, 'admin', `manual override: ${reason}`);
  if (status === 'PUBLISHED') {
    await db.query(`UPDATE event SET published_at=COALESCE(published_at, now()) WHERE id=$1`, [id]);
  }
  await audit({ actor: 'admin', action: 'event_status_override', objectType: 'event', objectId: id,
    prevState: prev[0].status, newState: status, reason });
  res.redirect(302, '/admin/events?ok=' + encodeURIComponent(`${id} → ${status}`));
});

adminForms.post('/pipeline/run', async (req, res) => {
  const reason = reasonOf(req);
  if (!reason) { res.redirect(302, '/admin?err=' + encodeURIComponent('É obrigatório indicar um motivo.')); return; }
  await audit({ actor: 'admin', action: 'pipeline_run', objectType: 'pipeline', objectId: 'manual', reason });
  try {
    const ing = await runIngestion();
    const cl = await runClustering();
    const cy = await runIntelligenceCycle();
    const gr = await buildGraph();
    const al = await runAlerts();
    res.redirect(302, '/admin?ok=' + encodeURIComponent(
      `Ingeridos ${ing.totalInserted} · novos eventos ${cl.newEvents} · anexados ${cl.attached} · publicados ${cy.filter((c) => c.published).length} · relações ${gr.edges} · notificações ${al.notificationsCreated}`));
  } catch (err: any) {
    // §74: show the real failure.
    res.redirect(302, '/admin?err=' + encodeURIComponent(`Falha no pipeline: ${String(err?.message ?? err).slice(0, 200)}`));
  }
});

app.use('/admin', adminForms);

// ---------------------------------------------------------------- ACCOUNTS (§56, §71)
const USER_COOKIE = 'gni_user';

function userCookieAttrs(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

async function currentUser(req: Request) {
  return resolveSession(parseCookies(req)[USER_COOKIE]);
}

const account = express.Router();
account.use(express.urlencoded({ extended: false, limit: '16kb' }));

account.get('/login', async (req, res) => {
  if (await currentUser(req)) { res.redirect(302, '/my'); return; }
  res.type('html').send(renderAuth('login', {
    next: String(req.query.next ?? '/my'),
    error: req.query.err ? String(req.query.err).slice(0, 200) : undefined,
    ok: req.query.ok ? String(req.query.ok).slice(0, 200) : undefined,
    prefs: prefsOf(req),
  }));
});

account.get('/register', async (req, res) => {
  if (await currentUser(req)) { res.redirect(302, '/my'); return; }
  res.type('html').send(renderAuth('register', {
    next: String(req.query.next ?? '/my'),
    error: req.query.err ? String(req.query.err).slice(0, 200) : undefined,
    prefs: prefsOf(req),
  }));
});

account.post('/register', rateLimit(10, 60_000), async (req, res) => {
  const { email, password } = req.body ?? {};
  const out = await createUser(String(email ?? ''), String(password ?? ''));
  if (out.error || !out.user) {
    res.status(400).type('html').send(renderAuth('register', { error: out.error , prefs: prefsOf(req) }));
    return;
  }
  const sess = await createSession(out.user.id);
  res.append('Set-Cookie', `${USER_COOKIE}=${sess.cookie}; ${userCookieAttrs()}`);
  res.redirect(302, '/my');
});

account.post('/login', rateLimit(20, 60_000), async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await authenticate(String(email ?? ''), String(password ?? ''));
  if (!user) {
    // Same message for unknown email and wrong password: no account enumeration.
    await securityEvent('user_login_failed', 'low', { ip: clientIp(req) });
    res.status(401).type('html').send(renderAuth('login', { error: 'Email ou palavra-passe incorrectos.' , prefs: prefsOf(req) }));
    return;
  }
  const sess = await createSession(user.id);
  res.append('Set-Cookie', `${USER_COOKIE}=${sess.cookie}; ${userCookieAttrs()}`);
  const next = String((req.body ?? {}).next ?? '/my');
  res.redirect(302, next.startsWith('/') && !next.startsWith('//') ? next : '/my');
});

account.post('/logout', async (req, res) => {
  await revokeSession(parseCookies(req)[USER_COOKIE]);
  res.append('Set-Cookie', `${USER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.redirect(302, '/');
});

app.use('/account', account);

// ---- My Intelligence ----
const my = express.Router();
my.use(express.urlencoded({ extended: false, limit: '16kb' }));

my.use(async (req, res, next) => {
  const sess = await currentUser(req);
  if (!sess) { res.redirect(302, `/account/login?next=${encodeURIComponent(req.originalUrl)}`); return; }
  (req as any).session = sess;
  next();
});

/** Double-submit CSRF for personal mutations. */
function myCsrf(req: Request, res: Response, next: NextFunction): void {
  const expected = (req as any).session.csrf as string;
  const given = String((req.body ?? {})._csrf ?? '');
  if (!expected || given !== expected) {
    void securityEvent('user_csrf_failed', 'medium', { ip: clientIp(req), path: req.path });
    res.status(403).type('html').send('<p>Validação CSRF falhou. Recarregue a página.</p>');
    return;
  }
  next();
}

my.get('/', async (req, res) => {
  const db = await getDb();
  const { user, csrf } = (req as any).session;
  const follows = await listFollows(user.id);

  const cats = follows.filter((f: any) => f.kind === 'category').map((f: any) => f.value);
  const countries = follows.filter((f: any) => f.kind === 'country').map((f: any) => f.value);
  const evIds = follows.filter((f: any) => f.kind === 'event').map((f: any) => f.value);

  // Personal feed: real query, empty when nothing matches.
  let events: any[] = [];
  if (cats.length || countries.length || evIds.length) {
    events = await db.query<any>(
      `SELECT e.*, sc.relevance, sc.confidence, sc.life_impact, sc.trending,
              COALESCE(vw.total,0) AS views_total
       FROM event e
       LEFT JOIN LATERAL (
         SELECT MAX(value) FILTER (WHERE kind='relevance') AS relevance,
                MAX(value) FILTER (WHERE kind='confidence') AS confidence,
                MAX(value) FILTER (WHERE kind='life_impact') AS life_impact,
                MAX(value) FILTER (WHERE kind='trending') AS trending
         FROM (SELECT DISTINCT ON (kind) kind, value FROM score WHERE event_id=e.id ORDER BY kind, computed_at DESC) s
       ) sc ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE counted) AS total FROM event_view WHERE event_id=e.id
       ) vw ON TRUE
       WHERE e.status='PUBLISHED'
         AND (e.category = ANY($1) OR e.country = ANY($2) OR e.id = ANY($3))
       ORDER BY e.last_activity_at DESC LIMIT 40`,
      [cats, countries, evIds]);
  }

  const bookmarks = await db.query<any>(
    `SELECT e.*, sc.relevance, sc.confidence, sc.life_impact, sc.trending,
            COALESCE(vw.total,0) AS views_total
     FROM bookmark b JOIN event e ON e.id=b.event_id
     LEFT JOIN LATERAL (
       SELECT MAX(value) FILTER (WHERE kind='relevance') AS relevance,
              MAX(value) FILTER (WHERE kind='confidence') AS confidence,
              MAX(value) FILTER (WHERE kind='life_impact') AS life_impact,
              MAX(value) FILTER (WHERE kind='trending') AS trending
       FROM (SELECT DISTINCT ON (kind) kind, value FROM score WHERE event_id=e.id ORDER BY kind, computed_at DESC) s
     ) sc ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE counted) AS total FROM event_view WHERE event_id=e.id
     ) vw ON TRUE
     WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 30`, [user.id]);

  // Only offer countries that actually have published events.
  const countryOpts = await db.query<any>(
    `SELECT country, COUNT(*)::int AS n FROM event
     WHERE status='PUBLISHED' AND country IS NOT NULL
     GROUP BY country ORDER BY n DESC LIMIT 30`);

  const flash = req.query.ok ? { kind: 'ok', msg: String(req.query.ok).slice(0, 200) }
    : req.query.err ? { kind: 'err', msg: String(req.query.err).slice(0, 200) } : undefined;

  const [unread, alertCount] = await Promise.all([
    unreadCount(user.id),
    db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM alert_rule WHERE user_id=$1 AND enabled`, [user.id])
      .then((r) => Number(r[0]?.n ?? 0)),
  ]);
  res.type('html').send(renderMyIntelligence({
    user, csrf, follows, unread, alertCount,
    events: decorate(events, prefsOf(req).lang), bookmarks: decorate(bookmarks, prefsOf(req).lang),
    countries: countryOpts, flash, prefs: prefsOf(req),
  }));
});

my.post('/follow', myCsrf, async (req, res) => {
  const { user } = (req as any).session;
  const kind = String((req.body ?? {}).kind ?? '') as FollowKind;
  const value = String((req.body ?? {}).value ?? '').slice(0, 120);
  const action = String((req.body ?? {}).action ?? 'follow');
  if (!FOLLOW_KINDS.includes(kind) || !value) {
    res.redirect(302, '/my?err=' + encodeURIComponent('Pedido inválido.')); return;
  }
  if (action === 'unfollow') await removeFollow(user.id, kind, value);
  else await addFollow(user.id, kind, value);
  res.redirect(302, (req.headers.referer ?? '').includes('/event/')
    ? String(req.headers.referer)
    : '/my');
});

my.post('/bookmark', myCsrf, async (req, res) => {
  const { user } = (req as any).session;
  const eventId = String((req.body ?? {}).event_id ?? '');
  if (!eventId) { res.redirect(302, '/my?err=' + encodeURIComponent('Pedido inválido.')); return; }
  await toggleBookmark(user.id, eventId);
  res.redirect(302, String(req.headers.referer ?? '/my'));
});

// ---- Alerts (§57) ----
my.get('/alerts', async (req, res) => {
  const db = await getDb();
  const { user, csrf } = (req as any).session;
  const rules = await db.query<any>(
    `SELECT r.*, (SELECT COUNT(*)::int FROM notification n WHERE n.rule_id=r.id) AS matches
     FROM alert_rule r WHERE r.user_id=$1 ORDER BY r.created_at DESC`, [user.id]);
  const countries = await db.query<any>(
    `SELECT country, COUNT(*)::int AS n FROM event WHERE status='PUBLISHED' AND country IS NOT NULL
     GROUP BY country ORDER BY n DESC LIMIT 40`);
  const flash = req.query.ok ? { kind: 'ok', msg: String(req.query.ok).slice(0, 200) }
    : req.query.err ? { kind: 'err', msg: String(req.query.err).slice(0, 200) } : undefined;
  res.type('html').send(renderAlerts({ rules, countries, csrf, flash, prefs: prefsOf(req) }));
});

my.post('/alerts', myCsrf, async (req, res) => {
  const { user } = (req as any).session;
  const b = req.body ?? {};
  const num = (v: any) => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : NaN;
  };
  const out = await createRule(user.id, {
    name: String(b.name ?? ''),
    category: String(b.category ?? '') || null,
    country: String(b.country ?? '') || null,
    min_confidence: num(b.min_confidence),
    min_impact: num(b.min_impact),
    min_relevance: num(b.min_relevance),
    only_verified: b.only_verified === 'true',
  });
  if (out.error) { res.redirect(302, '/my/alerts?err=' + encodeURIComponent(out.error)); return; }
  // Evaluate immediately so a new rule is not silently empty until the next cycle.
  await runAlerts();
  res.redirect(302, '/my/alerts?ok=' + encodeURIComponent('Alerta criado e avaliado.'));
});

my.post('/alerts/:id/toggle', myCsrf, async (req, res) => {
  const { user } = (req as any).session;
  await setRuleEnabled(user.id, Number(req.params.id), String((req.body ?? {}).enabled) === 'true');
  res.redirect(302, '/my/alerts');
});

my.post('/alerts/:id/delete', myCsrf, async (req, res) => {
  const { user } = (req as any).session;
  await deleteRule(user.id, Number(req.params.id));
  res.redirect(302, '/my/alerts?ok=' + encodeURIComponent('Alerta eliminado.'));
});

// ---- Inbox ----
my.get('/inbox', async (req, res) => {
  const { user, csrf } = (req as any).session;
  const [items, unread] = await Promise.all([listNotifications(user.id), unreadCount(user.id)]);
  res.type('html').send(renderInbox({ items, unread, csrf, prefs: prefsOf(req) }));
});

my.post('/inbox/read', myCsrf, async (req, res) => {
  await markAllRead((req as any).session.user.id);
  res.redirect(302, '/my/inbox');
});

my.get('/export', async (req, res) => {
  const { user } = (req as any).session;
  const data = await exportUserData(user.id);
  res.setHeader('Content-Disposition', `attachment; filename="gni-dados-${user.id}.json"`);
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

my.post('/delete', myCsrf, async (req, res) => {
  const { user } = (req as any).session;
  await deleteUser(user.id);
  res.append('Set-Cookie', `${USER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.redirect(302, '/?ok=' + encodeURIComponent('Conta eliminada.'));
});

app.use('/my', my);

app.get('/brief', async (req, res) => {
  const sess = await currentUser(req);
  const brief = await buildDailyBrief(sess?.user.id ?? null, Number(req.query.h ?? 24));
  res.type('html').send(renderBrief({
    ...brief,
    sections: brief.sections.map((s) => ({ heading: s.heading, events: decorate(s.events) })),
  }, !!sess, prefsOf(req)));
});

app.get('/api/brief', rateLimit(60, 60_000), async (req, res) => {
  const sess = await currentUser(req);
  const brief = await buildDailyBrief(sess?.user.id ?? null, Number(req.query.h ?? 24));
  res.json({ ...brief, sections: brief.sections.map((s) => ({ heading: s.heading, events: decorate(s.events) })) });
});

app.use((_req, res) => res.status(404).type('html').send(renderList({ title: '404', events: [], note: 'Página não encontrada.' })));

// ---------------------------------------------------------------- bootstrap
export async function bootstrap(): Promise<void> {
  await migrate();
  await registerSources();
}
