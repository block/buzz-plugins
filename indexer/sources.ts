import { normalizePath } from './slug.ts';
import type { Source } from './types.ts';

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9_][A-Za-z0-9_./+-]{0,199}$/;

export interface ParsedSource {
  line: number;
  source?: Source;
  error?: string;
}

export function validateSource(input: {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
}): { source: Source } | { error: string } {
  const { owner, repo } = input;
  if (!NAME_RE.test(owner) || owner === '.' || owner === '..') return { error: `invalid owner "${owner}"` };
  if (!NAME_RE.test(repo) || repo === '.' || repo === '..') return { error: `invalid repository "${repo}"` };
  const ref = input.ref ?? 'HEAD';
  if (!REF_RE.test(ref) || ref.includes('..') || ref.endsWith('/') || ref.endsWith('.lock')) {
    return { error: `invalid ref "${ref}"` };
  }
  const path = normalizePath(input.path ?? '');
  if (path === null) return { error: `invalid path "${input.path}"` };
  return { source: { owner, repo, ref, path } };
}

export function parseRepository(value: string): { owner: string; repo: string } | null {
  const trimmed = value.trim();
  const url = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(trimmed);
  if (url) return { owner: url[1]!, repo: url[2]! };
  const short = /^([^/\s:@]+)\/([^/\s:@]+?)(?:\.git)?$/.exec(trimmed);
  if (short) return { owner: short[1]!, repo: short[2]! };
  return null;
}

export function parseSources(text: string): ParsedSource[] {
  const out: ParsedSource[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const parts = line.split(/\s+/);
    if (parts.length < 2 || parts.length > 3) {
      out.push({ line: index + 1, error: 'expected "<repository> <ref> [path]"' });
      return;
    }
    const repository = parseRepository(parts[0]!);
    if (!repository) {
      out.push({ line: index + 1, error: `unsupported repository "${parts[0]}"` });
      return;
    }
    const checked = validateSource({ ...repository, ref: parts[1]!, path: parts[2] ?? '' });
    out.push('error' in checked ? { line: index + 1, error: checked.error } : { line: index + 1, source: checked.source });
  });
  return out;
}

export function formatSource(source: Source): string {
  const base = `https://github.com/${source.owner}/${source.repo} ${source.ref}`;
  return source.path ? `${base} ${source.path}` : base;
}

export function parseKeyList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

export function parseCleared(text: string): Set<string> {
  const set = new Set<string>();
  for (const line of parseKeyList(text)) {
    const [key, commit] = line.split(/\s+/);
    if (key && commit && /^[0-9a-f]{40}$/i.test(commit)) set.add(`${key.toLowerCase()} ${commit.toLowerCase()}`);
  }
  return set;
}

export function isCleared(cleared: Set<string>, key: string, commit: string): boolean {
  return cleared.has(`${key.toLowerCase()} ${commit.toLowerCase()}`);
}
