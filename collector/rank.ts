import { existsSync, readFileSync } from 'node:fs';
import { cli } from '../indexer/args.ts';
import { writeJsonAtomic } from '../indexer/crawl.ts';
import { validateIndex } from '../indexer/schema.ts';
import { parseKeyList } from '../indexer/sources.ts';
import { isoSeconds } from '../indexer/time.ts';
import { MEDIA_POLICY } from '../indexer/types.ts';
import type { IndexFile, IndexPlugin, Listing } from '../indexer/types.ts';

export interface InstallRow {
  ts: string;
  key: string;
  id: string;
  commit: string;
  installer: string;
}

export interface VoteRow {
  ts: string;
  key: string;
  id: string;
  voter: string;
  vote: 0 | 1;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HOT_DECAY_HOURS = 72;
export const MIN_TRENDING_INSTALLS = 3;

export function parseStore(text: string): { rows: InstallRow[]; skipped: number } {
  const rows: InstallRow[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as InstallRow;
      if (
        typeof row.key === 'string' &&
        typeof row.installer === 'string' &&
        typeof row.ts === 'string' &&
        !Number.isNaN(Date.parse(row.ts))
      ) {
        rows.push(row);
        continue;
      }
    } catch {
      /* counted below */
    }
    skipped++;
  }
  return { rows, skipped };
}

export function parseVotes(text: string): { rows: VoteRow[]; skipped: number } {
  const rows: VoteRow[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as VoteRow;
      if (
        typeof row.key === 'string' &&
        typeof row.voter === 'string' &&
        (row.vote === 0 || row.vote === 1) &&
        typeof row.ts === 'string' &&
        !Number.isNaN(Date.parse(row.ts))
      ) {
        rows.push(row);
        continue;
      }
    } catch {
      /* counted below */
    }
    skipped++;
  }
  return { rows, skipped };
}

