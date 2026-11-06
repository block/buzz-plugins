import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { request } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createCollector, defaultVotesPath, ipBucket, validatePing, validateVote } from './server.ts';

const KEY = 'github.com/octo/plug';
const COMMIT = 'a'.repeat(40);
const INSTALLER = 'b'.repeat(64);
const ping = (extra: Record<string, unknown> = {}) => ({
  key: KEY,
  id: 'octo.plug',
  commit: COMMIT,
  installer: INSTALLER,
  client: 'community-marketplace/0.1.0',
  ...extra,
});

const voteBody = (extra: Record<string, unknown> = {}) => ({
  key: KEY,
  id: 'octo.plug',
  voter: INSTALLER,
  vote: 1,
  client: 'community-marketplace/0.1.0',
  ...extra,
});

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

async function start(options: { now?: () => number; trustProxy?: boolean; allowTimeOverride?: boolean; maxPerDay?: number; maxVotesPerDay?: number; keys?: string[]; seedStore?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'collector-'));
  const storePath = join(dir, 'nested', 'installs.jsonl');
  const indexPath = join(dir, 'index.json');
  if (options.seedStore !== undefined) {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(storePath, options.seedStore);
  }
  const writeIndex = (keys: string[]) => writeFileSync(indexPath, JSON.stringify({ schemaVersion: 1, plugins: keys.map((key) => ({ key })) }));
  writeIndex(options.keys ?? [KEY, 'github.com/block/buzz-app/examples/plugins/counter']);
  const clock = { t: Date.parse('2026-11-05T12:00:00Z') };
  const server = createCollector({ storePath, indexPath, now: options.now ?? (() => clock.t), trustProxy: options.trustProxy, allowTimeOverride: options.allowTimeOverride, maxPerDay: options.maxPerDay, maxVotesPerDay: options.maxVotesPerDay });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const rows = () => (existsSync(storePath) ? readFileSync(storePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/v1/installs`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const votesPath = defaultVotesPath(storePath);
  const votes = () => (existsSync(votesPath) ? readFileSync(votesPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const postVote = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/v1/votes`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { base, post, rows, clock, storePath, indexPath, writeIndex, votesPath, votes, postVote };
}

test('a valid ping is accepted with 202 {} and stored with exactly ts, key, id, commit, installer', async () => {
  const c = await start();
  const res = await c.post(ping());
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), {});
  assert.deepEqual(c.rows(), [{ ts: '2026-11-05T12:00:00.000Z', key: KEY, id: 'octo.plug', commit: COMMIT, installer: INSTALLER }]);
});

test('extra fields are ignored and never stored', async () => {
  const c = await start();
  const res = await c.post(ping({ email: 'a@b.c', ip: '1.2.3.4' }));
  assert.equal(res.status, 202);
  assert.deepEqual(Object.keys(c.rows()[0]!), ['ts', 'key', 'id', 'commit', 'installer']);
});

