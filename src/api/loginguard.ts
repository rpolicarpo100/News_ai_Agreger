/**
 * Brute-force protection for the admin login (§36, §78 permission escalation).
 * Progressive lockout per client IP, recorded as security events.
 */
import { securityEvent } from '../core/audit.js';

const MAX_ATTEMPTS = Number(process.env.ADMIN_MAX_ATTEMPTS ?? 5);
const LOCKOUT_MS = Number(process.env.ADMIN_LOCKOUT_MS ?? 15 * 60_000);

interface Entry { fails: number; lockedUntil: number }
const attempts = new Map<string, Entry>();

export function isLocked(ip: string): { locked: boolean; secondsLeft: number } {
  const e = attempts.get(ip);
  if (!e || e.lockedUntil < Date.now()) return { locked: false, secondsLeft: 0 };
  return { locked: true, secondsLeft: Math.ceil((e.lockedUntil - Date.now()) / 1000) };
}

export async function recordFailure(ip: string): Promise<void> {
  const e = attempts.get(ip) ?? { fails: 0, lockedUntil: 0 };
  e.fails++;
  if (e.fails >= MAX_ATTEMPTS) {
    e.lockedUntil = Date.now() + LOCKOUT_MS;
    e.fails = 0;
    await securityEvent('admin_login_lockout', 'high', { ip, lockoutMs: LOCKOUT_MS });
  } else {
    await securityEvent('admin_login_failed', 'medium', { ip, consecutiveFails: e.fails });
  }
  attempts.set(ip, e);
}

export function recordSuccess(ip: string): void {
  attempts.delete(ip);
}

/** Exposed for tests. */
export function _reset(): void { attempts.clear(); }
