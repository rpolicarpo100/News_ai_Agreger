/**
 * Scoring engine — Sections 20, 21, 24, 26.
 *
 * Hard rules:
 *  - a score is a pure function of recorded inputs;
 *  - every score stores the factor breakdown that produced it ("WHY THIS SCORE?");
 *  - when the required inputs do not exist the score is NULL, rendered as N/A;
 *  - no random numbers, ever.
 */
import { getDb } from '../db/index.js';

export const FORMULA_VERSION = 'score-1.0.0';

export interface Factor { factor: string; weight: number; input: string; contribution: number }
export interface ScoreResult { kind: string; value: number | null; factors: Factor[]; unavailableReason?: string }

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

interface EventInputs {
  id: string;
  category: string;
  article_count: number;
  independent_sources: number;
  first_seen_at: string;
  last_activity_at: string;
  measurements: string | null;
  official_sources: number;
  max_reliability: number | null;
  avg_reliability: number | null;
  conflicts: number;
  countries: number;
  views_24h: number;
  views_prev_24h: number;
  timeline_points: number;
}

export async function loadInputs(eventId: string): Promise<EventInputs | null> {
  const db = await getDb();
  const rows = await db.query<any>(
    `SELECT e.id, e.category, e.article_count, e.independent_sources, e.first_seen_at,
            e.last_activity_at, e.measurements,
            (SELECT COUNT(*) FROM article a JOIN source s ON s.id=a.source_id
              WHERE a.event_id=e.id AND s.origin_type IN ('official','scientific')) AS official_sources,
            (SELECT MAX(s.reliability_score) FROM article a JOIN source s ON s.id=a.source_id WHERE a.event_id=e.id) AS max_reliability,
            (SELECT AVG(s.reliability_score) FROM article a JOIN source s ON s.id=a.source_id WHERE a.event_id=e.id) AS avg_reliability,
            (SELECT COUNT(*) FROM conflict c WHERE c.event_id=e.id AND NOT c.resolved) AS conflicts,
            (SELECT COUNT(DISTINCT a.geo_country) FROM article a WHERE a.event_id=e.id AND a.geo_country IS NOT NULL) AS countries,
            (SELECT COUNT(*) FROM event_view v WHERE v.event_id=e.id AND v.counted AND v.at > now() - interval '24 hours') AS views_24h,
            (SELECT COUNT(*) FROM event_view v WHERE v.event_id=e.id AND v.counted AND v.at <= now() - interval '24 hours' AND v.at > now() - interval '48 hours') AS views_prev_24h,
            (SELECT COUNT(*) FROM timeline_entry t WHERE t.event_id=e.id) AS timeline_points
     FROM event e WHERE e.id=$1`, [eventId]);
  if (!rows.length) return null;
  const r = rows[0];
  const num = (v: any) => (v === null || v === undefined ? 0 : Number(v));
  return {
    ...r,
    article_count: num(r.article_count), independent_sources: num(r.independent_sources),
    official_sources: num(r.official_sources), conflicts: num(r.conflicts), countries: num(r.countries),
    views_24h: num(r.views_24h), views_prev_24h: num(r.views_prev_24h), timeline_points: num(r.timeline_points),
    max_reliability: r.max_reliability === null ? null : Number(r.max_reliability),
    avg_reliability: r.avg_reliability === null ? null : Number(r.avg_reliability),
  };
}

// ---------------------------------------------------------------- CONFIDENCE
export function confidence(i: EventInputs): ScoreResult {
  const f: Factor[] = [];
  let v = 0;
  const indep = Math.min(i.independent_sources, 5);
  const c1 = indep * 12;
  f.push({ factor: 'independent_publisher_groups', weight: 12, input: `${i.independent_sources}`, contribution: c1 });
  v += c1;

  const c2 = i.official_sources > 0 ? 25 : 0;
  f.push({ factor: 'official_or_scientific_source_present', weight: 25, input: `${i.official_sources}`, contribution: c2 });
  v += c2;

  const rel = i.max_reliability;
  if (rel == null) {
    return { kind: 'confidence', value: null, factors: f, unavailableReason: 'no source reliability assessed for any linked source' };
  }
  const c3 = Math.round((rel / 100) * 20);
  f.push({ factor: 'best_source_reliability', weight: 20, input: `${rel}`, contribution: c3 });
  v += c3;

  const c4 = i.article_count >= 3 ? 10 : i.article_count === 2 ? 6 : 2;
  f.push({ factor: 'corroborating_article_count', weight: 10, input: `${i.article_count}`, contribution: c4 });
  v += c4;

  const c5 = i.conflicts > 0 ? -Math.min(30, i.conflicts * 15) : 0;
  f.push({ factor: 'unresolved_source_conflicts', weight: -15, input: `${i.conflicts}`, contribution: c5 });
  v += c5;

  return { kind: 'confidence', value: clamp(v), factors: f };
}

