import { ApiError, type Activity } from './api';

export const names: Record<string, string> = {
  igpsport: 'iGPSPORT',
  garmin: 'Garmin Connect',
  compare: 'Compare',
};

export const metric = (value: number | null | undefined, factor = 1, digits = 1) =>
  value == null
    ? '—'
    : (value * factor).toLocaleString(undefined, { maximumFractionDigits: digits });

export const duration = (
  a: Pick<Activity, 'movingSeconds' | 'timerSeconds' | 'elapsedSeconds'>,
) => {
  const seconds = a.movingSeconds ?? a.timerSeconds ?? a.elapsedSeconds;
  if (seconds == null) return '—';
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};

export const durationLabel = (
  a: Pick<Activity, 'movingSeconds' | 'timerSeconds' | 'elapsedSeconds'>,
) =>
  a.movingSeconds != null
    ? 'Moving time'
    : a.timerSeconds != null
      ? 'Timer duration'
      : 'Elapsed time';

export const dateLabel = (a: Activity) => {
  const source = a.sourceDateTime;
  if (!source) return 'Date unavailable';
  const date = new Date(source.slice(0, 10).replaceAll('.', '-') + 'T12:00:00');
  return Number.isNaN(date.getTime())
    ? source
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const syncLabel = (state: string) =>
  ({
    confirmed: 'Synced',
    existing: 'Already in Garmin',
    unconfirmed: 'Check status',
    received: 'Check status',
    unknown: 'Not checked',
  })[state] || state;

export const eligible = (a: Activity) =>
  !['confirmed', 'existing', 'received', 'unconfirmed'].includes(a.syncStatus);

export const errorMessage = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
