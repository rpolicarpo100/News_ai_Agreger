/**
 * Geo agent — Section 16.
 *
 * Gazetteer-based, deliberately small and honest. If a place is only inferred
 * from a country name, precision is 'approximate' and NO coordinates are
 * emitted at city level. False precision is forbidden.
 */
export interface GeoResult {
  country: string | null;
  place: string | null;
  lat: number | null;
  lon: number | null;
  precision: 'exact' | 'approximate' | 'unknown';
  basis: string;
}

interface Entry { name: string; country: string; lat: number; lon: number; kind: 'country' | 'city' }

// Country centroids (approximate by definition) + a few high-traffic cities.
const GAZETTEER: Entry[] = [
  { name: 'portugal', country: 'PT', lat: 39.5, lon: -8.0, kind: 'country' },
  { name: 'lisbon', country: 'PT', lat: 38.7223, lon: -9.1393, kind: 'city' },
  { name: 'lisboa', country: 'PT', lat: 38.7223, lon: -9.1393, kind: 'city' },
  { name: 'porto', country: 'PT', lat: 41.1579, lon: -8.6291, kind: 'city' },
  { name: 'spain', country: 'ES', lat: 40.0, lon: -4.0, kind: 'country' },
  { name: 'espanha', country: 'ES', lat: 40.0, lon: -4.0, kind: 'country' },
  { name: 'madrid', country: 'ES', lat: 40.4168, lon: -3.7038, kind: 'city' },
  { name: 'france', country: 'FR', lat: 46.6, lon: 2.2, kind: 'country' },
  { name: 'frança', country: 'FR', lat: 46.6, lon: 2.2, kind: 'country' },
  { name: 'paris', country: 'FR', lat: 48.8566, lon: 2.3522, kind: 'city' },
  { name: 'germany', country: 'DE', lat: 51.1, lon: 10.4, kind: 'country' },
  { name: 'alemanha', country: 'DE', lat: 51.1, lon: 10.4, kind: 'country' },
  { name: 'berlin', country: 'DE', lat: 52.52, lon: 13.405, kind: 'city' },
  { name: 'italy', country: 'IT', lat: 42.5, lon: 12.5, kind: 'country' },
  { name: 'itália', country: 'IT', lat: 42.5, lon: 12.5, kind: 'country' },
  { name: 'rome', country: 'IT', lat: 41.9028, lon: 12.4964, kind: 'city' },
  { name: 'united kingdom', country: 'GB', lat: 54.0, lon: -2.0, kind: 'country' },
  { name: 'reino unido', country: 'GB', lat: 54.0, lon: -2.0, kind: 'country' },
  { name: 'london', country: 'GB', lat: 51.5074, lon: -0.1278, kind: 'city' },
  { name: 'ireland', country: 'IE', lat: 53.4, lon: -8.0, kind: 'country' },
  { name: 'netherlands', country: 'NL', lat: 52.2, lon: 5.3, kind: 'country' },
  { name: 'belgium', country: 'BE', lat: 50.6, lon: 4.6, kind: 'country' },
  { name: 'brussels', country: 'BE', lat: 50.8503, lon: 4.3517, kind: 'city' },
  { name: 'poland', country: 'PL', lat: 52.1, lon: 19.4, kind: 'country' },
  { name: 'ukraine', country: 'UA', lat: 48.4, lon: 31.2, kind: 'country' },
  { name: 'ucrânia', country: 'UA', lat: 48.4, lon: 31.2, kind: 'country' },
  { name: 'kyiv', country: 'UA', lat: 50.4501, lon: 30.5234, kind: 'city' },
  { name: 'russia', country: 'RU', lat: 61.5, lon: 105.3, kind: 'country' },
  { name: 'rússia', country: 'RU', lat: 61.5, lon: 105.3, kind: 'country' },
  { name: 'moscow', country: 'RU', lat: 55.7558, lon: 37.6173, kind: 'city' },
  { name: 'united states', country: 'US', lat: 39.8, lon: -98.6, kind: 'country' },
  { name: 'estados unidos', country: 'US', lat: 39.8, lon: -98.6, kind: 'country' },
  { name: 'washington', country: 'US', lat: 38.9072, lon: -77.0369, kind: 'city' },
  { name: 'new york', country: 'US', lat: 40.7128, lon: -74.006, kind: 'city' },
  { name: 'california', country: 'US', lat: 36.8, lon: -119.4, kind: 'country' },
  { name: 'canada', country: 'CA', lat: 56.1, lon: -106.3, kind: 'country' },
  { name: 'mexico', country: 'MX', lat: 23.6, lon: -102.5, kind: 'country' },
  { name: 'brazil', country: 'BR', lat: -14.2, lon: -51.9, kind: 'country' },
  { name: 'brasil', country: 'BR', lat: -14.2, lon: -51.9, kind: 'country' },
  { name: 'argentina', country: 'AR', lat: -38.4, lon: -63.6, kind: 'country' },
  { name: 'chile', country: 'CL', lat: -35.7, lon: -71.5, kind: 'country' },
  { name: 'china', country: 'CN', lat: 35.9, lon: 104.2, kind: 'country' },
  { name: 'beijing', country: 'CN', lat: 39.9042, lon: 116.4074, kind: 'city' },
  { name: 'japan', country: 'JP', lat: 36.2, lon: 138.3, kind: 'country' },
  { name: 'japão', country: 'JP', lat: 36.2, lon: 138.3, kind: 'country' },
  { name: 'tokyo', country: 'JP', lat: 35.6762, lon: 139.6503, kind: 'city' },
  { name: 'india', country: 'IN', lat: 20.6, lon: 78.9, kind: 'country' },
  { name: 'índia', country: 'IN', lat: 20.6, lon: 78.9, kind: 'country' },
  { name: 'indonesia', country: 'ID', lat: -0.8, lon: 113.9, kind: 'country' },
  { name: 'philippines', country: 'PH', lat: 12.9, lon: 121.8, kind: 'country' },
  { name: 'south korea', country: 'KR', lat: 35.9, lon: 127.8, kind: 'country' },
  { name: 'taiwan', country: 'TW', lat: 23.7, lon: 121.0, kind: 'country' },
  { name: 'australia', country: 'AU', lat: -25.3, lon: 133.8, kind: 'country' },
  { name: 'new zealand', country: 'NZ', lat: -40.9, lon: 174.9, kind: 'country' },
  { name: 'israel', country: 'IL', lat: 31.0, lon: 34.9, kind: 'country' },
  { name: 'gaza', country: 'PS', lat: 31.5, lon: 34.47, kind: 'city' },
  { name: 'iran', country: 'IR', lat: 32.4, lon: 53.7, kind: 'country' },
  { name: 'irão', country: 'IR', lat: 32.4, lon: 53.7, kind: 'country' },
  { name: 'iraq', country: 'IQ', lat: 33.2, lon: 43.7, kind: 'country' },
  { name: 'syria', country: 'SY', lat: 34.8, lon: 39.0, kind: 'country' },
  { name: 'lebanon', country: 'LB', lat: 33.9, lon: 35.9, kind: 'country' },
  { name: 'turkey', country: 'TR', lat: 39.0, lon: 35.2, kind: 'country' },
  { name: 'turquia', country: 'TR', lat: 39.0, lon: 35.2, kind: 'country' },
  { name: 'saudi arabia', country: 'SA', lat: 23.9, lon: 45.1, kind: 'country' },
  { name: 'egypt', country: 'EG', lat: 26.8, lon: 30.8, kind: 'country' },
  { name: 'nigeria', country: 'NG', lat: 9.1, lon: 8.7, kind: 'country' },
  { name: 'south africa', country: 'ZA', lat: -30.6, lon: 22.9, kind: 'country' },
  { name: 'kenya', country: 'KE', lat: -0.02, lon: 37.9, kind: 'country' },
  { name: 'ethiopia', country: 'ET', lat: 9.1, lon: 40.5, kind: 'country' },
  { name: 'sudan', country: 'SD', lat: 12.9, lon: 30.2, kind: 'country' },
  { name: 'morocco', country: 'MA', lat: 31.8, lon: -7.1, kind: 'country' },
  { name: 'greece', country: 'GR', lat: 39.1, lon: 21.8, kind: 'country' },
  { name: 'sweden', country: 'SE', lat: 60.1, lon: 18.6, kind: 'country' },
  { name: 'norway', country: 'NO', lat: 60.5, lon: 8.5, kind: 'country' },
  { name: 'switzerland', country: 'CH', lat: 46.8, lon: 8.2, kind: 'country' },
  { name: 'austria', country: 'AT', lat: 47.5, lon: 14.6, kind: 'country' },
];

export function geocodeFromText(text: string, sourceCountry: string | null): GeoResult {
  const hay = ` ${text.toLowerCase().normalize('NFC')} `;
  let best: Entry | null = null;
  for (const e of GAZETTEER) {
    const re = new RegExp(`(^|[^a-zà-ÿ])${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zà-ÿ]|$)`, 'i');
    if (re.test(hay)) {
      if (!best || (best.kind === 'country' && e.kind === 'city')) best = e;
    }
  }
  if (best) {
    return {
      country: best.country,
      place: best.name.replace(/\b\w/g, (c) => c.toUpperCase()),
      lat: best.lat,
      lon: best.lon,
      precision: best.kind === 'city' ? 'approximate' : 'approximate',
      basis: `gazetteer match on "${best.name}" (${best.kind} centroid) — APPROXIMATE LOCATION, not a reported coordinate`,
    };
  }
  if (sourceCountry && sourceCountry.length === 2) {
    return {
      country: sourceCountry, place: null, lat: null, lon: null, precision: 'unknown',
      basis: `no place named in text; country inferred from source registration (${sourceCountry}) — no coordinates emitted`,
    };
  }
  return { country: null, place: null, lat: null, lon: null, precision: 'unknown', basis: 'no location information available' };
}
