/**
 * Accounts — §56 (Personal Intelligence), §71 (GDPR).
 *
 * Data minimisation is the design constraint: an account is an email, a scrypt
 * password hash, and a list of things the user follows. No name, no profile, no
 * behavioural tracking, no third-party identifiers.
 *
 * Passwords use Node's built-in scrypt (memory-hard). Sessions are opaque random
 * tokens; only their SHA-256 is stored, so a database leak does not yield usable
 * session cookies.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getDb } from '../db/index.js';
import { audit } from './audit.js';

const scrypt = promisify(_scrypt) as (pw: string | Buffer, salt: string | Buffer, len: number, opts: any) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_DAYS = Number(process.env.USER_SESSION_DAYS ?? 30);
export const MIN_PASSWORD = 10;

export interface User { id: string; email: string; created_at: string; last_login_at: string | null }

// ---------------------------------------------------------------- validation
export function validateEmail(email: string): string | null {
  const e = email.trim();
  if (e.length < 5 || e.length > 254) return 'Email inválido.';
  // Deliberately simple: the only authority on deliverability is delivery itself.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e)) return 'Email inválido.';
  return null;
}

export function validatePassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `A palavra-passe deve ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (pw.length > 512) return 'Palavra-passe demasiado longa.';
  // Rejecting only trivially weak inputs; length is the dominant factor.
  if (/^(.)\1+$/.test(pw)) return 'Palavra-passe demasiado simples.';
  return null;
}

// ---------------------------------------------------------------- passwords
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(pw, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------- accounts
export async function createUser(email: string, password: string): Promise<{ user?: User; error?: string }> {
  const emailErr = validateEmail(email);
  if (emailErr) return { error: emailErr };
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };

  const db = await getDb();
  const lower = email.trim().toLowerCase();
  const exists = await db.query(`SELECT 1 FROM app_user WHERE email_lower=$1`, [lower]);
  if (exists.length) return { error: 'Já existe uma conta com este email.' };

  const id = `USR-${randomBytes(9).toString('base64url')}`;
  const hash = await hashPassword(password);
  await db.query(
    `INSERT INTO app_user (id, email, email_lower, password_hash) VALUES ($1,$2,$3,$4)`,
    [id, email.trim(), lower, hash]);
  // Audit records the account id, never the email or password.
  await audit({ actor: id, action: 'user_register', objectType: 'app_user', objectId: id, reason: 'self-service registration' });
  const [u] = await db.query<User>(`SELECT id, email, created_at, last_login_at FROM app_user WHERE id=$1`, [id]);
  return { user: u };
}

export async function authenticate(email: string, password: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db.query<any>(
    `SELECT id, email, password_hash, disabled, created_at, last_login_at FROM app_user WHERE email_lower=$1`,
    [email.trim().toLowerCase()]);
  if (!rows.length) {
    // Constant-ish work even when the user does not exist, to avoid disclosing
    // account existence through response timing.
    await hashPassword(password);
    return null;
  }
  const u = rows[0];
  if (u.disabled) return null;
  if (!(await verifyPassword(password, u.password_hash))) return null;
  await db.query(`UPDATE app_user SET last_login_at=now() WHERE id=$1`, [u.id]);
  return { id: u.id, email: u.email, created_at: u.created_at, last_login_at: u.last_login_at };
}

// ---------------------------------------------------------------- sessions
export interface NewSession { cookie: string; csrf: string }

export async function createSession(userId: string): Promise<NewSession> {
  const db = await getDb();
  const id = randomBytes(12).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('hex');
  const tokenHash = createHash('sha256').update(secret).digest('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString();
  await db.query(
    `INSERT INTO user_session (id, user_id, token_hash, csrf, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [id, userId, tokenHash, csrf, expires]);
  return { cookie: `${id}.${secret}`, csrf };
}

export async function resolveSession(cookie: string | undefined): Promise<{ user: User; csrf: string } | null> {
  if (!cookie) return null;
  const [id, secret] = cookie.split('.');
  if (!id || !secret) return null;
  const db = await getDb();
  const rows = await db.query<any>(
    `SELECT s.token_hash, s.csrf, s.expires_at, s.revoked, u.id, u.email, u.created_at, u.last_login_at, u.disabled
     FROM user_session s JOIN app_user u ON u.id = s.user_id WHERE s.id=$1`, [id]);
  if (!rows.length) return null;
  const s = rows[0];
  if (s.revoked || s.disabled || new Date(s.expires_at).getTime() < Date.now()) return null;
  const given = createHash('sha256').update(secret).digest();
  const stored = Buffer.from(s.token_hash, 'hex');
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
  return {
    user: { id: s.id, email: s.email, created_at: s.created_at, last_login_at: s.last_login_at },
    csrf: s.csrf,
  };
}

export async function revokeSession(cookie: string | undefined): Promise<void> {
  if (!cookie) return;
  const [id] = cookie.split('.');
  if (!id) return;
  const db = await getDb();
  await db.query(`UPDATE user_session SET revoked=TRUE WHERE id=$1`, [id]);
}

// ---------------------------------------------------------------- follows
export const FOLLOW_KINDS = ['country', 'category', 'event'] as const;
export type FollowKind = (typeof FOLLOW_KINDS)[number];

export async function addFollow(userId: string, kind: FollowKind, value: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO follow (user_id, kind, value) VALUES ($1,$2,$3) ON CONFLICT (user_id, kind, value) DO NOTHING`,
    [userId, kind, value]);
}

export async function removeFollow(userId: string, kind: FollowKind, value: string): Promise<void> {
  const db = await getDb();
  await db.query(`DELETE FROM follow WHERE user_id=$1 AND kind=$2 AND value=$3`, [userId, kind, value]);
}

export async function listFollows(userId: string): Promise<Array<{ kind: string; value: string }>> {
  const db = await getDb();
  return db.query(`SELECT kind, value FROM follow WHERE user_id=$1 ORDER BY kind, value`, [userId]);
}

export async function toggleBookmark(userId: string, eventId: string): Promise<boolean> {
  const db = await getDb();
  const existing = await db.query(`SELECT 1 FROM bookmark WHERE user_id=$1 AND event_id=$2`, [userId, eventId]);
  if (existing.length) {
    await db.query(`DELETE FROM bookmark WHERE user_id=$1 AND event_id=$2`, [userId, eventId]);
    return false;
  }
  await db.query(`INSERT INTO bookmark (user_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId, eventId]);
  return true;
}

/**
 * §71: a user must be able to take their data and to erase it. Deletion cascades
 * to sessions, follows and bookmarks. The audit log keeps the account id only —
 * an opaque identifier with no personal data attached to it.
 */
export async function exportUserData(userId: string): Promise<object> {
  const db = await getDb();
  const [user] = await db.query(`SELECT id, email, created_at, last_login_at FROM app_user WHERE id=$1`, [userId]);
  const follows = await db.query(`SELECT kind, value, created_at FROM follow WHERE user_id=$1`, [userId]);
  const bookmarks = await db.query(`SELECT event_id, created_at FROM bookmark WHERE user_id=$1`, [userId]);
  const sessions = await db.query(
    `SELECT created_at, expires_at, revoked FROM user_session WHERE user_id=$1`, [userId]);
  return {
    exported_at: new Date().toISOString(),
    note: 'Estes são todos os dados pessoais associados à sua conta. Não recolhemos nome, telefone, localização nem histórico de navegação.',
    user, follows, bookmarks, sessions,
  };
}

export async function deleteUser(userId: string): Promise<void> {
  const db = await getDb();
  await db.query(`DELETE FROM app_user WHERE id=$1`, [userId]);
  await audit({ actor: userId, action: 'user_delete', objectType: 'app_user', objectId: userId,
    reason: 'self-service account deletion (GDPR erasure)' });
}
