/**
 * Admin browser sessions (§37 secure by default, §38 API security).
 *
 * The bearer ADMIN_TOKEN stays server-side. A browser login exchanges it for an
 * httpOnly cookie holding a signed, expiring session value. Nothing sensitive is
 * ever readable from frontend JavaScript.
 *
 *   cookie = base64(expiryMs) . hmac_sha256(ADMIN_TOKEN, "session|expiryMs")
 *
 * Because the HMAC key IS the admin token, rotating the token invalidates every
 * live session — which is the behaviour you want from a credential rotation.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { securityEvent } from '../core/audit.js';
import { clientIp } from './security.js';

export const SESSION_COOKIE = 'gni_admin';
export const CSRF_COOKIE = 'gni_csrf';
const SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS ?? 8);

function sign(payload: string): string | null {
  const key = process.env.ADMIN_TOKEN;
  if (!key) return null;
  return createHmac('sha256', key).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

export function issueSession(res: Response): void {
  const expiry = Date.now() + SESSION_HOURS * 3600e3;
  const sig = sign(`session|${expiry}`);
  if (!sig) return;
  const value = `${Buffer.from(String(expiry)).toString('base64url')}.${sig}`;
  const csrf = randomBytes(24).toString('hex');
  res.append('Set-Cookie', `${SESSION_COOKIE}=${value}; ${cookieAttrs(SESSION_HOURS * 3600)}`);
  // CSRF cookie is readable by the page only via the server-rendered form field;
  // it is compared against the submitted field (double-submit pattern).
  res.append('Set-Cookie', `${CSRF_COOKIE}=${csrf}; ${cookieAttrs(SESSION_HOURS * 3600)}`);
}

export function clearSession(res: Response): void {
  const expired = 'Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${expired}`);
  res.append('Set-Cookie', `${CSRF_COOKIE}=; ${expired}`);
}

export function sessionValid(req: Request): boolean {
  if (!process.env.ADMIN_TOKEN) return false;
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return false;
  const [b64, sig] = raw.split('.');
  if (!b64 || !sig) return false;
  let expiry: number;
  try { expiry = Number(Buffer.from(b64, 'base64url').toString()); } catch { return false; }
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = sign(`session|${expiry}`);
  return !!expected && safeEqual(sig, expected);
}

export function csrfToken(req: Request): string {
  return parseCookies(req)[CSRF_COOKIE] ?? '';
}

/** Gate for admin HTML pages: redirects to the login form instead of 401 JSON. */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.ADMIN_TOKEN) {
    res.status(503).type('html').send(adminDisabledPage());
    return;
  }
  if (!sessionValid(req)) {
    res.redirect(302, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  next();
}

/** Double-submit CSRF check for state-changing admin forms. */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const cookie = csrfToken(req);
  const submitted = String((req.body ?? {})._csrf ?? '');
  if (!cookie || !submitted || !safeEqual(cookie, submitted)) {
    void securityEvent('admin_csrf_failed', 'high', { ip: clientIp(req), path: req.path });
    res.status(403).type('html').send('<p>CSRF validation failed. Recarregue a página e tente novamente.</p>');
    return;
  }
  next();
}

export function verifyAdminToken(candidate: string): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !candidate) return false;
  return safeEqual(
    createHmac('sha256', 'cmp').update(candidate).digest('hex'),
    createHmac('sha256', 'cmp').update(expected).digest('hex'),
  );
}

function adminDisabledPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Admin desactivado</title>
  <body style="font-family:system-ui;background:#07090d;color:#e8edf5;padding:40px">
  <h1>Admin desactivado</h1>
  <p><code>ADMIN_TOKEN</code> não está configurado nesta instalação, por isso toda a área de administração está fechada.</p>
  <p style="color:#8b96a8">Isto é intencional: secure by default. Defina a variável de ambiente e reinicie o serviço.</p>
  </body>`;
}
