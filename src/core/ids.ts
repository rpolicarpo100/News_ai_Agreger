import { createHash } from 'node:crypto';

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function articleId(url: string): string {
  return `ART-${sha1(url).slice(0, 16)}`;
}

/** Permanent event id: EVT-YYYY-MM-DD-XXXXXXXX. Title may change, id never does. */
export function eventId(seedKey: string, when: Date): string {
  const d = when.toISOString().slice(0, 10);
  return `EVT-${d}-${sha1(seedKey).slice(0, 8).toUpperCase()}`;
}

export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'event';
}

/** Normalized text used for duplicate detection. */
export function contentHash(title: string, summary?: string | null): string {
  const norm = (t: string) =>
    t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return sha1(`${norm(title)}|${norm(summary ?? '').slice(0, 400)}`);
}
