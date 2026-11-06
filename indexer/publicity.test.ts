import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GIT_ANON_ARGS, cleanEnv, realDeps } from './net.ts';
import { checkPublic, parseLsRemote } from './publicity.ts';
import { COMMIT, mock, repoRoutes } from './testkit.ts';

const API = 'https://api.github.com/repos/octo/plug';
const RAW = `https://raw.githubusercontent.com/octo/plug/${COMMIT}`;

test('a public repository with manifest and plugin.js passes', async () => {
  const m = mock(repoRoutes());
  const result = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(result.ok);
  assert.equal(result.commit, COMMIT);
  assert.equal(result.manifest.id, 'octo.plug');
  assert.equal(result.repo.stars, 7);
});

test('no request carries credentials and git runs with a scrubbed environment', async () => {
  const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
  process.env.GITHUB_TOKEN = 'ghp_secret';
  process.env.GH_TOKEN = 'ghp_secret2';
  try {
    const m = mock(repoRoutes());
    const result = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
    assert.ok(result.ok);
    assert.ok(m.fetchCalls.length === 3);
    for (const call of m.fetchCalls) {
      const names = Object.keys(call.headers).map((h) => h.toLowerCase());
      assert.ok(!names.includes('authorization'), call.url);
      assert.ok(!names.includes('cookie'), call.url);
    }
    assert.equal(m.gitCalls.length, 1);
    const { args, env } = m.gitCalls[0]!;
    assert.deepEqual(args.slice(0, 2), ['-c', 'credential.helper=']);
    assert.deepEqual(args.slice(0, GIT_ANON_ARGS.length), GIT_ANON_ARGS);
    assert.deepEqual(args.slice(GIT_ANON_ARGS.length), ['ls-remote', 'https://github.com/octo/plug.git', 'main']);
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GH_TOKEN, undefined);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('cleanEnv drops tokens and unknown variables', () => {
  const env = cleanEnv({ PATH: '/bin', GITHUB_TOKEN: 'x', GH_TOKEN: 'y', GH_ENTERPRISE_TOKEN: 'z', HOME: '/home/u', SSH_AUTH_SOCK: 's' });
  assert.deepEqual(Object.keys(env).sort(), ['GCM_INTERACTIVE', 'GIT_ASKPASS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'PATH']);
});

test('the real fetch wrapper refuses an Authorization header', () => {
  const deps = realDeps();
  assert.throws(() => deps.fetch('https://example.invalid/', { headers: { Authorization: 'Bearer x' } }), /refusing/);
  assert.throws(() => deps.fetch('https://example.invalid/', { headers: { cookie: 'a=b' } }), /refusing/);
});

test('private repositories are rejected, including ones that 404 anonymously', async () => {
  const flagged = mock({ ...repoRoutes(), [API]: { status: 200, body: { private: true } } });
  const r1 = await checkPublic(flagged.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r1.ok);
  assert.equal(r1.reason, 'repo-private');
  assert.equal(flagged.gitCalls.length, 0);

  const hidden = mock({ ...repoRoutes(), [API]: { status: 404, body: { message: 'Not Found' } } });
  const r2 = await checkPublic(hidden.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r2.ok);
  assert.equal(r2.reason, 'repo-not-found');
  assert.equal(hidden.gitCalls.length, 0);
});

test('a missing "private" field is not treated as public', async () => {
  const m = mock({ ...repoRoutes(), [API]: { status: 200, body: { name: 'plug' } } });
  const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r.ok);
  assert.equal(r.reason, 'repo-private');
});

test('rate limiting waits a short while, then retries unauthenticated', async () => {
  const m = mock({
    ...repoRoutes(),
    [API]: [
      { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '2' }, body: { message: 'API rate limit exceeded' } },
      { status: 200, body: { private: false, stargazers_count: 1, default_branch: 'main' } },
    ],
  });
  const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(r.ok);
  assert.deepEqual(m.sleeps, [2000]);
  assert.ok(m.fetchCalls.every((c) => !('authorization' in c.headers)));
});

test('a long rate limit is reported, not waited out, and never falls back to credentials', async () => {
  const reset = String(Math.floor(Date.now() / 1000) + 3000);
  const m = mock({
    ...repoRoutes(),
    [API]: { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }, body: { message: 'API rate limit exceeded' } },
  });
  const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r.ok);
  assert.equal(r.reason, 'rate-limited');
  assert.deepEqual(m.sleeps, []);
  assert.equal(m.fetchCalls.length, 1);
  assert.equal(m.gitCalls.length, 0);
});

test('429 from the raw host is a rate limit too', async () => {
  const m = mock({ ...repoRoutes(), [`${RAW}/manifest.json`]: { status: 429, headers: { 'retry-after': '900' } } });
  const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r.ok);
  assert.equal(r.reason, 'rate-limited');
});

test('a 403 that is not a rate limit is an error, not a retry', async () => {
  const m = mock({ ...repoRoutes(), [API]: { status: 403, body: { message: 'Repository access blocked' } } });
  const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r.ok);
  assert.equal(r.reason, 'http-error');
  assert.equal(m.fetchCalls.length, 1);
});

