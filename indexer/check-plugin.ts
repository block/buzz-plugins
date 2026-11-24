import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanPlugin, tierOf } from './audit.ts';
import { parseListingYaml } from './listing.ts';
import { parseManifest } from './manifest.ts';
import { MAX_MANIFEST_BYTES, MAX_PLUGIN_BYTES } from './publicity.ts';

export interface Finding {
  /** `fail` blocks listing; `review` lists it but a maintainer has to clear it; `note` is advice. */
  level: 'ok' | 'note' | 'review' | 'fail';
  detail: string;
}

export interface PluginFiles {
  manifest?: string;
  plugin?: { text: string; bytes: number };
  listing?: string;
  readme: boolean;
  /** Built files that differ from the last commit or that git ignores, or `undefined` outside a git repository. */
  uncommitted?: string[];
  /** Commits the upstream branch lacks, or `undefined` when there is no upstream to compare with. */
  unpushed?: number;
}

/** Checks a plugin folder against what the crawl requires and the audit reports. */
export function checkPlugin(files: PluginFiles): Finding[] {
  const findings: Finding[] = [];
  const add = (level: Finding['level'], detail: string) => findings.push({ level, detail });

  if (files.manifest === undefined) return [{ level: 'fail', detail: 'manifest.json is missing' }];
  if (Buffer.byteLength(files.manifest) > MAX_MANIFEST_BYTES) return [{ level: 'fail', detail: `manifest.json is larger than ${MAX_MANIFEST_BYTES} bytes` }];
  const parsed = parseManifest(files.manifest);
  if ('error' in parsed) return [{ level: 'fail', detail: parsed.error }];
  const { manifest } = parsed;
  // Buzz refuses any other value, though the crawl doesn't read it.
  if ((JSON.parse(files.manifest) as { apiVersion?: unknown }).apiVersion !== 1) add('fail', 'manifest.json needs "apiVersion": 1');
  add('ok', `manifest.json: ${manifest.id} "${manifest.name}"`);
  if (!manifest.description) add('note', 'manifest.json has no description; the listing would have no tagline unless buzz-listing.yaml sets one');

  if (!files.plugin) add('fail', 'plugin.js is missing; build the plugin and keep the built file next to manifest.json');
  else if (files.plugin.bytes === 0) add('fail', 'plugin.js is empty');
  else if (files.plugin.bytes > MAX_PLUGIN_BYTES) add('fail', `plugin.js is larger than ${MAX_PLUGIN_BYTES} bytes`);
  else add('ok', `plugin.js: ${files.plugin.bytes} bytes`);

  if (files.listing !== undefined) {
    const listing = parseListingYaml(files.listing);
    if ('errors' in listing) for (const error of listing.errors) add('fail', `buzz-listing.yaml: ${error}`);
    else add('ok', 'buzz-listing.yaml is valid');
  } else if (!files.readme) add('note', 'no buzz-listing.yaml and no README; the listing would have no description');

  const tier = tierOf(manifest.host);
  if (tier === 'high') add('review', 'access tier is high (processes, commands, files, MCP or agent hooks); a maintainer has to clear each version');
  else add('ok', `access tier is ${tier}`);
  if (files.plugin && files.plugin.bytes > 0)
    for (const flag of scanPlugin({ ...files.plugin, truncated: false }, manifest.host)) add('review', `audit flag ${flag.code}: ${flag.detail}`);

  if (files.uncommitted === undefined) add('note', 'not in a git repository; the directory lists a commit, so commit and push the built files');
  else if (files.uncommitted.length > 0) add('fail', `not committed: ${files.uncommitted.join(', ')}; the directory lists what is pushed, not what is on disk`);
  else if (files.unpushed === undefined) add('note', 'built files are committed, but this branch has no upstream to compare with; push it');
  else if (files.unpushed > 0) add('fail', `${files.unpushed} commit${files.unpushed === 1 ? ' is' : 's are'} not pushed; the directory lists what is pushed`);
  else add('ok', 'built files are committed and pushed');
  return findings;
}

const BUILT = ['manifest.json', 'plugin.js', 'buzz-listing.yaml'];

function gitState(folder: string): Pick<PluginFiles, 'uncommitted' | 'unpushed'> {
  const git = (...args: string[]) => execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    git('rev-parse', '--is-inside-work-tree');
  } catch {
    return {};
  }
  const present = BUILT.filter((name) => existsSync(join(folder, name)));
  // Untracked, modified and, with --ignored, gitignored files all show here; a repository without commits lists everything.
  const uncommitted = git('status', '--porcelain', '--ignored', '--', ...present)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  try {
    return { uncommitted, unpushed: Number(git('rev-list', '--count', '@{upstream}..HEAD')) };
  } catch {
    return { uncommitted };
  }
}

export function readPluginFolder(folder: string): PluginFiles {
  const read = (name: string) => (existsSync(join(folder, name)) ? readFileSync(join(folder, name), 'utf8') : undefined);
  const plugin = join(folder, 'plugin.js');
  return {
    manifest: read('manifest.json'),
    plugin: existsSync(plugin) ? { text: readFileSync(plugin, 'utf8'), bytes: statSync(plugin).size } : undefined,
    listing: read('buzz-listing.yaml'),
    readme: ['README.md', 'README', 'readme.md'].some((name) => existsSync(join(folder, name))),
    ...gitState(folder),
  };
}

const MARK = { ok: 'ok    ', note: 'note  ', review: 'review', fail: 'FAIL  ' } as const;

function main(): void {
  const folder = resolve(process.argv[2] ?? '.');
  const findings = checkPlugin(readPluginFolder(folder));
  for (const finding of findings) console.log(`${MARK[finding.level]}  ${finding.detail}`);
  const failed = findings.filter((finding) => finding.level === 'fail').length;
  const review = findings.filter((finding) => finding.level === 'review').length;
  console.log(
    failed
      ? `\n${failed} problem${failed === 1 ? '' : 's'} to fix before this can be listed.`
      : review
        ? '\nCan be listed. It will show as not yet cleared until a maintainer reviews it.'
        : '\nReady to list.',
  );
  process.exit(failed ? 1 : 0);
}

if (import.meta.main) main();
