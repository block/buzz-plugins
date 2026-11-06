import { CATEGORIES, PLUGIN_ID_RE } from './types.ts';
import type { Category, Host } from './types.ts';

export interface Manifest {
  id: string;
  name: string;
  description: string;
  category: Category;
  tags: string[];
  host: Host;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function displayEntry(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim() || null;
  if (!isRecord(entry)) return null;
  const program = typeof entry.program === 'string' ? entry.program : typeof entry.id === 'string' ? entry.id : null;
  if (!program) return null;
  const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === 'string') : [];
  return [program, ...args].join(' ');
}

function declared(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

export function normalizeHost(raw: unknown): Host {
  const host = isRecord(raw) ? raw : {};
  const list = (value: unknown, map: (e: unknown) => string | null): string[] =>
    Array.isArray(value) ? value.map(map).filter((s): s is string => s !== null) : [];
  return {
    networkOrigins: list(host.networkOrigins, (e) => (typeof e === 'string' && e.trim() ? e.trim() : null)),
    processes: list(host.processes, displayEntry),
    commands: list(host.commands, displayEntry),
    files: declared(host.files),
    mcp: declared(host.mcp),
    agentHooks: declared(host.agentHooks),
  };
}

export function parseManifest(text: string): { manifest: Manifest } | { error: string; code: 'manifest-invalid' | 'manifest-id-invalid' } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { code: 'manifest-invalid', error: `manifest.json is not valid JSON: ${(error as Error).message}` };
  }
  if (!isRecord(raw)) return { code: 'manifest-invalid', error: 'manifest.json is not an object' };
  if (typeof raw.id !== 'string' || !PLUGIN_ID_RE.test(raw.id)) {
    return { code: 'manifest-id-invalid', error: `manifest id must match ${PLUGIN_ID_RE}` };
  }
  const discovery = isRecord(raw.discovery) ? raw.discovery : {};
  const category = (CATEGORIES as readonly string[]).includes(discovery.category as string)
    ? (discovery.category as Category)
    : 'productivity';
  const tags = Array.isArray(discovery.tags)
    ? [...new Set(discovery.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()))]
        .filter((t) => t.length >= 1 && t.length <= 32)
        .slice(0, 8)
    : [];
  return {
    manifest: {
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.id,
      description: typeof raw.description === 'string' ? raw.description.trim() : '',
      category,
      tags,
      host: normalizeHost(raw.host),
    },
  };
}
