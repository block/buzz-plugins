import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addSource } from './add.ts';
import { buildListing } from './build.ts';
import { crawl, isTransientOutage } from './crawl.ts';
import { validateIndex } from './schema.ts';
import { COMMIT, NOW, mock, repoRoutes } from './testkit.ts';
import type { Listing } from './types.ts';

const ctx = (previous: Listing[] = [], cleared = '') => ({
  now: () => NOW,
  previous: new Map(previous.map((p) => [p.key, p])),
  cleared: new Set(cleared ? [cleared] : []),
});

test('buildListing assembles the spec shape for a root plugin', async () => {
  const m = mock(
    repoRoutes({
      manifest: { id: 'octo.plug', name: 'Plug', description: 'Does a thing.', discovery: { category: 'agents', tags: ['x'] }, host: { networkOrigins: ['https://api.github.com'] } },
      readme: '# Plug\nreadme text',
      pluginJs: 'fetch("https://api.github.com/x")',
      stars: 12,
    }),
  );
  const r = await buildListing(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx());
  assert.ok(r.ok);
  const l = r.listing;
  assert.equal(l.key, 'github.com/octo/plug');
  assert.equal(l.slug, 'github-com--octo--plug');
  assert.equal(l.id, 'octo.plug');
  assert.equal(l.tagline, 'Does a thing.');
  assert.equal(l.description, '# Plug\nreadme text');
  assert.equal(l.category, 'agents');
  assert.deepEqual(l.author, { github: 'octo' });
  assert.equal(l.official, false);
  assert.deepEqual(l.source, { repository: 'https://github.com/octo/plug', ref: 'main', commit: COMMIT, path: '' });
  assert.deepEqual(l.host.networkOrigins, ['https://api.github.com']);
  assert.equal(l.audit.tier, 'medium');
  assert.equal(l.audit.cleared, true);
  assert.equal(l.audit.accessChanged, false);
  assert.equal(l.audit.checkedAt, '2026-11-05T23:00:00Z');
  assert.equal(l.stars, 12);
  assert.equal(l.updatedAt, '2026-11-04T10:20:30Z');
  assert.deepEqual(validateIndex({ schemaVersion: 1, generatedAt: '2026-11-05T23:00:00Z', mediaPolicy: 'm', plugins: [l] }), []);
});

test('official is true for the block owner in any case', async () => {
  const m = mock(repoRoutes({ owner: 'Block', repo: 'app' }));
  const r = await buildListing(m.deps, { owner: 'Block', repo: 'app', ref: 'main' }, ctx());
  assert.ok(r.ok);
  assert.equal(r.listing.official, true);
});

test('process and command entries become display strings', async () => {
  const manifest = {
    id: 'octo.plug',
    host: {
      processes: [{ id: 'sync', program: 'my-cli', args: ['sync'] }],
      commands: [{ id: 'copy', program: 'pbcopy' }],
      files: true,
      mcp: false,
    },
  };
  const r = await buildListing(mock(repoRoutes({ manifest })).deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx());
  assert.ok(r.ok);
  assert.deepEqual(r.listing.host, { networkOrigins: [], processes: ['my-cli sync'], commands: ['pbcopy'], files: true, mcp: false, agentHooks: false });
  assert.equal(r.listing.audit.tier, 'high');
  assert.equal(r.listing.audit.cleared, false);
});

test('a high-tier plugin is cleared when cleared.txt names its commit', async () => {
  const manifest = { id: 'octo.plug', host: { mcp: true } };
  const r = await buildListing(mock(repoRoutes({ manifest })).deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx([], `github.com/octo/plug ${COMMIT}`));
  assert.ok(r.ok);
  assert.equal(r.listing.audit.cleared, true);
});

test('accessChanged is computed against the previous index pin', async () => {
  const first = await buildListing(mock(repoRoutes()).deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx());
  assert.ok(first.ok);
  const manifest = { id: 'octo.plug', host: { networkOrigins: ['https://new.example.com'] } };
  const second = await buildListing(mock(repoRoutes({ manifest })).deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx([first.listing]));
  assert.ok(second.ok);
  assert.equal(second.listing.audit.accessChanged, true);
  const third = await buildListing(mock(repoRoutes({ manifest })).deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx([second.listing]));
  assert.ok(third.ok);
  assert.equal(third.listing.audit.accessChanged, false);
});

