import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateIndex } from '../indexer/schema.ts';
import { slugify } from '../indexer/slug.ts';
import type { Listing } from '../indexer/types.ts';
import { buildIndex, firstPings, parseStore, parseVotes, score, upvoteCounts } from './rank.ts';
import type { InstallRow, VoteRow } from './rank.ts';

const NOW = Date.parse('2026-11-05T23:00:00Z');
const H = 3_600_000;
const D = 24 * H;

function listing(name: string, extra: { cleared?: boolean; updatedAt?: string } = {}): Listing {
  const key = `github.com/o/${name}`;
  return {
    key,
    slug: slugify(key),
    id: `o.${name}`,
    name,
    tagline: '',
    description: '',
    category: 'productivity',
    tags: [],
    author: { github: 'o' },
    official: false,
    source: { repository: `https://github.com/o/${name}`, ref: 'main', commit: 'a'.repeat(40), path: '' },
    host: { networkOrigins: [], processes: [], commands: [], files: false, mcp: false, agentHooks: false },
    audit: { tier: 'low', flags: [], accessChanged: false, cleared: extra.cleared ?? true, checkedAt: '2026-11-05T22:00:00Z' },
    demo: { video: null, poster: null, screenshots: [] },
    setup: [],
    links: { repository: `https://github.com/o/${name}` },
    stars: 0,
    updatedAt: extra.updatedAt ?? '2026-11-01T00:00:00Z',
  };
}

let counter = 0;
const row = (name: string, ageMs: number, installer?: string): InstallRow => ({
  ts: new Date(NOW - ageMs).toISOString(),
  key: `github.com/o/${name}`,
  id: `o.${name}`,
  commit: 'a'.repeat(40),
  installer: installer ?? (counter++).toString(16).padStart(64, '0'),
});
const many = (name: string, n: number, ageMs: number) => Array.from({ length: n }, () => row(name, ageMs));
const build = (listings: Listing[], rows: InstallRow[], denylist: string[] = [], votes: VoteRow[] = []) => buildIndex({ listings, rows, votes, denylist, now: NOW });
const vote = (name: string, voter: string, value: 0 | 1, ageMs: number): VoteRow => ({
  ts: new Date(NOW - ageMs).toISOString(),
  key: `github.com/o/${name}`,
  id: `o.${name}`,
  voter,
  vote: value,
});
const installers = (name: string, n: number, ageMs = D) =>
  Array.from({ length: n }, (_, i) => row(name, ageMs, `${name}-${i}`.padEnd(64, '0')));
const find = (index: ReturnType<typeof build>, name: string) => index.plugins.find((p) => p.key === `github.com/o/${name}`)!;

test('one installer counts once per key, using its earliest ping wherever it sits in the file', () => {
  const rows = [row('a', 2 * H, 'x'.repeat(64)), row('a', 30 * D, 'x'.repeat(64)), row('a', 1 * H, 'x'.repeat(64)), row('a', 3 * H, 'y'.repeat(64))];
  const firsts = firstPings(rows, NOW).get('github.com/o/a')!;
  assert.equal(firsts.size, 2);
  assert.equal(firsts.get('x'.repeat(64)), NOW - 30 * D);
  const s = score(firsts, NOW);
  assert.deepEqual(s.installs, { allTime: 2, last24h: 1, last7d: 1 });
});

test('the same installer on two keys counts for each key', () => {
  const rows = [row('a', H, 'x'.repeat(64)), row('b', H, 'x'.repeat(64))];
  const index = build([listing('a'), listing('b')], rows);
  assert.equal(find(index, 'a').installs.allTime, 1);
  assert.equal(find(index, 'b').installs.allTime, 1);
});

test('windows are based on each installer\'s first ping and have exact edges', () => {
  const rows = [
    row('a', 0),
    row('a', 24 * H),
    row('a', 24 * H + 1),
    row('a', 7 * D),
    row('a', 7 * D + 1),
    row('a', 60 * D),
    row('a', -H),
  ];
  const s = score(firstPings(rows, NOW).get('github.com/o/a'), NOW);
  assert.deepEqual(s.installs, { allTime: 6, last24h: 2, last7d: 4 });
});

