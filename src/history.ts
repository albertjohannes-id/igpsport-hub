import type { Transfer } from './api';

const KEY = 'apex-transfer-history-v1';
const LIMIT = 200;
type Entry = Transfer & { scope: string };

function entries(): Entry[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (item): item is Entry =>
          !!item &&
          typeof item === 'object' &&
          typeof item.scope === 'string' &&
          typeof item.sourceId === 'string' &&
          typeof item.title === 'string' &&
          typeof item.at === 'number' &&
          ['received', 'unconfirmed', 'confirmed', 'existing'].includes(item.state) &&
          (item.activityId === null || typeof item.activityId === 'string') &&
          (item.receipt === undefined || typeof item.receipt === 'string'),
      )
      .slice(0, LIMIT);
  } catch {
    // Corrupt JSON is replaceable; storage access failures must remain visible.
    return [];
  }
}

export function readHistory(scope: string | null): Transfer[] {
  return scope ? entries().filter((entry) => entry.scope === scope) : [];
}

export function saveTransfer(scope: string, transfer: Transfer): void {
  const next = [
    { ...transfer, scope },
    ...entries().filter((entry) => entry.scope !== scope || entry.sourceId !== transfer.sourceId),
  ].slice(0, LIMIT);
  const value = JSON.stringify(next);
  if (value.length > 1_000_000)
    throw new Error('Transfer history is full. Clear older browser data before transferring.');
  localStorage.setItem(KEY, value);
  if (localStorage.getItem(KEY) !== value) throw new Error('Browser history could not be saved.');
}
