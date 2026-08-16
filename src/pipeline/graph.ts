/**
 * Global Event Graph — §29.
 *
 * Replaces the earlier "same category or country" heuristic with typed, evidenced
 * edges. Every relation must name the evidence that produced it, so a reader can
 * judge it. Relations are discovered, never asserted: if two events share nothing
 * measurable, no edge is created.
 *
 * The graph deliberately does NOT claim causation. `cross_domain_impact` means
 * "these co-occur in a pattern that often matters", not "A caused B" — inferring
 * causation from co-occurrence would be exactly the kind of invented conclusion
 * the specification forbids (§30).
 */
import { getDb } from '../db/index.js';
import { tokens, jaccard } from './cluster.js';

/**
 * Corpus-aware similarity. Raw Jaccard rated template headlines as near-identical
 * ("Green forest fire notification in Angola" vs "... in Zambia"), producing
 * thousands of meaningless topic edges. Weighting each token by how rare it is in
 * the current batch makes boilerplate contribute almost nothing, so only genuinely
 * distinctive shared wording creates an edge.
 */
export function idfWeights(titles: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of titles) {
    for (const tok of tokens(t)) df.set(tok, (df.get(tok) ?? 0) + 1);
  }
  const n = Math.max(1, titles.length);
  const w = new Map<string, number>();
  for (const [tok, count] of df) w.set(tok, Math.log(n / count));
  return w;
}

export function weightedSimilarity(a: Set<string>, b: Set<string>, idf: Map<string, number>): number {
  let shared = 0, total = 0;
  const seen = new Set<string>();
  for (const t of a) { const w = idf.get(t) ?? 1; total += w; seen.add(t); if (b.has(t)) shared += w; }
  for (const t of b) { if (!seen.has(t)) total += idf.get(t) ?? 1; }
  return total > 0 ? shared / total : 0;
}

export const GRAPH_VERSION = 'graph-1.0.0';

export type RelationKind =
  | 'same_location'
  | 'same_actor'
  | 'same_topic'
  | 'temporal_sequence'
  | 'cross_domain_impact';

export const RELATION_LABELS_PT: Record<RelationKind, string> = {
  same_location: 'Mesmo local',
  same_actor: 'Mesmas entidades',
  same_topic: 'Mesmo tema',
  temporal_sequence: 'Sequência temporal',
  cross_domain_impact: 'Domínios ligados',
};

/**
 * Category pairs that frequently co-occur in a meaningful way (§29 examples:
 * war → energy → economy; earthquake → infrastructure → economic impact).
 * The pair only produces an edge when the events ALSO share location and a
 * tight time window — the pairing alone is never sufficient.
 */
const LINKED_DOMAINS: Array<[string, string]> = [
  ['war_conflict', 'energy'],
  ['war_conflict', 'economy'],
  ['war_conflict', 'politics'],
  ['natural_events', 'transport'],
  ['natural_events', 'health'],
  ['natural_events', 'environment'],
  ['natural_events', 'energy'],
  ['energy', 'economy'],
  ['economy', 'finance'],
  ['health', 'society'],
  ['politics', 'economy'],
  ['technology', 'ai'],
  ['environment', 'energy'],
];

/**
 * Surface-form entity extraction picks up boilerplate ("Continue", "Sunday") and
 * feed furniture ("USGS", "Sismo"). These are not actors, and matching on them
 * produced edges between unrelated events.
 */
const GENERIC_ENTITIES = new Set([
  'continue', 'read more', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'live', 'watch', 'video', 'analysis', 'opinion', 'news', 'update', 'updates',
  'usgs', 'sismo', 'local', 'earthquake', 'magnitude', 'green', 'notification', 'report',
  'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo', 'reuters', 'ap', 'afp',
]);

function domainsLinked(a: string, b: string): boolean {
  return LINKED_DOMAINS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface GraphEvent {
  id: string; title: string; category: string; country: string | null;
  place: string | null; lat: number | null; lon: number | null;
  /** 'exact' only when the source published real coordinates (§16). */
  geo_precision: string | null;
  first_seen_at: string; last_activity_at: string;
  entities: string[];
}

/** Entities already extracted and stored by the entity agent — reused, not recomputed. */
async function loadEntities(eventIds: string[]): Promise<Map<string, string[]>> {
  const db = await getDb();
  const out = new Map<string, string[]>();
  if (!eventIds.length) return out;
  const rows = await db.query<any>(
    `SELECT DISTINCT ON (event_id) event_id, output
     FROM agent_run WHERE agent='entity' AND status='ok' AND event_id = ANY($1)
     ORDER BY event_id, started_at DESC`, [eventIds]);
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.output);
      const ents = parsed?.output?.entities ?? [];
      out.set(r.event_id, ents.map((e: any) => String(e.name)));
    } catch { /* unreadable output yields no entities, never invented ones */ }
  }
  return out;
}

