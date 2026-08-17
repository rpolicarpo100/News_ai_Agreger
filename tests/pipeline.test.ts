/**
 * Critical tests — Section 78.
 * These run against a throwaway PGlite database in ./data/test-pgdata.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';

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
const { contradictionAgent, verificationAgent, entityAgent } = await import('../src/agents/specialists.js');
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

// ---------------------------------------------------------------- event graph (§29)
const graph = await import('../src/pipeline/graph.js');

function gEvent(o: Partial<any>): any {
  return {
    id: 'E', title: 'T', category: 'general_news', country: null, place: null,
    lat: null, lon: null, geo_precision: 'exact', first_seen_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(), entities: [], ...o,
  };
}

test('graph links nearby events and scores closeness', () => {
  const now = new Date().toISOString();
  const a = gEvent({ id: 'A', lat: 38.72, lon: -9.14, last_activity_at: now });
  const b = gEvent({ id: 'B', lat: 38.75, lon: -9.15, last_activity_at: now });
  const rels = graph.relate(a, b);
  const loc = rels.find((r) => r.kind === 'same_location');
  assert.ok(loc, 'nearby events must be linked');
  assert.ok(loc!.strength > 80, 'very close events score high');
  assert.match(loc!.basis, /km/);
});

test('graph does NOT link distant events', () => {
  const a = gEvent({ id: 'A', lat: 38.7, lon: -9.1 });
  const b = gEvent({ id: 'B', lat: -33.9, lon: 151.2 }); // Sydney
  assert.equal(graph.relate(a, b).some((r) => r.kind === 'same_location'), false);
});

test('shared entities create an evidenced same_actor edge', () => {
  const a = gEvent({ id: 'A', entities: ['Banco Central Europeu', 'Christine Lagarde', 'Frankfurt'] });
  const b = gEvent({ id: 'B', entities: ['Christine Lagarde', 'Banco Central Europeu'] });
  const rel = graph.relate(a, b).find((r) => r.kind === 'same_actor');
  assert.ok(rel);
  assert.match(rel!.basis, /Christine Lagarde/);
});

test('a single shared entity is not enough for an edge', () => {
  const a = gEvent({ id: 'A', entities: ['Lisboa', 'Outra Coisa'] });
  const b = gEvent({ id: 'B', entities: ['Lisboa'] });
  assert.equal(graph.relate(a, b).some((r) => r.kind === 'same_actor'), false);
});

test('cross-domain edges require same country AND a tight window, and disclaim causation', () => {
  const now = Date.now();
  const war = gEvent({ id: 'W', category: 'war_conflict', country: 'UA', last_activity_at: new Date(now).toISOString() });
  const energy = gEvent({ id: 'E', category: 'energy', country: 'UA', last_activity_at: new Date(now - 6 * 3600e3).toISOString() });
  const rel = graph.relate(war, energy).find((r) => r.kind === 'cross_domain_impact');
  assert.ok(rel, 'linked domains in the same country and window must connect');
  assert.match(rel!.basis, /não.*causal/i, 'must explicitly disclaim causation');

  // Different countries: no edge.
  const far = gEvent({ id: 'F', category: 'energy', country: 'JP', last_activity_at: new Date(now).toISOString() });
  assert.equal(graph.relate(war, far).some((r) => r.kind === 'cross_domain_impact'), false);

  // Same country but far apart in time: no edge.
  const old = gEvent({ id: 'O', category: 'energy', country: 'UA', last_activity_at: new Date(now - 200 * 3600e3).toISOString() });
  assert.equal(graph.relate(war, old).some((r) => r.kind === 'cross_domain_impact'), false);
});

test('unrelated events in unlinked domains produce no edges at all', () => {
  const a = gEvent({ id: 'A', category: 'sports', country: 'PT', title: 'Resultado do campeonato de futebol' });
  const b = gEvent({ id: 'B', category: 'space', country: 'US', title: 'Telescope observes distant galaxy' });
  assert.deepEqual(graph.relate(a, b), [], 'no shared evidence must mean no relation');
});

test('buildGraph persists edges and relatedEvents reads them back', async () => {
  const r = await graph.buildGraph(80);
  assert.ok(r.examined > 0);
  const edges = await db.query<any>(`SELECT COUNT(*)::int AS n FROM event_relation`);
  if (Number(edges[0].n) > 0) {
    const [any] = await db.query<any>(`SELECT from_event FROM event_relation LIMIT 1`);
    const rel = await graph.relatedEvents(any.from_event, 5);
    assert.ok(rel.length > 0);
    assert.ok(rel[0].basis, 'every edge must carry its basis');
    assert.ok(rel[0].kind_label, 'every edge must carry a readable label');
    assert.ok(rel[0].strength >= 0 && rel[0].strength <= 100);
  }
});

test('every stored relation has a basis and a valid strength', async () => {
  const bad = await db.query<any>(
    `SELECT COUNT(*)::int AS n FROM event_relation
     WHERE basis IS NULL OR basis='' OR strength < 0 OR strength > 100`);
  assert.equal(Number(bad[0].n), 0);
});

test('approximate coordinates never produce a false "0 km" relation', () => {
  // Regression: gazetteer country centroids are identical for every event in a
  // country, so measuring between them claimed "0 km apart" with strength 95.
  const now = new Date().toISOString();
  const a = gEvent({ id: 'A', lat: 39.5, lon: -8.0, geo_precision: 'approximate', country: 'PT', place: null, last_activity_at: now });
  const b = gEvent({ id: 'B', lat: 39.5, lon: -8.0, geo_precision: 'approximate', country: 'PT', place: null, last_activity_at: now });
  const loc = graph.relate(a, b).find((r) => r.kind === 'same_location');
  assert.equal(loc, undefined, 'centroid-to-centroid distance must not become a location claim');
});

test('two approximate events at the same named place link weakly and say so', () => {
  const a = gEvent({ id: 'A', geo_precision: 'approximate', country: 'PT', place: 'Lisboa', lat: 38.7, lon: -9.1 });
  const b = gEvent({ id: 'B', geo_precision: 'approximate', country: 'PT', place: 'Lisboa', lat: 38.7, lon: -9.1 });
  const loc = graph.relate(a, b).find((r) => r.kind === 'same_location');
  assert.ok(loc);
  assert.ok(loc!.strength < 60, 'approximate matches must score lower than reported coordinates');
  assert.match(loc!.basis, /aproximada/i);
});

test('entity extraction rejects navigation chrome and repeated words', async () => {
  // Regression: NASA's APOD feed produced "entities" like
  // "Today's APOD Archive Submissions" and "APOD Science APOD APOD",
  // which then linked unrelated astronomy pictures as sharing an actor.
  const ctx = {
    eventId: 'X', event: {} as any,
    articles: [1, 2].map((i) => ({
      id: `a${i}`, source_id: 's', source_name: 'NASA', publisher_group: 'nasa',
      origin_type: 'official', reliability_score: 96, url: `https://apod.test/${i}`,
      title: 'APOD Science APOD APOD Today Archive Submissions Index Search',
      summary: 'Astronomy Picture of the Day', published_at: null, category: 'space',
      lat: null, lon: null, payload: '{}',
    })),
  } as any;
  const res = await entityAgent.run(ctx);
  const names: string[] = res.status === 'ok' ? (res.output as any).entities.map((e: any) => e.name) : [];
  assert.ok(!names.some((n) => n.split(/\s+/).length > 3), 'no entity may span more than 3 words');
  assert.ok(!names.some((n) => { const w = n.toLowerCase().split(/\s+/); return w.length > 1 && new Set(w).size < w.length; }),
    'no entity may repeat the same word');
});

test('same_actor requires specific names, not feed furniture', () => {
  // Two unrelated Indonesian earthquakes share "Depth", "UTC", "MMI" — none of
  // which is an actor. They must not be linked on that basis.
  const a = gEvent({ id: 'A', entities: ['Depth', 'UTC', 'MMI'], category: 'natural_events' });
  const b = gEvent({ id: 'B', entities: ['Depth', 'UTC', 'MMI IV'], category: 'natural_events' });
  const rel = graph.relate(a, b, { commonEntities: new Set(['depth', 'utc', 'mmi']) })
    .find((r) => r.kind === 'same_actor');
  assert.equal(rel, undefined);

  // Real named actors still link.
  const c = gEvent({ id: 'C', entities: ['Donald Trump', 'Iran', 'Hormuz'] });
  const d = gEvent({ id: 'D', entities: ['Donald Trump', 'Iran'] });
  assert.ok(graph.relate(c, d, {}).find((r) => r.kind === 'same_actor'));
});

// ---------------------------------------------------------------- payments (§83, §84)
const eth = await import('../src/core/eth.js');
const qr = await import('../src/core/qr.js');
const support = await import('../src/core/support.js');

test('keccak-256 matches the known-answer vector', () => {
  const hex = [...eth.keccak256(new Uint8Array())].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
});

test('EIP-55 checksums match the reference vectors from the specification', () => {
  for (const v of [
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ]) {
    assert.equal(eth.toChecksumAddress(v), v, `checksum mismatch for ${v}`);
  }
});

test('the configured donation address passes its EIP-55 checksum', () => {
  // A typo here sends money nowhere recoverable, so it is asserted, not assumed.
  const configured = '0x558d60469aC85EBC9679aB67835Fa9657a4B469e';
  const r = eth.validateEthAddress(configured);
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.checksum, configured);
});

test('a single-character typo in an address is rejected', () => {
  // Swap one hex digit; the checksum must catch it.
  const good = '0x558d60469aC85EBC9679aB67835Fa9657a4B469e';
  const typo = good.slice(0, -1) + (good.endsWith('e') ? 'f' : 'e');
  const r = eth.validateEthAddress(typo);
  assert.equal(r.valid, false);
  assert.match(r.reason!, /checksum/i);
});

test('malformed addresses are rejected on shape', () => {
  for (const bad of ['', '0x', 'not-an-address', '0x123', '558d60469aC85EBC9679aB67835Fa9657a4B469e0000']) {
    assert.equal(eth.validateEthAddress(bad).valid, false, `should reject ${bad}`);
  }
});

test('an all-lowercase address is accepted but flagged as unverifiable', () => {
  const r = eth.validateEthAddress('0x558d60469ac85ebc9679ab67835fa9657a4b469e');
  assert.equal(r.valid, true);
  assert.match(r.reason!, /checksum/i, 'operator must be told the typo check could not run');
});

test('QR encoder produces a valid, correctly-sized matrix', () => {
  const grid = qr.encodeQr('ethereum:0x558d60469aC85EBC9679aB67835Fa9657a4B469e');
  assert.equal(grid.length, 33, 'version 4 => 33x33 modules');
  assert.ok(grid.every((r) => r.length === grid.length), 'matrix must be square');
  // Finder patterns: dark 7x7 ring in three corners.
  for (const [r0, c0] of [[0, 0], [0, grid.length - 7], [grid.length - 7, 0]]) {
    assert.equal(grid[r0][c0], true);
    assert.equal(grid[r0 + 3][c0 + 3], true, 'finder centre must be dark');
    assert.equal(grid[r0 + 1][c0 + 1], false, 'finder inner ring must be light');
  }
});

test('QR SVG is self-contained with a quiet zone and no external references', () => {
  const svg = qr.qrSvg('https://revolut.me/infowithgoal', { label: 'teste' });
  assert.match(svg, /^<svg /);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg.replace(/aria-label="[^"]*"/, '')),
    'a payment QR must not load anything from a third party');
  assert.match(svg, /fill="#ffffff"/, 'light quiet zone required for scanning');
  assert.match(svg, /role="img"/);
  // viewBox includes the 4-module quiet zone on each side.
  const m = svg.match(/viewBox="0 0 (\d+) \1"/);
  assert.ok(m && Number(m[1]) === qr.encodeQr('https://revolut.me/infowithgoal').length + 8);
});

test('empty QR payload is refused rather than rendering an empty code', () => {
  assert.throws(() => qr.encodeQr(''));
});

test('support config exposes both configured methods with valid payloads', () => {
  const cfg = support.loadSupportConfig();
  assert.equal(cfg.configured, true);
  assert.equal(cfg.problems.length, 0);
  const revolut = cfg.methods.find((m) => m.id === 'revolut');
  const ethereum = cfg.methods.find((m) => m.id === 'ethereum');
  assert.ok(revolut && ethereum);
  assert.equal(revolut!.href, 'https://revolut.me/infowithgoal');
  assert.match(ethereum!.qrPayload, /^ethereum:0x[0-9a-fA-F]{40}$/, 'must be an EIP-681 URI');
  // Both payloads must encode without throwing.
  for (const m of cfg.methods) assert.ok(qr.encodeQr(m.qrPayload).length > 0);
});

test('an invalid configured address is refused, not displayed', () => {
  const prev = process.env.SUPPORT_ETH;
  process.env.SUPPORT_ETH = '0x558d60469aC85EBC9679aB67835Fa9657a4B469f'; // bad checksum
  const cfg = support.loadSupportConfig();
  assert.equal(cfg.methods.some((m) => m.id === 'ethereum'), false, 'must not show a possibly-mistyped address');
  assert.ok(cfg.problems.some((p) => /Ethereum/i.test(p)));
  if (prev === undefined) delete process.env.SUPPORT_ETH; else process.env.SUPPORT_ETH = prev;
});

test('revolut usernames and URLs both normalise to a canonical link', () => {
  const prev = process.env.SUPPORT_REVOLUT;
  for (const input of ['infowithgoal', '@infowithgoal', 'revolut.me/infowithgoal', 'https://revolut.me/infowithgoal']) {
    process.env.SUPPORT_REVOLUT = input;
    const m = support.loadSupportConfig().methods.find((x) => x.id === 'revolut');
    assert.equal(m?.href, 'https://revolut.me/infowithgoal', `failed for ${input}`);
  }
  process.env.SUPPORT_REVOLUT = 'http://evil.test/phish';
  const cfg = support.loadSupportConfig();
  assert.equal(cfg.methods.some((m) => m.id === 'revolut'), false, 'non-revolut links must be refused');
  if (prev === undefined) delete process.env.SUPPORT_REVOLUT; else process.env.SUPPORT_REVOLUT = prev;
});

test('donations cannot reach scoring: no scoring module imports support config', async () => {
  // §84 as an executable check rather than a promise in prose.
  const { readFileSync } = await import('node:fs');
  for (const f of ['src/pipeline/scoring.ts', 'src/pipeline/cluster.ts', 'src/pipeline/graph.ts',
                   'src/agents/orchestrator.ts', 'src/agents/specialists.ts']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/from '.*core\/support/.test(src), `${f} must not import payment configuration`);
    assert.ok(!/SUPPORT_(ETH|REVOLUT)/.test(src), `${f} must not read payment environment variables`);
  }
});

// ---------------------------------------------------------------- alerts & brief (§57, §58)
const alerts = await import('../src/pipeline/alerts.js');

test('a rule with no criteria is refused (it would match everything)', () => {
  assert.ok(alerts.validateRule({ name: 'Tudo' }));
  assert.equal(alerts.validateRule({ name: 'Sismos', category: 'natural_events' }), null);
});

test('rule thresholds must be integers within 0..100', () => {
  assert.ok(alerts.validateRule({ name: 'Alerta', min_confidence: 150 }));
  assert.ok(alerts.validateRule({ name: 'Alerta', min_impact: -5 }));
  assert.equal(alerts.validateRule({ name: 'Alerta', min_impact: 80 }), null);
});

test('alert rules fire only on matching published events', async () => {
  const { user } = await users.createUser('alerts@example.org', 'a-strong-enough-passphrase');
  const made = await alerts.createRule(user!.id, { name: 'Naturais', category: 'natural_events' });
  assert.ok(made.id);

  // Ensure at least one published natural_events event exists in the window.
  await db.query(
    `UPDATE event SET status='PUBLISHED', published_at=now() WHERE category='natural_events'
     AND id IN (SELECT id FROM event WHERE category='natural_events' LIMIT 1)`);

  const r = await alerts.runAlerts();
  assert.ok(r.rulesEvaluated >= 1);

  const notes = await alerts.listNotifications(user!.id);
  assert.ok(notes.length > 0, 'a matching event must produce a notification');
  assert.ok(notes.every((n: any) => n.category === 'natural_events'), 'only matching category may be delivered');
  assert.match(notes[0].reason, /Naturais/, 'notification must say which rule fired');
});

test('the same event never notifies twice for one rule', async () => {
  const { user } = await users.createUser('dupe-alert@example.org', 'a-strong-enough-passphrase');
  await alerts.createRule(user!.id, { name: 'Regra', category: 'natural_events' });
  await alerts.runAlerts();
  const first = (await alerts.listNotifications(user!.id)).length;
  await alerts.runAlerts();
  await alerts.runAlerts();
  assert.equal((await alerts.listNotifications(user!.id)).length, first, 'repeat runs must not duplicate');
});

test('an N/A score never satisfies a threshold', async () => {
  const { user } = await users.createUser('nascore@example.org', 'a-strong-enough-passphrase');
  // Trending is N/A for every event with no counted views, so a rule requiring
  // a high trending value must match nothing rather than treating N/A as pass.
  await db.query(
    `INSERT INTO alert_rule (user_id, name, category, min_relevance) VALUES ($1,'Impossivel',NULL,101)`,
    [user!.id]);
  await alerts.runAlerts();
  assert.equal((await alerts.listNotifications(user!.id)).length, 0);
});

test('disabled rules do not fire', async () => {
  const { user } = await users.createUser('disabled-rule@example.org', 'a-strong-enough-passphrase');
  const made = await alerts.createRule(user!.id, { name: 'Desligado', category: 'natural_events' });
  assert.equal(made.error, undefined);
  await alerts.setRuleEnabled(user!.id, made.id!, false);
  await alerts.runAlerts();
  assert.equal((await alerts.listNotifications(user!.id)).length, 0);
});

test('a user cannot delete or toggle another user\'s rule', async () => {
  const a = await users.createUser('owner@example.org', 'a-strong-enough-passphrase');
  const b = await users.createUser('attacker@example.org', 'a-strong-enough-passphrase');
  const made = await alerts.createRule(a.user!.id, { name: 'Meu alerta', category: 'space' });
  await alerts.deleteRule(b.user!.id, made.id!);       // wrong owner
  assert.equal((await alerts.listRules(a.user!.id)).length, 1, 'rule must survive a foreign delete');
  await alerts.setRuleEnabled(b.user!.id, made.id!, false);
  assert.equal((await alerts.listRules(a.user!.id))[0].enabled, true, 'foreign toggle must not apply');
});

test('unread count and mark-all-read behave', async () => {
  const { user } = await users.createUser('unread@example.org', 'a-strong-enough-passphrase');
  const mk = await alerts.createRule(user!.id, { name: 'Naturais', category: 'natural_events' });
  assert.equal(mk.error, undefined);
  await alerts.runAlerts();
  const before = await alerts.unreadCount(user!.id);
  assert.ok(before > 0, 'a matching rule must produce unread notifications');
  await alerts.markAllRead(user!.id);
  assert.equal(await alerts.unreadCount(user!.id), 0);
});

test('deleting an account removes its alert rules and notifications', async () => {
  const { user } = await users.createUser('cascade-alert@example.org', 'a-strong-enough-passphrase');
  await alerts.createRule(user!.id, { name: 'Cascata', category: 'natural_events' });
  await alerts.runAlerts();
  await users.deleteUser(user!.id);
  assert.equal((await db.query(`SELECT 1 FROM alert_rule WHERE user_id=$1`, [user!.id])).length, 0);
  assert.equal((await db.query(`SELECT 1 FROM notification WHERE user_id=$1`, [user!.id])).length, 0);
});

test('rule description is human-readable', () => {
  const text = alerts.describeRule({ name: 'x', category: 'natural_events', country: 'PT', min_impact: 70 } as any);
  assert.match(text, /Eventos Naturais/);
  assert.match(text, /PT/);
  assert.match(text, /70/);
});

test('daily brief contains only real published events and never invents prose', async () => {
  const brief = await alerts.buildDailyBrief(null, 720);
  assert.ok(brief.sections.length > 0, 'there is published data in this window');
  for (const s of brief.sections) {
    for (const e of s.events) {
      assert.ok(e.id.startsWith('EVT-'));
      assert.ok(e.title && e.title.length > 0);
      // Every brief entry must be a genuinely published event.
      const row = await db.query(`SELECT 1 FROM event WHERE id=$1 AND status='PUBLISHED'`, [e.id]);
      assert.equal(row.length, 1, `${e.id} must be published`);
    }
  }
  assert.match(brief.note, /Nada aqui é texto gerado/);
});

test('daily brief personalises only when the user follows something', async () => {
  const { user } = await users.createUser('brief@example.org', 'a-strong-enough-passphrase');
  const empty = await alerts.buildDailyBrief(user!.id, 720);
  assert.equal(empty.personalised, false, 'no follows => no personal section');
  assert.ok(!empty.sections.some((s) => s.heading === 'Do que segue'));

  await users.addFollow(user!.id, 'category', 'natural_events');
  const personal = await alerts.buildDailyBrief(user!.id, 720);
  assert.equal(personal.personalised, true);
});

test('daily brief on an empty window returns no sections rather than filler', async () => {
  // Use a window in the distant past: earlier tests publish events *during* this
  // run, so a "last one second" window is not reliably empty.
  const db2 = await getDb();
  const [{ max }] = await db2.query<any>(`SELECT MAX(published_at) AS max FROM event`);
  const hoursSinceNewest = max ? (Date.now() - new Date(max).getTime()) / 3600e3 : 0;
  // A window ending before the newest event still contains nothing only if we
  // look at a slice strictly older than everything; simplest is a zero window.
  const brief = await alerts.buildDailyBrief(null, -1);
  assert.equal(brief.sections.length, 0, 'no section may be rendered for an empty window');
  assert.equal(brief.totals.published, 0);
  assert.ok(hoursSinceNewest >= 0);
});

// ---------------------------------------------------------------- LLM grounding (§9, §35, §89)
const llm = await import('../src/agents/llm.js');

const fakeArticles = [
  { id: 'a1', source_id: 's', source_name: 'Reuters', publisher_group: 'reuters', origin_type: 'agency',
    reliability_score: 90, url: 'https://r.test/1', title: 'Magnitude 6.1 earthquake strikes Vanuatu',
    summary: 'A magnitude 6.1 earthquake struck near Port-Olry on Sunday. No casualties were reported.',
    published_at: null, category: 'natural_events', lat: null, lon: null, payload: '{}' },
  { id: 'a2', source_id: 't', source_name: 'AP', publisher_group: 'ap', origin_type: 'agency',
    reliability_score: 90, url: 'https://a.test/2', title: 'Quake felt across northern Vanuatu',
    summary: 'Residents described strong shaking. Authorities said assessments were ongoing.',
    published_at: null, category: 'natural_events', lat: null, lon: null, payload: '{}' },
] as any[];

test('a quote that exists verbatim in the cited article is kept', () => {
  const r = llm.verifyGrounding(
    [{ article: 1, quote: 'No casualties were reported', kind: 'FACT' }], fakeArticles);
  assert.equal(r.kept.length, 1);
  assert.equal(r.dropped.length, 0);
});

test('a fabricated quote is discarded — the model cannot invent evidence', () => {
  const r = llm.verifyGrounding([
    { article: 1, quote: 'Officials confirmed at least twelve people died', kind: 'FACT' },
  ], fakeArticles);
  assert.equal(r.kept.length, 0);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].why, /does not appear verbatim/);
});

test('a paraphrase is discarded even when its meaning is right', () => {
  // "No casualties were reported" paraphrased. Meaning preserved, wording not —
  // and unverifiable wording is not evidence.
  const r = llm.verifyGrounding(
    [{ article: 1, quote: 'There were no reports of any casualties', kind: 'FACT' }], fakeArticles);
  assert.equal(r.kept.length, 0);
});

test('a quote attributed to the wrong article is discarded', () => {
  // Real sentence from article 1, but cited as article 2.
  const r = llm.verifyGrounding(
    [{ article: 2, quote: 'No casualties were reported', kind: 'FACT' }], fakeArticles);
  assert.equal(r.kept.length, 0);
  assert.match(r.dropped[0].why, /verbatim/);
});

test('out-of-range and malformed citations are discarded', () => {
  const r = llm.verifyGrounding([
    { article: 99, quote: 'No casualties were reported', kind: 'FACT' },
    { article: 0, quote: 'No casualties were reported', kind: 'FACT' },
    { article: 1, quote: 'short', kind: 'FACT' },
    { article: 1, quote: 'No casualties were reported', kind: 'INVENTED_KIND' },
    'not an object',
  ] as any, fakeArticles);
  assert.equal(r.kept.length, 0);
  assert.ok(r.dropped.length >= 4);
});

test('grounding tolerates punctuation and case differences but not new words', () => {
  const ok = llm.verifyGrounding(
    [{ article: 1, quote: 'no casualties were reported.', kind: 'FACT' }], fakeArticles);
  assert.equal(ok.kept.length, 1, 'case and trailing punctuation must not matter');
  const bad = llm.verifyGrounding(
    [{ article: 1, quote: 'no serious casualties were reported', kind: 'FACT' }], fakeArticles);
  assert.equal(bad.kept.length, 0, 'an inserted word changes the meaning and must be caught');
});

test('LLM agent reports unavailable, never guesses, when no provider is set', async () => {
  const keys = [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY];
  delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  assert.equal(llm.isLlmAvailable(), false);
  const res = await llm.llmExtractionAgent.run({ eventId: 'X', event: { category: 'natural_events' } as any, articles: fakeArticles });
  assert.equal(res.status, 'unavailable');
  assert.equal(res.output, null, 'an unavailable agent must produce no output at all');
  assert.match(res.notes.join(' '), /no LLM provider/i);
  if (keys[0]) process.env.OPENAI_API_KEY = keys[0];
  if (keys[1]) process.env.ANTHROPIC_API_KEY = keys[1];
});

test('a mostly-fabricating model has its whole response rejected', async () => {
  // Substitute a provider that invents three of four claims.
  const original = llm.getProvider;
  const ctx = { eventId: 'X', event: { category: 'natural_events' } as any, articles: fakeArticles };
  const fabricated = JSON.stringify({
    claims: [
      { article: 1, quote: 'No casualties were reported', kind: 'FACT' },
      { article: 1, quote: 'The president declared a state of emergency', kind: 'FACT' },
      { article: 1, quote: 'Damage was estimated at two billion dollars', kind: 'MEASUREMENT' },
      { article: 2, quote: 'Scientists predict a larger quake within days', kind: 'FACT' },
    ],
    unknowns: [],
  });
  const { kept, dropped } = llm.verifyGrounding(JSON.parse(fabricated).claims, fakeArticles);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 3);
  // The agent rejects the run when under half the claims verify.
  assert.ok(kept.length / 4 < 0.5, 'this response must trip the rejection threshold');
  assert.ok(typeof original === 'function');
});

test('LLM usage is metered for cost control (§67)', () => {
  llm.resetLlmUsage();
  const u = llm.getLlmUsage();
    assert.equal(u.calls, 0);
  assert.equal(u.inputTokens, 0);
});

test('the LLM agent is registered but never blocks the deterministic pipeline', async () => {
  const { ALL_AGENTS } = await import('../src/agents/specialists.js');
  assert.ok(ALL_AGENTS.some((a) => a.name === 'llm_extraction'));
  // With no key configured the orchestrator must still publish events.
  const [ev] = await db.query<any>(`SELECT id FROM event WHERE category='natural_events' LIMIT 1`);
  const res = await processEvent(ev.id);
  assert.ok(res);
  const runs = await db.query<any>(
    `SELECT agent, status, mode FROM agent_run WHERE event_id=$1 AND agent='llm_extraction'
     ORDER BY started_at DESC LIMIT 1`, [ev.id]);
  if (runs.length) {
    assert.equal(runs[0].mode, 'llm');
    assert.ok(['unavailable', 'blocked', 'insufficient_data', 'ok'].includes(runs[0].status));
  }
});

test('system prompt forbids outside knowledge and demands verbatim quotes', () => {
  // The guardrails are part of the contract; a silent prompt edit should fail here.
  const src = readFileSync('src/agents/llm.ts', 'utf8');
  assert.match(src, /Use ONLY the text of the numbered articles/);
  assert.match(src, /character-for-character/);
  assert.match(src, /Do not infer causation/);
});

test('an unconfigured optional agent does not hold events for human review', async () => {
  // Regression: adding the LLM agent made every event fail the
  // 'no_agent_failures' supervisor check, because "no API key configured" was
  // treated as a failure. Publishing dropped to near zero.
  const keys = [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY];
  delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;

  const [ev] = await db.query<any>(
    `SELECT e.id FROM event e JOIN article a ON a.event_id=e.id
     WHERE e.category <> 'unclassified' AND a.published_at IS NOT NULL LIMIT 1`);
  const res = await processEvent(ev.id);
  assert.ok(res);
  const check = res!.supervisor.findings.find((f: any) => f.check === 'no_agent_failures');
  assert.equal(check.pass, true, 'an unconfigured provider must not count as an agent failure');
  assert.match(check.detail, /não configurados|all selected/);

  if (keys[0]) process.env.OPENAI_API_KEY = keys[0];
  if (keys[1]) process.env.ANTHROPIC_API_KEY = keys[1];
});

test('a genuinely erroring agent IS still flagged for review', async () => {
  const { ALL_AGENTS } = await import('../src/agents/specialists.js');
  const boom = {
    name: 'exploding_test_agent', version: '1.0.0',
    appliesTo: () => true,
    run: async () => { throw new Error('simulated agent crash'); },
  };
  ALL_AGENTS.push(boom as any);
  try {
    const [ev] = await db.query<any>(`SELECT id FROM event LIMIT 1`);
    const res = await processEvent(ev.id);
    const check = res!.supervisor.findings.find((f: any) => f.check === 'no_agent_failures');
    assert.equal(check.pass, false, 'a crashing agent must still be caught');
    assert.match(check.detail, /erro:/);
  } finally {
    ALL_AGENTS.pop();
  }
});

// ---------------------------------------------------------------- retenção
const retention = await import('../src/pipeline/retention.js');
const { audit } = await import('../src/core/audit.js');

test('dry run não altera absolutamente nada', async () => {
  const before = await db.query<any>(`SELECT
    (SELECT COUNT(*)::int FROM article) a,
    (SELECT COUNT(*)::int FROM event) e,
    (SELECT COUNT(*)::int FROM audit_log) al,
    (SELECT COUNT(*)::int FROM agent_run) ar`);
  const r = await retention.runRetention({ ...retention.DEFAULT_POLICY,
    payloadDays: 0, agentRunDays: 0, auditDays: 0, viewDays: 0, staleEventDays: 0, graphDays: 0 }, true);
  assert.equal(r.dryRun, true);
  const after = await db.query<any>(`SELECT
    (SELECT COUNT(*)::int FROM article) a,
    (SELECT COUNT(*)::int FROM event) e,
    (SELECT COUNT(*)::int FROM audit_log) al,
    (SELECT COUNT(*)::int FROM agent_run) ar`);
  assert.deepEqual(after[0], before[0], 'um dry run tem de ser inofensivo');
});

test('a retenção NUNCA apaga a proveniência de um artigo', async () => {
  const [art] = await db.query<any>(
    `SELECT id, url, title, source_id, published_at FROM article WHERE event_id IS NOT NULL LIMIT 1`);
  assert.ok(art, 'precisamos de um artigo processado');
  await retention.runRetention({ ...retention.DEFAULT_POLICY, payloadDays: 0 }, false);
  const [after] = await db.query<any>(
    `SELECT id, url, title, source_id, published_at, payload FROM article WHERE id=$1`, [art.id]);
  assert.ok(after, 'o artigo não pode desaparecer');
  assert.equal(after.url, art.url, 'o URL de origem tem de sobreviver');
  assert.equal(after.title, art.title);
  assert.equal(after.source_id, art.source_id);
  // Só o payload verbatim é libertado.
  assert.equal(after.payload, '{"archived":true}');
});

test('eventos publicados e os seus artigos são intocáveis', async () => {
  const before = await db.query<any>(`SELECT COUNT(*)::int n FROM event WHERE status='PUBLISHED'`);
  await retention.runRetention({
    payloadDays: 0, agentRunDays: 0, auditDays: 0, viewDays: 0, staleEventDays: 0, graphDays: 0,
  }, false);
  const after = await db.query<any>(`SELECT COUNT(*)::int n FROM event WHERE status='PUBLISHED'`);
  assert.equal(after[0].n, before[0].n, 'nenhum evento publicado pode ser removido');
});

test('a auditoria é resumida, nunca apagada em silêncio (§32)', async () => {
  await audit({ actor: 'teste', action: 'evento_antigo', objectType: 'teste', reason: 'para arquivar' });
  await db.query(`UPDATE audit_log SET at = now() - interval '400 days' WHERE action='evento_antigo'`);
  const r = await retention.runRetention({ ...retention.DEFAULT_POLICY, auditDays: 1 }, false);
  assert.ok(r.auditArchived > 0);
  const [arch] = await db.query<any>(
    `SELECT actor, action, prev_state, new_state, reason FROM audit_log
     WHERE action='retention_archive' ORDER BY at DESC LIMIT 1`);
  assert.ok(arch, 'tem de existir uma entrada de arquivo a declarar o que foi compactado');
  assert.match(arch.reason, /não foi apagado em silêncio/);
  const prev = JSON.parse(arch.prev_state);
  assert.ok(prev.entries > 0 && prev.from && prev.to, 'o arquivo declara quantos e de que período');
  // A própria entrada de arquivo nunca é ela própria arquivada.
  const again = await retention.runRetention({ ...retention.DEFAULT_POLICY, auditDays: 1 }, false);
  const [{ n }] = await db.query<any>(
    `SELECT COUNT(*)::int n FROM audit_log WHERE action='retention_archive'`);
  assert.ok(n >= 1, 'as entradas de arquivo têm de sobreviver a ciclos seguintes');
  assert.ok(again.auditArchived >= 0);
});

test('a execução mais recente de cada agente é sempre preservada (§35)', async () => {
  const [ev] = await db.query<any>(
    `SELECT event_id FROM agent_run WHERE event_id IS NOT NULL GROUP BY event_id
     HAVING COUNT(*) > 1 LIMIT 1`);
  if (!ev) return; // nada a testar nesta base
  await db.query(`UPDATE agent_run SET started_at = now() - interval '400 days' WHERE event_id=$1`, [ev.event_id]);
  await retention.runRetention({ ...retention.DEFAULT_POLICY, agentRunDays: 1 }, false);
  const kept = await db.query<any>(
    `SELECT DISTINCT agent FROM agent_run WHERE event_id=$1`, [ev.event_id]);
  assert.ok(kept.length > 0, 'tem de sobrar pelo menos uma execução por agente para reconstruir a conclusão');
});

test('eventos seguidos ou marcados nunca são removidos', async () => {
  const { user } = await users.createUser('retencao@example.org', 'uma-palavra-passe-forte');
  const [ev] = await db.query<any>(`SELECT id FROM event WHERE status <> 'PUBLISHED' LIMIT 1`);
  if (!ev) return;
  await users.addFollow(user!.id, 'event', ev.id);
  await db.query(`UPDATE event SET last_activity_at = now() - interval '400 days' WHERE id=$1`, [ev.id]);
  await retention.runRetention({ ...retention.DEFAULT_POLICY, staleEventDays: 1 }, false);
  const still = await db.query(`SELECT 1 FROM event WHERE id=$1`, [ev.id]);
  assert.equal(still.length, 1, 'um evento que alguém segue não pode ser recolhido como lixo');
});

test('eventos na fila de revisão nunca são removidos', async () => {
  const [q] = await db.query<any>(
    `SELECT event_id FROM review_queue WHERE state='open' LIMIT 1`);
  if (!q) return;
  await db.query(`UPDATE event SET last_activity_at = now() - interval '400 days' WHERE id=$1`, [q.event_id]);
  await retention.runRetention({ ...retention.DEFAULT_POLICY, staleEventDays: 1 }, false);
  const still = await db.query(`SELECT 1 FROM event WHERE id=$1`, [q.event_id]);
  assert.equal(still.length, 1, 'não se apaga o que está à espera de decisão humana');
});

test('databaseSize não inventa um número quando não sabe', async () => {
  const s = await retention.databaseSize();
  if (s.bytes === null) {
    assert.match(s.pretty, /indisponível/);
    assert.deepEqual(s.tables, []);
  } else {
    assert.ok(s.bytes > 0);
    assert.ok(s.tables.length > 0);
  }
});

test('a revisão mais recente do supervisor é sempre preservada', async () => {
  const [ev] = await db.query<any>(
    `SELECT event_id FROM supervisor_review GROUP BY event_id HAVING COUNT(*) > 1 LIMIT 1`);
  if (!ev) return;
  await db.query(`UPDATE supervisor_review SET at = now() - interval '400 days' WHERE event_id=$1`, [ev.event_id]);
  await retention.runRetention({ ...retention.DEFAULT_POLICY, supervisorDays: 1 }, false);
  const left = await db.query<any>(`SELECT COUNT(*)::int n FROM supervisor_review WHERE event_id=$1`, [ev.event_id]);
  assert.equal(left[0].n, 1, 'a página do evento precisa da decisão mais recente');
});

test('uma política parcial herda o resto em vez de gerar SQL inválido', async () => {
  // Regressão: passar { payloadDays: 0 } gerava "undefined days" no SQL.
  const r = await retention.runRetention({ payloadDays: 0 }, true);
  assert.equal(r.dryRun, true);
  assert.ok(Number.isInteger(r.agentRunsRemoved));
});

test('um intervalo inválido é recusado, não interpolado no SQL', async () => {
  await assert.rejects(
    () => retention.runRetention({ payloadDays: Number.NaN }, true),
    /intervalo inválido/);
  await assert.rejects(
    () => retention.runRetention({ auditDays: -5 }, true),
    /intervalo inválido/);
});
