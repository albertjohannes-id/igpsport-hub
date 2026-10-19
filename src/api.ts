import { readHistory, saveTransfer } from './history';

export type Provider = 'igpsport' | 'garmin';
export type SessionState = 'connected' | 'disconnected' | 'error' | 'unavailable';
export type Session = { state: SessionState; message?: string; checkedAt?: number };
export type Activity = {
  id: string;
  provider: Provider;
  title: string;
  sourceDateTime: string | null;
  startTimeUtc: string | null;
  timePrecision: 'date' | 'datetime' | 'unknown';
  distanceMeters: number | null;
  movingSeconds: number | null;
  timerSeconds: number | null;
  elapsedSeconds: number | null;
  averageSpeedMps: number | null;
  ascentMeters: number | null;
  deviceName: string | null;
  syncStatus: string;
  maxSpeedMps?: number | null;
  averageHeartRateBpm?: number | null;
  maxHeartRateBpm?: number | null;
  averageCadenceRpm?: number | null;
  maxCadenceRpm?: number | null;
  caloriesKcal?: number | null;
};
export type Transfer = {
  sourceId: string;
  title: string;
  state: string;
  activityId: string | null;
  at: number;
  receipt?: string;
};
export type Status = {
  mode: 'local' | 'cloud-preview' | 'hosted-test';
  capabilities: { login: boolean; transfer: boolean };
  sessions: Record<Provider, Session>;
  history: Transfer[];
  historyScope?: string | null;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  if (!navigator.onLine)
    throw new ApiError('You are offline. Reconnect and try again.', 0, 'OFFLINE');
  const response = await fetch('/api' + path, {
    method: body ? 'POST' : 'GET',
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'X-Apex-Client': 'local-web',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError(
      'The activity service is unavailable. Please try again shortly.',
      response.status,
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error || 'Request failed. Please try again.',
      response.status,
      result.code,
    );
  return result as T;
}

let historyScope: string | null | undefined;

async function browserRequest<T>(
  path: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  if (!navigator.onLine)
    throw new ApiError('You are offline. Reconnect and try again.', 0, 'OFFLINE');
  const transfer = path === '/igpsport/transfer' || path === '/igpsport/check';
  // Re-read cookies before account-sensitive work; another tab may have switched accounts.
  if (transfer && historyScope !== undefined) {
    const current = await request<Status>('/status', undefined, signal);
    if (current.historyScope !== historyScope) {
      historyScope = current.historyScope;
      throw new ApiError(
        'Connected accounts changed. Reload before transferring.',
        409,
        'ACCOUNTS_CHANGED',
      );
    }
  }
  if (transfer && historyScope !== undefined) {
    if (!historyScope)
      throw new ApiError('Connect both accounts before transferring.', 401, 'RECONNECT');
    try {
      const previous = readHistory(historyScope).find((entry) => entry.sourceId === body?.id);
      if (
        path.endsWith('/transfer') &&
        previous &&
        ['received', 'unconfirmed'].includes(previous.state)
      ) {
        throw new ApiError(
          'A previous transfer is not confirmed. Use Check status first.',
          409,
          'CHECK_FIRST',
        );
      }
      body = { ...body, ...(previous?.receipt ? { receipt: previous.receipt } : {}) };
      saveTransfer(
        historyScope,
        previous || {
          sourceId: String(body.id),
          title: 'Ride ' + body.id,
          state: 'received',
          activityId: null,
          at: Date.now() / 1000,
        },
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        'Browser storage is unavailable or full. Allow site storage before transferring.',
        0,
        'STORAGE_UNAVAILABLE',
      );
    }
  }
  const result = await request<T>(path, body, signal);
  if (path.endsWith('/login') && (result as { storage?: string }).storage === 'browser') {
    const saved = await request<{ saved: string[]; proofs: Record<string, string | null> }>(
      '/storage',
    );
    const expected = (result as { storageProof: string }).storageProof;
    if (!expected || saved.proofs[path.split('/')[1]] !== expected) {
      throw new ApiError(
        'Your browser did not save the connection cookie. Allow cookies for this site and reconnect.',
        0,
        'STORAGE_UNAVAILABLE',
      );
    }
  }
  if (path === '/status') {
    const status = result as Status;
    historyScope = status.historyScope;
    if (historyScope !== undefined) {
      try {
        status.history = readHistory(historyScope);
      } catch {
        throw new ApiError(
          'Browser history is unavailable. Allow site storage and reload.',
          0,
          'STORAGE_UNAVAILABLE',
        );
      }
    }
  } else if (transfer && historyScope) {
    try {
      saveTransfer(historyScope, result as Transfer);
    } catch {
      throw new ApiError(
        'The request completed, but its result could not be saved. Check Garmin before trying again.',
        0,
        'STORAGE_UNAVAILABLE',
      );
    }
  } else if (path.startsWith('/igpsport/activities') && historyScope) {
    const history = readHistory(historyScope);
    for (const activity of (result as { activities: Activity[] }).activities) {
      const previous = history.find((entry) => entry.sourceId === activity.id);
      if (previous) activity.syncStatus = previous.state;
    }
  }
  return result;
}

let queue: Promise<unknown> = Promise.resolve();
export function api<T>(
  path: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const run = () => browserRequest<T>(path, body, signal);
  // Web Locks serialize cookie rotation and account changes across same-origin tabs.
  if (navigator.locks) return navigator.locks.request('apex-provider-session', run);
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
