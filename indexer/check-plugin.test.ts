import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPlugin, readPluginFolder, type PluginFiles } from './check-plugin.ts';
import { MAX_MANIFEST_BYTES } from './publicity.ts';

const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: 'octo.plug', name: 'Plug', apiVersion: 1, description: 'Does a thing.', ...extra });
const plugin = (text = 'export const inject = []; export function apply() {}') => ({ text, bytes: Buffer.byteLength(text) });
const files = (overrides: Partial<PluginFiles> = {}): PluginFiles => ({ manifest: manifest(), plugin: plugin(), readme: true, uncommitted: [], unpushed: 0, ...overrides });
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

test('an oversize manifest and a manifest without apiVersion 1 fail', () => {
  assert.match(details(files({ manifest: manifest({ pad: 'x'.repeat(MAX_MANIFEST_BYTES) }) }), 'fail')[0]!, /larger than/);
  assert.deepEqual(details(files({ manifest: manifest({ apiVersion: undefined }) }), 'fail'), ['manifest.json needs "apiVersion": 1']);
  assert.deepEqual(details(files({ manifest: manifest({ apiVersion: 2 }) }), 'fail'), ['manifest.json needs "apiVersion": 1']);
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

test('commits that are not pushed fail, and no upstream is a note', () => {
  assert.match(details(files({ unpushed: 2 }), 'fail')[0]!, /2 commits are not pushed/);
  assert.match(details(files({ unpushed: undefined }), 'note')[0]!, /no upstream/);
});

test('missing description and missing README are notes', () => {
  const notes = details(files({ manifest: manifest({ description: undefined }), readme: false }), 'note');
  assert.equal(notes.length, 2);
});

function repository() {
  const folder = mkdtempSync(join(tmpdir(), 'check-plugin-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', folder, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' });
  const write = (name: string, text: string) => writeFileSync(join(folder, name), text);
  write('manifest.json', manifest());
  write('plugin.js', plugin().text);
  return { folder, git, write };
}
const commit = (git: (...args: string[]) => void) => {
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'built');
};

test('readPluginFolder reports built files that are not committed', () => {
  const { folder, git, write } = repository();
  assert.equal(readPluginFolder(folder).uncommitted, undefined);
  git('init', '-q');
  assert.deepEqual(readPluginFolder(folder).uncommitted, ['manifest.json', 'plugin.js']);
  commit(git);
  assert.deepEqual(readPluginFolder(folder).uncommitted, []);
  write('plugin.js', 'changed');
  assert.deepEqual(readPluginFolder(folder).uncommitted, ['plugin.js']);
});

test('a gitignored plugin.js counts as not committed', () => {
  const { folder, git, write } = repository();
  git('init', '-q');
  write('.gitignore', 'plugin.js\n');
  commit(git);
  assert.deepEqual(readPluginFolder(folder).uncommitted, ['plugin.js']);
  assert.match(details(readPluginFolder(folder), 'fail')[0]!, /not committed: plugin\.js/);
});

test('readPluginFolder counts commits the upstream lacks', () => {
  const { folder, git, write } = repository();
  git('init', '-q', '-b', 'main');
  commit(git);
  assert.equal(readPluginFolder(folder).unpushed, undefined);
  const remote = mkdtempSync(join(tmpdir(), 'check-plugin-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote]);
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '--no-verify', '-u', 'origin', 'main');
  assert.equal(readPluginFolder(folder).unpushed, 0);
  write('plugin.js', 'next');
  commit(git);
  assert.equal(readPluginFolder(folder).unpushed, 1);
});

test('the command exits 0 when a plugin can be listed and 1 when it cannot', () => {
  const run = (folder: string) => spawnSync(process.execPath, ['--experimental-strip-types', join(import.meta.dirname, 'check-plugin.ts'), folder], { encoding: 'utf8' });
  const { folder, git } = repository();
  const listable = run(folder);
  assert.equal(listable.status, 0, listable.stdout);
  assert.match(listable.stdout, /Ready to list/);
  git('init', '-q');
  const uncommitted = run(folder);
  assert.equal(uncommitted.status, 1);
  assert.match(uncommitted.stdout, /FAIL {4}not committed/);
});
