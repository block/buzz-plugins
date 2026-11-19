import type { Source } from './types.ts';

export function listingKey(source: Pick<Source, 'owner' | 'repo' | 'path'>): string {
  const base = `github.com/${source.owner}/${source.repo}`;
  return source.path ? `${base}/${source.path}` : base;
}

export function slugify(key: string): string {
  return key
    .toLowerCase()
    .replaceAll('/', '--')
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 120);
}

export function normalizePath(raw: string): string | null {
  const trimmed = raw.replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return '';
  const segments = trimmed.split('/');
  if (segments.length > 8) return null;
  if (!segments.every((s) => /^[A-Za-z0-9._@+-]{1,100}$/.test(s) && s !== '.' && s !== '..')) return null;
  return segments.join('/');
}
