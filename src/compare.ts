import type { Activity } from './api';

export const COMPARE_PAGES = 5;
// Lists are mirrored when the Compare tab opens; reuse them for this long.
export const AUTO_COMPARE_WAIT = 120000;

// Suggestion thresholds: same or adjacent day, close distance, close duration.
const dayMoment = (a: Activity) => {
  const raw = a.sourceDateTime;
  if (!raw) return null;
  const time = new Date(raw.slice(0, 10).replaceAll('.', '-') + 'T12:00:00').getTime();
  return Number.isNaN(time) ? null : time / 86400000;
};
export const dayGap = (a: Activity, b: Activity) => {
  const from = dayMoment(a);
  const to = dayMoment(b);
  if (from == null || to == null) return 99;
  return Math.abs(Math.floor(from + 0.5) - Math.floor(to + 0.5));
};
export const distanceGap = (a: Activity, b: Activity) =>
  a.distanceMeters == null || b.distanceMeters == null
    ? null
    : Math.abs(a.distanceMeters - b.distanceMeters);
export const minuteGap = (a: Activity, b: Activity) => {
  const seconds = (a: Activity) => a.timerSeconds ?? a.movingSeconds ?? a.elapsedSeconds ?? null;
  const diff = Math.abs((seconds(a) ?? 0) - (seconds(b) ?? 0));
  return diff < 60 ? 'same duration' : `${Math.round(diff / 60)} min apart`;
};
// A pair suggests itself when the numbers plausibly describe the same ride.
const looksLikeSameRide = (a: Activity, b: Activity) => {
  const days = dayGap(a, b);
  if (days > 1) return false;
  const distance = distanceGap(a, b);
  if (distance == null) return false;
  if (distance > Math.max((a.distanceMeters || 0) * 0.03, 300)) return false;
  const from = a.timerSeconds ?? a.movingSeconds ?? a.elapsedSeconds ?? null;
  const to = b.timerSeconds ?? b.movingSeconds ?? b.elapsedSeconds ?? null;
  if (from != null && to != null && Math.abs(from - to) > Math.max(from * 0.12, 240)) return false;
  return true;
};

export type ComparePair = { igp: Activity; garmin: Activity };
export type Compare = {
  pairs: ComparePair[];
  fresh: Activity[];
  igpTotal: number;
  garminTotal: number;
  capped: boolean;
  fetchedAt: number;
};

export const buildCompare = (
  igpList: Activity[],
  garList: Activity[],
  capped: boolean,
): Omit<Compare, 'fetchedAt'> => {
  // Only rides with no recorded outcome need a suggestion; the rest of the Hub already knows.
  const taken = new Set<string>();
  const pairs: ComparePair[] = [];
  const fresh: Activity[] = [];
  const unknown = [...igpList]
    .filter((a) => a.syncStatus === 'unknown')
    .sort((a, b) => (dayMoment(b) ?? 0) - (dayMoment(a) ?? 0));
  for (const igpRide of unknown) {
    let best: ComparePair | undefined;
    let bestScore = Infinity;
    for (const garminRide of garList) {
      if (taken.has(garminRide.id) || !looksLikeSameRide(igpRide, garminRide)) continue;
      const score = dayGap(igpRide, garminRide) * 1e6 + (distanceGap(igpRide, garminRide) ?? 0);
      if (score < bestScore) {
        bestScore = score;
        best = { igp: igpRide, garmin: garminRide };
      }
    }
    if (best) {
      taken.add(best.garmin.id);
      pairs.push(best);
    } else fresh.push(igpRide);
  }
  return { pairs, fresh, igpTotal: igpList.length, garminTotal: garList.length, capped };
};
