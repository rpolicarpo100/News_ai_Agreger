/**
 * Alert engine (§57) and Daily Intelligence Brief (§58).
 *
 * Delivery is in-app by default. That is a deliberate choice: an alert system
 * whose only channel is an unconfigured email provider would be a button that
 * does nothing (§4). An in-app inbox works with zero external dependencies, and
 * email can be added later as a second channel without changing this logic.
 *
 * Matching runs against real published events only. A rule that matches nothing
 * produces nothing — no digest is padded to look active.
 */
import { getDb } from '../db/index.js';
import { CATEGORY_LABELS_PT } from './classify.js';

export interface AlertRule {
  id: number;
  user_id: string;
  name: string;
  category: string | null;
  country: string | null;
  min_confidence: number | null;
  min_impact: number | null;
  min_relevance: number | null;
  only_verified: boolean;
  enabled: boolean;
  last_fired_at: string | null;
}

export interface RuleInput {
  name: string;
  category?: string | null;
  country?: string | null;
  min_confidence?: number | null;
  min_impact?: number | null;
  min_relevance?: number | null;
  only_verified?: boolean;
}

/** A rule with no constraint at all would match the entire firehose. */
export function validateRule(r: RuleInput): string | null {
  if (!r.name || r.name.trim().length < 2) return 'Dê um nome ao alerta.';
  if (r.name.length > 80) return 'Nome demasiado longo.';
  const bounded = (v: number | null | undefined) => v == null || (Number.isInteger(v) && v >= 0 && v <= 100);
  if (!bounded(r.min_confidence) || !bounded(r.min_impact) || !bounded(r.min_relevance)) {
    return 'Os limiares devem ser números inteiros entre 0 e 100.';
  }
  const hasConstraint = !!r.category || !!r.country || r.only_verified === true ||
    r.min_confidence != null || r.min_impact != null || r.min_relevance != null;
  if (!hasConstraint) return 'Defina pelo menos um critério, caso contrário o alerta corresponderia a tudo.';
  return null;
}

export async function createRule(userId: string, r: RuleInput): Promise<{ id?: number; error?: string }> {
  const err = validateRule(r);
  if (err) return { error: err };
  const db = await getDb();
  const existing = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM alert_rule WHERE user_id=$1`, [userId]);
  if (Number(existing[0].n) >= 20) return { error: 'Limite de 20 alertas por conta atingido.' };
  const rows = await db.query<{ id: number }>(
    `INSERT INTO alert_rule (user_id, name, category, country, min_confidence, min_impact, min_relevance, only_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [userId, r.name.trim(), r.category || null, r.country || null,
     r.min_confidence ?? null, r.min_impact ?? null, r.min_relevance ?? null, r.only_verified === true]);
  return { id: rows[0].id };
}

export async function listRules(userId: string): Promise<AlertRule[]> {
  const db = await getDb();
  return db.query<AlertRule>(
    `SELECT * FROM alert_rule WHERE user_id=$1 ORDER BY created_at DESC`, [userId]);
}

export async function deleteRule(userId: string, id: number): Promise<void> {
  const db = await getDb();
  await db.query(`DELETE FROM alert_rule WHERE id=$1 AND user_id=$2`, [id, userId]);
}