test('subdirectory plugins use only the plugin README, with a path in the key', async () => {
  const withBoth = mock(repoRoutes({ owner: 'block', repo: 'app', path: 'examples/x', readme: 'plugin readme', rootReadme: 'root readme' }));
  const a = await buildListing(withBoth.deps, { owner: 'block', repo: 'app', ref: 'main', path: 'examples/x' }, ctx());
  assert.ok(a.ok);
  assert.equal(a.listing.key, 'github.com/block/app/examples/x');
  assert.equal(a.listing.slug, 'github-com--block--app--examples--x');
  assert.equal(a.listing.source.path, 'examples/x');
  assert.equal(a.listing.description, 'plugin readme');

  const rootOnly = mock(repoRoutes({ owner: 'block', repo: 'app', path: 'examples/x', rootReadme: 'root readme' }));
  const b = await buildListing(rootOnly.deps, { owner: 'block', repo: 'app', ref: 'main', path: 'examples/x' }, ctx());
  assert.ok(b.ok);
  assert.equal(b.listing.description, '');

  const none = mock(repoRoutes({ owner: 'block', repo: 'app', path: 'examples/x', manifest: { id: 'example.x', name: 'X', apiVersion: 1 } }));
  const c = await buildListing(none.deps, { owner: 'block', repo: 'app', ref: 'main', path: 'examples/x' }, ctx());
  assert.ok(c.ok);
  assert.equal(c.listing.description, '');
  assert.equal(c.listing.tagline, '');
  assert.equal(c.listing.category, 'productivity');
});

test('an author description skips the README fetch entirely', async () => {
  const m = mock(repoRoutes({ listingYaml: 'description: hello\n', readme: 'ignored' }));
  const r = await buildListing(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx());
  assert.ok(r.ok);
  assert.equal(r.listing.description, 'hello');
  assert.ok(!m.fetchCalls.some((c) => c.url.endsWith('README.md')));
});

test('an invalid buzz-listing.yaml rejects the listing with the reason', async () => {
  const m = mock(repoRoutes({ listingYaml: 'tagline: ok\nsurprise: yes\n' }));
  const r = await buildListing(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx());
  assert.ok(!r.ok);
  assert.equal(r.reason, 'listing-invalid');
  assert.match(r.detail, /surprise/);
});

test('a failing commit lookup rejects the listing instead of inventing a date', async () => {
  const routes = repoRoutes();
  delete routes[`https://api.github.com/repos/octo/plug/commits/${COMMIT}`];
  const r = await buildListing(mock(routes).deps, { owner: 'octo', repo: 'plug', ref: 'main' }, ctx());
  assert.ok(!r.ok);
  assert.equal(r.reason, 'http-error');
});

test('crawl lists good sources, rejects bad ones with reasons, and detects duplicates and slug collisions', async () => {
  const good = repoRoutes({ owner: 'octo', repo: 'plug' });
  const priv = repoRoutes({ owner: 'octo', repo: 'secret' });
  priv['https://api.github.com/repos/octo/secret'] = { status: 404 };
  const noManifest = repoRoutes({ owner: 'octo', repo: 'empty' });
  delete noManifest[`https://raw.githubusercontent.com/octo/empty/${COMMIT}/manifest.json`];
  const collide1 = repoRoutes({ owner: 'o', repo: 'a.b', manifest: { id: 'o.one' } });
  const collide2 = repoRoutes({ owner: 'o', repo: 'a-b', manifest: { id: 'o.two' } });
  const m = mock({ ...good, ...priv, ...noManifest, ...collide1, ...collide2 });

  const sources = [
    'https://github.com/octo/plug main',
    'https://github.com/octo/secret main',
    'https://github.com/octo/empty main',
    'https://github.com/OCTO/plug main',
    'https://github.com/o/a.b main',
    'https://github.com/o/a-b main',
    'not a source',
  ].join('\n');
  const { index, report } = await crawl({ sourcesText: sources, deps: m.deps, now: () => NOW });

  assert.deepEqual(index.plugins.map((p) => p.key), ['github.com/o/a.b', 'github.com/octo/plug']);
  assert.deepEqual(validateIndex(index), []);
  assert.equal(report.summary.sources, 7);
  assert.equal(report.summary.listed, 2);
  assert.equal(report.summary.rejected, 5);
  assert.deepEqual(report.summary.byReason, {
    'repo-not-found': 1,
    'manifest-missing': 1,
    'duplicate-source': 1,
    'slug-collision': 1,
    'invalid-source': 1,
  });
  assert.equal(report.results[0]!.status, 'listed');
  assert.equal(report.results[1]!.reason, 'repo-not-found');
});

