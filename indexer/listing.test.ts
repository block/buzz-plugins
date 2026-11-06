import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseListingYaml, resolveMeta } from './listing.ts';
import { parseManifest } from './manifest.ts';
import type { Source } from './types.ts';

const source: Source = { owner: 'o', repo: 'r', ref: 'main', path: 'plugins/x' };
const commit = 'c'.repeat(40);
const manifest = (extra: object = {}) => {
  const parsed = parseManifest(JSON.stringify({ id: 'o.x', name: 'X', ...extra }));
  assert.ok('manifest' in parsed);
  return parsed.manifest;
};
const meta = (m: ReturnType<typeof manifest>, author: ReturnType<typeof ok> | null, readme = { atPath: null as string | null }) => {
  const r = resolveMeta({ manifest: m, author, readme, source, commit });
  assert.ok('meta' in r, JSON.stringify(r));
  return r.meta;
};
const ok = (text: string) => {
  const r = parseListingYaml(text);
  assert.ok('listing' in r, JSON.stringify(r));
  return r.listing;
};
const errors = (text: string) => {
  const r = parseListingYaml(text);
  assert.ok('errors' in r, 'expected errors');
  return r.errors.join('\n');
};

test('a full buzz-listing.yaml parses and resolves media to the pinned commit', () => {
  const author = ok(`
tagline: Notes, fast
description: |
  Long **markdown**
category: productivity
tags: [notes, quick]
demo:
  video: demo/demo.mp4
  poster: demo/poster.png
  screenshots:
    - { src: demo/1.png, caption: The notes page }
    - { src: "https://cdn.example.org/two.jpg" }
setup:
  - { title: Install, detail: Add it, command: buzz plugin add x }
links: { docs: "https://docs.example.org", support: "https://example.org/help" }
`);
  const m = meta(manifest({ description: 'ignored' }), author);
  assert.equal(m.tagline, 'Notes, fast');
  assert.equal(m.description, 'Long **markdown**\n');
  assert.deepEqual(m.tags, ['notes', 'quick']);
  assert.deepEqual(m.demo.video, { url: `https://raw.githubusercontent.com/o/r/${commit}/plugins/x/demo/demo.mp4`, type: 'video/mp4' });
  assert.equal(m.demo.poster?.type, 'image/png');
  assert.deepEqual(m.demo.screenshots, [
    { url: `https://raw.githubusercontent.com/o/r/${commit}/plugins/x/demo/1.png`, type: 'image/png', caption: 'The notes page' },
    { url: 'https://cdn.example.org/two.jpg', type: 'image/jpeg' },
  ]);
  assert.deepEqual(m.setup, [{ title: 'Install', detail: 'Add it', command: 'buzz plugin add x' }]);
  assert.deepEqual(m.links, { repository: 'https://github.com/o/r', docs: 'https://docs.example.org/', support: 'https://example.org/help' });
});

test('with no listing file everything falls back to the manifest and README', () => {
  const m = meta(
    manifest({ description: 'd'.repeat(150), discovery: { category: 'agents', tags: ['a', 'b'] } }),
    null,
    { atPath: 'path readme' },
  );
  assert.equal(m.tagline.length, 100);
  assert.equal(m.category, 'agents');
  assert.deepEqual(m.tags, ['a', 'b']);
  assert.equal(m.description, 'path readme');
  assert.deepEqual(m.demo, { video: null, poster: null, screenshots: [] });
  assert.deepEqual(m.setup, []);
});

test('the README at the plugin path is the description, capped at 4000 characters', () => {
  assert.equal(meta(manifest(), null, { atPath: 'z'.repeat(9000) }).description.length, 4000);
  assert.equal(meta(manifest(), null, { atPath: null }).description, '');
});

test('a manifest with no description, discovery or README still produces a listing', () => {
  const m = meta(manifest(), null);
  assert.equal(m.tagline, '');
  assert.equal(m.category, 'productivity');
  assert.deepEqual(m.tags, []);
  assert.equal(m.description, '');
});