export async function setRuleEnabled(userId: string, id: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE alert_rule SET enabled=$3 WHERE id=$1 AND user_id=$2`, [id, userId, enabled]);
}

/** Human-readable description of what a rule matches — shown next to it. */
export function describeRule(r: AlertRule | RuleInput): string {
  const parts: string[] = [];
  if (r.category) parts.push(CATEGORY_LABELS_PT[r.category] ?? r.category);
  if (r.country) parts.push(`país ${r.country}`);
  if (r.only_verified) parts.push('apenas VERIFIED');
  if (r.min_confidence != null) parts.push(`confidence ≥ ${r.min_confidence}`);
  if (r.min_impact != null) parts.push(`life impact ≥ ${r.min_impact}`);
  if (r.min_relevance != null) parts.push(`relevance ≥ ${r.min_relevance}`);
  return parts.length ? parts.join(' · ') : 'sem critérios';
}

export interface AlertRunReport { rulesEvaluated: number; notificationsCreated: number }

/**
 * Evaluate every enabled rule against recently published events.
 *
 * Scores are read from the latest stored value. A rule with a threshold on a
 * score that is N/A does NOT match: an unknown value is not treated as passing.
 */
export async function runAlerts(sinceHours = 48): Promise<AlertRunReport> {
  const db = await getDb();
  const rules = await db.query<AlertRule>(`SELECT * FROM alert_rule WHERE enabled`);
  if (!rules.length) return { rulesEvaluated: 0, notificationsCreated: 0 };

  const since = new Date(Date.now() - sinceHours * 3600e3).toISOString();
  let created = 0;

  for (const rule of rules) {
    const params: any[] = [rule.user_id, rule.id, since];
    const where: string[] = [`e.status='PUBLISHED'`, `e.published_at > $3`];

    if (rule.category) { params.push(rule.category); where.push(`e.category=$${params.length}`); }
    if (rule.country) { params.push(rule.country.toUpperCase()); where.push(`e.country=$${params.length}`); }
    if (rule.only_verified) where.push(`e.verification='VERIFIED'`);

    const scoreFilter = (kind: string, min: number) => {
      params.push(min);
      // COALESCE to -1 so an N/A score never satisfies a threshold.
      return `COALESCE((SELECT value FROM score WHERE event_id=e.id AND kind='${kind}'
               ORDER BY computed_at DESC LIMIT 1), -1) >= $${params.length}`;
    };
    if (rule.min_confidence != null) where.push(scoreFilter('confidence', rule.min_confidence));
    if (rule.min_impact != null) where.push(scoreFilter('life_impact', rule.min_impact));
    if (rule.min_relevance != null) where.push(scoreFilter('relevance', rule.min_relevance));

    const matches = await db.query<{ id: string }>(
      `SELECT e.id FROM event e
       WHERE ${where.join(' AND ')}
         AND NOT EXISTS (SELECT 1 FROM notification n
                         WHERE n.user_id=$1 AND n.rule_id=$2 AND n.event_id=e.id)
       ORDER BY e.published_at DESC LIMIT 25`, params);

    for (const m of matches) {
      await db.query(
        `INSERT INTO notification (user_id, rule_id, event_id, reason)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [rule.user_id, rule.id, m.id, `Alerta "${rule.name}": ${describeRule(rule)}`]);
      created++;
    }
    if (matches.length) {
      await db.query(`UPDATE alert_rule SET last_fired_at=now() WHERE id=$1`, [rule.id]);
    }
  }
  return { rulesEvaluated: rules.length, notificationsCreated: created };
}

// ---------------------------------------------------------------- notifications
export async function listNotifications(userId: string, limit = 50) {
  const db = await getDb();
  return db.query<any>(
    `SELECT n.id, n.reason, n.created_at, n.read_at, e.id AS event_id, e.slug, e.title,
            e.category, e.country, e.verification, e.last_activity_at
     FROM notification n JOIN event e ON e.id=n.event_id
     WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT $2`, [userId, limit]);
}

export async function unreadCount(userId: string): Promise<number> {
  const db = await getDb();
  const r = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM notification WHERE user_id=$1 AND read_at IS NULL`, [userId]);
  return Number(r[0]?.n ?? 0);
}

export async function markAllRead(userId: string): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE notification SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`, [userId]);
}

// ---------------------------------------------------------------- daily brief (§58)
export interface BriefSection { heading: string; events: any[] }
export interface DailyBrief {
  generatedAt: string;
  windowHours: number;
  personalised: boolean;
  sections: BriefSection[];
  totals: { published: number; followed: number; alerts: number };
  note: string;
}

