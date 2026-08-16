/**
 * Section 3 — TEST DATA DETECTED IN PRODUCTION → DEPLOYMENT BLOCKED.
 *
 * Two layers:
 *  1. build/CI time: scripts/check-no-test-data.ts scans the source tree;
 *  2. runtime: this guard refuses to serve a production process whose database
 *     contains rows flagged as test data or synthetic-looking sources.
 */
import { getDb } from '../db/index.js';
import { securityEvent } from './audit.js';

/**
 * Matched against the HOST portion only. Matching the whole URL produced false
 * positives on legitimate reporting (e.g. a Guardian story about "deepfake"
 * scams). Real journalism must never be mistaken for synthetic data.
 */
const SUSPECT_HOSTS = /^(.*\.)?(example\.(com|org|net)|localhost|test\.invalid|.*\.test|fake.*|lorem.*|dummy.*|placeholder.*)$/i;

function host(u: string): string {
  try { return new URL(u).hostname; } catch { return u; }
}

export interface TestDataFinding { kind: string; count: number; sample: string[] }

export async function findTestData(): Promise<TestDataFinding[]> {
  const db = await getDb();
  const out: TestDataFinding[] = [];

  const flagged = await db.query<{ id: string }>(`SELECT id FROM article WHERE is_test_data LIMIT 5`);
  const flaggedN = await db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM article WHERE is_test_data`);
  if (Number(flaggedN[0].n) > 0) out.push({ kind: 'article.is_test_data', count: Number(flaggedN[0].n), sample: flagged.map((r) => r.id) });

  const evN = await db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM event WHERE is_test_data`);
  if (Number(evN[0].n) > 0) out.push({ kind: 'event.is_test_data', count: Number(evN[0].n), sample: [] });

  const urls = await db.query<{ url: string }>(`SELECT url FROM article LIMIT 2000`);
  const bad = urls.filter((u) => SUSPECT_HOSTS.test(host(u.url)));
  if (bad.length) out.push({ kind: 'article.suspect_url', count: bad.length, sample: bad.slice(0, 5).map((b) => b.url) });

  const srcs = await db.query<{ id: string; feed_url: string }>(`SELECT id, feed_url FROM source`);
  const badSrc = srcs.filter((s) => SUSPECT_HOSTS.test(host(s.feed_url)));
  if (badSrc.length) out.push({ kind: 'source.suspect_feed', count: badSrc.length, sample: badSrc.slice(0, 5).map((s) => s.id) });

  return out;
}

export async function guardAgainstTestData(): Promise<void> {
  const findings = await findTestData();
  if (!findings.length) return;
  const detail = findings.map((f) => `${f.kind}=${f.count}${f.sample.length ? ` (${f.sample.join(', ')})` : ''}`).join('; ');
  await securityEvent('test_data_in_database', 'high', detail);
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_DATA !== 'true') {
    console.error(`\nTEST DATA DETECTED IN PRODUCTION\n        ↓\nDEPLOYMENT BLOCKED\n\n${detail}\n`);
    process.exit(1);
  }
  console.warn(`[testguard] non-production: test data present -> ${detail}`);
}
