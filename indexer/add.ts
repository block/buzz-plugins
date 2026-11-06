import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { cli } from './args.ts';
import { realDeps } from './net.ts';
import type { Deps } from './net.ts';
import { checkPublic } from './publicity.ts';
import { listingKey } from './slug.ts';
import { formatSource, parseKeyList, parseRepository, parseSources } from './sources.ts';

export async function addSource(
  deps: Deps,
  input: { repository: string; ref?: string; path?: string },
  files: { sources: string; denylist?: string },
): Promise<{ ok: true; line: string; commit: string } | { ok: false; reason: string; detail: string }> {
  const repository = parseRepository(input.repository);
  if (!repository) return { ok: false, reason: 'invalid-source', detail: `expected owner/repo, got "${input.repository}"` };

  const checked = await checkPublic(deps, { ...repository, ref: input.ref, path: input.path });
  if (!checked.ok) return checked;

  const key = listingKey(checked.source);
  const denied = files.denylist && existsSync(files.denylist) ? parseKeyList(readFileSync(files.denylist, 'utf8')) : [];
  if (denied.some((d) => d.toLowerCase() === key.toLowerCase())) {
    return { ok: false, reason: 'denylisted', detail: `${key} is in the denylist` };
  }
  const existing = existsSync(files.sources) ? readFileSync(files.sources, 'utf8') : '';
  if (parseSources(existing).some((e) => e.source && listingKey(e.source).toLowerCase() === key.toLowerCase())) {
    return { ok: false, reason: 'duplicate-source', detail: `${key} is already in ${files.sources}` };
  }
  const line = formatSource(checked.source);
  appendFileSync(files.sources, `${existing === '' || existing.endsWith('\n') ? '' : '\n'}${line}\n`);
  return { ok: true, line, commit: checked.commit };
}

async function main(): Promise<void> {
  const { values, positionals } = cli({ sources: { type: 'string' }, denylist: { type: 'string' } });
  const [repository, ref, path] = positionals;
  if (!repository || positionals.length > 3) {
    console.error('usage: add.ts owner/repo [ref] [path] [--sources sources.txt] [--denylist denylist.txt]');
    process.exit(2);
  }
  const result = await addSource(
    realDeps(),
    { repository, ref, path },
    { sources: values.sources ?? 'sources.txt', denylist: values.denylist ?? 'denylist.txt' },
  );
  if (!result.ok) {
    console.error(`not added: ${result.reason}: ${result.detail}`);
    process.exit(1);
  }
  console.log(`added: ${result.line}  (commit ${result.commit})`);
}

if (import.meta.main) await main();