test('an old installer pinging again today is not a new installer', () => {
  const rows = [row('a', 10 * D, 'z'.repeat(64)), row('a', H, 'z'.repeat(64))];
  const s = score(firstPings(rows, NOW).get('github.com/o/a'), NOW);
  assert.deepEqual(s.installs, { allTime: 1, last24h: 0, last7d: 0 });
});

test('trending is new installers in 24h minus the daily average of the previous 7 days', () => {
  const firsts = new Map<string, number>();
  for (let i = 0; i < 6; i++) firsts.set(`n${i}`, NOW - H * (i + 1));
  for (let i = 0; i < 14; i++) firsts.set(`o${i}`, NOW - D - H * (i + 1));
  firsts.set('too-old', NOW - 8 * D - H);
  const s = score(firsts, NOW);
  assert.equal(s.installs.last24h, 6);
  assert.equal(s.trending, 6 - 14 / 7);
});

test('trending ranks by score, and drops non-positive, ineligible and uncleared listings', () => {
  const rows = [
    ...many('hi', 5, 2 * H), ...many('hi', 14, 3 * D),
    ...many('mid', 3, 2 * H), ...many('mid', 7, 3 * D),
    ...many('flat', 1, 2 * H), ...many('flat', 7, 3 * D),
    ...many('falling', 0, 2 * H), ...many('falling', 10, 3 * D),
    ...many('tiny', 2, 2 * H),
    ...many('blocked', 20, 2 * H),
  ];
  const listings = [listing('hi'), listing('mid'), listing('flat'), listing('falling'), listing('tiny'), listing('blocked', { cleared: false })];
  const index = build(listings, rows);
  assert.deepEqual(index.rankings.trending, ['github.com/o/hi', 'github.com/o/mid']);
  assert.equal(index.rankings.allTime[0], 'github.com/o/blocked');
  assert.ok(index.rankings.allTime.includes('github.com/o/tiny'));
  assert.ok(!index.rankings.hot.includes('github.com/o/blocked'));
  assert.ok(!index.rankings.hot.includes('github.com/o/tiny'));
  assert.equal(find(index, 'blocked').installs.last24h, 20);
});

test('trending needs at least 3 all-time installers', () => {
  const two = build([listing('a')], many('a', 2, H));
  assert.deepEqual(two.rankings.trending, []);
  const three = build([listing('a')], many('a', 3, H));
  assert.deepEqual(three.rankings.trending, ['github.com/o/a']);
});

test('hot sums exp(-age_hours/72) over first pings in the last 7 days', () => {
  const rows = [row('a', 0), row('a', 72 * H), row('a', 144 * H), row('a', 7 * D + 1), row('a', 8 * D)];
  const s = score(firstPings(rows, NOW).get('github.com/o/a'), NOW);
  assert.ok(Math.abs(s.hot - (1 + Math.exp(-1) + Math.exp(-2))) < 1e-9, String(s.hot));
  const aged = score(new Map([['x', NOW - 36 * H]]), NOW);
  assert.ok(Math.abs(aged.hot - Math.exp(-0.5)) < 1e-12);
});

test('hot favours recent installs over a larger but older burst', () => {
  const rows = [...many('burst', 6, 6 * D), ...many('fresh', 4, 2 * H)];
  const index = build([listing('burst'), listing('fresh')], rows);
  assert.deepEqual(index.rankings.hot, ['github.com/o/fresh', 'github.com/o/burst']);
  assert.deepEqual(index.rankings.allTime, ['github.com/o/burst', 'github.com/o/fresh']);
});

