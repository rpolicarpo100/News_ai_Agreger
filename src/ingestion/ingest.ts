/**
 * Ingestion worker — Section 1 (INGESTION → NORMALIZATION) and 42 (source health).
 *
 * Guarantees:
 *  - one row per real remote record, storing the verbatim provider payload;
 *  - a failed source is recorded as failed. No substitute data is invented.
 */
import { getDb, nowIso } from '../db/index.js';
import { SOURCES, type SourceDef } from './sources.js';
import { parseFeed } from './rss.js';
import { articleId, contentHash, sha1 } from '../core/ids.js';
import { audit } from '../core/audit.js';
import { getFlag, FLAGS } from '../core/flags.js';
import { classify } from '../pipeline/classify.js';
import { geocodeFromText } from '../pipeline/geo.js';

const UA = 'GlobalNewsIntelligence/0.1 (+https://github.com/; research aggregator; contact via repo)';
const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 15000);

export interface IngestReport {
  startedAt: string;
  finishedAt: string;
  sources: Array<{ id: string; status: string; items: number; inserted: number; error?: string; ms: number }>;
  totalInserted: number;
}

export async function registerSources(): Promise<void> {
  const db = await getDb();
  for (const s of SOURCES) {
    await db.query(
      `INSERT INTO source (id,name,homepage_url,feed_url,kind,origin_type,country,language,categories,publisher_group,reliability_score,reliability_basis)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         name=$2, homepage_url=$3, feed_url=$4, kind=$5, origin_type=$6, country=$7,
         language=$8, categories=$9, publisher_group=$10, reliability_score=$11, reliability_basis=$12`,
      [s.id, s.name, s.homepage_url, s.feed_url, s.kind, s.origin_type, s.country, s.language,
       s.categories, s.publisher_group, s.reliability_score ?? null, s.reliability_basis ?? null],
    );
    await db.query(`INSERT INTO source_health (source_id) VALUES ($1) ON CONFLICT (source_id) DO NOTHING`, [s.id]);
  }
}

async function fetchText(url: string): Promise<{ body: string; ms: number }> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/json;q=0.9, */*;q=0.5' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    return { body, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

interface NormalizedRecord {
  url: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  lat?: number | null;
  lon?: number | null;
  place?: string | null;
  geoPrecision?: string;
  geoBasis?: string;
  measurements?: Record<string, unknown>;
  raw: string;
}

/** USGS GeoJSON → normalized records. All numbers come straight from the provider. */
function normalizeUsgs(body: string): NormalizedRecord[] {
  const data = JSON.parse(body);
  const feats = Array.isArray(data?.features) ? data.features : [];
  return feats.map((f: any): NormalizedRecord | null => {
    const p = f?.properties ?? {};
    const c = f?.geometry?.coordinates;
    if (!p.url || !p.title) return null;
    return {
      url: String(p.url),
      title: String(p.title),
      summary: p.place ? `Sismo registado pelo USGS. Local indicado pela fonte: ${p.place}.` : null,
      publishedAt: p.time ? new Date(Number(p.time)).toISOString() : null,
      lat: Array.isArray(c) ? Number(c[1]) : null,
      lon: Array.isArray(c) ? Number(c[0]) : null,
      place: p.place ?? null,
      geoPrecision: 'exact',
      geoBasis: 'USGS geometry.coordinates (instrumental epicentre)',
      measurements: {
        magnitude: p.mag ?? null,
        magnitude_type: p.magType ?? null,
        depth_km: Array.isArray(c) ? c[2] ?? null : null,
        felt_reports: p.felt ?? null,
        alert: p.alert ?? null,
        tsunami_flag: p.tsunami ?? null,
        usgs_status: p.status ?? null,
      },
      raw: JSON.stringify(f).slice(0, 8000),
    };
  }).filter(Boolean) as NormalizedRecord[];
}

