import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergePending, parsePending } from './pending.ts';

const row = (extra: Record<string, unknown>) => JSON.stringify({ ts: '2026-11-05T12:00:00.000Z', key: 'github.com/octo/plug', id: 'octo.plug', repository: 'https://github.com/octo/plug', ref: 'main', path: '', commit: 'a'.repeat(40), ...extra });

test('pending sources are appended after sources.txt, deduplicated and denylist-filtered', () => {
  const sources = 'https://github.com/block/buzz-app main examples/plugins/counter\n';
  const pending = [
    row({}),
    row({ repository: 'https://github.com/OCTO/plug' }),
    row({ key: 'github.com/block/buzz-app/examples/plugins/counter', repository: 'https://github.com/block/buzz-app', path: 'examples/plugins/counter', ref: 'other' }),
    row({ key: 'github.com/bad/one', repository: 'https://github.com/bad/one' }),
    row({ key: 'github.com/octo/sub/a', repository: 'https://github.com/octo/sub', path: 'a', ref: 'v1' }),
    '{broken',
    row({ ref: '../x', repository: 'https://github.com/octo/badref' }),
  ].join('\n');
  const merged = mergePending(sources, pending, 'github.com/bad/one\n');
  assert.equal(merged.added, 2);
  assert.equal(merged.text, `${sources}https://github.com/octo/plug main\nhttps://github.com/octo/sub v1 a\n`);
});

test('no pending sources leaves sources.txt as it is', () => {
  assert.deepEqual(mergePending('x', ''), { text: 'x', added: 0 });
  assert.equal(mergePending('https://github.com/a/b main', row({})).text, 'https://github.com/a/b main\nhttps://github.com/octo/plug main\n');
  assert.equal(parsePending('\n{"key":1}\n').length, 0);
});