export interface RelationCandidate {
  from: string; to: string; kind: RelationKind; strength: number; basis: string;
}

/** Pure function: given two events, what evidenced relations exist between them? */
export interface RelateOpts {
  idf?: Map<string, number>;
  /** Entities appearing in this many events or more are treated as boilerplate. */
  commonEntities?: Set<string>;
}

export function relate(a: GraphEvent, b: GraphEvent, optsOrIdf?: Map<string, number> | RelateOpts): RelationCandidate[] {
  const opts: RelateOpts = optsOrIdf instanceof Map ? { idf: optsOrIdf } : (optsOrIdf ?? {});
  const idf = opts.idf;
  const common = opts.commonEntities;
  const out: RelationCandidate[] = [];
  const hoursApart = Math.abs(
    new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime()) / 3600e3;

  // ---- geography
  // Distance is only meaningful between REPORTED coordinates. Gazetteer
  // centroids are shared by every event in a country, so measuring between two
  // of them yields a meaningless "0 km" — false precision (§16). Approximate
  // positions therefore degrade to a country-level statement.
  const exactBoth = a.geo_precision === 'exact' && b.geo_precision === 'exact'
    && a.lat != null && a.lon != null && b.lat != null && b.lon != null;
  const km = exactBoth ? haversineKm([a.lat!, a.lon!], [b.lat!, b.lon!]) : null;
  // A country is only a location claim when it came from the text or from
  // reported coordinates. geo_precision='unknown' means it was inferred from the
  // publisher's country of registration ("the BBC published it"), which says
  // nothing about where the event happened (§16).
  const aLocated = a.geo_precision === 'exact' || a.geo_precision === 'approximate';
  const bLocated = b.geo_precision === 'exact' || b.geo_precision === 'approximate';
  const sameCountry = aLocated && bLocated && !!a.country && a.country === b.country;

  if (km !== null && km < 300) {
    out.push({
      from: a.id, to: b.id, kind: 'same_location',
      strength: Math.round(Math.max(40, 95 - (km / 300) * 55)),
      basis: `Coordenadas reportadas pelas fontes a ${km.toFixed(0)} km de distância.`,
    });
  } else if (km === null && sameCountry && a.place && b.place && a.place === b.place) {
    out.push({
      from: a.id, to: b.id, kind: 'same_location', strength: 45,
      basis: `Mesmo local indicado pelas fontes: ${a.place} (${a.country}). Localização aproximada, sem coordenadas reportadas.`,
    });
  }

  // ---- shared entities
  if (a.entities.length && b.entities.length) {
    const setB = new Set(b.entities.map((e) => e.toLowerCase()));
    const shared = a.entities
      .filter((e) => setB.has(e.toLowerCase()))
      // Two filters: a small hand list of known furniture, plus a corpus rule —
      // an "entity" that appears across many unrelated events is boilerplate,
      // not an actor. The corpus rule generalises to feeds not yet seen.
      .filter((e) => !GENERIC_ENTITIES.has(e.toLowerCase()))
      .filter((e) => !common?.has(e.toLowerCase()))
      .filter((e) => e.length >= 3 && !/^\d+$/.test(e));
    // A shared entity only counts as evidence of a shared actor when it is a
    // plausible proper noun. Feed furniture ("Depth", "UTC", "MMI IV") and
    // fragments of navigation chrome are excluded, and at least one multi-word
    // or clearly specific name must be present — otherwise two unrelated
    // earthquakes "share an actor" simply because both mention a country.
    const specific = shared.filter((e) => e.length >= 4 && /^[A-ZÀ-Þ]/.test(e) && !/^[A-Z]{2,5}$/.test(e));
    if (specific.length >= 2) {
      out.push({
        from: a.id, to: b.id, kind: 'same_actor',
        strength: Math.min(90, 40 + specific.length * 12),
        basis: `Entidades em comum: ${specific.slice(0, 5).join(', ')}.`,
      });
    }
  }

  // ---- topical overlap (same category + similar wording)
  if (a.category === b.category && a.category !== 'unclassified') {
    const ta = tokens(a.title), tb = tokens(b.title);
    const sim = idf ? weightedSimilarity(ta, tb, idf) : jaccard(ta, tb);
    // Distinctive shared terms, ignoring boilerplate that appears everywhere.
    const shared = [...ta].filter((t) => tb.has(t));
    const distinctive = idf ? shared.filter((t) => (idf.get(t) ?? 0) > 1.5) : shared;
    if (sim >= 0.30 && distinctive.length >= 2) {
      out.push({
        from: a.id, to: b.id, kind: 'same_topic',
        strength: Math.min(85, Math.round(sim * 120)),
        basis: `Mesma categoria (${a.category}); termos distintivos em comum: ${distinctive.slice(0, 5).join(', ')}.`,
      });
    }
  }

  // ---- temporal sequence: same place, same category, close in time but distinct
  if (a.category === b.category && hoursApart <= 72 && hoursApart > 0 &&
      ((km !== null && km < 500) || (sameCountry && a.category !== 'general_news'))) {
    out.push({
      from: a.id, to: b.id, kind: 'temporal_sequence',
      strength: Math.round(Math.max(35, 75 - hoursApart)),
      basis: `Mesmo tipo de acontecimento na mesma área, com ${hoursApart.toFixed(0)}h de intervalo.`,
    });
  }

  // ---- cross-domain: linked domains, same country, tight window.
  // Explicitly correlational. No causal claim is made or implied.
  if (domainsLinked(a.category, b.category) && sameCountry && hoursApart <= 48) {
    out.push({
      from: a.id, to: b.id, kind: 'cross_domain_impact',
      strength: Math.round(Math.max(30, 65 - hoursApart / 2)),
      basis: `${a.category} e ${b.category} no mesmo país (${a.country}) com ${hoursApart.toFixed(0)}h de intervalo. Correlação observada, não relação causal.`,
    });
  }

  return out;
}