// ---------------------------------------------------------------- RELEVANCE
export function relevance(i: EventInputs): ScoreResult {
  const f: Factor[] = [];
  let v = 0;
  const c1 = Math.min(i.article_count, 8) * 6;
  f.push({ factor: 'coverage_volume', weight: 6, input: `${i.article_count} articles`, contribution: c1 }); v += c1;
  const c2 = Math.min(i.independent_sources, 5) * 7;
  f.push({ factor: 'coverage_breadth', weight: 7, input: `${i.independent_sources} groups`, contribution: c2 }); v += c2;
  const c3 = Math.min(i.countries, 4) * 4;
  f.push({ factor: 'geographic_spread', weight: 4, input: `${i.countries} countries referenced`, contribution: c3 }); v += c3;
  const hours = (Date.now() - new Date(i.last_activity_at).getTime()) / 3600e3;
  const c4 = hours < 6 ? 15 : hours < 24 ? 10 : hours < 72 ? 4 : 0;
  f.push({ factor: 'recency_of_last_activity', weight: 15, input: `${hours.toFixed(1)}h ago`, contribution: c4 }); v += c4;
  const c5 = Math.min(i.timeline_points, 6) * 2;
  f.push({ factor: 'timeline_development', weight: 2, input: `${i.timeline_points} entries`, contribution: c5 }); v += c5;
  return { kind: 'relevance', value: clamp(v), factors: f };
}

// ---------------------------------------------------------------- LIFE IMPACT
const IMPACT_BASE: Record<string, number> = {
  natural_events: 45, war_conflict: 45, health: 40, energy: 30, economy: 28,
  transport: 25, environment: 25, politics: 20, crime: 18, finance: 15, society: 15,
  technology: 10, ai: 10, science: 10, space: 8, business: 10, crypto: 8, sports: 3, culture: 3,
};

export function lifeImpact(i: EventInputs): ScoreResult {
  const f: Factor[] = [];
  const base = IMPACT_BASE[i.category];
  if (base === undefined) {
    return { kind: 'life_impact', value: null, factors: f, unavailableReason: `no impact model for category "${i.category}"` };
  }
  let v = base;
  f.push({ factor: 'category_baseline', weight: 1, input: i.category, contribution: base });

  // Provider-supplied magnitude (natural events) — real numbers only.
  let mag: number | null = null;
  try { const m = i.measurements ? JSON.parse(i.measurements) : null; mag = m?.magnitude != null ? Number(m.magnitude) : null; } catch { /* ignore */ }
  if (mag != null && !Number.isNaN(mag)) {
    const c = Math.round(Math.max(0, (mag - 4) * 12));
    f.push({ factor: 'reported_magnitude', weight: 12, input: `M${mag}`, contribution: c }); v += c;
  }
  const c2 = Math.min(i.countries, 4) * 5;
  f.push({ factor: 'countries_referenced', weight: 5, input: `${i.countries}`, contribution: c2 }); v += c2;
  const c3 = Math.min(i.independent_sources, 4) * 3;
  f.push({ factor: 'breadth_of_reporting', weight: 3, input: `${i.independent_sources}`, contribution: c3 }); v += c3;

  return {
    kind: 'life_impact', value: clamp(v), factors: f,
  };
}

// ---------------------------------------------------------------- TRENDING
/** Section 26/27: real counted activity only. No views => no trending score. */
export function trending(i: EventInputs, frozen: boolean): ScoreResult {
  const f: Factor[] = [];
  if (frozen) return { kind: 'trending', value: null, factors: f, unavailableReason: 'trending frozen by administrator (emergency control)' };
  if (i.views_24h === 0) {
    return { kind: 'trending', value: null, factors: f, unavailableReason: 'no counted views in the last 24h — trending is not estimated' };
  }
  let v = 0;
  const c1 = Math.min(60, Math.round(Math.log10(i.views_24h + 1) * 30));
  f.push({ factor: 'counted_views_24h', weight: 30, input: `${i.views_24h}`, contribution: c1 }); v += c1;
  const growth = i.views_prev_24h > 0 ? i.views_24h / i.views_prev_24h : (i.views_24h > 0 ? 2 : 1);
  const c2 = Math.min(25, Math.round((growth - 1) * 20));
  f.push({ factor: 'view_growth_vs_prev_24h', weight: 20, input: `${i.views_prev_24h} → ${i.views_24h}`, contribution: c2 }); v += c2;
  const hours = (Date.now() - new Date(i.last_activity_at).getTime()) / 3600e3;
  const c3 = hours < 3 ? 15 : hours < 12 ? 8 : 0;
  f.push({ factor: 'update_recency', weight: 15, input: `${hours.toFixed(1)}h`, contribution: c3 }); v += c3;
  return { kind: 'trending', value: clamp(v), factors: f };
}

