import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Deps } from '../indexer/net.ts';
import { COMMIT, mock, repoRoutes } from '../indexer/testkit.ts';
import type { RepoFixture } from '../indexer/testkit.ts';
import { createCollector } from './server.ts';
import { defaultPendingPath, sourceFromKey, validateSubmission } from './submit.ts';

const INSTALLER = 'b'.repeat(64);
const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

function repoDeps(...fixtures: RepoFixture[]) {
  return mock(Object.assign({}, ...fixtures.map((f) => repoRoutes(f))));
}

async function start(options: { deps?: Deps; keys?: string[]; denylist?: string; maxSubmissionsPerDay?: number; maxPerDay?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'collector-sources-'));
  const storePath = join(dir, 'installs.jsonl');
  const indexPath = join(dir, 'index.json');
  const denylistPath = join(dir, 'denylist.txt');
  writeFileSync(indexPath, JSON.stringify({ schemaVersion: 1, plugins: (options.keys ?? []).map((key) => ({ key })) }));
  writeFileSync(denylistPath, options.denylist ?? '');
  const server = createCollector({
    storePath,
    indexPath,
    denylistPath,
    deps: options.deps ?? repoDeps({}).deps,
    now: () => Date.parse('2026-11-05T12:00:00Z'),
    maxSubmissionsPerDay: options.maxSubmissionsPerDay,
    maxPerDay: options.maxPerDay,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const jsonl = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return {
    submit: (body: unknown) => postJson('/v1/sources', body),
    ping: (extra: Record<string, unknown> = {}) =>
      postJson('/v1/installs', { key: 'github.com/octo/plug', id: 'octo.plug', commit: COMMIT, installer: INSTALLER, client: 'community-marketplace/0.1.0', ...extra }),
    vote: () => postJson('/v1/votes', { key: 'github.com/octo/plug', id: 'octo.plug', voter: INSTALLER, vote: 1, client: 'community-marketplace/0.1.0' }),
    pending: () => jsonl(defaultPendingPath(storePath)),
    pendingFeed: () => fetch(`${base}/v1/pending-sources.jsonl`),
    installs: () => jsonl(storePath),
  };
}

test('a public source is queued and the would-be listing summary comes back', async () => {
  const c = await start();
  const res = await c.submit({ repository: 'octo/plug' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'queued');
  assert.equal(body.listing.key, 'github.com/octo/plug');
  assert.equal(body.listing.id, 'octo.plug');
  assert.equal(body.listing.name, 'Plug');
  assert.equal(body.listing.tagline, 'Does a thing.');
  assert.deepEqual(body.listing.source, { repository: 'https://github.com/octo/plug', ref: 'main', commit: COMMIT, path: '' });
  assert.deepEqual(body.listing.audit, { tier: 'low', flags: [], cleared: true });
  assert.deepEqual(c.pending(), [
    { ts: '2026-11-05T12:00:00.000Z', key: 'github.com/octo/plug', id: 'octo.plug', repository: 'https://github.com/octo/plug', ref: 'main', path: '', commit: COMMIT },
  ]);
});

test('GET /v1/pending-sources.jsonl serves the pending store for the crawl', async () => {
  const c = await start();
  const empty = await c.pendingFeed();
  assert.equal(empty.status, 200);
  assert.equal(await empty.text(), '');
  await c.submit({ repository: 'octo/plug' });
  const res = await c.pendingFeed();
  assert.match(res.headers.get('content-type') ?? '', /application\/x-ndjson/);
  assert.deepEqual((await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)), c.pending());
});

test('resubmitting a queued source is idempotent and an indexed source reports listed', async () => {
  const c = await start({ keys: ['github.com/octo/other'], deps: repoDeps({}, { repo: 'other', manifest: { id: 'octo.other', name: 'Other', apiVersion: 1 } }).deps });
  assert.equal((await (await c.submit({ repository: 'https://github.com/octo/plug' })).json()).status, 'queued');
  assert.equal((await (await c.submit({ repository: 'octo/plug.git', ref: 'main' })).json()).status, 'queued');
  assert.equal((await (await c.submit({ repository: 'octo/other' })).json()).status, 'listed');
  assert.equal(c.pending().length, 1);
});

test('sources in a subfolder keep their path', async () => {
  const c = await start({ deps: repoDeps({ path: 'plugins/one' }).deps });
  const body = await (await c.submit({ repository: 'octo/plug', path: '/plugins/one/' })).json();
  assert.equal(body.listing.key, 'github.com/octo/plug/plugins/one');
  assert.equal(c.pending()[0].path, 'plugins/one');
});

test('sources that fail the check get 422 with the reason and are not queued', async () => {
  const privateRepo = mock({ 'https://api.github.com/repos/octo/plug': { status: 200, body: { private: true } } });
  const noPluginJs = repoDeps({});
  noPluginJs.routes.delete(`https://raw.githubusercontent.com/octo/plug/${COMMIT}/plugin.js`);
  const cases: [Deps, unknown, string][] = [
    [repoDeps({}).deps, { repository: 'not a repo' }, 'invalid-source'],
    [repoDeps({}).deps, { repository: 'octo/plug', path: '../up' }, 'invalid-source'],
    [mock({}).deps, { repository: 'octo/plug' }, 'repo-not-found'],
    [privateRepo.deps, { repository: 'octo/plug' }, 'repo-private'],
    [noPluginJs.deps, { repository: 'octo/plug' }, 'plugin-js-missing'],
    [repoDeps({ listingYaml: 'unknown: field\n' }).deps, { repository: 'octo/plug' }, 'listing-invalid'],
  ];
  for (const [deps, body, reason] of cases) {
    const c = await start({ deps });
    const res = await c.submit(body);
    assert.equal(res.status, 422, reason);
    assert.equal((await res.json()).reason, reason);
    assert.deepEqual(c.pending(), []);
  }
});

test('denylisted keys get 422', async () => {
  const c = await start({ denylist: 'github.com/octo/plug\n' });
  const res = await c.submit({ repository: 'octo/plug' });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).reason, 'denylisted');
  assert.deepEqual(c.pending(), []);
});