test('manifest discovery values that are invalid fall back safely', () => {
  const m = manifest({ discovery: { category: 'nonsense', tags: ['ok', '', 'x'.repeat(40), 7, 'ok', ...Array(10).fill('t') .map((_, i) => `t${i}`)] } });
  assert.equal(m.category, 'productivity');
  assert.equal(m.tags[0], 'ok');
  assert.ok(m.tags.length <= 8);
  assert.ok(m.tags.every((t) => t.length >= 1 && t.length <= 32));
});

test('the author tagline wins over the manifest description; tags and category too', () => {
  const m = meta(manifest({ description: 'from manifest', discovery: { category: 'agents', tags: ['m'] } }), ok('tagline: mine\ncategory: communication\ntags: [t]\n'));
  assert.equal(m.tagline, 'mine');
  assert.equal(m.category, 'communication');
  assert.deepEqual(m.tags, ['t']);
});

test('unknown fields are errors at every level', () => {
  assert.match(errors('tagline: x\nauthor: me\n'), /unknown field "author"/);
  assert.match(errors('demo:\n  gif: a.gif\n'), /demo: unknown field "gif"/);
  assert.match(errors('demo:\n  screenshots:\n    - { src: a.png, alt: x }\n'), /screenshots\[0\]: unknown field "alt"/);
  assert.match(errors('setup:\n  - { title: a, step: b }\n'), /setup\[0\]: unknown field "step"/);
  assert.match(errors('links: { homepage: "https://x.org" }\n'), /links: unknown field "homepage"/);
});

test('limits and types are enforced', () => {
  assert.match(errors("tagline: ''\n"), /tagline/);
  assert.match(errors(`tagline: ${'x'.repeat(101)}\n`), /tagline/);
  assert.match(errors(`description: ${JSON.stringify('x'.repeat(4001))}\n`), /description/);
  assert.match(errors('category: games\n'), /category/);
  assert.match(errors(`tags: [${Array.from({ length: 9 }, (_, i) => `t${i}`).join(',')}]\n`), /tags/);
  assert.match(errors(`tags: [${'x'.repeat(33)}]\n`), /tags\[0\]/);
  assert.match(errors(`setup: [${Array(6).fill('{ title: a }').join(',')}]\n`), /setup/);
  assert.match(errors('setup:\n  - { detail: no title }\n'), /title/);
  assert.match(errors('links: { docs: "http://insecure.example" }\n'), /https/);
  assert.match(errors('tagline: [a]\n'), /string/);
  assert.match(errors('- just\n- a list\n'), /mapping/);
  assert.match(errors('tagline: a\ntagline: b\n'), /not valid YAML/);
  assert.match(errors('a: [unclosed\n'), /not valid YAML/);
});

test('an empty listing file is valid and changes nothing', () => {
  assert.deepEqual(ok(''), {});
  assert.deepEqual(ok('# nothing here\n'), {});
});

test('media paths cannot escape the plugin directory or use odd schemes', () => {
  for (const bad of ['../x.png', '/etc/passwd.png', 'a//b.png', 'javascript:alert(1)', 'http://x.org/a.png', 'file:///a.png', 'data:image/png;base64,AA', 'demo/a.svg', 'demo/a.exe']) {
    const r = resolveMeta({
      manifest: manifest(),
      author: ok(`demo:\n  poster: ${JSON.stringify(bad)}\n`),
      readme: { atPath: null },
      source,
      commit,
    });
    assert.ok('errors' in r, bad);
  }
  const r = resolveMeta({ manifest: manifest(), author: ok('demo:\n  video: demo/a.png\n'), readme: { atPath: null }, source, commit });
  assert.ok('errors' in r);
});

test('root-level plugins get media URLs without a path segment', () => {
  const r = resolveMeta({
    manifest: manifest(),
    author: ok('demo:\n  poster: poster.webp\n'),
    readme: { atPath: null },
    source: { ...source, path: '' },
    commit,
  });
  assert.ok('meta' in r);
  assert.equal(r.meta.demo.poster?.url, `https://raw.githubusercontent.com/o/r/${commit}/poster.webp`);
});
