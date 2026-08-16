/**
 * Specialist agents — Sections 9, 15, 18, 19.
 *
 * All are deterministic: they only restructure and cross-check data that already
 * exists in the database. None of them can author a fact. When the inputs do not
 * support a conclusion the agent returns status 'insufficient_data' with output
 * null, which the UI renders as INSUFFICIENT DATA.
 */
import type { Agent, AgentContext, AgentResult } from './types.js';

const ok = <T>(a: Agent, output: T, confidence: number | null, notes: string[] = []): AgentResult<T> => ({
  agent: a.name, agentVersion: a.version, mode: 'deterministic', status: 'ok', output, confidence, notes,
});
const insufficient = (a: Agent, why: string): AgentResult<never> => ({
  agent: a.name, agentVersion: a.version, mode: 'deterministic', status: 'insufficient_data',
  output: null, confidence: null, notes: [why],
});

// ---------------------------------------------------------------- NATURAL EVENTS
export const naturalEventsAgent: Agent = {
  name: 'natural_events', version: '1.0.0',
  appliesTo: (c) => c.event.category === 'natural_events',
  async run(c) {
    const measured: Record<string, { value: unknown; source: string; url: string }> = {};
    for (const a of c.articles) {
      try {
        const m = JSON.parse(a.payload)?.measurements;
        if (m && typeof m === 'object') {
          for (const [k, v] of Object.entries(m)) {
            if (v === null || v === undefined || v === '') continue;
            if (!(k in measured)) measured[k] = { value: v, source: a.source_name, url: a.url };
          }
        }
      } catch { /* payload not JSON-shaped: nothing extracted, nothing invented */ }
    }
    const coords = c.articles.find((a) => a.lat != null && a.lon != null);
    if (!Object.keys(measured).length && !coords) {
      return insufficient(naturalEventsAgent, 'no provider-supplied magnitude, depth or coordinates in any linked article');
    }
    return ok(naturalEventsAgent, {
      measurements: measured,
      coordinates: coords ? { lat: coords.lat, lon: coords.lon, source: coords.source_name, url: coords.url } : null,
      note: 'All values copied verbatim from provider fields. No value is estimated.',
    }, Object.keys(measured).length ? 85 : 60, [`extracted ${Object.keys(measured).length} provider fields`]);
  },
};

// ---------------------------------------------------------------- WAR & CONFLICT
export const warConflictAgent: Agent = {
  name: 'war_conflict', version: '1.0.0',
  appliesTo: (c) => c.event.category === 'war_conflict',
  async run(c) {
    const OFFICIAL = new Set(['official', 'scientific']);
    const buckets = { CONFIRMED: [] as string[], CLAIMED: [] as string[], UNVERIFIED: [] as string[], DISPUTED: [] as string[] };
    const attribution = /\b(said|claimed|alleged|according to|afirmou|alegou|segundo|reivindic)\b/i;
    for (const a of c.articles) {
      const text = `${a.title} ${a.summary ?? ''}`;
      if (attribution.test(text)) buckets.CLAIMED.push(`${a.source_name}: ${a.title}`);
      else if (OFFICIAL.has(a.origin_type)) buckets.CONFIRMED.push(`${a.source_name}: ${a.title}`);
      else buckets.UNVERIFIED.push(`${a.source_name}: ${a.title}`);
    }
    return ok(warConflictAgent, {
      buckets,
      note: 'Statements attributed to a party are CLAIMED, not fact. Propaganda is never promoted to CONFIRMED.',
    }, c.event.independent_sources >= 2 ? 60 : 35);
  },
};

// ---------------------------------------------------------------- ENTITIES
const ENTITY_STOP = new Set(['The', 'A', 'An', 'This', 'That', 'These', 'Those', 'It', 'In', 'On', 'At', 'For', 'And', 'But', 'New', 'More', 'Why', 'How', 'What', 'When', 'Live', 'Watch', 'Video', 'Um', 'Uma', 'Os', 'As', 'Mais', 'Como', 'Porque']);

