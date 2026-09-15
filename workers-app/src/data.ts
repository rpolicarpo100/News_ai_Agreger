/**
 * Camada de dados — funções extraídas de src/api/server.ts,
 * adaptadas para pg.Pool (Hyperdrive). São queries puras: recebem
 * o pool, fazem SQL, devolvem objects.
 */
import pg from 'pg';

/* ---------------------------------------------------------------- helpers */

export function params(sql: string, values: any[]) {
  // Substitui $1..$n em SQL do PostgreSQL
  let i = 0;
  return sql.replace(/\$\d+/g, () => values[i++] as string);
}

/* ---------------------------------------------------------------- publishedEvents */

export interface EventsOpts {
  category?: string; country?: string; limit?: number; offset?: number;
  minConfidence?: number; minImpact?: number;
  order?: 'recent' | 'relevance' | 'impact' | 'trending' | 'views' | 'confidence';
  dir?: 'asc' | 'desc'; sinceHours?: number;
}

export async function publishedEvents(db: pg.Pool, opts: EventsOpts = {}) {
  const wheres: string[] = [`e.status='PUBLISHED'`, `NOT e.is_test_data`];
  const values: any[] = [];

  const push = (cond: string, val: any) => { values.push(val); wheres.push(cond.replace('$N', `$${values.length}`)); };

  if (opts.category)   push(`e.category=$N`, opts.category);
  if (opts.country)    push(`e.country=$N`, opts.country.toUpperCase());
  if (opts.sinceHours) push(`e.last_activity_at > $N`, new Date(Date.now() - opts.sinceHours * 3600e3).toISOString());
  if (opts.minConfidence != null) push(`COALESCE(sc.confidence,-1) >= $N`, opts.minConfidence);
  if (opts.minImpact != null)     push(`COALESCE(sc.life_impact,-1) >= $N`, opts.minImpact);

  const d = opts.dir === 'asc' ? 'ASC' : 'DESC';
  const byScore = (col: string) => `${col} ${d} NULLS LAST, e.last_activity_at DESC`;
  const ORDERS: Record<string, string> = {
    recent:     `e.last_activity_at ${d}`,
    relevance:  byScore('sc.relevance'),
    confidence: byScore('sc.confidence'),
    impact:     byScore('sc.life_impact'),
    life_impact: byScore('sc.life_impact'),
    trending:   byScore('sc.trending'),
    views:      byScore('vw.total'),
  };
  const order = ORDERS[opts.order ?? 'recent'] ?? ORDERS.recent;

  const limit = Math.min(opts.limit ?? 30, 100);
  values.push(limit);
  values.push(opts.offset ?? 0);

  const r = await db.query(
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
     WHERE ${wheres.join(' AND ')}
     ORDER BY ${order}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return r.rows;
}

/* ---------------------------------------------------------------- eventDetail */

export async function eventDetail(db: pg.Pool, id: string) {
  const ev = await db.query(`SELECT * FROM event WHERE id=$1`, [id]);
  if (!ev.rows.length) return null;
  const e = ev.rows[0];

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

  const views = await viewCounts(db, id);

  return {
    event: e,
    views,
    scores: scores.rows,
    score_changes: changes.rows,
    articles: articles.rows,
    timeline: timeline.rows,
    conflicts: conflicts.rows,
    agent_runs: runs.rows,
    supervisor: review.rows[0] ?? null,
    state_history: states.rows,
  };
}

/* ---------------------------------------------------------------- viewCounts */

export async function viewCounts(db: pg.Pool, eventId: string) {
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE counted) AS total,
            COUNT(*) FILTER (WHERE counted AND at > now() - interval '24 hours') AS h24
     FROM event_view WHERE event_id=$1`, [eventId]);
  const row = r.rows[0];
  return { total: Number(row.total), h24: Number(row.h24) };
}

/* ---------------------------------------------------------------- systemStatus */

export async function systemStatus(db: pg.Pool) {
  const countsR = await db.query(
    `SELECT (SELECT COUNT(*) FROM article) AS articles,
           (SELECT COUNT(*) FROM event) AS events,
           (SELECT COUNT(*) FROM event WHERE status='PUBLISHED') AS published,
           (SELECT COUNT(*) FROM review_queue WHERE state='open') AS review_open,
           (SELECT COUNT(*) FROM conflict WHERE NOT resolved) AS conflicts,
           (SELECT COUNT(*) FROM event_view WHERE counted) AS views,
           (SELECT COUNT(*) FROM source WHERE enabled AND NOT blocked) AS sources_enabled,
           (SELECT COUNT(*) FROM audit_log) AS audit_entries`);
  const health = await db.query(
    `SELECT s.id, s.name, h.status, h.last_success_at, h.last_error, h.items_last_run, h.response_ms
     FROM source s LEFT JOIN source_health h ON h.source_id=s.id ORDER BY h.status, s.name`);
  const flags = await db.query(`SELECT key, value FROM system_flag`);
  const flagsObj = Object.fromEntries(flags.rows.map((r: any) => [r.key, r.value]));
  return {
    counts: Object.fromEntries(Object.entries(countsR.rows[0] as any).map(([k, v]) => [k, Number(v)])),
    flags: flagsObj,
    sources: health.rows,
    time: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- searchEvents */

export async function searchEvents(db: pg.Pool, q: string, limit = 30) {
  const r = await db.query(
    `SELECT e.*, ts_rank_cd(to_tsvector('simple', e.title || ' ' || COALESCE(e.measurements, '')), plainto_tsquery('simple', $1)) AS rank
     FROM event e
     WHERE to_tsvector('simple', e.title || ' ' || COALESCE(e.measurements, '')) @@ plainto_tsquery('simple', $1)
       AND e.status='PUBLISHED' AND NOT e.is_test_data
     ORDER BY rank DESC, e.last_activity_at DESC
     LIMIT $2`, [q, limit]);
  return r.rows;
}

/* ---------------------------------------------------------------- mapEvents */

export async function mapEvents(db: pg.Pool) {
  const r = await db.query(
    `SELECT e.id, e.title, e.slug, e.category, e.country, e.lat, e.lon
     FROM event e
     WHERE e.status='PUBLISHED' AND NOT e.is_test_data AND e.lat IS NOT NULL AND e.lon IS NOT NULL`);
  return r.rows;
}