export function upvoteCounts(votes: VoteRow[], firsts: Map<string, Map<string, number>>, now: number): Map<string, number> {
  const latest = new Map<string, { ts: number; vote: 0 | 1; key: string; voter: string }>();
  for (const row of votes) {
    const ts = Date.parse(row.ts);
    if (ts > now) continue;
    const id = `${row.key}\n${row.voter}`;
    const seen = latest.get(id);
    if (!seen || ts >= seen.ts) latest.set(id, { ts, vote: row.vote, key: row.key, voter: row.voter });
  }
  const counts = new Map<string, number>();
  for (const { vote, key, voter } of latest.values()) {
    if (vote !== 1 || !firsts.get(key)?.has(voter)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function firstPings(rows: InstallRow[], now: number): Map<string, Map<string, number>> {
  const byKey = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const ts = Date.parse(row.ts);
    if (ts > now) continue;
    let installers = byKey.get(row.key);
    if (!installers) byKey.set(row.key, (installers = new Map()));
    const seen = installers.get(row.installer);
    if (seen === undefined || ts < seen) installers.set(row.installer, ts);
  }
  return byKey;
}

export interface Scores {
  installs: { allTime: number; last24h: number; last7d: number };
  trending: number;
  hot: number;
}

export function score(firsts: Map<string, number> | undefined, now: number): Scores {
  let allTime = 0;
  let last24h = 0;
  let last7d = 0;
  let previous7d = 0;
  let hot = 0;
  for (const first of firsts?.values() ?? []) {
    allTime++;
    const age = now - first;
    if (age <= 7 * DAY) {
      last7d++;
      hot += Math.exp(-(age / HOUR) / HOT_DECAY_HOURS);
    }
    if (age <= DAY) last24h++;
    else if (age <= 8 * DAY) previous7d++;
  }
  return { installs: { allTime, last24h, last7d }, trending: last24h - previous7d / 7, hot };
}

function compareKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildIndex(input: {
  listings: Listing[];
  rows: InstallRow[];
  votes?: VoteRow[];
  denylist: string[];
  now: number;
  collectionStartedAt?: string;
}): IndexFile {
  const { now } = input;
  const denied = new Set(input.denylist.map((k) => k.toLowerCase()));
  const listings = input.listings.filter((l) => !denied.has(l.key.toLowerCase()));
  const firsts = firstPings(input.rows, now);
  const upvotes = upvoteCounts(input.votes ?? [], firsts, now);

  const scored = listings.map((listing) => {
    const s = score(firsts.get(listing.key), now);
    const plugin: IndexPlugin = { ...listing, installs: s.installs, upvotes: upvotes.get(listing.key) ?? 0 };
    return { plugin, s };
  });

  const byAllTime = [...scored].sort(
    (a, b) =>
      b.s.installs.allTime - a.s.installs.allTime ||
      compareKey(b.plugin.updatedAt, a.plugin.updatedAt) ||
      compareKey(a.plugin.key, b.plugin.key),
  );

  const eligible = scored.filter(({ plugin, s }) => plugin.audit.cleared && s.installs.allTime >= MIN_TRENDING_INSTALLS);
  const ranked = (pick: (s: Scores) => number): string[] =>
    eligible
      .filter(({ s }) => pick(s) > 0)
      .sort((a, b) => pick(b.s) - pick(a.s) || compareKey(b.plugin.updatedAt, a.plugin.updatedAt) || compareKey(a.plugin.key, b.plugin.key))
      .map(({ plugin }) => plugin.key);

  const startOfDay = (t: number) => isoSeconds(Math.floor(t / DAY) * DAY);
  const earliest = input.rows.map((r) => Date.parse(r.ts)).filter((t) => t <= now);
  const collectionStartedAt =
    input.collectionStartedAt ?? startOfDay(earliest.length > 0 ? Math.min(...earliest) : now);

  return {
    schemaVersion: 1,
    generatedAt: isoSeconds(now),
    collectionStartedAt,
    mediaPolicy: MEDIA_POLICY,
    plugins: byAllTime.map(({ plugin }) => plugin),
    rankings: {
      allTime: byAllTime.map(({ plugin }) => plugin.key),
      trending: ranked((s) => s.trending),
      hot: ranked((s) => s.hot),
      mostUpvoted: eligible
        .filter(({ plugin }) => plugin.upvotes > 0)
        .sort(
          (a, b) =>
            b.plugin.upvotes - a.plugin.upvotes ||
            b.s.installs.allTime - a.s.installs.allTime ||
            compareKey(a.plugin.key, b.plugin.key),
        )
        .map(({ plugin }) => plugin.key),
    },
  };
}

function main(): void {
  const { values } = cli({
    listings: { type: 'string' },
    store: { type: 'string' },
    votes: { type: 'string' },
    denylist: { type: 'string' },
    out: { type: 'string' },
    now: { type: 'string' },
    'collection-started-at': { type: 'string' },
  });
  if (!values.listings || !values.store || !values.out) {
    console.error('usage: rank.ts --listings <listings.json> --store <installs.jsonl> [--votes <votes.jsonl>] [--denylist <file>] --out <index.json> [--now <iso>]');
    process.exit(2);
  }
  const listings = JSON.parse(readFileSync(values.listings, 'utf8')) as { plugins: Listing[] };
  const { rows, skipped } = parseStore(existsSync(values.store) ? readFileSync(values.store, 'utf8') : '');
  const votes = parseVotes(values.votes && existsSync(values.votes) ? readFileSync(values.votes, 'utf8') : '');
  const denylist = values.denylist && existsSync(values.denylist) ? parseKeyList(readFileSync(values.denylist, 'utf8')) : [];
  const now = values.now ? Date.parse(values.now) : Date.now();
  if (Number.isNaN(now)) {
    console.error(`invalid --now "${values.now}"`);
    process.exit(2);
  }
  const index = buildIndex({
    listings: listings.plugins,
    rows,
    votes: votes.rows,
    denylist,
    now,
    collectionStartedAt: values['collection-started-at'],
  });
  const errors = validateIndex(index);
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  writeJsonAtomic(values.out, index);
  console.log(`ranked ${index.plugins.length} plugins from ${rows.length} ping rows${skipped ? ` (${skipped} unreadable rows skipped)` : ''}`);
  console.log(`  votes: ${votes.rows.length} rows${votes.skipped ? ` (${votes.skipped} unreadable rows skipped)` : ''}`);
  console.log(`  trending: ${index.rankings.trending.length}, hot: ${index.rankings.hot.length}, mostUpvoted: ${index.rankings.mostUpvoted.length}`);
}

if (import.meta.main) main();