export const entityAgent: Agent = {
  name: 'entity', version: '1.0.0',
  appliesTo: () => true,
  async run(c) {
    const counts = new Map<string, number>();
    for (const a of c.articles) {
      const text = `${a.title}. ${a.summary ?? ''}`;
      const matches = text.match(/\b[A-ZÀ-Þ][\wÀ-ÿ'’-]+(?:\s+(?:de|da|do|of|van|von|el)?\s*[A-ZÀ-Þ][\wÀ-ÿ'’-]+){0,3}\b/g) ?? [];
      for (const m of matches) {
        const clean = m.trim();
        if (clean.length < 3 || ENTITY_STOP.has(clean)) continue;
        if (/^[A-ZÀ-Þ]+$/.test(clean) && clean.length < 3) continue;
        counts.set(clean, (counts.get(clean) ?? 0) + 1);
      }
    }
    const entities = [...counts.entries()]
      .filter(([, n]) => n >= Math.min(2, c.articles.length))
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([name, mentions]) => ({ name, mentions }));
    if (!entities.length) return insufficient(entityAgent, 'no repeated capitalised entity across the linked articles');
    return ok(entityAgent, { entities, note: 'Surface-form extraction; entities are not resolved to a knowledge base.' }, 55);
  },
};

// ---------------------------------------------------------------- CONTRADICTION
export const contradictionAgent: Agent = {
  name: 'contradiction', version: '1.0.0',
  appliesTo: (c) => c.articles.length >= 2,
  async run(c) {
    const conflicts: Array<{ field: string; values: Array<{ source: string; url: string; value: string }> }> = [];

    // Numeric claims of the same kind that disagree (magnitude, deaths, injured...)
    const patterns: Array<{ field: string; re: RegExp }> = [
      { field: 'magnitude', re: /\b(?:magnitude|mag\.?|m)\s*([0-9]+(?:[.,][0-9]+)?)/i },
      { field: 'fatalities', re: /\b([0-9][0-9.,]*)\s*(?:people\s+)?(?:killed|dead|deaths|mortos|mortes|v[ií]timas mortais)\b/i },
      { field: 'injured', re: /\b([0-9][0-9.,]*)\s*(?:injured|wounded|feridos)\b/i },
      { field: 'depth_km', re: /\bdepth(?: of)?\s*([0-9]+(?:[.,][0-9]+)?)\s*km\b/i },
    ];
    for (const { field, re } of patterns) {
      const found = new Map<string, { source: string; url: string; value: string }>();
      for (const a of c.articles) {
        const m = `${a.title} ${a.summary ?? ''}`.match(re);
        if (m) {
          const v = m[1].replace(',', '.');
          if (!found.has(v)) found.set(v, { source: a.source_name, url: a.url, value: v });
        }
      }
      if (found.size > 1) conflicts.push({ field, values: [...found.values()] });
    }

    if (!conflicts.length) {
      return ok(contradictionAgent, { conflicts: [], note: 'No numeric disagreement detected among linked articles.' }, 70);
    }
    return ok(contradictionAgent, {
      conflicts,
      note: 'Divergence is shown, not resolved. The system does not pick a value arbitrarily.',
    }, 80, [`${conflicts.length} conflicting field(s)`]);
  },
};

// ---------------------------------------------------------------- VERIFICATION
export const verificationAgent: Agent = {
  name: 'verification', version: '1.0.0',
  appliesTo: () => true,
  async run(c) {
    const groups = new Set(c.articles.map((a) => a.publisher_group));
    const official = c.articles.filter((a) => a.origin_type === 'official' || a.origin_type === 'scientific');
    const withTimestamp = c.articles.filter((a) => a.published_at);
    const reliabilities = c.articles.map((a) => a.reliability_score).filter((r): r is number => r != null);

    const checks = [
      { check: 'source_exists', pass: c.articles.length > 0, detail: `${c.articles.length} linked article(s)` },
      { check: 'independent_confirmation', pass: groups.size >= 2, detail: `${groups.size} distinct publisher group(s): ${[...groups].join(', ')}` },
      { check: 'primary_or_official_source', pass: official.length > 0, detail: official.length ? official.map((a) => a.source_name).join(', ') : 'none' },
      { check: 'timestamps_present', pass: withTimestamp.length === c.articles.length, detail: `${withTimestamp.length}/${c.articles.length} articles carry a published timestamp` },
      { check: 'source_reliability_known', pass: reliabilities.length === c.articles.length, detail: reliabilities.length ? `min ${Math.min(...reliabilities)}, max ${Math.max(...reliabilities)}` : 'unassessed sources present' },
    ];

    // Verification verdict — deliberately conservative.
    const verdict =
      checks[1].pass && checks[2].pass ? 'VERIFIED'
      : checks[1].pass || checks[2].pass ? 'UNCERTAIN'
      : 'UNVERIFIED';

    return ok(verificationAgent, { checks, verdict, independent_groups: groups.size }, null, [
      'Source reliability and event confidence are separate dimensions (Section 11).',
    ]);
  },
};

export const ALL_AGENTS: Agent[] = [naturalEventsAgent, warConflictAgent, entityAgent, contradictionAgent, verificationAgent];