test('malformed bodies get 400', async () => {
  const c = await start();
  const bad: unknown[] = [
    '{not json',
    '',
    '[]',
    'null',
    '"str"',
    ping({ key: undefined }),
    ping({ id: undefined }),
    ping({ commit: undefined }),
    ping({ installer: undefined }),
    ping({ client: undefined }),
    ping({ key: 'gitlab.com/o/r' }),
    ping({ key: 'github.com/o' }),
    ping({ key: 'github.com/o/r/../x' }),
    ping({ id: 'Bad Id' }),
    ping({ commit: 'a'.repeat(39) }),
    ping({ commit: 'A'.repeat(40) }),
    ping({ commit: 'g'.repeat(40) }),
    ping({ installer: 'b'.repeat(63) }),
    ping({ installer: 'B'.repeat(64) }),
    ping({ installer: 42 }),
    ping({ client: 'x'.repeat(65) }),
    ping({ client: 'has space' }),
  ];
  for (const body of bad) {
    const res = await c.post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(c.rows(), []);
});

test('keys that are not in the index get 404 and are not stored', async () => {
  const c = await start();
  const res = await c.post(ping({ key: 'github.com/someone/else' }));
  assert.equal(res.status, 404);
  assert.deepEqual(c.rows(), []);
});

test('with no index every key is unknown', async () => {
  const c = await start();
  writeFileSync(c.indexPath, 'garbage');
  assert.equal((await c.post(ping())).status, 404);
});

test('the index is reloaded when the file changes', async () => {
  const c = await start({ keys: [] });
  assert.equal((await c.post(ping())).status, 404);
  c.writeIndex([KEY]);
  const future = new Date(Date.now() + 5000);
  utimesSync(c.indexPath, future, future);
  assert.equal((await c.post(ping())).status, 202);
});

test('the 1 KiB body limit applies to declared and chunked bodies', async () => {
  const c = await start();
  const padded = (size: number) => {
    const body = JSON.stringify(ping());
    return body + ' '.repeat(size - Buffer.byteLength(body));
  };
  assert.equal((await c.post(padded(1024))).status, 202);
  assert.equal((await c.post(padded(1025))).status, 400);
  assert.equal(c.rows().length, 1);

  const chunked = await new Promise<number>((resolve, reject) => {
    const req = request(`${c.base}/v1/installs`, { method: 'POST', headers: { 'transfer-encoding': 'chunked', 'content-type': 'application/json' } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', (e) => ((e as NodeJS.ErrnoException).code === 'ECONNRESET' ? resolve(400) : reject(e)));
    req.write(padded(1024));
    req.write('x'.repeat(10));
    req.end();
  });
  assert.equal(chunked, 400);
  assert.equal(c.rows().length, 1);
});

test('more than 30 pings per IP per UTC day gets 429, then resets the next day', async () => {
  const c = await start();
  for (let i = 0; i < 30; i++) {
    const res = await c.post(ping({ installer: i.toString(16).padStart(64, '0') }));
    assert.equal(res.status, 202, `ping ${i + 1}`);
  }
  const limited = await c.post(ping({ installer: 'f'.repeat(64) }));
  assert.equal(limited.status, 429);
  assert.equal(c.rows().length, 30);

  c.clock.t = Date.parse('2026-11-06T00:00:01Z');
  assert.equal((await c.post(ping({ installer: 'e'.repeat(64) }))).status, 202);
});

test('malformed and unknown-key requests also count toward the limit', async () => {
  const c = await start({ maxPerDay: 3 });
  assert.equal((await c.post('{')).status, 400);
  assert.equal((await c.post(ping({ key: 'github.com/x/y' }))).status, 404);
  assert.equal((await c.post(ping())).status, 202);
  assert.equal((await c.post(ping())).status, 429);
});

test('forwarded addresses are only trusted when asked to be, and each address has its own budget', async () => {
  const plain = await start({ maxPerDay: 1 });
  assert.equal((await plain.post(ping(), { 'x-forwarded-for': '203.0.113.1' })).status, 202);
  assert.equal((await plain.post(ping(), { 'x-forwarded-for': '203.0.113.2' })).status, 429);

  const proxied = await start({ maxPerDay: 1, trustProxy: true });
  assert.equal((await proxied.post(ping(), { 'x-forwarded-for': '203.0.113.1' })).status, 202);
  assert.equal((await proxied.post(ping(), { 'x-forwarded-for': '203.0.113.2' })).status, 202);
  assert.equal((await proxied.post(ping(), { 'x-forwarded-for': '203.0.113.2' })).status, 429);
  assert.equal((await proxied.post(ping(), { 'x-forwarded-for': 'spoofed, 203.0.113.2' })).status, 429);
});

test('IPv6 clients share a budget per /64 and mapped IPv4 collapses to IPv4', () => {
  assert.equal(ipBucket('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipBucket('203.0.113.9'), '203.0.113.9');
  assert.equal(ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), ipBucket('2001:db8:1:2::1'));
  assert.notEqual(ipBucket('2001:db8:1:2::1'), ipBucket('2001:db8:1:3::1'));
});

test('storage is append-only: existing rows are kept and repeat installers add rows', async () => {
  const c = await start();
  await c.post(ping());
  const before = readFileSync(c.storePath, 'utf8');
  c.clock.t += 60_000;
  assert.equal((await c.post(ping())).status, 202);
  const after = readFileSync(c.storePath, 'utf8');
  assert.ok(after.startsWith(before));
  assert.equal(c.rows().length, 2);
});

test('concurrent pings are all stored as whole lines', async () => {
  const c = await start({ maxPerDay: 100 });
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => c.post(ping({ installer: i.toString(16).padStart(64, '0') }))));
  assert.ok(results.every((r) => r.status === 202));
  assert.equal(c.rows().length, 40);
});

test('the time override header is ignored unless enabled', async () => {
  const off = await start();
  await off.post(ping(), { 'x-collector-time': '2026-10-01T00:00:00Z' });
  assert.equal(off.rows()[0].ts, '2026-11-05T12:00:00.000Z');

  const on = await start({ allowTimeOverride: true });
  await on.post(ping(), { 'x-collector-time': '2026-10-01T00:00:00Z' });
  assert.equal(on.rows()[0].ts, '2026-10-01T00:00:00.000Z');
  assert.equal((await on.post(ping(), { 'x-collector-time': 'nope' })).status, 400);
});

test('GET /v1/index.json serves the newest index with open CORS', async () => {
  const c = await start();
  const res = await fetch(`${c.base}/v1/index.json`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), JSON.parse(readFileSync(c.indexPath, 'utf8')));
  c.writeIndex(['github.com/new/one']);
  const again = await (await fetch(`${c.base}/v1/index.json`)).json();
  assert.equal(again.plugins[0].key, 'github.com/new/one');
});

test('GET /v1/index.json is 503 when there is no readable index', async () => {
  const c = await start();
  writeFileSync(c.indexPath, 'nope');
  assert.equal((await fetch(`${c.base}/v1/index.json`)).status, 503);
});

test('routing: preflight for GET, 405s, 404s, and no CORS on the POST endpoint', async () => {
  const c = await start();
  const pre = await fetch(`${c.base}/v1/index.json`, { method: 'OPTIONS', headers: { origin: 'https://example.org', 'access-control-request-method': 'GET' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.doesNotMatch(pre.headers.get('access-control-allow-methods') ?? '', /POST/);
  assert.equal((await fetch(`${c.base}/v1/installs`)).status, 405);
  assert.equal((await fetch(`${c.base}/v1/index.json`, { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await fetch(`${c.base}/nope`)).status, 404);
  const posted = await c.post(ping(), { origin: 'https://example.org' });
  assert.equal(posted.headers.get('access-control-allow-origin'), null);
  const optionsInstalls = await fetch(`${c.base}/v1/installs`, { method: 'OPTIONS' });
  assert.equal(optionsInstalls.status, 405);
});

test('validatePing accepts the documented shape', () => {
  assert.deepEqual(validatePing(ping({ key: 'github.com/block/buzz-app/examples/plugins/counter' })), {
    ok: true,
    key: 'github.com/block/buzz-app/examples/plugins/counter',
    id: 'octo.plug',
    commit: COMMIT,
    installer: INSTALLER,
  });
  assert.equal(validatePing(null).ok, false);
});

test('a vote from an installer is accepted and stored with exactly ts, key, id, voter, vote', async () => {
  const c = await start();
  assert.equal((await c.post(ping())).status, 202);
  const res = await c.postVote(voteBody({ extra: 'dropped' }));
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), {});
  c.clock.t += 1000;
  assert.equal((await c.postVote(voteBody({ vote: 0 }))).status, 202);
  assert.deepEqual(c.votes(), [
    { ts: '2026-11-05T12:00:00.000Z', key: KEY, id: 'octo.plug', voter: INSTALLER, vote: 1 },
    { ts: '2026-11-05T12:00:01.000Z', key: KEY, id: 'octo.plug', voter: INSTALLER, vote: 0 },
  ]);
  assert.equal(c.rows().length, 1);
});

test('a vote without an install ping for that key gets 403 and is not stored', async () => {
  const c = await start();
  assert.equal((await c.postVote(voteBody())).status, 403);
  await c.post(ping({ key: 'github.com/block/buzz-app/examples/plugins/counter' }));
  assert.equal((await c.postVote(voteBody())).status, 403);
  assert.equal((await c.postVote(voteBody({ voter: 'c'.repeat(64) }))).status, 403);
  assert.deepEqual(c.votes(), []);
});

test('installers already in the store can vote after a restart, and new installs can vote at once', async () => {
  const seeded = JSON.stringify({ ts: '2026-11-01T00:00:00.000Z', key: KEY, id: 'octo.plug', commit: COMMIT, installer: 'd'.repeat(64) });
  const c = await start({ seedStore: `${seeded}\n{broken\n` });
  assert.equal((await c.postVote(voteBody({ voter: 'd'.repeat(64) }))).status, 202);
  assert.equal((await c.postVote(voteBody())).status, 403);
  assert.equal((await c.post(ping())).status, 202);
  assert.equal((await c.postVote(voteBody())).status, 202);
});

test('malformed votes get 400 and unknown keys 404', async () => {
  const c = await start();
  for (const bad of ['nope', [], voteBody({ vote: 2 }), voteBody({ vote: true }), voteBody({ voter: 'x' }), voteBody({ id: 'Bad_Id' }), voteBody({ client: undefined })]) {
    assert.equal((await c.postVote(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await c.postVote(voteBody({ key: 'github.com/other/repo' }))).status, 404);
  assert.equal((await c.postVote('x'.repeat(2048))).status, 400);
  assert.deepEqual(c.votes(), []);
});

test('votes have their own per-IP daily budget', async () => {
  const c = await start({ maxPerDay: 1, maxVotesPerDay: 2 });
  assert.equal((await c.post(ping())).status, 202);
  assert.equal((await c.post(ping())).status, 429);
  assert.equal((await c.postVote(voteBody())).status, 202);
  assert.equal((await c.postVote(voteBody())).status, 202);
  assert.equal((await c.postVote(voteBody())).status, 429);
  c.clock.t += 24 * 3_600_000;
  assert.equal((await c.postVote(voteBody())).status, 202);
  assert.equal((await fetch(`${c.base}/v1/votes`)).status, 405);
});

test('validateVote and defaultVotesPath', () => {
  assert.deepEqual(validateVote(voteBody({ vote: 0 })), { ok: true, key: KEY, id: 'octo.plug', voter: INSTALLER, vote: 0 });
  assert.equal(validateVote(null).ok, false);
  assert.equal(defaultVotesPath('/d/installs.jsonl'), '/d/installs.votes.jsonl');
  assert.equal(defaultVotesPath('/d/store'), '/d/store.votes');
});