/**
 * The brief is a selection of real events, not generated prose. Every line is a
 * stored title with its stored scores. Nothing is summarised into new sentences,
 * because that is where invented facts appear (§89: the AI organises, it is not
 * the authority).
 */
export async function buildDailyBrief(userId: string | null, windowHours = 24): Promise<DailyBrief> {
  const db = await getDb();
  const since = new Date(Date.now() - windowHours * 3600e3).toISOString();

  // The window is measured on published_at, which the server sets. Feed-supplied
  // last_activity_at can legitimately sit in the future (publisher clock drift),
  // and filtering on it let events leak into windows they do not belong to.
  const select = `SELECT e.id, e.slug, e.title, e.category, e.country, e.place, e.verification,
      e.last_activity_at, e.article_count, e.independent_sources,
      sc.relevance, sc.confidence, sc.life_impact, sc.trending,
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
    ) vw ON TRUE`;

  const sections: BriefSection[] = [];

  // 1. Highest life impact — the "why it matters" section.
  const impact = await db.query<any>(
    `${select} WHERE e.status='PUBLISHED' AND e.published_at > $1
       AND (SELECT value FROM score WHERE event_id=e.id AND kind='life_impact' ORDER BY computed_at DESC LIMIT 1) IS NOT NULL
     ORDER BY sc.life_impact DESC NULLS LAST LIMIT 6`, [since]);
  if (impact.length) sections.push({ heading: 'Maior impacto potencial', events: impact });

  // 2. Best-corroborated: multiple independent publisher groups.
  const corroborated = await db.query<any>(
    `${select} WHERE e.status='PUBLISHED' AND e.published_at > $1 AND e.independent_sources >= 2
     ORDER BY e.independent_sources DESC, sc.confidence DESC NULLS LAST LIMIT 6`, [since]);
  if (corroborated.length) sections.push({ heading: 'Confirmado por fontes independentes', events: corroborated });

  // 3. Personal: only what the user follows.
  let personalised = false;
  let followed = 0;
  if (userId) {
    const follows = await db.query<{ kind: string; value: string }>(
      `SELECT kind, value FROM follow WHERE user_id=$1`, [userId]);
    followed = follows.length;
    const cats = follows.filter((f) => f.kind === 'category').map((f) => f.value);
    const countries = follows.filter((f) => f.kind === 'country').map((f) => f.value);
    const evIds = follows.filter((f) => f.kind === 'event').map((f) => f.value);
    if (cats.length || countries.length || evIds.length) {
      const mine = await db.query<any>(
        `${select} WHERE e.status='PUBLISHED' AND e.published_at > $1
           AND (e.category = ANY($2) OR e.country = ANY($3) OR e.id = ANY($4))
         ORDER BY e.published_at DESC LIMIT 8`, [since, cats, countries, evIds]);
      personalised = true;
      if (mine.length) sections.unshift({ heading: 'Do que segue', events: mine });
    }
  }

  // 4. Open source conflicts — disagreement is information.
  const disputed = await db.query<any>(
    `${select} WHERE e.status='PUBLISHED' AND e.published_at > $1
       AND EXISTS (SELECT 1 FROM conflict c WHERE c.event_id=e.id AND NOT c.resolved)
     ORDER BY e.published_at DESC LIMIT 5`, [since]);
  if (disputed.length) sections.push({ heading: 'Fontes em conflito', events: disputed });

  const totals = await db.query<any>(
    `SELECT (SELECT COUNT(*) FROM event WHERE status='PUBLISHED' AND published_at > $1)::int AS published`,
    [since]);
  const alerts = userId ? await unreadCount(userId) : 0;

  return {
    generatedAt: new Date().toISOString(),
    windowHours,
    personalised,
    sections,
    totals: { published: Number(totals[0]?.published ?? 0), followed, alerts },
    note: 'Este resumo é uma selecção de acontecimentos reais publicados na janela indicada. Os títulos são os das fontes e os scores são os calculados pelo sistema. Nada aqui é texto gerado.',
  };
}
