import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listingKey, normalizePath, slugify } from './slug.ts';
import { formatSource, isCleared, parseCleared, parseSources } from './sources.ts';

test('listing keys include the path only when the plugin is not at the root', () => {
  assert.equal(listingKey({ owner: 'o', repo: 'r', path: '' }), 'github.com/o/r');
  assert.equal(listingKey({ owner: 'block', repo: 'buzz-app', path: 'examples/plugins/counter' }), 'github.com/block/buzz-app/examples/plugins/counter');
});

test('slugs lowercase, turn / into --, and replace everything else outside [a-z0-9-]', () => {
  assert.equal(slugify('github.com/nickhenggeler/buzz-projects-plugin'), 'github-com--nickhenggeler--buzz-projects-plugin');
  assert.equal(slugify('github.com/Block/Buzz_App/Examples/My.Plugin'), 'github-com--block--buzz-app--examples--my-plugin');
  assert.equal(slugify('github.com/o/r/a_b.c'), 'github-com--o--r--a-b-c');
});

test('slugs are capped at 120 characters and stay URL-safe', () => {
  const slug = slugify(`github.com/o/r/${'x'.repeat(300)}`);
  assert.equal(slug.length, 120);
  assert.match(slug, /^[a-z0-9-]+$/);
});

test('paths are normalized and traversal is rejected', () => {
  assert.equal(normalizePath(''), '');
  assert.equal(normalizePath('/a/b/'), 'a/b');
  assert.equal(normalizePath('a//b'), null);
  assert.equal(normalizePath('..'), null);
  assert.equal(normalizePath('a/../b'), null);
  assert.equal(normalizePath('a b'), null);
});

test('sources.txt lines parse, comments are skipped and bad lines are reported', () => {
  const parsed = parseSources(
    [
      '# seeds',
      'https://github.com/o/r main',
      'https://github.com/o/r.git v1 sub/dir  # trailing',
      'o/short main',
      'https://example.com/o/r main',
      'https://github.com/o/r',
      '',
    ].join('\n'),
  );
  assert.equal(parsed.length, 5);
  assert.deepEqual(parsed[0]!.source, { owner: 'o', repo: 'r', ref: 'main', path: '' });
  assert.deepEqual(parsed[1]!.source, { owner: 'o', repo: 'r', ref: 'v1', path: 'sub/dir' });
  assert.deepEqual(parsed[2]!.source, { owner: 'o', repo: 'short', ref: 'main', path: '' });
  assert.ok(parsed[3]!.error);
  assert.ok(parsed[4]!.error);
  assert.equal(formatSource(parsed[1]!.source!), 'https://github.com/o/r v1 sub/dir');
});

test('cleared.txt matches on key and commit, case-insensitively, ignoring comments', () => {
  const commit = 'b'.repeat(40);
  const cleared = parseCleared(`# maintainers\ngithub.com/O/R ${commit.toUpperCase()}\ngithub.com/o/bad nothex\n`);
  assert.ok(isCleared(cleared, 'github.com/o/r', commit));
  assert.ok(!isCleared(cleared, 'github.com/o/r', 'c'.repeat(40)));
  assert.ok(!isCleared(cleared, 'github.com/o/bad', commit));
});
