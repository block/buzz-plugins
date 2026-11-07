import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cli } from './args.ts';
import { crawl, type CrawlResultEntry } from './crawl.ts';
import type { Deps } from './net.ts';
import { realDeps } from './net.ts';
import { listingKey } from './slug.ts';
import { parseSources } from './sources.ts';

export interface SourceCheck {
  line: string;
  ok: boolean;
  detail: string;
}

export interface CheckOutcome {
  ok: boolean;
  checks: SourceCheck[];
}

const normalize = (raw: string) => raw.replace(/#.*$/, '').trim().split(/\s+/).join(' ');

export function addedLines(baseText: string, candidateText: string): string[] {
  const base = new Set(baseText.split('\n').map(normalize).filter(Boolean));
  const seen = new Set<string>();
  return candidateText
    .split('\n')
    .map(normalize)
    .filter((line) => line && !base.has(line) && !seen.has(line) && seen.add(line));
}

export function sourceFromIssue(body: string): string {
  const match = /^###\s+Source line\s*\n+([\s\S]*?)(?=\n###\s|$)/m.exec(body);
  const value = (match?.[1] ?? '').replace(/^```\w*\s*|```\s*$/g, '').trim();
  return value === '_No response_' ? '' : value;
}

export async function checkSources(options: {
  baseText: string;
  candidateText: string;
  denylistText?: string;
  clearedText?: string;
  deps: Deps;
  now?: () => number;
}): Promise<CheckOutcome> {
  const added = addedLines(options.baseText, options.candidateText);
  if (added.length === 0) return { ok: true, checks: [] };

  const addedSet = new Set(added);
  const keptKeys = new Set<string>();
  for (const entry of parseSources(options.candidateText)) {
    if (!entry.source) continue;
    const raw = options.candidateText.split('\n')[entry.line - 1] ?? '';
    if (!addedSet.has(normalize(raw))) keptKeys.add(listingKey(entry.source).toLowerCase());
  }

  const checks: SourceCheck[] = [];
  const toCrawl: string[] = [];
  for (const line of added) {
    const [entry] = parseSources(line);
    if (!entry?.source) {
      checks.push({ line, ok: false, detail: `invalid-source: ${entry?.error ?? 'unreadable line'}` });
      continue;
    }
    if (keptKeys.has(listingKey(entry.source).toLowerCase())) {
      checks.push({ line, ok: false, detail: `duplicate-source: ${listingKey(entry.source)} is already listed` });
      continue;
    }
    toCrawl.push(line);
  }

  if (toCrawl.length) {
    const { index, report } = await crawl({
      sourcesText: toCrawl.join('\n'),
      denylistText: options.denylistText,
      clearedText: options.clearedText,
      deps: options.deps,
      now: options.now,
    });
    const byKey = new Map(index.plugins.map((p) => [p.key, p]));
    report.results.forEach((result: CrawlResultEntry, i) => {
      const line = toCrawl[i]!;
      const listing = result.key ? byKey.get(result.key) : undefined;
      if (result.status === 'listed' && listing) {
        const flags = listing.audit.flags.length ? `, flags: ${listing.audit.flags.map((f) => f.code).join(', ')}` : '';
        checks.push({ line, ok: true, detail: `${listing.name} (${listing.id}), ${listing.audit.tier} access${flags}` });
      } else {
        checks.push({ line, ok: false, detail: `${result.reason ?? 'rejected'}: ${result.detail ?? ''}`.trim() });
      }
    });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

const cell = (text: string) => text.replace(/[`|\r\n]/g, ' ').trim();

export function formatReport(outcome: CheckOutcome, emptyMessage: string): string {
  if (outcome.checks.length === 0) return `### Plugin listing check\n\n${emptyMessage}\n`;
  const rows = outcome.checks.map((c) => `| \`${cell(c.line)}\` | ${c.ok ? '✅' : '❌'} ${cell(c.detail)} |`);
  const summary = outcome.ok
    ? 'Every new source passes. A maintainer will review and merge.'
    : 'Fix the sources marked ❌. Each line needs a public GitHub repository with a built `manifest.json` and `plugin.js` at the given branch and folder.';
  return ['### Plugin listing check', '', '| Source | Result |', '|---|---|', ...rows, '', summary, ''].join('\n');
}

async function main(): Promise<void> {
  const { values } = cli({
    base: { type: 'string' },
    candidate: { type: 'string' },
    issue: { type: 'string' },
    denylist: { type: 'string' },
    cleared: { type: 'string' },
    report: { type: 'string' },
  });
  if (!values.base || (!values.candidate === !values.issue)) {
    console.error('usage: check-sources.ts --base <sources.txt> (--candidate <sources.txt> | --issue <issue-body.md>) [--denylist <file>] [--cleared <file>] [--report <out.md>]');
    process.exit(2);
  }
  const read = (path: string | undefined) => (path && existsSync(path) ? readFileSync(path, 'utf8') : '');
  const baseText = read(values.base);
  const issueLine = values.issue ? normalize(sourceFromIssue(read(values.issue))) : '';
  const listedAlready = !!issueLine && baseText.split('\n').map(normalize).includes(issueLine);
  const outcome: CheckOutcome = listedAlready
    ? { ok: false, checks: [{ line: issueLine, ok: false, detail: 'duplicate-source: this line is already in sources.txt' }] }
    : await checkSources({
        baseText,
        candidateText: values.issue ? `${baseText}\n${issueLine}\n` : read(values.candidate),
        denylistText: read(values.denylist ?? 'denylist.txt'),
        clearedText: read(values.cleared ?? 'cleared.txt'),
        deps: realDeps(),
      });
  const missing = !!values.issue && outcome.checks.length === 0;
  const report = missing
    ? formatReport({ ok: false, checks: [] }, 'No source line found. Fill in **Source line** as `https://github.com/<owner>/<repo> <branch> [folder]`.')
    : formatReport(outcome, 'No new sources to check.');
  if (values.report) writeFileSync(values.report, report);
  console.log(report);
  if (!outcome.ok || missing) process.exit(1);
}

if (import.meta.main) await main();