test('crawl uses the previous index for accessChanged and cleared.txt for clearing', async () => {
  const manifest = { id: 'octo.plug', host: { commands: [{ id: 'c', program: 'tool' }] } };
  const m = () => mock(repoRoutes({ manifest }));
  const src = 'https://github.com/octo/plug main';
  const first = await crawl({ sourcesText: src, deps: m().deps, now: () => NOW });
  assert.equal(first.index.plugins[0]!.audit.cleared, false);
  assert.equal(first.report.results[0]!.cleared, false);
  const second = await crawl({
    sourcesText: src,
    clearedText: `github.com/octo/plug ${COMMIT}\n`,
    previous: { plugins: first.index.plugins.map((p) => ({ ...p, host: { ...p.host, commands: [] } })) },
    deps: m().deps,
    now: () => NOW,
  });
  assert.equal(second.index.plugins[0]!.audit.cleared, true);
  assert.equal(second.index.plugins[0]!.audit.accessChanged, true);
});

test('add appends a passing source and refuses duplicates, private repos and denylisted keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'add-'));
  const sources = join(dir, 'sources.txt');
  const denylist = join(dir, 'denylist.txt');
  writeFileSync(sources, '# seeds\nhttps://github.com/o/seed main');
  writeFileSync(denylist, 'github.com/octo/banned\n');

  const ok = await addSource(mock(repoRoutes()).deps, { repository: 'octo/plug' }, { sources, denylist });
  assert.ok(ok.ok);
  assert.equal(ok.line, 'https://github.com/octo/plug main');
  assert.equal(readFileSync(sources, 'utf8'), '# seeds\nhttps://github.com/o/seed main\nhttps://github.com/octo/plug main\n');

  const dup = await addSource(mock(repoRoutes()).deps, { repository: 'https://github.com/octo/plug', ref: 'main' }, { sources, denylist });
  assert.ok(!dup.ok);
  assert.equal(dup.reason, 'duplicate-source');

  const priv = repoRoutes({ owner: 'octo', repo: 'hidden' });
  priv['https://api.github.com/repos/octo/hidden'] = { status: 200, body: { private: true } };
  const refused = await addSource(mock(priv).deps, { repository: 'octo/hidden', ref: 'main' }, { sources, denylist });
  assert.ok(!refused.ok);
  assert.equal(refused.reason, 'repo-private');

  const banned = await addSource(mock(repoRoutes({ owner: 'octo', repo: 'banned' })).deps, { repository: 'octo/banned', ref: 'main' }, { sources, denylist });
  assert.ok(!banned.ok);
  assert.equal(banned.reason, 'denylisted');

  const bad = await addSource(mock({}).deps, { repository: 'nonsense' }, { sources, denylist });
  assert.ok(!bad.ok);
  assert.equal(readFileSync(sources, 'utf8').split('\n').filter(Boolean).length, 3);

  const sub = await addSource(mock(repoRoutes({ owner: 'octo', repo: 'mono', path: 'p/q' })).deps, { repository: 'octo/mono', ref: 'main', path: 'p/q' }, { sources, denylist });
  assert.ok(sub.ok);
  assert.ok(readFileSync(sources, 'utf8').endsWith('https://github.com/octo/mono main p/q\n'));
});

test('a crawl where every source hit a rate limit is flagged as an outage so listings are not blanked', async () => {
  const limited = { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '3000' } };
  const m = mock({ 'https://api.github.com/repos/octo/plug': limited });
  const out = await crawl({ sourcesText: 'https://github.com/octo/plug main', deps: m.deps, now: () => NOW });
  assert.equal(out.report.results[0]!.reason, 'rate-limited');
  assert.equal(isTransientOutage(out.report), true);

  const ok = await crawl({ sourcesText: 'https://github.com/octo/plug main\nhttps://github.com/octo/gone main', deps: mock({ ...repoRoutes(), 'https://api.github.com/repos/octo/gone': { status: 404 } }).deps, now: () => NOW });
  assert.equal(isTransientOutage(ok.report), false);
  const permanent = await crawl({ sourcesText: 'https://github.com/octo/gone main', deps: mock({ 'https://api.github.com/repos/octo/gone': { status: 404 } }).deps, now: () => NOW });
  assert.equal(isTransientOutage(permanent.report), false);
});