test('a GitHub rate limit is a 503, not a rejection', async () => {
  const limited = mock({ 'https://api.github.com/repos/octo/plug': { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' } } });
  const c = await start({ deps: limited.deps });
  const res = await c.submit({ repository: 'octo/plug' });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, 'rate-limited');
});

test('malformed submissions get 400 and oversize bodies are refused', async () => {
  const c = await start();
  for (const bad of ['{', '[]', {}, { repository: 42 }, { repository: '' }, { repository: 'o/r', ref: 7 }, { repository: 'x'.repeat(201) }]) {
    assert.equal((await c.submit(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await c.submit({ repository: 'octo/plug', pad: 'x'.repeat(1100) })).status, 400);
});

test('submissions have their own per-IP daily budget', async () => {
  const c = await start({ maxSubmissionsPerDay: 2 });
  assert.equal((await c.submit({ repository: 'octo/plug' })).status, 200);
  assert.equal((await c.submit({ repository: 'octo/plug' })).status, 200);
  assert.equal((await c.submit({ repository: 'octo/plug' })).status, 429);
  assert.equal((await c.ping()).status, 202);
  assert.equal((await c.ping({ key: 'github.com/octo/else' })).status, 429);
});

test('a first install of an unlisted public plugin queues the source and stores the ping', async () => {
  const c = await start();
  assert.equal((await c.ping()).status, 202);
  assert.equal(c.pending().length, 1);
  assert.equal(c.pending()[0].key, 'github.com/octo/plug');
  assert.equal(c.installs().length, 1);
  assert.equal((await c.ping()).status, 202);
  assert.equal(c.pending().length, 1);
  assert.equal(c.installs().length, 2);
  assert.equal((await c.vote()).status, 404);
});

test('an unlisted install ping with a ref checks that ref', async () => {
  const deps = mock(repoRoutes({}), () => ({ code: 0, stdout: `${COMMIT}\trefs/tags/v1.0.0\n`, stderr: '' }));
  const c = await start({ deps: deps.deps });
  assert.equal((await c.ping({ ref: 'v1.0.0' })).status, 202);
  assert.equal(c.pending()[0].ref, 'v1.0.0');
  assert.ok(deps.gitCalls.some((call) => call.args.includes('v1.0.0')));
  assert.equal((await c.ping({ key: 'github.com/octo/else', ref: 'bad ref' })).status, 400);
});

test('an unlisted install ping is refused when the check fails or the manifest id differs', async () => {
  const missing = await start({ deps: mock({}).deps });
  const res = await missing.ping();
  assert.equal(res.status, 404);
  assert.equal((await res.json()).reason, 'repo-not-found');
  assert.deepEqual(missing.installs(), []);

  const other = await start();
  const mismatch = await other.ping({ id: 'octo.other' });
  assert.equal(mismatch.status, 404);
  assert.equal((await mismatch.json()).reason, 'id-mismatch');
  assert.deepEqual(other.pending(), []);
  assert.deepEqual(other.installs(), []);

  assert.equal((await other.ping()).status, 202);
  assert.equal((await other.ping({ id: 'octo.other', installer: 'c'.repeat(64) })).status, 404);

  const denied = await start({ denylist: 'github.com/octo/plug' });
  const deniedRes = await denied.ping();
  assert.equal(deniedRes.status, 404);
  assert.equal((await deniedRes.json()).reason, 'denylisted');
  assert.deepEqual(denied.installs(), []);
});

test('unlisted install pings spend the submission budget too', async () => {
  const c = await start({ deps: mock({}).deps, maxSubmissionsPerDay: 1 });
  assert.equal((await c.ping()).status, 404);
  assert.equal((await c.ping()).status, 429);
});

test('validateSubmission and sourceFromKey', () => {
  assert.deepEqual(validateSubmission({ repository: ' octo/plug ', ref: '', path: null }), { ok: true, submission: { repository: 'octo/plug', ref: undefined, path: undefined } });
  assert.equal(validateSubmission(null).ok, false);
  assert.deepEqual(sourceFromKey('github.com/o/r/a/b'), { owner: 'o', repo: 'r', path: 'a/b' });
  assert.deepEqual(sourceFromKey('github.com/o/r'), { owner: 'o', repo: 'r', path: '' });
  assert.equal(sourceFromKey('gitlab.com/o/r'), null);
});
