import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addedLines, checkSources, formatReport, sourceFromIssue } from './check-sources.ts';
import { crawl } from './crawl.ts';
import { NOW, mock, repoRoutes } from './testkit.ts';

const BASE = '# seeds\nhttps://github.com/o/seed main\n';

test('addedLines ignores comments, spacing and lines already in the base', () => {
  assert.deepEqual(
    addedLines(BASE, `${BASE}https://github.com/octo/plug   main  # mine\n\nhttps://github.com/octo/plug main\n`),
    ['https://github.com/octo/plug main'],
  );
  assert.deepEqual(addedLines(BASE, '# only removals\n'), []);
});

test('a new public source with a built plugin passes', async () => {
  const outcome = await checkSources({ baseText: BASE, candidateText: `${BASE}https://github.com/octo/plug main\n`, deps: mock(repoRoutes()).deps, now: () => NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.checks.length, 1);
  assert.match(outcome.checks[0]!.detail, /octo\.plug/);
  assert.match(formatReport(outcome, ''), /✅/);
});

test('bad lines, duplicates, denylisted keys and missing plugins fail with a reason each', async () => {
  const routes = { ...repoRoutes({ owner: 'o', repo: 'seed' }), ...repoRoutes({ owner: 'octo', repo: 'banned' }), 'https://api.github.com/repos/octo/gone': { status: 404 } };
  const outcome = await checkSources({
    baseText: BASE,
    candidateText: `${BASE}not a source\nhttps://github.com/o/seed v2\nhttps://github.com/octo/banned main\nhttps://github.com/octo/gone main\n`,
    denylistText: 'github.com/octo/banned\n',
    deps: mock(routes).deps,
    now: () => NOW,
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(
    outcome.checks.map((c) => c.detail.split(':')[0]),
    ['invalid-source', 'duplicate-source', 'denylisted', 'repo-not-found'],
  );
  const report = formatReport(outcome, '');
  assert.equal(report.match(/❌/g)!.length, 5);
});

test('changing an existing line re-checks it instead of calling it a duplicate', async () => {
  const outcome = await checkSources({
    baseText: 'https://github.com/octo/plug main\n',
    candidateText: 'https://github.com/octo/plug release\n',
    deps: mock(repoRoutes()).deps,
    now: () => NOW,
  });
  assert.equal(outcome.checks.length, 1);
  assert.notEqual(outcome.checks[0]!.detail.split(':')[0], 'duplicate-source');
});

test('the issue form value is read from its Source line section', () => {
  const body = '### Source line\n\nhttps://github.com/octo/plug main plugins/x\n\n### Checks\n\n- [X] built';
  assert.equal(sourceFromIssue(body), 'https://github.com/octo/plug main plugins/x');
  assert.equal(sourceFromIssue('### Source line\n\n_No response_\n'), '');
  assert.equal(sourceFromIssue('nothing here'), '');
});

test('report cells cannot break out of the table or code span', () => {
  const report = formatReport({ ok: false, checks: [{ line: 'a`b|c\nd', ok: false, detail: 'x|y' }] }, '');
  assert.match(report, /\| `a b c d` \| ❌ x y \|/);
});

test('crawl skips denylisted keys', async () => {
  const { index, report } = await crawl({
    sourcesText: 'https://github.com/octo/plug main',
    denylistText: 'GitHub.com/Octo/Plug\n',
    deps: mock(repoRoutes()).deps,
    now: () => NOW,
  });
  assert.equal(index.plugins.length, 0);
  assert.equal(report.results[0]!.reason, 'denylisted');
});
