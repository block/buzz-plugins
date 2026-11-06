import { slugify } from './slug.ts';
import { CATEGORIES, COMMIT_RE, PLUGIN_ID_RE } from './types.ts';

type Rec = Record<string, unknown>;

const KEY_RE = /^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9._-]+)*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function isKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_RE.test(value) && !value.split('/').some((s) => s === '.' || s === '..');
}

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Checker {
  errors: string[] = [];
  at(path: string, ok: boolean, message: string): boolean {
    if (!ok) this.errors.push(`${path}: ${message}`);
    return ok;
  }
  string(path: string, v: unknown, max = Infinity, min = 0): v is string {
    return this.at(path, typeof v === 'string' && v.length >= min && [...v].length <= max, `must be a string of ${min}-${max} characters`);
  }
  stringList(path: string, v: unknown, maxItems: number): void {
    if (!this.at(path, Array.isArray(v) && v.length <= maxItems, `must be a list of at most ${maxItems} strings`)) return;
    (v as unknown[]).forEach((item, i) => this.string(`${path}[${i}]`, item));
  }
  iso(path: string, v: unknown): void {
    this.at(path, typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)), 'must be an ISO 8601 UTC timestamp');
  }
  media(path: string, v: unknown, nullable: boolean): void {
    if (v === null && nullable) return;
    if (!this.at(path, isRec(v), 'must be an object with url and type')) return;
    const m = v as Rec;
    this.at(`${path}.url`, typeof m.url === 'string' && m.url.startsWith('https://'), 'must be an https URL');
    this.string(`${path}.type`, m.type, 100, 1);
  }
}

export function checkListing(c: Checker, p: unknown, path: string): void {
  if (!c.at(path, isRec(p), 'must be an object')) return;
  const l = p as Rec;
  if (c.at(`${path}.key`, isKey(l.key), 'must be github.com/<owner>/<repo>[/<path>]')) {
    c.at(`${path}.slug`, l.slug === slugify(l.key as string), 'must be the slug derived from key');
  }
  c.at(`${path}.id`, typeof l.id === 'string' && PLUGIN_ID_RE.test(l.id), `must match ${PLUGIN_ID_RE}`);
  c.string(`${path}.name`, l.name, 200, 1);
  c.string(`${path}.tagline`, l.tagline, 100);
  c.string(`${path}.description`, l.description, 4000);
  c.at(`${path}.category`, (CATEGORIES as readonly string[]).includes(l.category as string), 'must be a known category');
  c.stringList(`${path}.tags`, l.tags, 8);
  if (Array.isArray(l.tags)) l.tags.forEach((t, i) => c.string(`${path}.tags[${i}]`, t, 32, 1));

  if (c.at(`${path}.author`, isRec(l.author), 'must be an object')) c.string(`${path}.author.github`, (l.author as Rec).github, 100, 1);
  c.at(`${path}.official`, typeof l.official === 'boolean', 'must be a boolean');

  if (c.at(`${path}.source`, isRec(l.source), 'must be an object')) {
    const s = l.source as Rec;
    c.at(`${path}.source.repository`, typeof s.repository === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(s.repository), 'must be a github.com repository URL');
    c.string(`${path}.source.ref`, s.ref, 200, 1);
    c.at(`${path}.source.commit`, typeof s.commit === 'string' && COMMIT_RE.test(s.commit), 'must be 40 hex characters');
    c.at(`${path}.source.path`, typeof s.path === 'string' && !s.path.startsWith('/') && !s.path.endsWith('/'), 'must not start or end with "/"');
    if (typeof l.key === 'string' && typeof s.path === 'string' && typeof s.repository === 'string') {
      const base = s.repository.replace('https://', '');
      c.at(`${path}.key`, l.key === (s.path ? `${base}/${s.path}` : base), 'must match source repository and path');
    }
  }

  if (c.at(`${path}.host`, isRec(l.host), 'must be an object')) {
    const h = l.host as Rec;
    for (const f of ['networkOrigins', 'processes', 'commands']) c.stringList(`${path}.host.${f}`, h[f], 1000);
    for (const f of ['files', 'mcp', 'agentHooks']) c.at(`${path}.host.${f}`, typeof h[f] === 'boolean', 'must be a boolean');
  }

  if (c.at(`${path}.audit`, isRec(l.audit), 'must be an object')) {
    const a = l.audit as Rec;
    c.at(`${path}.audit.tier`, a.tier === 'high' || a.tier === 'medium' || a.tier === 'low', 'must be high, medium or low');
    if (c.at(`${path}.audit.flags`, Array.isArray(a.flags), 'must be a list')) {
      (a.flags as unknown[]).forEach((f, i) => {
        if (!c.at(`${path}.audit.flags[${i}]`, isRec(f), 'must be an object')) return;
        c.at(`${path}.audit.flags[${i}].code`, ['dynamic-code', 'obfuscated', 'undeclared-origin', 'size'].includes((f as Rec).code as string), 'unknown flag code');
        c.string(`${path}.audit.flags[${i}].detail`, (f as Rec).detail);
      });
    }
    c.at(`${path}.audit.accessChanged`, typeof a.accessChanged === 'boolean', 'must be a boolean');
    c.at(`${path}.audit.cleared`, typeof a.cleared === 'boolean', 'must be a boolean');
    c.iso(`${path}.audit.checkedAt`, a.checkedAt);
  }

  if (c.at(`${path}.demo`, isRec(l.demo), 'must be an object')) {
    const d = l.demo as Rec;
    c.media(`${path}.demo.video`, d.video, true);
    c.media(`${path}.demo.poster`, d.poster, true);
    if (c.at(`${path}.demo.screenshots`, Array.isArray(d.screenshots), 'must be a list')) {
      (d.screenshots as unknown[]).forEach((s, i) => c.media(`${path}.demo.screenshots[${i}]`, s, false));
    }
  }
  if (c.at(`${path}.setup`, Array.isArray(l.setup) && l.setup.length <= 5, 'must be a list of at most 5 steps')) {
    (l.setup as unknown[]).forEach((s, i) => {
      if (c.at(`${path}.setup[${i}]`, isRec(s), 'must be an object')) c.string(`${path}.setup[${i}].title`, (s as Rec).title, 200, 1);
    });
  }
  if (c.at(`${path}.links`, isRec(l.links), 'must be an object')) {
    c.at(`${path}.links.repository`, typeof (l.links as Rec).repository === 'string', 'must be a string');
  }
  c.at(`${path}.stars`, Number.isInteger(l.stars) && (l.stars as number) >= 0, 'must be a non-negative integer');
  c.iso(`${path}.updatedAt`, l.updatedAt);
}

