/**
 * Minimal, dependency-free RSS 2.0 / Atom parser.
 *
 * It extracts only what the feed actually contains. Missing fields stay null —
 * they are never guessed or filled in.
 */
export interface FeedItem {
  title: string;
  link: string;
  summary: string | null;
  publishedAt: string | null; // ISO
  /** Only present when the feed itself carries georss/geo coordinates. */
  lat: number | null;
  lon: number | null;
  /** Only present when the feed carries structured numeric fields. */
  measurements: Record<string, unknown> | null;
  countryName: string | null;
  raw: string;
}

/** CDATA must be unwrapped BEFORE tag stripping, otherwise `<![CDATA[...]]>`
 *  is itself eaten by the tag regex and the whole field is lost. */
function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeEntities(s: string): string {
  return unwrapCdata(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function stripTags(s: string): string {
  return decodeEntities(unwrapCdata(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return m[1];
  }
  return null;
}

function atomLink(block: string): string | null {
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (any) return decodeEntities(any[1]);
  return null;
}

function parseDate(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(stripTags(s));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  // Reject implausible timestamps rather than silently accepting them.
  const year = d.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  return d.toISOString();
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const rawTitle = tag(b, ['title']);
    if (!rawTitle) continue;
    const title = stripTags(rawTitle);
    if (!title) continue;

    const rawLink = tag(b, ['link']);
    const unwrapped = rawLink ? unwrapCdata(rawLink).trim() : null;
    let link = unwrapped && /^https?:\/\//i.test(unwrapped) ? decodeEntities(unwrapped) : atomLink(b);
    if (!link) link = tag(b, ['guid']) ? stripTags(tag(b, ['guid'])!) : null;
    if (!link || !/^https?:\/\//i.test(link)) continue; // no URL => no provenance => drop

    const desc = tag(b, ['description', 'summary', 'content:encoded', 'content']);
    const summary = desc ? stripTags(desc).slice(0, 1200) || null : null;
    const publishedAt = parseDate(tag(b, ['pubDate', 'published', 'updated', 'dc:date']));

    const geo = extractGeo(b);
    out.push({
      title, link, summary, publishedAt,
      lat: geo.lat, lon: geo.lon,
      measurements: extractMeasurements(b),
      countryName: geo.country,
      raw: b.length > 8000 ? b.slice(0, 8000) : b,
    });
  }
  return out;
}


/**
 * Coordinates published by the feed itself (georss / W3C geo). These are real
 * reported positions, so they are treated as 'exact' — unlike gazetteer guesses.
 */
function extractGeo(block: string): { lat: number | null; lon: number | null; country: string | null } {
  let lat: number | null = null, lon: number | null = null;
  const pt = block.match(/<(?:georss:)?point>\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*<\/(?:georss:)?point>/i);
  if (pt) { lat = Number(pt[1]); lon = Number(pt[2]); }
  if (lat === null) {
    const la = block.match(/<geo:lat>\s*(-?\d+(?:\.\d+)?)\s*<\/geo:lat>/i);
    const lo = block.match(/<geo:long>\s*(-?\d+(?:\.\d+)?)\s*<\/geo:long>/i);
    if (la && lo) { lat = Number(la[1]); lon = Number(lo[1]); }
  }
  if (lat !== null && (Math.abs(lat) > 90 || Math.abs(lon!) > 180)) { lat = null; lon = null; }
  const c = block.match(/<gdacs:country>([^<]*)<\/gdacs:country>/i);
  const country = c && c[1].trim() ? c[1].trim().split(',')[0].trim() : null;
  return { lat, lon, country };
}

/** Structured numbers the feed publishes as attributes. Nothing is derived. */
function extractMeasurements(block: string): Record<string, unknown> | null {
  const m: Record<string, unknown> = {};
  const sev = block.match(/<gdacs:severity[^>]*unit="([^"]*)"[^>]*value="([^"]*)"/i);
  if (sev) { m.severity_value = Number(sev[2]); m.severity_unit = sev[1]; }
  const pop = block.match(/<gdacs:population[^>]*unit="([^"]*)"[^>]*value="([^"]*)"/i);
  if (pop) { m.population_affected = Number(pop[2]); m.population_unit = pop[1]; }
  const alert = block.match(/<gdacs:alertlevel>([^<]*)<\/gdacs:alertlevel>/i);
  if (alert && alert[1].trim()) m.alert_level = alert[1].trim();
  const etype = block.match(/<gdacs:eventtype>([^<]*)<\/gdacs:eventtype>/i);
  if (etype && etype[1].trim()) m.event_type = etype[1].trim();
  const eid = block.match(/<gdacs:eventid>([^<]*)<\/gdacs:eventid>/i);
  if (eid && eid[1].trim()) m.provider_event_id = eid[1].trim();
  const depth = block.match(/Depth:\s*(\d+(?:\.\d+)?)\s*km/i);
  if (depth) m.depth_km = Number(depth[1]);
  const mag = block.match(/Magnitude\s*(\d+(?:\.\d+)?)\s*M/i);
  if (mag) m.magnitude = Number(mag[1]);
  return Object.keys(m).length ? m : null;
}
