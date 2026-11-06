import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cli } from './args.ts';
import { buildListing } from './build.ts';
import { realDeps } from './net.ts';
import { mergePending } from './pending.ts';
import type { Deps } from './net.ts';
import type { ReasonCode } from './publicity.ts';
import { listingKey, slugify } from './slug.ts';
import { parseCleared, parseSources } from './sources.ts';
import { isoSeconds } from './time.ts';
import type { Listing, ListingsFile } from './types.ts';

export interface CrawlResultEntry {
  source: string;
  key?: string;
  status: 'listed' | 'rejected';
  reason?: ReasonCode;
  detail?: string;
  commit?: string;
  tier?: string;
  cleared?: boolean;
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
  previous?: { plugins?: Listing[] } | null;
  deps: Deps;
  now?: () => number;
}

export async function crawl(options: CrawlOptions): Promise<{ listings: ListingsFile; report: CrawlReport }> {
  const now = options.now ?? Date.now;
  const previous = new Map<string, Listing>();
  for (const p of options.previous?.plugins ?? []) previous.set(p.key, p);
  const ctx = { now, previous, cleared: parseCleared(options.clearedText ?? '') };

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
      flags: listing.audit.flags.map((f) => f.code),
    });
  }

  plugins.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byReason: Record<string, number> = {};
  for (const r of results) if (r.reason) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  const generatedAt = isoSeconds(now());
  return {
    listings: { schemaVersion: 1, generatedAt, plugins },
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
    pending: { type: 'string' },
    denylist: { type: 'string' },
    out: { type: 'string' },
    report: { type: 'string' },
  });
  if (!values.sources || !values.out || !values.report) {
    console.error('usage: crawl.ts --sources <file> [--pending <pending-sources.jsonl>] [--denylist <file>] [--previous <index.json>] [--cleared <file>] --out <listings.json> --report <report.json>');
    process.exit(2);
  }
  const clearedPath = values.cleared ?? join(dirname(values.sources), 'cleared.txt');
  const denylistPath = values.denylist ?? join(dirname(values.sources), 'denylist.txt');
  const readIfExists = (path: string | undefined) => (path && existsSync(path) ? readFileSync(path, 'utf8') : '');
  const merged = mergePending(readFileSync(values.sources, 'utf8'), readIfExists(values.pending), readIfExists(denylistPath));
  const previous = values.previous && existsSync(values.previous) ? JSON.parse(readFileSync(values.previous, 'utf8')) : null;
  const { listings, report } = await crawl({
    sourcesText: merged.text,
    clearedText: existsSync(clearedPath) ? readFileSync(clearedPath, 'utf8') : '',
    previous,
    deps: realDeps(),
  });
  writeJsonAtomic(values.report, report);
  const { summary } = report;
  const outage = isTransientOutage(report);
  if (!outage) writeJsonAtomic(values.out, listings);
  if (merged.added) console.log(`merged ${merged.added} pending sources`);
  console.log(`crawled ${summary.sources} sources: ${summary.listed} listed, ${summary.rejected} rejected`);
  for (const r of report.results) {
    console.log(`  ${r.status === 'listed' ? 'listed  ' : 'rejected'} ${r.source}${r.reason ? `  ${r.reason}: ${r.detail}` : `  tier=${r.tier} cleared=${r.cleared}${r.flags?.length ? ` flags=${r.flags.join(',')}` : ''}`}`);
  }
  if (outage) {
    console.error(`nothing listed because of rate limiting or network errors; left ${values.out} untouched`);
    process.exit(1);
  }
}

if (import.meta.main) await main();
