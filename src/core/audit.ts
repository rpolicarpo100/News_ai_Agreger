import { getDb } from '../db/index.js';

export interface AuditEntry {
  actor: string;
  action: string;
  objectType: string;
  objectId?: string | null;
  prevState?: unknown;
  newState?: unknown;
  reason: string;
}

/** Section 34 — every automatic or manual change is written here. Never deleted. */
export async function audit(e: AuditEntry): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO audit_log (actor, action, object_type, object_id, prev_state, new_state, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      e.actor,
      e.action,
      e.objectType,
      e.objectId ?? null,
      e.prevState === undefined ? null : JSON.stringify(e.prevState),
      e.newState === undefined ? null : JSON.stringify(e.newState),
      e.reason,
    ],
  );
}

export async function securityEvent(kind: string, severity: 'low' | 'medium' | 'high', detail: unknown): Promise<void> {
  const db = await getDb();
  await db.query(`INSERT INTO security_event (kind, severity, detail) VALUES ($1,$2,$3)`, [
    kind,
    severity,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
  ]);
}
