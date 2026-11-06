import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePings, generateVotes } from './seed-pings.ts';

const plugins = ['a', 'b', 'c', 'd'].map((n) => ({ key: `github.com/o/${n}`, id: `o.${n}`, commit: 'a'.repeat(40) }));
const NOW = Date.parse('2026-11-05T23:00:00Z');

test('generated pings are deterministic, within the window and well formed', () => {
  const first = generatePings(plugins, { now: NOW, days: 10, seed: 1 });
  const second = generatePings(plugins, { now: NOW, days: 10, seed: 1 });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, generatePings(plugins, { now: NOW, days: 10, seed: 2 }));
  assert.ok(first.length > 200);
  for (const p of first) {
    assert.ok(p.at <= NOW && p.at >= NOW - 10 * 24 * 3_600_000);
    assert.match(p.installer, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(first.map((p) => p.at), first.map((p) => p.at).sort((x, y) => x - y));
  assert.equal(new Set(first.map((p) => p.key)).size, 4);
  assert.ok(new Set(first.map((p) => p.installer)).size < first.length);
});

test('generated votes come only from installers, after their install, and are deterministic', () => {
  const pings = generatePings(plugins, { now: NOW, days: 10, seed: 1 });
  const votes = generateVotes(pings, { now: NOW, seed: 1 });
  assert.deepEqual(votes, generateVotes(pings, { now: NOW, seed: 1 }));
  const firsts = new Map<string, number>();
  for (const p of pings) {
    const id = `${p.key}\n${p.installer}`;
    firsts.set(id, Math.min(firsts.get(id) ?? Infinity, p.at));
  }
  assert.ok(votes.length > 20);
  for (const v of votes) {
    const first = firsts.get(`${v.key}\n${v.voter}`);
    assert.ok(first !== undefined && v.at >= first && v.at <= NOW);
  }
  assert.ok(votes.some((v) => v.vote === 0));
  assert.ok(votes.filter((v) => v.vote === 1).length < firsts.size);
});
