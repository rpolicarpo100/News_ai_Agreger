/** Sections 36-38: headers, rate limiting, admin auth. */
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import { securityEvent } from '../core/audit.js';

export function secureHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' https://*.e2b.app");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

const buckets = new Map<string, { n: number; reset: number }>();

export function rateLimit(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.path.split('/').slice(0, 4).join('/')}|${clientIp(req)}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset < now) {
      buckets.set(key, { n: 1, reset: now + windowMs });
      next(); return;
    }
    b.n++;
    if (b.n > limit) {
      res.setHeader('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests.' });
      return;
    }
    next();
  };
}

export function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '0.0.0.0';
}

/** Admin auth via bearer token from env. No secret is ever shipped to the client. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'admin_disabled', message: 'ADMIN_TOKEN is not configured on this deployment.' });
    return;
  }
  const got = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(expected).digest();
  if (!got || !timingSafeEqual(a, b)) {
    void securityEvent('admin_auth_failed', 'high', { ip: clientIp(req), path: req.path });
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