test('server errors and network failures are retried then reported', async () => {
  const m = mock({ ...repoRoutes(), [API]: new Error('socket hang up') });
  const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r.ok);
  assert.equal(r.reason, 'network-error');
  assert.equal(m.fetchCalls.length, 3);
});

test('refs: unresolved, commit shas, and git credential demands', async () => {
  const empty = mock(repoRoutes(), () => ({ code: 0, stdout: '', stderr: '' }));
  const r1 = await checkPublic(empty.deps, { owner: 'octo', repo: 'plug', ref: 'nope' });
  assert.ok(!r1.ok);
  assert.equal(r1.reason, 'ref-unresolved');

  const sha = mock(repoRoutes(), () => ({ code: 0, stdout: '', stderr: '' }));
  const r2 = await checkPublic(sha.deps, { owner: 'octo', repo: 'plug', ref: COMMIT });
  assert.ok(!r2.ok);
  assert.equal(r2.reason, 'ref-unresolved');

  const auth = mock(repoRoutes(), () => ({ code: 128, stdout: '', stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" }));
  const r3 = await checkPublic(auth.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r3.ok);
  assert.equal(r3.reason, 'git-unauthenticated');

  const broken = mock(repoRoutes(), () => ({ code: 128, stdout: '', stderr: 'fatal: unable to access' }));
  const r4 = await checkPublic(broken.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r4.ok);
  assert.equal(r4.reason, 'git-failed');
});

test('ls-remote parsing prefers branches, peels annotated tags and ignores suffix matches', () => {
  const sha = (c: string) => c.repeat(40);
  const out = [
    `${sha('1')}\trefs/heads/feature/main`,
    `${sha('2')}\trefs/heads/main`,
    `${sha('3')}\trefs/tags/v1`,
    `${sha('4')}\trefs/tags/v1^{}`,
    `${sha('5')}\tHEAD`,
  ].join('\n');
  assert.equal(parseLsRemote(out, 'main'), sha('2'));
  assert.equal(parseLsRemote(out, 'v1'), sha('4'));
  assert.equal(parseLsRemote(out, 'HEAD'), sha('5'));
  assert.equal(parseLsRemote(`${sha('1')}\trefs/heads/feature/main`, 'main'), null);
  assert.equal(parseLsRemote('not-a-sha\trefs/heads/main', 'main'), null);
});

test('an omitted ref resolves to the default branch', async () => {
  const m = mock(repoRoutes());
  const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug' });
  assert.ok(r.ok);
  assert.equal(r.source.ref, 'main');
  assert.equal(m.gitCalls[0]!.args.at(-1), 'main');
});

test('missing manifest.json or plugin.js fails the check', async () => {
  const routes = repoRoutes();
  delete routes[`${RAW}/manifest.json`];
  const r1 = await checkPublic(mock(routes).deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r1.ok);
  assert.equal(r1.reason, 'manifest-missing');

  const routes2 = repoRoutes();
  delete routes2[`${RAW}/plugin.js`];
  const r2 = await checkPublic(mock(routes2).deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r2.ok);
  assert.equal(r2.reason, 'plugin-js-missing');
});

test('manifest must parse and carry a valid id', async () => {
  const bad = mock({ ...repoRoutes(), [`${RAW}/manifest.json`]: { status: 200, body: '{nope' } });
  const r1 = await checkPublic(bad.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(!r1.ok);
  assert.equal(r1.reason, 'manifest-invalid');

  for (const id of ['Bad.Id', '1abc', '', 'a'.repeat(81), 'has space', 42, undefined]) {
    const m = mock(repoRoutes({ manifest: { id, name: 'X' } }));
    const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main' });
    assert.ok(!r.ok, String(id));
    assert.equal(r.reason, 'manifest-id-invalid');
  }
  const ok = await checkPublic(mock(repoRoutes({ manifest: { id: 'a'.repeat(80) } })).deps, { owner: 'octo', repo: 'plug', ref: 'main' });
  assert.ok(ok.ok);
});

test('plugins in subdirectories are fetched from the pinned commit and path', async () => {
  const m = mock(repoRoutes({ path: 'examples/plugins/x' }));
  const r = await checkPublic(m.deps, { owner: 'octo', repo: 'plug', ref: 'main', path: '/examples/plugins/x/' });
  assert.ok(r.ok);
  assert.equal(r.source.path, 'examples/plugins/x');
});

test('hostile owner, repo, ref or path values never reach the network', async () => {
  const inputs = [
    { owner: 'a/b', repo: 'r', ref: 'main' },
    { owner: 'o', repo: '..', ref: 'main' },
    { owner: 'o', repo: 'r', ref: '--upload-pack=evil' },
    { owner: 'o', repo: 'r', ref: 'main..x' },
    { owner: 'o', repo: 'r', ref: 'main', path: '../etc' },
    { owner: 'o', repo: 'r', ref: 'main', path: 'a/./b' },
    { owner: 'o', repo: 'r', ref: 'main', path: 'a b' },
  ];
  for (const input of inputs) {
    const m = mock({});
    const r = await checkPublic(m.deps, input);
    assert.ok(!r.ok, JSON.stringify(input));
    assert.equal(r.reason, 'invalid-source');
    assert.equal(m.fetchCalls.length, 0);
    assert.equal(m.gitCalls.length, 0);
  }
});