export async function ingestSource(s: SourceDef): Promise<{ status: string; items: number; inserted: number; error?: string; ms: number }> {
  const db = await getDb();
  await db.query(`UPDATE source_health SET last_attempt_at=now(), status='unknown' WHERE source_id=$1`, [s.id]);
  let records: NormalizedRecord[] = [];
  let ms = 0;
  try {
    const { body, ms: took } = await fetchText(s.feed_url);
    ms = took;
    if (s.kind === 'geojson') {
      records = normalizeUsgs(body);
    } else {
      records = parseFeed(body).map((i) => ({
        url: i.link, title: i.title, summary: i.summary, publishedAt: i.publishedAt, raw: i.raw,
        // Coordinates only when the feed itself published them.
        lat: i.lat, lon: i.lon,
        place: i.countryName,
        geoPrecision: i.lat != null ? 'exact' : undefined,
        geoBasis: i.lat != null ? `coordinates published by ${s.name} in the feed item (georss/geo)` : undefined,
        measurements: i.measurements ?? undefined,
      }));
    }
    if (records.length === 0) {
      await db.query(
        `UPDATE source_health SET status='degraded', last_error=$2, response_ms=$3, items_last_run=0,
         parse_failures=parse_failures+1, consecutive_fail=consecutive_fail+1 WHERE source_id=$1`,
        [s.id, 'feed returned no parsable items', ms],
      );
      return { status: 'degraded', items: 0, inserted: 0, error: 'no parsable items', ms };
    }
  } catch (err: any) {
    const msg = String(err?.message ?? err).slice(0, 400);
    await db.query(
      `UPDATE source_health SET status='offline', last_error=$2, response_ms=$3, items_last_run=0,
       consecutive_fail=consecutive_fail+1 WHERE source_id=$1`,
      [s.id, msg, ms],
    );
    await audit({ actor: 'ingestion', action: 'source_fetch_failed', objectType: 'source', objectId: s.id, reason: msg });
    // Section 74: fail safe. No substitute data.
    return { status: 'offline', items: 0, inserted: 0, error: msg, ms };
  }

  let inserted = 0;
  for (const r of records) {
    const id = articleId(r.url);
    const exists = await db.query(`SELECT 1 FROM article WHERE id=$1`, [id]);
    if (exists.length) continue;

    const cls = classify(r.title, r.summary, s);
    const geo = r.lat != null && r.lon != null
      ? { country: null as string | null, place: r.place ?? null, lat: r.lat, lon: r.lon, precision: r.geoPrecision ?? 'exact', basis: r.geoBasis ?? 'provider coordinates' }
      : geocodeFromText(`${r.title} ${r.summary ?? ''}`, s.country);

    await db.query(
      `INSERT INTO article (id, source_id, url, title, summary, raw_hash, content_hash, published_at, language,
        category, category_basis, geo_country, geo_place, lat, lon, geo_precision, geo_basis, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, s.id, r.url, r.title, r.summary, sha1(r.raw), contentHash(r.title, r.summary),
       r.publishedAt, s.language, cls.category, cls.basis, geo.country, geo.place, geo.lat, geo.lon,
       geo.precision, geo.basis, JSON.stringify({ provider: s.id, record: r.raw, measurements: r.measurements ?? null })],
    );
    inserted++;
  }

  await db.query(
    `UPDATE source_health SET status='online', last_success_at=now(), last_error=NULL,
     response_ms=$2, items_last_run=$3, consecutive_fail=0 WHERE source_id=$1`,
    [s.id, ms, records.length],
  );
  return { status: 'online', items: records.length, inserted, ms };
}

export async function runIngestion(): Promise<IngestReport> {
  const startedAt = nowIso();
  if ((await getFlag(FLAGS.INGESTION)) !== 'on') {
    return { startedAt, finishedAt: nowIso(), sources: [], totalInserted: 0 };
  }
  const db = await getDb();
  await registerSources();
  const enabled = await db.query<{ id: string }>(`SELECT id FROM source WHERE enabled AND NOT blocked`);
  const allowed = new Set(enabled.map((e) => e.id));

  const results = await Promise.all(
    SOURCES.filter((s) => allowed.has(s.id)).map(async (s) => ({ id: s.id, ...(await ingestSource(s)) })),
  );
  const totalInserted = results.reduce((a, r) => a + r.inserted, 0);
  await audit({
    actor: 'ingestion', action: 'run', objectType: 'pipeline', objectId: 'ingestion',
    newState: { inserted: totalInserted, sources: results.length },
    reason: 'scheduled ingestion cycle',
  });
  return { startedAt, finishedAt: nowIso(), sources: results, totalInserted };
}