test('allTime ties go to the newer updatedAt, then the key', () => {
  const listings = [
    listing('b', { updatedAt: '2026-11-02T00:00:00Z' }),
    listing('a', { updatedAt: '2026-11-02T00:00:00Z' }),
    listing('c', { updatedAt: '2026-11-03T00:00:00Z' }),
    listing('d', { updatedAt: '2026-10-01T00:00:00Z' }),
  ];
  const rows = [...many('b', 2, D), ...many('a', 2, D), ...many('c', 2, D), ...many('d', 3, D)];
  const index = build(listings, rows);
  assert.deepEqual(index.rankings.allTime, ['github.com/o/d', 'github.com/o/c', 'github.com/o/a', 'github.com/o/b']);
  assert.deepEqual(index.plugins.map((p) => p.key), index.rankings.allTime);
});

test('trending and hot ties break by newer updatedAt, then key', () => {
  const listings = [listing('b', { updatedAt: '2026-11-02T00:00:00Z' }), listing('a', { updatedAt: '2026-11-02T00:00:00Z' }), listing('c', { updatedAt: '2026-11-03T00:00:00Z' })];
  const rows = [...many('a', 3, H), ...many('b', 3, H), ...many('c', 3, H)];
  const index = build(listings, rows);
  assert.deepEqual(index.rankings.hot.slice(0, 3), ['github.com/o/c', 'github.com/o/a', 'github.com/o/b']);
  assert.deepEqual(index.rankings.trending, ['github.com/o/c', 'github.com/o/a', 'github.com/o/b']);
});

test('denylisted keys are dropped everywhere, case-insensitively', () => {
  const rows = [...many('bad', 9, H), ...many('good', 3, H)];
  const index = build([listing('bad'), listing('good')], rows, ['GitHub.com/o/BAD']);
  assert.deepEqual(index.plugins.map((p) => p.key), ['github.com/o/good']);
  for (const list of Object.values(index.rankings)) assert.ok(!list.includes('github.com/o/bad'));
});

test('pings for keys that are not listed are ignored, and future rows are not counted', () => {
  const rows = [...many('ghost', 5, H), row('a', H), row('a', -2 * H)];
  const index = build([listing('a')], rows);
  assert.equal(index.plugins.length, 1);
  assert.equal(find(index, 'a').installs.allTime, 1);
});

test('listings with no pings get zero installs and rank last', () => {
  const index = build([listing('quiet'), listing('busy')], many('busy', 1, D));
  assert.deepEqual(find(index, 'quiet').installs, { allTime: 0, last24h: 0, last7d: 0 });
  assert.deepEqual(index.rankings.allTime, ['github.com/o/busy', 'github.com/o/quiet']);
  assert.deepEqual(index.rankings.trending, []);
  assert.deepEqual(index.rankings.hot, []);
});

test('the index carries schemaVersion, timestamps and the media policy, and validates', () => {
  const index = build([listing('a')], many('a', 3, 2 * D));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.generatedAt, '2026-11-05T23:00:00Z');
  assert.equal(index.collectionStartedAt, '2026-11-03T00:00:00Z');
  assert.match(index.mediaPolicy, /raw\.githubusercontent\.com/);
  assert.deepEqual(validateIndex(index), []);
  assert.equal(buildIndex({ listings: [], rows: [], denylist: [], now: NOW }).collectionStartedAt, '2026-11-05T00:00:00Z');
  assert.equal(buildIndex({ listings: [], rows: [], denylist: [], now: NOW, collectionStartedAt: '2026-10-01T00:00:00Z' }).collectionStartedAt, '2026-10-01T00:00:00Z');
});

test('the store parser skips unreadable lines', () => {
  const good = JSON.stringify(row('a', H));
  const { rows, skipped } = parseStore(`${good}\n\n{broken\n{"key":"x"}\n${JSON.stringify({ ...row('a', H), ts: 'not a date' })}\n`);
  assert.equal(rows.length, 1);
  assert.equal(skipped, 3);
});

