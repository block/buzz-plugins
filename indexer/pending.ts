import { listingKey } from './slug.ts';
import { formatSource, parseKeyList, parseRepository, parseSources, validateSource } from './sources.ts';

export interface PendingRow {
  ts: string;
  key: string;
  id: string;
  repository: string;
  ref: string;
  path: string;
  commit: string;
}

export function parsePending(text: string): PendingRow[] {
  const rows: PendingRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<PendingRow>;
      if (typeof row.key === 'string' && typeof row.repository === 'string' && typeof row.ref === 'string') {
        rows.push({ ts: String(row.ts ?? ''), key: row.key, id: String(row.id ?? ''), repository: row.repository, ref: row.ref, path: typeof row.path === 'string' ? row.path : '', commit: String(row.commit ?? '') });
      }
    } catch {
      /* unreadable rows are skipped, as rank.ts does */
    }
  }
  return rows;
}

export function mergePending(sourcesText: string, pendingText: string, denylistText = ''): { text: string; added: number } {
  const seen = new Set<string>();
  for (const entry of parseSources(sourcesText)) if (entry.source) seen.add(listingKey(entry.source).toLowerCase());
  const denied = new Set(parseKeyList(denylistText).map((k) => k.toLowerCase()));
  const lines: string[] = [];
  for (const row of parsePending(pendingText)) {
    const repository = parseRepository(row.repository);
    if (!repository) continue;
    const checked = validateSource({ ...repository, ref: row.ref, path: row.path });
    if ('error' in checked) continue;
    const key = listingKey(checked.source).toLowerCase();
    if (seen.has(key) || denied.has(key)) continue;
    seen.add(key);
    lines.push(formatSource(checked.source));
  }
  if (lines.length === 0) return { text: sourcesText, added: 0 };
  const base = sourcesText === '' || sourcesText.endsWith('\n') ? sourcesText : `${sourcesText}\n`;
  return { text: `${base}${lines.join('\n')}\n`, added: lines.length };
}
