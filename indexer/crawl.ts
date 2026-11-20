import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cli } from './args.ts';
import { buildListing } from './build.ts';
import { realDeps } from './net.ts';
import type { Deps } from './net.ts';
import type { ReasonCode } from './publicity.ts';
import { listingKey, slugify } from './slug.ts';
import { parseKeyList, parsePins, parseSources } from './sources.ts';
import { isoSeconds } from './time.ts';
import { type IndexFile, type Listing, MEDIA_POLICY } from './types.ts';

export interface CrawlResultEntry {
  source: string;
  key?: string;
  status: 'listed' | 'rejected';
  reason?: ReasonCode;
  detail?: string;
  commit?: string;
  tier?: string;
  cleared?: boolean;
  verified?: boolean;
  flags?: string[];
}

export interface CrawlReport {
  generatedAt: string;
  summary: { sources: number; listed: number; rejected: number; byReason: Record<string, number> };
  results: CrawlResultEntry[];
}

export interface CrawlOptions {
  sourcesText: string;
  clearedText?: string;
  verifiedText?: string;
  denylistText?: string;
  previous?: { plugins?: Listing[] } | null;
  deps: Deps;
  now?: () => number;
}

export async function crawl(options: CrawlOptions): Promise<{ index: IndexFile; report: CrawlReport }> {
  const now = options.now ?? Date.now;
  const previous = new Map<string, Listing>();
  for (const p of options.previous?.plugins ?? []) previous.set(p.key, p);
  const ctx = {
    now,
    previous,
    cleared: parsePins(options.clearedText ?? ''),
    verified: parsePins(options.verifiedText ?? ''),
  };
  const denied = new Set(parseKeyList(options.denylistText ?? '').map((k) => k.toLowerCase()));

  const results: CrawlResultEntry[] = [];
  const plugins: Listing[] = [];
  const seenKeys = new Set<string>();
  const seenSlugs = new Map<string, string>();

  for (const entry of parseSources(options.sourcesText)) {
    const label = `line ${entry.line}`;
    if (!entry.source) {
      results.push({ source: label, status: 'rejected', reason: 'invalid-source', detail: entry.error });
      continue;
    }
    const { source } = entry;
    const key = listingKey(source);
    const printable = `${key}@${source.ref}`;
    if (seenKeys.has(key.toLowerCase())) {
      results.push({ source: printable, key, status: 'rejected', reason: 'duplicate-source', detail: 'listing key already appears earlier in sources.txt' });
      continue;
    }
    seenKeys.add(key.toLowerCase());
    if (denied.has(key.toLowerCase())) {
      results.push({ source: printable, key, status: 'rejected', reason: 'denylisted', detail: 'listing key is in denylist.txt' });
      continue;
    }

    const built = await buildListing(options.deps, source, ctx);
    if (!built.ok) {
      results.push({ source: printable, key, status: 'rejected', reason: built.reason, detail: built.detail });
      continue;
    }
    const { listing } = built;
    const clash = seenSlugs.get(listing.slug);
    if (clash) {
      results.push({ source: printable, key, status: 'rejected', reason: 'slug-collision', detail: `slug ${listing.slug} is already used by ${clash}` });
      continue;
    }
    seenSlugs.set(listing.slug, listing.key);
    plugins.push(listing);
    results.push({
      source: printable,
      key,
      status: 'listed',
      commit: listing.source.commit,
      tier: listing.audit.tier,
      cleared: listing.audit.cleared,
      verified: listing.verified,
      flags: listing.audit.flags.map((f) => f.code),
    });
  }

  plugins.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byReason: Record<string, number> = {};
  for (const r of results) if (r.reason) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  const generatedAt = isoSeconds(now());
  return {
    index: { schemaVersion: 1, generatedAt, mediaPolicy: MEDIA_POLICY, plugins },
    report: {
      generatedAt,
      summary: {
        sources: results.length,
        listed: results.filter((r) => r.status === 'listed').length,
        rejected: results.filter((r) => r.status === 'rejected').length,
        byReason,
      },
      results,
    },
  };
}

export function isTransientOutage(report: CrawlReport): boolean {
  return (
    report.summary.listed === 0 &&
    report.results.some((r) => r.reason === 'rate-limited' || r.reason === 'network-error')
  );
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

async function main(): Promise<void> {
  const { values } = cli({
    sources: { type: 'string' },
    previous: { type: 'string' },
    cleared: { type: 'string' },
    verified: { type: 'string' },
    denylist: { type: 'string' },
    out: { type: 'string' },
    report: { type: 'string' },
  });
  if (!values.sources || !values.out || !values.report) {
    console.error('usage: crawl.ts --sources <file> [--denylist <file>] [--cleared <file>] [--verified <file>] [--previous <index.json>] --out <index.json> --report <report.json>');
    process.exit(2);
  }
  const readIfExists = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  const previous = values.previous && existsSync(values.previous) ? JSON.parse(readFileSync(values.previous, 'utf8')) : null;
  const { index, report } = await crawl({
    sourcesText: readFileSync(values.sources, 'utf8'),
    clearedText: readIfExists(values.cleared ?? join(dirname(values.sources), 'cleared.txt')),
    verifiedText: readIfExists(values.verified ?? join(dirname(values.sources), 'verified.txt')),
    denylistText: readIfExists(values.denylist ?? join(dirname(values.sources), 'denylist.txt')),
    previous,
    deps: realDeps(),
  });
  writeJsonAtomic(values.report, report);
  const { summary } = report;
  const outage = isTransientOutage(report);
  if (!outage) writeJsonAtomic(values.out, index);
  console.log(`crawled ${summary.sources} sources: ${summary.listed} listed, ${summary.rejected} rejected`);
  for (const r of report.results) console.log(`  ${describeResult(r)}`);
  if (outage) {
    console.error(`nothing listed because of rate limiting or network errors; left ${values.out} untouched`);
    process.exit(1);
  }
}

export function describeResult(r: CrawlResultEntry): string {
  return `${r.status === 'listed' ? 'listed  ' : 'rejected'} ${r.source}${r.reason ? `  ${r.reason}: ${r.detail}` : `  tier=${r.tier} cleared=${r.cleared} verified=${r.verified}${r.flags?.length ? ` flags=${r.flags.join(',')}` : ''}`}`;
}

if (import.meta.main) await main();
