/**
 * Duplicate & Cluster agent — Sections 5, 14.
 *
 * Articles are grouped into EVENTS. Matching is lexical + temporal + geographic,
 * fully deterministic and explainable. No LLM is required for the core pipeline
 * to work, so the system degrades to "fewer, coarser events" rather than to
 * fabricated ones when AI is unavailable.
 */
import { getDb } from '../db/index.js';
import { eventId, slugify, sha1 } from '../core/ids.js';
import { audit } from '../core/audit.js';

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'with', 'as', 'at', 'by', 'from', 'after', 'over', 'is', 'are', 'was', 'were', 'says', 'said', 'new',
  'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'por', 'para', 'com', 'que', 'e', 'é', 'ao', 'à', 'se', 'mais', 'após', 'sobre']);

export function tokens(s: string): Set<string> {
  return new Set(
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface ArticleRow {
  id: string; source_id: string; title: string; summary: string | null; category: string | null;
  published_at: string | null; ingested_at: string; lat: number | null; lon: number | null;
  geo_country: string | null; geo_place: string | null; geo_precision: string | null;
  content_hash: string; payload: string; event_id: string | null;
}

const SIM_THRESHOLD = Number(process.env.CLUSTER_SIM ?? 0.30);
const TIME_WINDOW_H = Number(process.env.CLUSTER_WINDOW_H ?? 48);

export interface ClusterReport { newEvents: number; attached: number; duplicates: number }

export async function runClustering(): Promise<ClusterReport> {
  const db = await getDb();
  const pending = await db.query<ArticleRow>(
    `SELECT * FROM article WHERE event_id IS NULL AND NOT is_test_data ORDER BY COALESCE(published_at, ingested_at) ASC LIMIT 500`,
  );
  let newEvents = 0, attached = 0, duplicates = 0;

  for (const art of pending) {
    const when = new Date(art.published_at ?? art.ingested_at);
    // Exact duplicate (same normalized content) already attached to an event?
    const dup = await db.query<{ event_id: string }>(
      `SELECT event_id FROM article WHERE content_hash=$1 AND event_id IS NOT NULL AND id<>$2 LIMIT 1`,
      [art.content_hash, art.id],
    );
    if (dup.length) {
      await attach(art, dup[0].event_id, 'exact content hash duplicate');
      duplicates++; attached++;
      continue;
    }

    // (1) Provider-supplied event identity wins over any heuristic.
    const pkey = providerKey(art);
    if (pkey) {
      const same = await db.query<{ event_id: string }>(
        `SELECT a.event_id FROM article a
         WHERE a.event_id IS NOT NULL AND a.source_id=$1
           AND a.payload LIKE $2 AND a.id<>$3 LIMIT 1`,
        [art.source_id, `%"provider_event_id":"${pkey.split(':').slice(1).join(':')}"%`, art.id]);
      if (same.length) {
        await attach(art, same[0].event_id, `provider event identity ${pkey} (authoritative, not heuristic)`);
        attached++;
        continue;
      }
    }

    const candidates = await db.query<any>(
      `SELECT e.id, e.title, e.category, e.lat, e.lon, e.country, e.first_seen_at, e.last_activity_at, e.measurements
       FROM event e
       WHERE e.last_activity_at > $1 AND (e.category = $2 OR $2 = 'unclassified')
       ORDER BY e.last_activity_at DESC LIMIT 200`,
      [new Date(when.getTime() - TIME_WINDOW_H * 3600e3).toISOString(), art.category ?? 'unclassified'],
    );

    const titleTokens = tokens(art.title);
    const bodyTokens = tokens(`${art.title} ${art.summary ?? ''}`.slice(0, 400));
    let best: { id: string; score: number; why: string } | null = null;

    for (const c of candidates) {
      const ct = tokens(c.title);
      const why: string[] = [];

      // If BOTH sides carry a provider event identity and they differ, they are
      // definitively different occurrences. Never merge them, however similar
      // the template wording ("Green forest fire notification in X") may be.
      if (pkey) {
        let cKey: string | null = null;
        try { cKey = JSON.parse(c.measurements ?? 'null')?.provider_event_id ?? null; } catch { /* ignore */ }
        if (cKey && `${art.source_id}:${cKey}` !== pkey) continue;
      }

      // ---- Hard blockers. Two reports about clearly different places are never
      // the same event, however similar the wording. This is what stops template
      // feeds ("Green forest fire notification in X") collapsing worldwide.
      if (art.lat != null && art.lon != null && c.lat != null && c.lon != null) {
        const km = haversineKm([art.lat, art.lon], [c.lat, c.lon]);
        if (km > 250) continue;
        why.push(`within ${km.toFixed(0)}km`);
      } else if (art.geo_country && c.country && art.geo_country !== c.country) {
        continue; // different countries and no coordinates to prove otherwise
      }

      const titleSim = jaccard(titleTokens, ct);
      const bodySim = jaccard(bodyTokens, ct);
      let score = Math.max(titleSim, bodySim * 0.9);
      why.unshift(`title jaccard ${titleSim.toFixed(2)}`);

      // Shared rare tokens (proper nouns, numbers) are strong evidence that two
      // differently-worded headlines describe the same occurrence.
      const shared = [...titleTokens].filter((t) => ct.has(t));
      const rare = shared.filter((t) => /\d/.test(t) || t.length >= 7);
      if (rare.length >= 2) { score += 0.12; why.push(`shared specific terms: ${rare.slice(0, 4).join(', ')}`); }

      if (art.lat != null && c.lat != null) score += 0.1;
      else if (art.geo_country && c.country && art.geo_country === c.country) {
        score += 0.06; why.push(`same country ${c.country}`);
      }

      if (!best || score > best.score) best = { id: c.id, score, why: why.join('; ') };
    }

    if (best && best.score >= SIM_THRESHOLD) {
      await attach(art, best.id, `similarity ${best.score.toFixed(2)} — ${best.why}`);
      attached++;
    } else {
      const id = eventId(`${art.content_hash}|${art.source_id}`, when);
      const measurements = extractMeasurements(art);
      await db.query(
        `INSERT INTO event (id, slug, title, title_source_id, category, status, country, place, lat, lon,
           geo_precision, first_seen_at, last_activity_at, article_count, independent_sources, measurements)
         VALUES ($1,$2,$3,$4,$5,'CLUSTERED',$6,$7,$8,$9,$10,$11,$11,1,1,$12)
         ON CONFLICT (id) DO NOTHING`,
        [id, slugify(art.title), art.title, art.id, art.category ?? 'unclassified',
         art.geo_country, art.geo_place, art.lat, art.lon, art.geo_precision, when.toISOString(),
         measurements ? JSON.stringify(measurements) : null],
      );
      await db.query(`UPDATE article SET event_id=$1 WHERE id=$2`, [id, art.id]);
      await db.query(
        `INSERT INTO event_state_history (event_id, from_state, to_state, reason, actor)
         VALUES ($1,'EVENT_DETECTED','CLUSTERED',$2,'cluster_agent')`,
        [id, `new event seeded from article ${art.id}`],
      );
      await db.query(
        `INSERT INTO timeline_entry (event_id, at, label, article_id, source_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, when.toISOString(), art.title, art.id, art.source_id],
      );
      await db.query(
        `INSERT INTO provenance (object_type, object_id, field, value, source_id, article_id, origin_url, derivation)
         SELECT 'event', $1, 'title', $2, $3, $4, url, 'verbatim' FROM article WHERE id=$4`,
        [id, art.title, art.source_id, art.id],
      );
      newEvents++;
    }
  }

  await recomputeEventAggregates();
  if (newEvents || attached) {
    await audit({ actor: 'cluster_agent', action: 'run', objectType: 'pipeline', objectId: 'clustering',
      newState: { newEvents, attached, duplicates }, reason: 'clustering cycle' });
  }
  return { newEvents, attached, duplicates };
}

/**
 * Strongest possible cluster signal: the provider's own stable event identifier.
 * GDACS, for instance, publishes several episodes of the SAME disaster under one
 * eventid. Using it groups genuine updates and keeps distinct disasters apart,
 * without any heuristic guessing.
 */
function providerKey(art: ArticleRow): string | null {
  const m = extractMeasurements(art);
  const id = m?.provider_event_id;
  return id ? `${art.source_id}:${String(id)}` : null;
}

function extractMeasurements(art: ArticleRow): Record<string, unknown> | null {
  try {
    const p = JSON.parse(art.payload);
    return p?.measurements ?? null;
  } catch { return null; }
}

async function attach(art: ArticleRow, evId: string, reason: string): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE article SET event_id=$1 WHERE id=$2`, [evId, art.id]);
  const when = new Date(art.published_at ?? art.ingested_at).toISOString();
  await db.query(
    `INSERT INTO timeline_entry (event_id, at, label, article_id, source_id) VALUES ($1,$2,$3,$4,$5)`,
    [evId, when, art.title, art.id, art.source_id],
  );
  await db.query(
    `INSERT INTO provenance (object_type, object_id, field, value, source_id, article_id, origin_url, derivation)
     SELECT 'event', $1, 'clustered_article', $2, $3, $4, url, 'computed' FROM article WHERE id=$4`,
    [evId, reason, art.source_id, art.id],
  );
  await db.query(`UPDATE event SET last_activity_at = GREATEST(last_activity_at, $2) WHERE id=$1`, [evId, when]);
}

/** article_count + independent_sources (Section 13: distinct publisher groups). */
export async function recomputeEventAggregates(): Promise<void> {
  const db = await getDb();
  await db.query(`
    UPDATE event e SET
      article_count = sub.n,
      independent_sources = sub.groups
    FROM (
      SELECT a.event_id AS eid, COUNT(*) AS n, COUNT(DISTINCT s.publisher_group) AS groups
      FROM article a JOIN source s ON s.id = a.source_id
      WHERE a.event_id IS NOT NULL GROUP BY a.event_id
    ) sub
    WHERE e.id = sub.eid AND (e.article_count <> sub.n OR e.independent_sources <> sub.groups)`);
}
