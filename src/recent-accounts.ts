import type { Provider } from './api';

type Account = { username: string; lastUsed: number };
const KEY = 'apex-recent-accounts';
const MAX_AGE = 90 * 24 * 60 * 60 * 1000;
type Accounts = Record<Provider, Account[]>;

function write(accounts: Accounts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(accounts));
  } catch {
    // Remembering an account must never prevent a successful connection.
  }
}

function read(): Accounts {
  const accounts: Accounts = { igpsport: [], garmin: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const provider of ['igpsport', 'garmin'] as const) {
      if (!Array.isArray(raw?.[provider])) continue;
      const seen = new Set<string>();
      accounts[provider] = raw[provider]
        .filter(
          (item: Account) =>
            item &&
            typeof item.username === 'string' &&
            item.username.trim() &&
            Number.isFinite(item.lastUsed) &&
            item.lastUsed <= Date.now() &&
            Date.now() - item.lastUsed < MAX_AGE,
        )
        .sort((a: Account, b: Account) => b.lastUsed - a.lastUsed)
        .filter((item: Account) => {
          if (seen.has(item.username)) return false;
          seen.add(item.username);
          return true;
        })
        .slice(0, 5);
    }
    write(accounts);
  } catch {
    // Storage may be blocked or contain an older, invalid value.
  }
  return accounts;
}

export function recentAccounts(provider: Provider): string[] {
  return read()[provider].map((account) => account.username);
}

export function rememberAccount(provider: Provider, username: string) {
  const accounts = read();
  const value = username.trim();
  if (!value) return;
  accounts[provider] = [
    { username: value, lastUsed: Date.now() },
    ...accounts[provider].filter((account) => account.username !== value),
  ].slice(0, 5);
  write(accounts);
}

export function forgetAccount(provider: Provider, username?: string) {
  const accounts = read();
  accounts[provider] =
    username === undefined
      ? []
      : accounts[provider].filter((account) => account.username !== username.trim());
  write(accounts);
}
