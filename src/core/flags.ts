import { getDb } from '../db/index.js';
import { audit } from './audit.js';

/** Section 41 — Emergency Control Center. All flags default to the safe value. */
export const FLAGS = {
  AUTO_PUBLISH: 'auto_publish',        // on|off
  AI_ANALYSIS: 'ai_analysis',          // on|off
  TRENDING_FROZEN: 'trending_frozen',  // yes|no
  RESTRICTED_MODE: 'restricted_mode',  // yes|no
  INGESTION: 'ingestion',              // on|off
} as const;

const DEFAULTS: Record<string, string> = {
  [FLAGS.AUTO_PUBLISH]: 'on',
  [FLAGS.AI_ANALYSIS]: 'on',
  [FLAGS.TRENDING_FROZEN]: 'no',
  [FLAGS.RESTRICTED_MODE]: 'no',
  [FLAGS.INGESTION]: 'on',
};

export async function getFlag(key: string): Promise<string> {
  const db = await getDb();
  const r = await db.query<{ value: string }>(`SELECT value FROM system_flag WHERE key=$1`, [key]);
  return r[0]?.value ?? DEFAULTS[key] ?? 'off';
}

export async function allFlags(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM system_flag`);
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setFlag(key: string, value: string, actor: string, reason: string): Promise<void> {
  const db = await getDb();
  const prev = await getFlag(key);
  await db.query(
    `INSERT INTO system_flag (key, value, updated_by) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()`,
    [key, value, actor],
  );
  await audit({ actor, action: 'set_flag', objectType: 'system_flag', objectId: key, prevState: prev, newState: value, reason });
}