export function validateListings(value: unknown): string[] {
  const c = new Checker();
  if (!c.at('$', isRec(value), 'must be an object')) return c.errors;
  const f = value as Rec;
  c.at('$.schemaVersion', f.schemaVersion === 1, 'must be 1');
  c.iso('$.generatedAt', f.generatedAt);
  if (c.at('$.plugins', Array.isArray(f.plugins), 'must be a list')) {
    (f.plugins as unknown[]).forEach((p, i) => checkListing(c, p, `$.plugins[${i}]`));
  }
  return c.errors;
}

export function validateIndex(value: unknown): string[] {
  const c = new Checker();
  if (!c.at('$', isRec(value), 'must be an object')) return c.errors;
  const f = value as Rec;
  c.at('$.schemaVersion', f.schemaVersion === 1, 'must be 1');
  c.iso('$.generatedAt', f.generatedAt);
  c.iso('$.collectionStartedAt', f.collectionStartedAt);
  c.string('$.mediaPolicy', f.mediaPolicy, 500, 1);

  const keys = new Set<string>();
  const slugs = new Set<string>();
  if (c.at('$.plugins', Array.isArray(f.plugins), 'must be a list')) {
    (f.plugins as unknown[]).forEach((p, i) => {
      const path = `$.plugins[${i}]`;
      checkListing(c, p, path);
      if (!isRec(p)) return;
      if (typeof p.key === 'string') {
        c.at(`${path}.key`, !keys.has(p.key), 'duplicate key');
        keys.add(p.key);
      }
      if (typeof p.slug === 'string') {
        c.at(`${path}.slug`, !slugs.has(p.slug), 'duplicate slug');
        slugs.add(p.slug);
      }
      if (c.at(`${path}.installs`, isRec(p.installs), 'must be an object')) {
        const n = p.installs as Rec;
        for (const k of ['allTime', 'last24h', 'last7d']) {
          c.at(`${path}.installs.${k}`, Number.isInteger(n[k]) && (n[k] as number) >= 0, 'must be a non-negative integer');
        }
        if (Number.isInteger(n.allTime) && Number.isInteger(n.last7d) && Number.isInteger(n.last24h)) {
          c.at(`${path}.installs`, (n.last24h as number) <= (n.last7d as number) && (n.last7d as number) <= (n.allTime as number), 'must satisfy last24h <= last7d <= allTime');
        }
      }
      if (c.at(`${path}.upvotes`, Number.isInteger(p.upvotes) && (p.upvotes as number) >= 0, 'must be a non-negative integer') && isRec(p.installs)) {
        const all = (p.installs as Rec).allTime;
        if (Number.isInteger(all)) c.at(`${path}.upvotes`, (p.upvotes as number) <= (all as number), 'must not exceed installs.allTime');
      }
    });
  }

  if (c.at('$.rankings', isRec(f.rankings), 'must be an object')) {
    const r = f.rankings as Rec;
    const plugins = Array.isArray(f.plugins) ? (f.plugins as Rec[]) : [];
    const byKey = new Map(plugins.map((p) => [p.key as string, p]));
    for (const name of ['allTime', 'trending', 'hot', 'mostUpvoted']) {
      const list = r[name];
      if (!c.at(`$.rankings.${name}`, Array.isArray(list) && list.every((k) => typeof k === 'string'), 'must be a list of keys')) continue;
      const seen = new Set<string>();
      for (const k of list as string[]) {
        c.at(`$.rankings.${name}`, byKey.has(k), `unknown key ${k}`);
        c.at(`$.rankings.${name}`, !seen.has(k), `duplicate key ${k}`);
        seen.add(k);
        if (name !== 'allTime') {
          const audit = byKey.get(k)?.audit as Rec | undefined;
          c.at(`$.rankings.${name}`, audit?.cleared === true, `${k} is not cleared`);
        }
      }
      if (name === 'allTime') c.at('$.rankings.allTime', seen.size === byKey.size, 'must rank every plugin');
    }
  }
  return c.errors;
}
