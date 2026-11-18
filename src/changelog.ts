import raw from '../CHANGELOG.md?raw';

export type ChangelogEntry = {
  version: string;
  date: string;
  changes: string[];
};

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  for (const block of markdown.split(/^## /m).slice(1)) {
    const lines = block.split('\n');
    const match = /^([0-9]+\.[0-9]+\.[0-9]+)(?:\s*[—–-]\s*(\S+))?\s*$/.exec(lines[0].trim());
    if (!match) continue;
    entries.push({
      version: match[1],
      date: match[2] || '',
      changes: lines
        .slice(1)
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim()),
    });
  }
  return entries;
}

export const changelog = parseChangelog(raw);