export interface GraphReport { examined: number; edges: number }

/** Recompute relations for recently active published events. */
export async function buildGraph(limit = 150): Promise<GraphReport> {
  const db = await getDb();
  const rows = await db.query<any>(
    `SELECT id, title, category, country, place, lat, lon, geo_precision, first_seen_at, last_activity_at
     FROM event WHERE status='PUBLISHED' ORDER BY last_activity_at DESC LIMIT $1`, [limit]);
  if (rows.length < 2) return { examined: rows.length, edges: 0 };

  const entities = await loadEntities(rows.map((r: any) => r.id));
  const events: GraphEvent[] = rows.map((r: any) => ({ ...r, entities: entities.get(r.id) ?? [] }));
  const idf = idfWeights(events.map((e) => e.title));

  // Corpus frequency of every extracted entity. Anything present in more than
  // 8% of events is treated as boilerplate rather than a distinguishing actor.
  const entityDf = new Map<string, number>();
  for (const e of events) {
    for (const name of new Set(e.entities.map((x) => x.toLowerCase()))) {
      entityDf.set(name, (entityDf.get(name) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(events.length * 0.03));
  const commonEntities = new Set(
    [...entityDf.entries()].filter(([, n]) => n >= threshold).map(([name]) => name));

  let edges = 0;
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j];
      // Only consider pairs within a sane window; the graph is about proximity.
      const hours = Math.abs(
        new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime()) / 3600e3;
      if (hours > 168) continue;

      for (const rel of relate(a, b, { idf, commonEntities })) {
        // Store one canonical direction so the edge is not duplicated.
        const [from, to] = rel.from < rel.to ? [rel.from, rel.to] : [rel.to, rel.from];
        await db.query(
          `INSERT INTO event_relation (from_event, to_event, kind, strength, basis, detected_by)
           VALUES ($1,$2,$3,$4,$5,'graph_agent')
           ON CONFLICT (from_event, to_event, kind)
           DO UPDATE SET strength=$4, basis=$5`,
          [from, to, rel.kind, rel.strength, rel.basis]);
        edges++;
      }
    }
  }
  return { examined: events.length, edges };
}

export interface RelatedEvent {
  id: string; slug: string; title: string; category: string; country: string | null;
  last_activity_at: string; kind: RelationKind; kind_label: string; strength: number; basis: string;
}

/** Edges are undirected in storage; query both sides. */
export async function relatedEvents(eventId: string, limit = 8): Promise<RelatedEvent[]> {
  const db = await getDb();
  const rows = await db.query<any>(
    `SELECT e.id, e.slug, e.title, e.category, e.country, e.last_activity_at,
            r.kind, r.strength, r.basis
     FROM event_relation r
     JOIN event e ON e.id = CASE WHEN r.from_event=$1 THEN r.to_event ELSE r.from_event END
     WHERE (r.from_event=$1 OR r.to_event=$1) AND e.status='PUBLISHED'
     ORDER BY r.strength DESC, e.last_activity_at DESC LIMIT $2`, [eventId, limit]);
  return rows.map((r: any) => ({
    ...r, kind_label: RELATION_LABELS_PT[r.kind as RelationKind] ?? r.kind,
  }));
}
