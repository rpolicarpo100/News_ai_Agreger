/**
 * View system (Section 28) + Anti-manipulation engine (Section 27).
 *
 * Privacy: the raw IP is never stored. Sessions are identified by a salted
 * SHA-256 of (ip + user-agent + daily rotation), which cannot be reversed into
 * an address and rotates every 24h (GDPR data minimisation, Section 71).
 */
import { getDb } from '../db/index.js';
import { sha256 } from '../core/ids.js';
import { securityEvent } from '../core/audit.js';

const SALT = process.env.VIEW_SALT ?? 'dev-only-salt-change-in-production';
const DEDUPE_MINUTES = Number(process.env.VIEW_DEDUPE_MIN ?? 30);
const MAX_VIEWS_PER_SESSION_HOUR = Number(process.env.VIEW_RATE_HOUR ?? 60);

export function sessionHash(ip: string, ua: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return sha256(`${SALT}|${day}|${ip}|${ua}`).slice(0, 32);
}

const BOT_UA = /(bot|crawl|spider|slurp|curl|wget|python-requests|headless|phantom|scrapy|http-client)/i;

export interface ViewOutcome { counted: boolean; reason?: string }

export async function recordView(eventId: string, ip: string, ua: string): Promise<ViewOutcome> {
  const db = await getDb();
  const sh = sessionHash(ip, ua);

  const reject = async (reason: string): Promise<ViewOutcome> => {
    await db.query(`INSERT INTO event_view (event_id, session_hash, counted, reject_reason) VALUES ($1,$2,FALSE,$3)`,
      [eventId, sh, reason]);
    return { counted: false, reason };
  };

  if (BOT_UA.test(ua) || !ua) return reject('bot_pattern');

  const recent = await db.query(
    `SELECT 1 FROM event_view WHERE event_id=$1 AND session_hash=$2 AND at > now() - ($3 || ' minutes')::interval LIMIT 1`,
    [eventId, sh, String(DEDUPE_MINUTES)]);
  if (recent.length) return reject('dedupe_window');

  const hourly = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM event_view WHERE session_hash=$1 AND at > now() - interval '1 hour'`, [sh]);
  if (Number(hourly[0]?.n ?? 0) >= MAX_VIEWS_PER_SESSION_HOUR) {
    await securityEvent('view_rate_limit', 'medium', { session: sh, eventId });
    return reject('rate_limit');
  }

  await db.query(`INSERT INTO event_view (event_id, session_hash, counted) VALUES ($1,$2,TRUE)`, [eventId, sh]);
  return { counted: true };
}

export async function viewCounts(eventId: string): Promise<{ total: number; h24: number }> {
  const db = await getDb();
  const r = await db.query<{ total: string; h24: string }>(
    `SELECT COUNT(*) FILTER (WHERE counted) AS total,
            COUNT(*) FILTER (WHERE counted AND at > now() - interval '24 hours') AS h24
     FROM event_view WHERE event_id=$1`, [eventId]);
  return { total: Number(r[0]?.total ?? 0), h24: Number(r[0]?.h24 ?? 0) };
}
