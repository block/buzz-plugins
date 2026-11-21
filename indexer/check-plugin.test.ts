import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPlugin, readPluginFolder, type PluginFiles } from './check-plugin.ts';

const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: 'octo.plug', name: 'Plug', apiVersion: 1, description: 'Does a thing.', ...extra });
const plugin = (text = 'export const inject = []; export function apply() {}') => ({ text, bytes: Buffer.byteLength(text) });
const files = (overrides: Partial<PluginFiles> = {}): PluginFiles => ({ manifest: manifest(), plugin: plugin(), readme: true, uncommitted: [], ...overrides });
const levels = (input: PluginFiles) => checkPlugin(input).map((finding) => finding.level);
const details = (input: PluginFiles, level: string) => checkPlugin(input).filter((finding) => finding.level === level).map((finding) => finding.detail);

test('a committed, built, low-access plugin is ready to list', () => {
  assert.deepEqual([...new Set(levels(files()))], ['ok']);
});

test('a missing or invalid manifest stops the check', () => {
  assert.deepEqual(details(files({ manifest: undefined }), 'fail'), ['manifest.json is missing']);
  assert.equal(checkPlugin(files({ manifest: '{' })).length, 1);
  assert.match(details(files({ manifest: manifest({ id: 'Bad_Id' }) }), 'fail')[0]!, /manifest id/);
});

test('a missing or empty plugin.js fails', () => {
  assert.match(details(files({ plugin: undefined }), 'fail')[0]!, /plugin\.js is missing/);
  assert.deepEqual(details(files({ plugin: plugin('') }), 'fail'), ['plugin.js is empty']);
});

test('an invalid buzz-listing.yaml fails with each error', () => {
  assert.match(details(files({ listing: 'nope: 1\n' }), 'fail').join('\n'), /buzz-listing\.yaml/);
  assert.deepEqual(details(files({ listing: 'tagline: Short\n' }), 'fail'), []);
});

test('high access and audit flags need a maintainer but do not fail', () => {
  const high = files({ manifest: manifest({ host: { files: true } }) });
  assert.match(details(high, 'review')[0]!, /access tier is high/);
  assert.deepEqual(details(high, 'fail'), []);
  assert.match(details(files({ plugin: plugin('eval("1")') }), 'review')[0]!, /dynamic-code/);
  assert.match(details(files({ plugin: plugin('fetch("https://api.example.com/x")') }), 'review')[0]!, /undeclared-origin/);
});

test('uncommitted built files fail, and no repository is a note', () => {
  assert.match(details(files({ uncommitted: ['plugin.js'] }), 'fail')[0]!, /not committed: plugin\.js/);
  assert.match(details(files({ uncommitted: undefined }), 'note')[0]!, /not in a git repository/);
});

test('missing description and missing README are notes', () => {
  const notes = details(files({ manifest: manifest({ description: undefined }), readme: false }), 'note');
  assert.equal(notes.length, 2);
});

test('readPluginFolder reports built files that are not committed', () => {
  const folder = mkdtempSync(join(tmpdir(), 'check-plugin-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', folder, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' });
  writeFileSync(join(folder, 'manifest.json'), manifest());
  writeFileSync(join(folder, 'plugin.js'), plugin().text);
  assert.equal(readPluginFolder(folder).uncommitted, undefined);
  git('init', '-q');
  assert.deepEqual(readPluginFolder(folder).uncommitted, ['manifest.json', 'plugin.js']);
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'built');
  assert.deepEqual(readPluginFolder(folder).uncommitted, []);
  writeFileSync(join(folder, 'plugin.js'), 'changed');
  assert.deepEqual(readPluginFolder(folder).uncommitted, ['plugin.js']);
});