// ---------------------------------------------------------------- SOURCE RELIABILITY (event-level view)
export function sourceReliability(i: EventInputs): ScoreResult {
  if (i.avg_reliability == null) {
    return { kind: 'source_reliability', value: null, factors: [], unavailableReason: 'linked sources have no assessed reliability' };
  }
  return {
    kind: 'source_reliability', value: clamp(i.avg_reliability),
    factors: [{ factor: 'mean_assessed_reliability_of_linked_sources', weight: 1, input: i.avg_reliability.toFixed(1), contribution: clamp(i.avg_reliability) }],
  };
}

// ---------------------------------------------------------------- EVIDENCE STRENGTH
export function evidenceStrength(i: EventInputs): ScoreResult {
  const f: Factor[] = [];
  let v = 0;
  const c1 = i.official_sources > 0 ? 35 : 0;
  f.push({ factor: 'primary_source_present', weight: 35, input: `${i.official_sources}`, contribution: c1 }); v += c1;
  const c2 = Math.min(i.independent_sources, 4) * 10;
  f.push({ factor: 'independent_corroboration', weight: 10, input: `${i.independent_sources}`, contribution: c2 }); v += c2;
  let hasNumbers = false;
  try { const m = i.measurements ? JSON.parse(i.measurements) : null; hasNumbers = !!m && Object.values(m).some((x) => x !== null); } catch { /* ignore */ }
  const c3 = hasNumbers ? 15 : 0;
  f.push({ factor: 'structured_measurements_from_provider', weight: 15, input: String(hasNumbers), contribution: c3 }); v += c3;
  const c4 = i.conflicts > 0 ? -20 : 0;
  f.push({ factor: 'open_conflicts', weight: -20, input: `${i.conflicts}`, contribution: c4 }); v += c4;
  if (v <= 0) return { kind: 'evidence_strength', value: null, factors: f, unavailableReason: 'no qualifying evidence recorded' };
  return { kind: 'evidence_strength', value: clamp(v), factors: f };
}

// ---------------------------------------------------------------- PERSIST
export async function scoreEvent(eventId: string, trendingFrozen: boolean): Promise<ScoreResult[]> {
  const db = await getDb();
  const i = await loadInputs(eventId);
  if (!i) return [];
  const results = [confidence(i), relevance(i), lifeImpact(i), trending(i, trendingFrozen), evidenceStrength(i), sourceReliability(i)];

  for (const r of results) {
    const prev = await db.query<{ value: number | null }>(
      `SELECT value FROM score WHERE event_id=$1 AND kind=$2 ORDER BY computed_at DESC LIMIT 1`, [eventId, r.kind]);
    const oldVal = prev.length ? prev[0].value : undefined;
    const changed = oldVal === undefined || oldVal !== r.value;
    if (!changed) continue;

    await db.query(
      `INSERT INTO score (event_id, kind, value, factors, formula_ver) VALUES ($1,$2,$3,$4,$5)`,
      [eventId, r.kind, r.value, JSON.stringify({ factors: r.factors, unavailableReason: r.unavailableReason ?? null }), FORMULA_VERSION]);

    if (oldVal !== undefined) {
      const reason = r.unavailableReason
        ? `became N/A: ${r.unavailableReason}`
        : `inputs changed: ${r.factors.map((f) => `${f.factor}=${f.input}`).join('; ')}`;
      await db.query(
        `INSERT INTO score_change (event_id, kind, old_value, new_value, reason) VALUES ($1,$2,$3,$4,$5)`,
        [eventId, r.kind, oldVal, r.value, reason]);
    }
    await db.query(
      `INSERT INTO provenance (object_type, object_id, field, value, derivation) VALUES ('score',$1,$2,$3,'computed')`,
      [eventId, r.kind, r.value === null ? 'N/A' : String(r.value)]);
  }
  return results;
}
