import { GIT_ANON_ARGS, cleanEnv, publicGet, readLimited } from './net.ts';
import type { Deps, GetResult } from './net.ts';
import { parseManifest } from './manifest.ts';
import type { Manifest } from './manifest.ts';
import { validateSource } from './sources.ts';
import { COMMIT_RE } from './types.ts';
import type { Source } from './types.ts';

export type ReasonCode =
  | 'invalid-source'
  | 'repo-not-found'
  | 'repo-private'
  | 'repo-unavailable'
  | 'rate-limited'
  | 'network-error'
  | 'http-error'
  | 'git-unauthenticated'
  | 'git-failed'
  | 'ref-unresolved'
  | 'manifest-missing'
  | 'plugin-js-missing'
  | 'manifest-invalid'
  | 'manifest-id-invalid'
  | 'listing-invalid'
  | 'slug-collision'
  | 'duplicate-source'
  | 'denylisted';

export interface Failure {
  ok: false;
  reason: ReasonCode;
  detail: string;
}

export interface PublicOk {
  ok: true;
  source: Source;
  commit: string;
  repo: { stars: number; defaultBranch: string };
  manifest: Manifest;
  pluginJs: { text: string; bytes: number; truncated: boolean };
}

export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_PLUGIN_BYTES = 16 * 1024 * 1024;

export function fail(reason: ReasonCode, detail: string): Failure {
  return { ok: false, reason, detail };
}

export function rawUrl(source: Pick<Source, 'owner' | 'repo' | 'path'>, commit: string, file: string): string {
  const dir = source.path ? `${source.path}/` : '';
  return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commit}/${dir}${file}`;
}

export function getFailure(result: Exclude<GetResult, { kind: 'ok' }>, what: string): Failure {
  if (result.kind === 'rate-limited') {
    return fail('rate-limited', `${what} is rate limited; retry in about ${Math.ceil(result.waitMs / 1000)}s`);
  }
  return fail('network-error', `${what}: ${result.detail}`);
}

export async function fetchRepoInfo(
  deps: Deps,
  owner: string,
  repo: string,
): Promise<{ ok: true; stars: number; defaultBranch: string } | Failure> {
  const result = await publicGet(deps, `https://api.github.com/repos/${owner}/${repo}`);
  if (result.kind !== 'ok') return getFailure(result, 'GitHub API repository lookup');
  const { response } = result;
  if (response.status === 404) {
    return fail('repo-not-found', 'repository not found, or it is not public (anonymous requests cannot tell the two apart)');
  }
  if (response.status === 451) return fail('repo-unavailable', 'repository is unavailable for legal reasons');
  if (response.status !== 200) return fail('http-error', `GitHub API repository lookup returned HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fail('http-error', 'GitHub API repository lookup returned a body that is not JSON');
  }
  const info = body as { private?: unknown; stargazers_count?: unknown; default_branch?: unknown };
  if (info.private !== false) return fail('repo-private', 'repository is not reported as "private": false');
  return {
    ok: true,
    stars: typeof info.stargazers_count === 'number' ? info.stargazers_count : 0,
    defaultBranch: typeof info.default_branch === 'string' ? info.default_branch : 'main',
  };
}

export function parseLsRemote(stdout: string, ref: string): string | null {
  const refs = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (sha && name && COMMIT_RE.test(sha)) refs.set(name, sha);
  }
  const order = [`refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`, ref];
  for (const name of order) {
    const sha = refs.get(name);
    if (sha) return sha;
  }
  return null;
}

export async function resolveRef(
  deps: Deps,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ ok: true; commit: string } | Failure> {
  const args = [...GIT_ANON_ARGS, 'ls-remote', `https://github.com/${owner}/${repo}.git`, ref];
  const result = await deps.git(args, cleanEnv());
  if (result.code !== 0) {
    const stderr = result.stderr.trim().slice(0, 300);
    if (/could not read (Username|Password)|Authentication failed|terminal prompts disabled|Invalid username/i.test(stderr)) {
      return fail('git-unauthenticated', `git needed credentials: ${stderr}`);
    }
    return fail('git-failed', `git ls-remote exited ${result.code}: ${stderr}`);
  }
  const commit = parseLsRemote(result.stdout, ref);
  if (!commit) return fail('ref-unresolved', `ref "${ref}" did not resolve to a commit (use a branch or tag name)`);
  return { ok: true, commit };
}

async function fetchRaw(
  deps: Deps,
  url: string,
  limit: number,
  what: string,
  missing: ReasonCode,
): Promise<{ ok: true; text: string; bytes: number; truncated: boolean } | Failure> {
  const result = await publicGet(deps, url);
  if (result.kind !== 'ok') return getFailure(result, what);
  const { response } = result;
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return fail(missing, `${what} returned 404`);
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    return fail('http-error', `${what} returned HTTP ${response.status}`);
  }
  return { ok: true, ...(await readLimited(response, limit)) };
}

export async function checkPublic(
  deps: Deps,
  input: { owner: string; repo: string; ref?: string; path?: string },
): Promise<PublicOk | Failure> {
  const checkedInput = validateSource({ ...input, ref: input.ref ?? 'HEAD' });
  if ('error' in checkedInput) return fail('invalid-source', checkedInput.error);
  let source = checkedInput.source;

  const repo = await fetchRepoInfo(deps, source.owner, source.repo);
  if (!repo.ok) return repo;
  if (input.ref === undefined) {
    const checked = validateSource({ ...source, ref: repo.defaultBranch });
    if ('error' in checked) return fail('invalid-source', `default branch: ${checked.error}`);
    source = checked.source;
  }

  const resolved = await resolveRef(deps, source.owner, source.repo, source.ref);
  if (!resolved.ok) return resolved;
  const { commit } = resolved;

  const manifestRes = await fetchRaw(deps, rawUrl(source, commit, 'manifest.json'), MAX_MANIFEST_BYTES, 'manifest.json', 'manifest-missing');
  if (!manifestRes.ok) return manifestRes;
  const pluginRes = await fetchRaw(deps, rawUrl(source, commit, 'plugin.js'), MAX_PLUGIN_BYTES, 'plugin.js', 'plugin-js-missing');
  if (!pluginRes.ok) return pluginRes;

  if (manifestRes.truncated) return fail('manifest-invalid', `manifest.json is larger than ${MAX_MANIFEST_BYTES} bytes`);
  const parsed = parseManifest(manifestRes.text);
  if ('error' in parsed) return fail(parsed.code, parsed.error);

  return {
    ok: true,
    source,
    commit,
    repo: { stars: repo.stars, defaultBranch: repo.defaultBranch },
    manifest: parsed.manifest,
    pluginJs: { text: pluginRes.text, bytes: pluginRes.bytes, truncated: pluginRes.truncated },
  };
}
