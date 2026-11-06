import { audit } from './audit.ts';
import { parseListingYaml, resolveMeta } from './listing.ts';
import type { AuthorListing } from './listing.ts';
import { publicGet, readLimited } from './net.ts';
import type { Deps } from './net.ts';
import { checkPublic, fail, getFailure, rawUrl } from './publicity.ts';
import type { Failure } from './publicity.ts';
import { listingKey, slugify } from './slug.ts';
import { isoSeconds } from './time.ts';
import type { Listing, Source } from './types.ts';

export interface BuildContext {
  now: () => number;
  previous: Map<string, Listing>;
  cleared: Set<string>;
}

const TEXT_LIMIT = 256 * 1024;

async function fetchOptionalText(deps: Deps, url: string, what: string): Promise<{ ok: true; text: string | null } | Failure> {
  const result = await publicGet(deps, url);
  if (result.kind !== 'ok') return getFailure(result, what);
  const { response } = result;
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return { ok: true, text: null };
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    return fail('http-error', `${what} returned HTTP ${response.status}`);
  }
  const { text, truncated } = await readLimited(response, TEXT_LIMIT);
  return truncated && what === 'buzz-listing.yaml'
    ? fail('listing-invalid', 'buzz-listing.yaml is too large')
    : { ok: true, text };
}

async function fetchCommitDate(deps: Deps, source: Source, commit: string): Promise<{ ok: true; date: string } | Failure> {
  const result = await publicGet(deps, `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${commit}`);
  if (result.kind !== 'ok') return getFailure(result, 'GitHub API commit lookup');
  if (result.response.status !== 200) return fail('http-error', `GitHub API commit lookup returned HTTP ${result.response.status}`);
  try {
    const body = (await result.response.json()) as { commit?: { committer?: { date?: string }; author?: { date?: string } } };
    const date = body.commit?.committer?.date ?? body.commit?.author?.date;
    const time = date ? Date.parse(date) : NaN;
    if (Number.isNaN(time)) return fail('http-error', 'GitHub API commit lookup returned no commit date');
    return { ok: true, date: isoSeconds(time) };
  } catch {
    return fail('http-error', 'GitHub API commit lookup returned a body that is not JSON');
  }
}

export async function buildListing(
  deps: Deps,
  input: { owner: string; repo: string; ref?: string; path?: string },
  ctx: BuildContext,
): Promise<{ ok: true; listing: Listing } | Failure> {
  const checked = await checkPublic(deps, input);
  if (!checked.ok) return checked;
  const { source, commit, manifest } = checked;

  const listingRes = await fetchOptionalText(deps, rawUrl(source, commit, 'buzz-listing.yaml'), 'buzz-listing.yaml');
  if (!listingRes.ok) return listingRes;
  let author: AuthorListing | null = null;
  if (listingRes.text !== null) {
    const parsed = parseListingYaml(listingRes.text);
    if ('errors' in parsed) return fail('listing-invalid', parsed.errors.join('; '));
    author = parsed.listing;
  }

  const readme = { atPath: null as string | null };
  if (author?.description === undefined) {
    const atPath = await fetchOptionalText(deps, rawUrl(source, commit, 'README.md'), 'README.md');
    if (!atPath.ok) return atPath;
    readme.atPath = atPath.text;
  }

  const date = await fetchCommitDate(deps, source, commit);
  if (!date.ok) return date;

  const resolved = resolveMeta({ manifest, author, readme, source, commit });
  if ('errors' in resolved) return fail('listing-invalid', resolved.errors.join('; '));

  const key = listingKey(source);
  const repository = `https://github.com/${source.owner}/${source.repo}`;
  const listing: Listing = {
    key,
    slug: slugify(key),
    id: manifest.id,
    name: manifest.name,
    tagline: resolved.meta.tagline,
    description: resolved.meta.description,
    category: resolved.meta.category,
    tags: resolved.meta.tags,
    author: { github: source.owner },
    official: source.owner.toLowerCase() === 'block',
    source: { repository, ref: source.ref, commit, path: source.path },
    host: manifest.host,
    audit: audit({
      key,
      commit,
      host: manifest.host,
      plugin: checked.pluginJs,
      previousHost: ctx.previous.get(key)?.host,
      cleared: ctx.cleared,
      checkedAt: isoSeconds(ctx.now()),
    }),
    demo: resolved.meta.demo,
    setup: resolved.meta.setup,
    links: resolved.meta.links,
    stars: checked.repo.stars,
    updatedAt: date.date,
  };
  return { ok: true, listing };
}