test('validateIndex catches structural problems', () => {
  const index = build([listing('a'), listing('b', { cleared: false })], many('a', 3, H));
  assert.deepEqual(validateIndex(index), []);
  const broken = structuredClone(index);
  broken.rankings.trending.push('github.com/o/b');
  broken.plugins[0]!.slug = 'wrong';
  broken.plugins[1]!.installs = { allTime: 1, last24h: 5, last7d: 2 };
  const errors = validateIndex(broken).join('\n');
  assert.match(errors, /not cleared/);
  assert.match(errors, /slug/);
  assert.match(errors, /last24h <= last7d <= allTime/);
  assert.ok(validateIndex({}).length > 0);
});

test('fixtures/index.json validates against the spec shape', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/index.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateIndex(fixture), []);
});

test('upvotes count distinct installers whose latest vote is 1', () => {
  const rows = installers('a', 4);
  const [v0, v1, v2, v3] = rows.map((r) => r.installer);
  const votes = [
    vote('a', v0!, 1, 5 * H),
    vote('a', v0!, 1, 4 * H),
    vote('a', v1!, 1, 5 * H),
    vote('a', v1!, 0, 2 * H),
    vote('a', v2!, 0, 5 * H),
    vote('a', v2!, 1, 1 * H),
    vote('a', v3!, 1, -H),
    vote('a', 'f'.repeat(64), 1, H),
  ];
  const index = build([listing('a')], rows, [], votes);
  assert.equal(find(index, 'a').upvotes, 2);
  assert.equal(upvoteCounts(votes, firstPings(rows, NOW), NOW).get('github.com/o/a'), 2);
});

test('a vote only counts for the key its voter installed', () => {
  const rows = installers('a', 1);
  const index = build([listing('a'), listing('b')], rows, [], [vote('b', rows[0]!.installer, 1, H)]);
  assert.equal(find(index, 'b').upvotes, 0);
  assert.equal(find(index, 'a').upvotes, 0);
});

test('mostUpvoted ranks cleared listings with 3+ installers, ties by installs then key', () => {
  const rows = [...installers('a', 5), ...installers('b', 4), ...installers('c', 4), ...installers('d', 2), ...installers('e', 9), ...installers('z', 3)];
  const up = (name: string, n: number) => rows.filter((r) => r.key === `github.com/o/${name}`).slice(0, n).map((r) => vote(name, r.installer, 1, H));
  const votes = [...up('a', 2), ...up('b', 2), ...up('c', 3), ...up('d', 2), ...up('e', 9)];
  const listings = [listing('a'), listing('b'), listing('c'), listing('d'), listing('e', { cleared: false }), listing('z')];
  const index = build(listings, rows, [], votes);
  assert.deepEqual(index.rankings.mostUpvoted, ['github.com/o/c', 'github.com/o/a', 'github.com/o/b']);
  assert.equal(find(index, 'e').upvotes, 9);
  assert.equal(find(index, 'z').upvotes, 0);
  assert.deepEqual(validateIndex(index), []);
});

test('the vote parser skips unreadable lines and bad vote values', () => {
  const good = JSON.stringify(vote('a', 'x'.repeat(64), 1, H));
  const { rows, skipped } = parseVotes(`${good}\n{broken\n${JSON.stringify({ ...vote('a', 'x'.repeat(64), 1, H), vote: 2 })}\n\n`);
  assert.equal(rows.length, 1);
  assert.equal(skipped, 2);
});

test('validateIndex requires upvotes no larger than installs and a mostUpvoted list', () => {
  const index = build([listing('a')], installers('a', 3));
  const broken = structuredClone(index) as unknown as { plugins: { upvotes: unknown }[]; rankings: Record<string, unknown> };
  broken.plugins[0]!.upvotes = 4;
  delete broken.rankings.mostUpvoted;
  const errors = validateIndex(broken).join('\n');
  assert.match(errors, /upvotes: must not exceed installs.allTime/);
  assert.match(errors, /mostUpvoted: must be a list of keys/);
});
