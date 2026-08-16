/** Data Freshness Engine — Section 25. Validity depends on the category. */
export type Freshness = 'FRESH' | 'RECENT' | 'AGING' | 'STALE' | 'EXPIRED';

const HOURS: Record<string, [number, number, number, number]> = {
  //            FRESH<, RECENT<, AGING<, STALE<   (beyond => EXPIRED)
  natural_events: [1, 6, 24, 72],
  war_conflict: [2, 8, 24, 96],
  finance: [1, 4, 12, 48],
  crypto: [1, 4, 12, 48],
  economy: [6, 24, 72, 240],
  politics: [6, 24, 96, 336],
  health: [6, 24, 96, 336],
  transport: [3, 12, 48, 168],
  energy: [6, 24, 96, 336],
  technology: [12, 48, 168, 720],
  ai: [12, 48, 168, 720],
  science: [24, 96, 336, 1440],
  space: [24, 96, 336, 1440],
  default: [6, 24, 96, 336],
};

export function freshness(category: string, lastActivityIso: string): { state: Freshness; ageHours: number; thresholdsH: number[] } {
  const t = HOURS[category] ?? HOURS.default;
  // Some feeds publish timestamps slightly in the future (timezone/clock drift).
  // Clamp to 0 rather than reporting a negative age, which would be nonsense.
  const ageHours = Math.max(0, (Date.now() - new Date(lastActivityIso).getTime()) / 3600e3);
  const state: Freshness =
    ageHours < t[0] ? 'FRESH' : ageHours < t[1] ? 'RECENT' : ageHours < t[2] ? 'AGING' : ageHours < t[3] ? 'STALE' : 'EXPIRED';
  return { state, ageHours, thresholdsH: t };
}

export function relativePt(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'há segundos';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
