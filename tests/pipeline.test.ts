/**
 * Critical tests — Section 78.
 * These run against a throwaway PGlite database in ./data/test-pgdata.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';

process.env.PGLITE_DIR = './data/test-pgdata';
delete process.env.DATABASE_URL;
rmSync('./data/test-pgdata', { recursive: true, force: true });
mkdirSync('./data/test-pgdata', { recursive: true });

const { getDb, migrate } = await import('../src/db/index.js');
const { classify } = await import('../src/pipeline/classify.js');
const { geocodeFromText } = await import('../src/pipeline/geo.js');
const { parseFeed } = await import('../src/ingestion/rss.js');
const { tokens, jaccard, runClustering } = await import('../src/pipeline/cluster.js');
const { confidence, relevance, lifeImpact, trending, scoreEvent } = await import('../src/pipeline/scoring.js');
const { freshness } = await import('../src/pipeline/freshness.js');
const { recordView, sessionHash } = await import('../src/pipeline/views.js');
const { processEvent } = await import('../src/agents/orchestrator.js');
const { contradictionAgent, verificationAgent } = await import('../src/agents/specialists.js');
const { findTestData } = await import('../src/core/testguard.js');
const { articleId, eventId, contentHash } = await import('../src/core/ids.js');

await migrate();
const db = await getDb();

// ---------------------------------------------------------------- fixtures
// These rows exist ONLY inside this isolated test database (Section 3). They are
// flagged where the schema allows and the DB directory is deleted per run.
async function seedRealShapedRows() {
  await db.query(`INSERT INTO source (id,name,homepage_url,feed_url,kind,origin_type,country,language,categories,publisher_group,reliability_score)
    VALUES ('t-usgs','USGS','https://earthquake.usgs.gov/','https://earthquake.usgs.gov/x.geojson','geojson','scientific','US','en','natural_events','usgs',98)
    ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO source (id,name,homepage_url,feed_url,kind,origin_type,country,language,categories,publisher_group,reliability_score)
    VALUES ('t-bbc','BBC','https://bbc.com/','https://feeds.bbci.co.uk/x.xml','rss','outlet','GB','en','general_news','bbc',88)
    ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO source (id,name,homepage_url,feed_url,kind,origin_type,country,language,categories,publisher_group,reliability_score)
    VALUES ('t-bbc2','BBC Tech','https://bbc.com/tech','https://feeds.bbci.co.uk/y.xml','rss','outlet','GB','en','technology','bbc',88)
    ON CONFLICT (id) DO NOTHING`);
}

async function addArticle(o: { id: string; source: string; url: string; title: string; summary?: string; when?: string; cat?: string; lat?: number; lon?: number; measurements?: any }) {
  await db.query(
    `INSERT INTO article (id, source_id, url, title, summary, raw_hash, content_hash, published_at, language, category, category_basis, lat, lon, geo_precision, payload)
     VALUES ($1,$2,$3,$4,$5,'h',$6,$7,'en',$8,'test fixture',$9,$10,'exact',$11)`,
    [o.id, o.source, o.url, o.title, o.summary ?? null, contentHash(o.title, o.summary ?? null),
     o.when ?? new Date().toISOString(), o.cat ?? 'natural_events', o.lat ?? null, o.lon ?? null,
     JSON.stringify({ provider: o.source, measurements: o.measurements ?? null })]);
}

// ---------------------------------------------------------------- ids
test('event id is permanent and correctly shaped', () => {
  const d = new Date('2026-08-16T10:00:00Z');
  const a = eventId('seed-key', d);
  assert.match(a, /^EVT-\d{4}-\d{2}-\d{2}-[0-9A-F]{8}$/);
  assert.equal(a, eventId('seed-key', d), 'same seed must yield same id');
  assert.notEqual(a, eventId('other-seed', d));
});

test('article id derives deterministically from url', () => {
  assert.equal(articleId('https://a.test/x'), articleId('https://a.test/x'));
  assert.notEqual(articleId('https://a.test/x'), articleId('https://a.test/y'));
});

// ---------------------------------------------------------------- rss
test('rss parser extracts real fields and drops items without a URL', () => {
  const xml = `<rss><channel>
    <item><title>Earthquake strikes region</title><link>https://news.test/a</link>
      <description>A magnitude 6.1 quake.</description><pubDate>Sat, 15 Aug 2026 10:00:00 GMT</pubDate></item>
    <item><title>No link here</title><description>orphan</description></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Earthquake strikes region');
  assert.equal(items[0].link, 'https://news.test/a');
  assert.ok(items[0].publishedAt?.startsWith('2026-08-15'));
});

test('rss parser rejects implausible timestamps rather than inventing one', () => {
  const xml = `<rss><channel><item><title>T</title><link>https://n.test/1</link><pubDate>not a date</pubDate></item></channel></rss>`;
  assert.equal(parseFeed(xml)[0].publishedAt, null);
});

// ---------------------------------------------------------------- classification
test('classifier explains itself and refuses to force a category', () => {
  const q = classify('Magnitude 6.2 earthquake strikes coastal region', 'Tsunami warning issued', { categories: 'natural_events', origin_type: 'scientific' });
  assert.equal(q.category, 'natural_events');
  assert.match(q.basis, /matched:/);

  const none = classify('Zzz qqq wxyz', null);
  assert.equal(none.category, 'unclassified');
  assert.match(none.basis, /not forced/);
});

// ---------------------------------------------------------------- geo
test('geo never emits false precision', () => {
  const g = geocodeFromText('Protests in Lisbon this week', 'PT');
  assert.equal(g.country, 'PT');
  assert.equal(g.precision, 'approximate');
  assert.match(g.basis, /APPROXIMATE/);

  const unknown = geocodeFromText('An announcement was made', null);
  assert.equal(unknown.lat, null);
  assert.equal(unknown.precision, 'unknown');
});

// ---------------------------------------------------------------- clustering
test('duplicate detection and clustering group articles into one event', async () => {
  await seedRealShapedRows();
  const t = new Date().toISOString();
  await addArticle({ id: 'A1', source: 't-usgs', url: 'https://q.test/1', title: 'M 6.2 - 100km SW of Coastal City', summary: 'Earthquake recorded.', when: t, lat: 10, lon: 20, measurements: { magnitude: 6.2, depth_km: 30 } });
  await addArticle({ id: 'A2', source: 't-bbc', url: 'https://q.test/2', title: 'M 6.2 earthquake 100km SW of Coastal City', summary: 'Earthquake recorded near coastal city.', when: t, lat: 10.1, lon: 20.1 });
  await addArticle({ id: 'A3', source: 't-bbc', url: 'https://q.test/3', title: 'M 6.2 - 100km SW of Coastal City', summary: 'Earthquake recorded.', when: t });

  const r = await runClustering();
  assert.ok(r.newEvents >= 1);
  const evs = await db.query<any>(`SELECT id, article_count, independent_sources FROM event`);
  assert.equal(evs.length, 1, 'three articles about the same quake must collapse into ONE event');
  assert.equal(Number(evs[0].article_count), 3);
  assert.equal(Number(evs[0].independent_sources), 2, 'two BBC feeds count as one publisher group');
});

test('unrelated article creates its own event', async () => {
  await addArticle({ id: 'B1', source: 't-bbc2', url: 'https://t.test/1', title: 'Chip maker announces new processor architecture', summary: 'Semiconductor announcement.', cat: 'technology' });
  await runClustering();
  const evs = await db.query<any>(`SELECT id, category FROM event ORDER BY category`);
  assert.equal(evs.length, 2);
});

// ---------------------------------------------------------------- scoring
test('scores are deterministic and reproducible', async () => {
  const [ev] = await db.query<any>(`SELECT id FROM event WHERE category='natural_events'`);
  const { loadInputs } = await import('../src/pipeline/scoring.js');
  const i1 = await loadInputs(ev.id);
  const a = confidence(i1!), b = confidence(i1!);
  assert.equal(a.value, b.value, 'same inputs must yield the same score');
  assert.ok(a.factors.length > 0, 'every score must carry its factor breakdown');
  assert.ok(a.factors.every((f) => typeof f.contribution === 'number'));
});

test('trending is N/A without counted views — never estimated', async () => {
  const { loadInputs } = await import('../src/pipeline/scoring.js');
  const [ev] = await db.query<any>(`SELECT id FROM event LIMIT 1`);
  const i = await loadInputs(ev.id);
  const t = trending(i!, false);
  assert.equal(t.value, null);
  assert.match(t.unavailableReason!, /no counted views/);
});

test('trending is N/A when frozen by emergency control', async () => {
  const { loadInputs } = await import('../src/pipeline/scoring.js');
  const [ev] = await db.query<any>(`SELECT id FROM event LIMIT 1`);
  const t = trending((await loadInputs(ev.id))!, true);
  assert.equal(t.value, null);
  assert.match(t.unavailableReason!, /frozen/);
});

test('life impact uses provider magnitude, and is N/A for unknown categories', async () => {
  const { loadInputs } = await import('../src/pipeline/scoring.js');
  const [ev] = await db.query<any>(`SELECT id FROM event WHERE category='natural_events'`);
  const i = (await loadInputs(ev.id))!;
  const li = lifeImpact(i);
  assert.ok(li.value! > 0);
  assert.ok(li.factors.some((f) => f.factor === 'reported_magnitude'), 'magnitude must be a visible factor');

  const bogus = lifeImpact({ ...i, category: 'unmodelled_category' } as any);
  assert.equal(bogus.value, null);
});

test('all scores are within 0..100 or null', async () => {
  const [ev] = await db.query<any>(`SELECT id FROM event LIMIT 1`);
  const results = await scoreEvent(ev.id, false);
  for (const r of results) {
    assert.ok(r.value === null || (r.value >= 0 && r.value <= 100), `${r.kind} out of range`);
  }
});

// ---------------------------------------------------------------- contradictions
test('contradiction agent surfaces divergence without resolving it', async () => {
  const ctx = {
    eventId: 'X', event: { independent_sources: 2 } as any,
    articles: [
      { id: 'a', source_name: 'Alpha', url: 'https://a.test', title: 'Quake magnitude 6.2 hits region', summary: '', origin_type: 'outlet', publisher_group: 'a', reliability_score: 80, source_id: 'a', published_at: null, category: null, lat: null, lon: null, payload: '{}' },
      { id: 'b', source_name: 'Beta', url: 'https://b.test', title: 'Quake magnitude 6.5 hits region', summary: '', origin_type: 'outlet', publisher_group: 'b', reliability_score: 80, source_id: 'b', published_at: null, category: null, lat: null, lon: null, payload: '{}' },
    ],
  } as any;
  const res = await contradictionAgent.run(ctx);
  const conflicts = (res.output as any).conflicts;
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, 'magnitude');
  assert.equal(conflicts[0].values.length, 2);
  assert.match((res.output as any).note, /not resolve/i);
});

test('verification separates source reliability from confirmation', async () => {
  const one = { eventId: 'X', event: {} as any, articles: [
    { id: 'a', source_name: 'BBC', url: 'https://b.test', title: 't', summary: '', origin_type: 'outlet', publisher_group: 'bbc', reliability_score: 88, source_id: 'x', published_at: new Date().toISOString(), category: null, lat: null, lon: null, payload: '{}' },
  ] } as any;
  const r = await verificationAgent.run(one);
  assert.equal((r.output as any).verdict, 'UNVERIFIED', 'a single highly-reliable outlet is not independent confirmation');
});

// ---------------------------------------------------------------- views / anti-manipulation
test('refresh loops do not inflate views', async () => {
  const [ev] = await db.query<any>(`SELECT id FROM event LIMIT 1`);
  const first = await recordView(ev.id, '203.0.113.5', 'Mozilla/5.0 (X11; Linux x86_64)');
  const second = await recordView(ev.id, '203.0.113.5', 'Mozilla/5.0 (X11; Linux x86_64)');
  assert.equal(first.counted, true);
  assert.equal(second.counted, false);
  assert.equal(second.reason, 'dedupe_window');
});

test('bot user agents are rejected', async () => {
  const [ev] = await db.query<any>(`SELECT id FROM event LIMIT 1`);
  const r = await recordView(ev.id, '198.51.100.7', 'python-requests/2.31');
  assert.equal(r.counted, false);
  assert.equal(r.reason, 'bot_pattern');
});

test('session hash does not contain the raw ip', () => {
  const h = sessionHash('203.0.113.5', 'UA');
  assert.ok(!h.includes('203.0.113.5'));
  assert.match(h, /^[0-9a-f]{32}$/);
});

// ---------------------------------------------------------------- freshness
test('freshness thresholds depend on the category', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600e3).toISOString();
  assert.equal(freshness('natural_events', twoHoursAgo).state, 'RECENT');
  assert.equal(freshness('science', twoHoursAgo).state, 'FRESH');
  assert.equal(freshness('natural_events', new Date(Date.now() - 200 * 3600e3).toISOString()).state, 'EXPIRED');
});

// ---------------------------------------------------------------- orchestrator + gate
test('orchestrator runs only relevant agents and records versioned runs', async () => {
  const [ev] = await db.query<any>(`SELECT id FROM event WHERE category='natural_events'`);
  const res = await processEvent(ev.id);
  assert.ok(res);
  assert.ok(res!.agentsRun.includes('natural_events'));
  assert.ok(!res!.agentsRun.includes('war_conflict'), 'irrelevant agents must not run');
  const runs = await db.query<any>(`SELECT agent, agent_version, status FROM agent_run WHERE event_id=$1`, [ev.id]);
  assert.ok(runs.length >= 3);
  assert.ok(runs.every((r: any) => r.agent_version), 'every run must record its agent version');
});

test('quality gate blocks publication of an unclassified event', async () => {
  await db.query(`INSERT INTO source (id,name,homepage_url,feed_url,kind,origin_type,country,language,categories,publisher_group,reliability_score)
    VALUES ('t-unk','Unknown Feed','https://u.test/','https://u.test/f.xml','rss','outlet',NULL,'en','','unk',50) ON CONFLICT DO NOTHING`);
  await addArticle({ id: 'U1', source: 't-unk', url: 'https://u.test/1', title: 'Qqqq wwww eeee', cat: 'unclassified' });
  await runClustering();
  const [ev] = await db.query<any>(`SELECT id FROM event WHERE category='unclassified'`);
  const res = await processEvent(ev.id);
  assert.equal(res!.published, false);
  assert.ok(res!.gate.failures.some((f) => f.includes('CLASSIFIED?')));
  const q = await db.query(`SELECT 1 FROM review_queue WHERE event_id=$1 AND state='open'`, [ev.id]);
  assert.equal(q.length, 1, 'blocked events must land in the human review queue');
});

test('every published event is traceable to a real article url', async () => {
  const rows = await db.query<any>(
    `SELECT e.id FROM event e WHERE e.status='PUBLISHED'
       AND NOT EXISTS (SELECT 1 FROM article a WHERE a.event_id=e.id AND a.url LIKE 'http%')`);
  assert.equal(rows.length, 0, 'a published event without a source URL must not exist');
});

test('every published event has an audit-visible state history', async () => {
  const rows = await db.query<any>(
    `SELECT e.id FROM event e WHERE e.status='PUBLISHED'
       AND NOT EXISTS (SELECT 1 FROM event_state_history h WHERE h.event_id=e.id)`);
  assert.equal(rows.length, 0);
});

test('scores persisted always carry factors and a formula version', async () => {
  const rows = await db.query<any>(`SELECT kind, factors, formula_ver FROM score`);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.formula_ver);
    const parsed = JSON.parse(r.factors);
    assert.ok(Array.isArray(parsed.factors));
  }
});

// ---------------------------------------------------------------- test data guard
test('test data guard finds nothing in a clean database', async () => {
  const findings = await findTestData();
  const flagged = findings.filter((f) => f.kind.includes('is_test_data'));
  assert.equal(flagged.length, 0);
});

test('test data guard detects a suspect url', async () => {
  await addArticle({ id: 'FAKE1', source: 't-bbc', url: 'https://example.com/fake-story', title: 'Placeholder' });
  const findings = await findTestData();
  assert.ok(findings.some((f) => f.kind === 'article.suspect_url'));
  await db.query(`DELETE FROM article WHERE id='FAKE1'`);
});

// ---------------------------------------------------------------- similarity util
test('jaccard similarity behaves', () => {
  assert.equal(jaccard(tokens('earthquake coastal city'), tokens('earthquake coastal city')), 1);
  assert.ok(jaccard(tokens('earthquake coastal city'), tokens('football match results')) < 0.1);
});

// ---------------------------------------------------------------- regression: real-feed defects
test('CDATA-wrapped feed fields are parsed, not swallowed', () => {
  const xml = `<rss><channel><item>
    <title><![CDATA[Russia says at least seven killed in attack]]></title>
    <description><![CDATA[Moscow also launched strikes overnight.]]></description>
    <link>https://www.bbc.co.uk/news/articles/abc?at_medium=RSS&amp;at_campaign=rss</link>
    <pubDate>Sun, 16 Aug 2026 19:58:14 GMT</pubDate></item></channel></rss>`;
  const [i] = parseFeed(xml);
  assert.equal(i.title, 'Russia says at least seven killed in attack');
  assert.equal(i.summary, 'Moscow also launched strikes overnight.');
  assert.ok(i.link.startsWith('https://www.bbc.co.uk/news/articles/abc'));
});

test('feed-published coordinates and measurements are extracted verbatim', () => {
  const xml = `<rss><channel><item>
    <title>Green earthquake (Magnitude 5.5M, Depth:10km) in Indonesia</title>
    <link>https://www.gdacs.org/report.aspx?eventid=1558840</link>
    <geo:Point><geo:lat>-7.9322</geo:lat><geo:long>120.5855</geo:long></geo:Point>
    <gdacs:severity unit="M" value="5.5">Magnitude 5.5M</gdacs:severity>
    <gdacs:population unit="in MMI IV" value="475578">480 thousand</gdacs:population>
    <gdacs:eventid>1558840</gdacs:eventid>
    <gdacs:country>Indonesia</gdacs:country></item></channel></rss>`;
  const [i] = parseFeed(xml);
  assert.equal(i.lat, -7.9322);
  assert.equal(i.lon, 120.5855);
  assert.equal(i.measurements!.magnitude, 5.5);
  assert.equal(i.measurements!.population_affected, 475578);
  assert.equal(i.measurements!.provider_event_id, '1558840');
  assert.equal(i.countryName, 'Indonesia');
});

test('out-of-range coordinates are discarded rather than stored', () => {
  const xml = `<rss><channel><item><title>T</title><link>https://x.test/1</link>
    <geo:Point><geo:lat>999</geo:lat><geo:long>500</geo:long></geo:Point></item></channel></rss>`;
  assert.equal(parseFeed(xml)[0].lat, null);
});

test('template headlines about different countries are NOT merged', async () => {
  await db.query(`INSERT INTO source (id,name,homepage_url,feed_url,kind,origin_type,country,language,categories,publisher_group,reliability_score)
    VALUES ('t-gdacs','GDACS','https://gdacs.org/','https://gdacs.org/x.xml','rss','official','INT','en','natural_events','gdacs',96) ON CONFLICT DO NOTHING`);
  const mk = async (id: string, country: string, lat: number, lon: number, evid: string, episode = '1') => {
    await db.query(
      `INSERT INTO article (id, source_id, url, title, summary, raw_hash, content_hash, published_at, language, category, category_basis, geo_country, lat, lon, geo_precision, payload)
       VALUES ($1,'t-gdacs',$2,$3,'',' h',$4,now(),'en','natural_events','fixture',$5,$6,$7,'exact',$8)`,
      [id, `https://gdacs.org/report.aspx?eventid=${evid}&episode=${episode}`, `Green forest fire notification in ${country}`,
       contentHash(`Green forest fire notification in ${country}`, ''), country.slice(0, 2).toUpperCase(), lat, lon,
       JSON.stringify({ provider: 't-gdacs', measurements: { provider_event_id: evid, event_type: 'WF' } })]);
  };
  await mk('G1', 'Angola', -12.5, 18.5, '9001');
  await mk('G2', 'Zambia', -13.1, 27.8, '9002');
  await mk('G3', 'Angola', -12.6, 18.6, '9001', '2'); // same provider event, later episode => same event
  await runClustering();

  const evs = await db.query<any>(`SELECT e.id, e.article_count FROM event e
    WHERE EXISTS (SELECT 1 FROM article a WHERE a.event_id=e.id AND a.source_id='t-gdacs')`);
  assert.equal(evs.length, 2, 'Angola and Zambia fires must stay distinct events');
  assert.ok(evs.some((e: any) => Number(e.article_count) === 2), 'two episodes of the same provider event must merge');
});

test('future feed timestamps never produce a negative age', () => {
  const future = new Date(Date.now() + 3 * 3600e3).toISOString();
  const f = freshness('general_news', future);
  assert.ok(f.ageHours >= 0);
  assert.equal(f.state, 'FRESH');
});

test('classifier matches whole words only (no substring misfires)', () => {
  // Regression: "esa" inside a Portuguese word used to tag sports as 'space'.
  const c = classify('Francisca Martins apura-se para a final de 400 metros livres dos Europeus de natação', 'Campeonato europeu de natação.');
  assert.notEqual(c.category, 'space');
  // Genuine whole-word hits still work.
  assert.equal(classify('ESA launches new satellite into orbit', null).category, 'space');
  assert.equal(classify('Uma mesa foi vendida num leilão', null).category, 'unclassified');
});

// ---------------------------------------------------------------- admin auth
const { sessionValid, issueSession, verifyAdminToken, csrfToken, parseCookies } = await import('../src/api/session.js');
const { isLocked, recordFailure, recordSuccess, _reset } = await import('../src/api/loginguard.js');

function fakeRes() {
  const headers: string[] = [];
  return { headers, append(_k: string, v: string) { headers.push(v); } } as any;
}
function reqWithCookies(setCookies: string[]) {
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  return { headers: { cookie } } as any;
}

test('admin session is rejected when ADMIN_TOKEN is unset (secure by default)', () => {
  delete process.env.ADMIN_TOKEN;
  const res = fakeRes();
  issueSession(res);
  assert.equal(res.headers.length, 0, 'no session cookie may be issued without a configured token');
  assert.equal(sessionValid({ headers: { cookie: 'gni_admin=abc.def' } } as any), false);
});

test('valid admin session round-trips; tampering is rejected', () => {
  process.env.ADMIN_TOKEN = 'test-token-abcdef123456';
  const res = fakeRes();
  issueSession(res);
  const req = reqWithCookies(res.headers);
  assert.equal(sessionValid(req), true);
  assert.match(csrfToken(req), /^[0-9a-f]{48}$/);

  // Flipping a character in the signature must invalidate the session.
  const raw = parseCookies(req).gni_admin;
  const [b64, sig] = raw.split('.');
  const tampered = `${b64}.${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(sessionValid({ headers: { cookie: `gni_admin=${tampered}` } } as any), false);
});

test('rotating ADMIN_TOKEN invalidates existing sessions', () => {
  process.env.ADMIN_TOKEN = 'first-token-000000';
  const res = fakeRes();
  issueSession(res);
  const req = reqWithCookies(res.headers);
  assert.equal(sessionValid(req), true);
  process.env.ADMIN_TOKEN = 'rotated-token-111111';
  assert.equal(sessionValid(req), false);
});

test('expired sessions are rejected', async () => {
  process.env.ADMIN_TOKEN = 'test-token-abcdef123456';
  process.env.ADMIN_SESSION_HOURS = '-1'; // already expired
  // Re-import is not possible mid-run, so build the cookie the same way with a past expiry.
  const { createHmac } = await import('node:crypto');
  const past = Date.now() - 1000;
  const sig = createHmac('sha256', process.env.ADMIN_TOKEN!).update(`session|${past}`).digest('hex');
  const value = `${Buffer.from(String(past)).toString('base64url')}.${sig}`;
  assert.equal(sessionValid({ headers: { cookie: `gni_admin=${value}` } } as any), false);
  delete process.env.ADMIN_SESSION_HOURS;
});

test('admin token comparison rejects wrong and empty tokens', () => {
  process.env.ADMIN_TOKEN = 'correct-horse-battery-staple';
  assert.equal(verifyAdminToken('correct-horse-battery-staple'), true);
  assert.equal(verifyAdminToken('wrong'), false);
  assert.equal(verifyAdminToken(''), false);
  delete process.env.ADMIN_TOKEN;
  assert.equal(verifyAdminToken('anything'), false);
});

test('brute force lockout engages after repeated failures', async () => {
  _reset();
  const ip = '203.0.113.99';
  assert.equal(isLocked(ip).locked, false);
  for (let i = 0; i < 5; i++) await recordFailure(ip);
  assert.equal(isLocked(ip).locked, true, 'must lock out after 5 failures');
  assert.ok(isLocked(ip).secondsLeft > 0);
  _reset();
  assert.equal(isLocked(ip).locked, false);
});

test('successful login clears the failure counter', async () => {
  _reset();
  const ip = '203.0.113.98';
  await recordFailure(ip);
  await recordFailure(ip);
  recordSuccess(ip);
  for (let i = 0; i < 4; i++) await recordFailure(ip);
  assert.equal(isLocked(ip).locked, false, 'counter must have reset on success');
  _reset();
});

test('manual publication always records a state-history entry', async () => {
  // Regression: writing event.status directly before setState() made setState
  // see no transition, so the manual override left no audit trail (§32).
  const [ev] = await db.query<any>(`SELECT id FROM event WHERE status <> 'PUBLISHED' LIMIT 1`);
  const before = await db.query<any>(`SELECT COUNT(*) AS n FROM event_state_history WHERE event_id=$1`, [ev.id]);
  const { setState } = await import('../src/agents/orchestrator.js');
  await setState(ev.id, 'PUBLISHED', 'admin', 'manual override: test');
  await db.query(`UPDATE event SET published_at=COALESCE(published_at, now()) WHERE id=$1`, [ev.id]);
  const after = await db.query<any>(`SELECT COUNT(*) AS n FROM event_state_history WHERE event_id=$1`, [ev.id]);
  assert.equal(Number(after[0].n), Number(before[0].n) + 1, 'the transition must be recorded');
  const [latest] = await db.query<any>(
    `SELECT to_state, actor, reason FROM event_state_history WHERE event_id=$1 ORDER BY at DESC, id DESC LIMIT 1`, [ev.id]);
  assert.equal(latest.to_state, 'PUBLISHED');
  assert.equal(latest.actor, 'admin');
});

// ---------------------------------------------------------------- accounts (§56, §71)
const users = await import('../src/core/users.js');

test('passwords are scrypt-hashed, never stored in plaintext', async () => {
  const hash = await users.hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('scrypt$'));
  assert.ok(!hash.includes('correct horse'));
  assert.equal(await users.verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await users.verifyPassword('wrong password here', hash), false);
});

test('two identical passwords produce different hashes (unique salts)', async () => {
  const a = await users.hashPassword('same-password-1234');
  const b = await users.hashPassword('same-password-1234');
  assert.notEqual(a, b);
  assert.equal(await users.verifyPassword('same-password-1234', a), true);
  assert.equal(await users.verifyPassword('same-password-1234', b), true);
});

test('registration validates email and password strength', async () => {
  assert.ok((await users.createUser('not-an-email', 'longenoughpassword')).error);
  assert.ok((await users.createUser('a@b.co', 'short')).error);
  assert.ok((await users.createUser('a@b.co', 'aaaaaaaaaaaa')).error, 'repeated-char password rejected');
});

test('account lifecycle: create, authenticate, session, revoke', async () => {
  const { user, error } = await users.createUser('Reader@Example.org', 'a-strong-enough-passphrase');
  assert.equal(error, undefined);
  assert.ok(user!.id.startsWith('USR-'));

  assert.equal(await users.authenticate('reader@example.org', 'wrong-passphrase-xx'), null);
  const authed = await users.authenticate('READER@example.org', 'a-strong-enough-passphrase');
  assert.ok(authed, 'email match must be case-insensitive');

  const sess = await users.createSession(authed!.id);
  const resolved = await users.resolveSession(sess.cookie);
  assert.equal(resolved!.user.id, authed!.id);
  assert.equal(await users.resolveSession('bogus.token'), null);

  await users.revokeSession(sess.cookie);
  assert.equal(await users.resolveSession(sess.cookie), null, 'revoked session must not resolve');
});

test('duplicate registration is refused', async () => {
  await users.createUser('dupe@example.org', 'a-strong-enough-passphrase');
  const second = await users.createUser('DUPE@example.org', 'another-strong-passphrase');
  assert.ok(second.error);
});

test('session tokens are stored only as hashes', async () => {
  const { user } = await users.createUser('hash@example.org', 'a-strong-enough-passphrase');
  const sess = await users.createSession(user!.id);
  const secret = sess.cookie.split('.')[1];
  const rows = await db.query<any>(`SELECT token_hash FROM user_session WHERE user_id=$1`, [user!.id]);
  assert.ok(rows.length);
  assert.notEqual(rows[0].token_hash, secret, 'raw session secret must never be stored');
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
});

test('follows and bookmarks round-trip and are idempotent', async () => {
  const { user } = await users.createUser('follow@example.org', 'a-strong-enough-passphrase');
  await users.addFollow(user!.id, 'category', 'natural_events');
  await users.addFollow(user!.id, 'category', 'natural_events'); // duplicate
  await users.addFollow(user!.id, 'country', 'PT');
  const list = await users.listFollows(user!.id);
  assert.equal(list.length, 2, 'duplicate follow must not create a second row');

  await users.removeFollow(user!.id, 'country', 'PT');
  assert.equal((await users.listFollows(user!.id)).length, 1);

  const [ev] = await db.query<any>(`SELECT id FROM event LIMIT 1`);
  assert.equal(await users.toggleBookmark(user!.id, ev.id), true);
  assert.equal(await users.toggleBookmark(user!.id, ev.id), false, 'toggling twice must remove it');
});

test('GDPR export contains only the declared personal data', async () => {
  const { user } = await users.createUser('export@example.org', 'a-strong-enough-passphrase');
  await users.addFollow(user!.id, 'category', 'health');
  const data: any = await users.exportUserData(user!.id);
  assert.equal(data.user.email, 'export@example.org');
  assert.equal(data.follows.length, 1);
  // No password material may ever leave the system.
  assert.ok(!JSON.stringify(data).includes('scrypt$'));
});

test('account deletion cascades to sessions, follows and bookmarks', async () => {
  const { user } = await users.createUser('erase@example.org', 'a-strong-enough-passphrase');
  const sess = await users.createSession(user!.id);
  await users.addFollow(user!.id, 'category', 'space');
  const [ev] = await db.query<any>(`SELECT id FROM event LIMIT 1`);
  await users.toggleBookmark(user!.id, ev.id);

  await users.deleteUser(user!.id);

  assert.equal((await db.query(`SELECT 1 FROM app_user WHERE id=$1`, [user!.id])).length, 0);
  assert.equal((await db.query(`SELECT 1 FROM follow WHERE user_id=$1`, [user!.id])).length, 0);
  assert.equal((await db.query(`SELECT 1 FROM bookmark WHERE user_id=$1`, [user!.id])).length, 0);
  assert.equal((await db.query(`SELECT 1 FROM user_session WHERE user_id=$1`, [user!.id])).length, 0);
  assert.equal(await users.resolveSession(sess.cookie), null);
});

test('disabled accounts cannot authenticate or resolve sessions', async () => {
  const { user } = await users.createUser('disabled@example.org', 'a-strong-enough-passphrase');
  const sess = await users.createSession(user!.id);
  await db.query(`UPDATE app_user SET disabled=TRUE WHERE id=$1`, [user!.id]);
  assert.equal(await users.authenticate('disabled@example.org', 'a-strong-enough-passphrase'), null);
  assert.equal(await users.resolveSession(sess.cookie), null);
});
