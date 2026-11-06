import { isCleared } from './sources.ts';
import type { Audit, Flag, Host, Tier } from './types.ts';

export const SIZE_LIMIT_BYTES = 3 * 1024 * 1024;
const LONG_LINE = 5000;
const ESCAPE_RATIO = 0.3;
const BASE64_RUN = 20 * 1024;

const IGNORED_HOSTS = new Set([
  'github.com',
  'www.w3.org',
  'json-schema.org',
  'schemas.xmlsoap.org',
  'schemas.openxmlformats.org',
  'schemas.microsoft.com',
  'purl.org',
  'ns.adobe.com',
  'xmlns.com',
  'www.sitemaps.org',
]);

export function tierOf(host: Host): Tier {
  if (host.processes.length > 0 || host.commands.length > 0 || host.files || host.mcp || host.agentHooks) return 'high';
  return host.networkOrigins.length > 0 ? 'medium' : 'low';
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

function scanDynamicCode(text: string): Flag | null {
  const patterns: [string, RegExp][] = [
    ['eval(', /\beval\s*\(/g],
    ['new Function(', /\bnew\s+Function\s*\(/g],
    ['setTimeout with a string', /\bsetTimeout\s*\(\s*["'`]/g],
    ['setInterval with a string', /\bsetInterval\s*\(\s*["'`]/g],
  ];
  const found: string[] = [];
  for (const [label, re] of patterns) {
    const matches = [...text.matchAll(re)];
    if (matches.length > 0) found.push(`${label} at line ${lineOf(text, matches[0]!.index)}${matches.length > 1 ? ` (+${matches.length - 1} more)` : ''}`);
  }
  return found.length > 0 ? { code: 'dynamic-code', detail: found.join('; ') } : null;
}

function scanObfuscated(text: string): Flag | null {
  const escape = /\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]{1,6}\}/g;
  let lineNo = 0;
  for (const line of text.split('\n')) {
    lineNo++;
    if (line.length <= LONG_LINE) continue;
    let covered = 0;
    for (const m of line.matchAll(escape)) covered += m[0].length;
    if (covered / line.length > ESCAPE_RATIO) {
      return {
        code: 'obfuscated',
        detail: `line ${lineNo} is ${line.length} characters and ${Math.round((covered / line.length) * 100)}% escape sequences`,
      };
    }
  }
  const blob = new RegExp(`[A-Za-z0-9+/]{${BASE64_RUN + 1},}`).exec(text);
  if (blob) return { code: 'obfuscated', detail: `base64-like blob of ${blob[0].length} characters at line ${lineOf(text, blob.index)}` };
  return null;
}

function scanOrigins(text: string, declaredOrigins: string[]): Flag | null {
  const allowed = new Set<string>();
  for (const origin of declaredOrigins) {
    try {
      allowed.add(new URL(origin).origin);
    } catch {
      allowed.add(origin);
    }
  }
  const undeclared = new Set<string>();
  for (const m of text.matchAll(/https:\/\/[^\s"'`<>()\\{}^|[\]]+/g)) {
    let url: URL;
    try {
      url = new URL(m[0]);
    } catch {
      continue;
    }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname) && url.hostname !== 'localhost') continue;
    if (IGNORED_HOSTS.has(url.hostname) || allowed.has(url.origin)) continue;
    undeclared.add(url.origin);
  }
  if (undeclared.size === 0) return null;
  const list = [...undeclared].sort();
  const shown = list.slice(0, 5).join(', ');
  return { code: 'undeclared-origin', detail: `${shown}${list.length > 5 ? ` (+${list.length - 5} more)` : ''}` };
}

export function scanPlugin(input: { text: string; bytes: number; truncated: boolean }, host: Host): Flag[] {
  const flags: Flag[] = [];
  const add = (flag: Flag | null) => flag && flags.push(flag);
  add(scanDynamicCode(input.text));
  add(scanObfuscated(input.text));
  add(scanOrigins(input.text, host.networkOrigins));
  if (input.bytes > SIZE_LIMIT_BYTES) {
    const size = input.truncated ? `more than ${(input.bytes / 1024 / 1024).toFixed(0)} MiB` : `${(input.bytes / 1024 / 1024).toFixed(2)} MiB`;
    flags.push({ code: 'size', detail: `plugin.js is ${size}; the limit is 3 MiB` });
  }
  return flags;
}

function canonicalHost(host: Host): string {
  const sorted = (list: string[]) => [...list].sort();
  return JSON.stringify({
    networkOrigins: sorted(host.networkOrigins),
    processes: sorted(host.processes),
    commands: sorted(host.commands),
    files: host.files,
    mcp: host.mcp,
    agentHooks: host.agentHooks,
  });
}

export function accessChanged(current: Host, previous: Host | undefined): boolean {
  return previous !== undefined && canonicalHost(current) !== canonicalHost(previous);
}

export function audit(input: {
  key: string;
  commit: string;
  host: Host;
  plugin: { text: string; bytes: number; truncated: boolean };
  previousHost?: Host;
  cleared: Set<string>;
  checkedAt: string;
}): Audit {
  const tier = tierOf(input.host);
  const flags = scanPlugin(input.plugin, input.host);
  const needsClearing = tier === 'high' || flags.length > 0;
  return {
    tier,
    flags,
    accessChanged: accessChanged(input.host, input.previousHost),
    cleared: !needsClearing || isCleared(input.cleared, input.key, input.commit),
    checkedAt: input.checkedAt,
  };
}
