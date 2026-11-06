import { parse } from 'yaml';
import { rawUrl } from './publicity.ts';
import { CATEGORIES } from './types.ts';
import type { Category, Listing, Media, Screenshot, SetupStep, Source } from './types.ts';
import type { Manifest } from './manifest.ts';

export const MAX_LISTING_BYTES = 64 * 1024;
export const MAX_SCREENSHOTS = 10;
export const MAX_SETUP_STEPS = 5;

export interface AuthorListing {
  tagline?: string;
  description?: string;
  category?: Category;
  tags?: string[];
  demo?: { video?: string; poster?: string; screenshots?: { src: string; caption?: string }[] };
  setup?: SetupStep[];
  links?: { docs?: string; support?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strictKeys(value: Record<string, unknown>, allowed: string[], where: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${where}: unknown field "${key}"`);
  }
}

function str(value: unknown, where: string, errors: string[], min: number, max: number): string | undefined {
  if (typeof value !== 'string') {
    errors.push(`${where}: must be a string`);
    return undefined;
  }
  const length = [...value].length;
  if (length < min || length > max) {
    errors.push(`${where}: must be ${min}-${max} characters (got ${length})`);
    return undefined;
  }
  return value;
}

function httpsUrl(value: unknown, where: string, errors: string[]): string | undefined {
  const text = str(value, where, errors, 1, 500);
  if (text === undefined) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('not https');
    return url.toString();
  } catch {
    errors.push(`${where}: must be an https URL`);
    return undefined;
  }
}

export function parseListingYaml(text: string): { listing: AuthorListing } | { errors: string[] } {
  if (Buffer.byteLength(text) > MAX_LISTING_BYTES) return { errors: [`buzz-listing.yaml is larger than ${MAX_LISTING_BYTES} bytes`] };
  let raw: unknown;
  try {
    raw = parse(text, { uniqueKeys: true, maxAliasCount: 10 });
  } catch (error) {
    return { errors: [`buzz-listing.yaml is not valid YAML: ${(error as Error).message.split('\n')[0]}`] };
  }
  if (raw === null || raw === undefined) return { listing: {} };
  if (!isRecord(raw)) return { errors: ['buzz-listing.yaml must be a mapping'] };

  const errors: string[] = [];
  const out: AuthorListing = {};
  strictKeys(raw, ['tagline', 'description', 'category', 'tags', 'demo', 'setup', 'links'], 'buzz-listing.yaml', errors);

  if ('tagline' in raw) out.tagline = str(raw.tagline, 'tagline', errors, 1, 100);
  if ('description' in raw) out.description = str(raw.description, 'description', errors, 0, 4000);
  if ('category' in raw) {
    if (typeof raw.category === 'string' && (CATEGORIES as readonly string[]).includes(raw.category)) {
      out.category = raw.category as Category;
    } else {
      errors.push(`category: must be one of ${CATEGORIES.join(', ')}`);
    }
  }
  if ('tags' in raw) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 8) {
      errors.push('tags: must be a list of at most 8 strings');
    } else {
      const tags = raw.tags.map((t, i) => str(t, `tags[${i}]`, errors, 1, 32));
      out.tags = [...new Set(tags.filter((t): t is string => t !== undefined))];
    }
  }
  if ('demo' in raw) {
    if (!isRecord(raw.demo)) {
      errors.push('demo: must be a mapping');
    } else {
      strictKeys(raw.demo, ['video', 'poster', 'screenshots'], 'demo', errors);
      const demo: NonNullable<AuthorListing['demo']> = {};
      if ('video' in raw.demo) demo.video = str(raw.demo.video, 'demo.video', errors, 1, 500);
      if ('poster' in raw.demo) demo.poster = str(raw.demo.poster, 'demo.poster', errors, 1, 500);
      if ('screenshots' in raw.demo) {
        const shots = raw.demo.screenshots;
        if (!Array.isArray(shots) || shots.length > MAX_SCREENSHOTS) {
          errors.push(`demo.screenshots: must be a list of at most ${MAX_SCREENSHOTS} items`);
        } else {
          demo.screenshots = [];
          shots.forEach((shot, i) => {
            const where = `demo.screenshots[${i}]`;
            if (!isRecord(shot)) return void errors.push(`${where}: must be a mapping`);
            strictKeys(shot, ['src', 'caption'], where, errors);
            const src = str(shot.src, `${where}.src`, errors, 1, 500);
            const caption = 'caption' in shot ? str(shot.caption, `${where}.caption`, errors, 0, 200) : undefined;
            if (src !== undefined) demo.screenshots!.push(caption === undefined ? { src } : { src, caption });
          });
        }
      }
      out.demo = demo;
    }
  }
  if ('setup' in raw) {
    if (!Array.isArray(raw.setup) || raw.setup.length > MAX_SETUP_STEPS) {
      errors.push(`setup: must be a list of at most ${MAX_SETUP_STEPS} steps`);
    } else {
      out.setup = [];
      raw.setup.forEach((step, i) => {
        const where = `setup[${i}]`;
        if (!isRecord(step)) return void errors.push(`${where}: must be a mapping`);
        strictKeys(step, ['title', 'detail', 'command'], where, errors);
        const title = str(step.title, `${where}.title`, errors, 1, 100);
        const detail = 'detail' in step ? str(step.detail, `${where}.detail`, errors, 0, 500) : undefined;
        const command = 'command' in step ? str(step.command, `${where}.command`, errors, 0, 300) : undefined;
        if (title !== undefined) {
          const entry: SetupStep = { title };
          if (detail) entry.detail = detail;
          if (command) entry.command = command;
          out.setup!.push(entry);
        }
      });
    }
  }
  if ('links' in raw) {
    if (!isRecord(raw.links)) {
      errors.push('links: must be a mapping');
    } else {
      strictKeys(raw.links, ['docs', 'support'], 'links', errors);
      const links: NonNullable<AuthorListing['links']> = {};
      if ('docs' in raw.links) links.docs = httpsUrl(raw.links.docs, 'links.docs', errors);
      if ('support' in raw.links) links.support = httpsUrl(raw.links.support, 'links.support', errors);
      out.links = links;
    }
  }
  return errors.length > 0 ? { errors } : { listing: out };
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function resolveMedia(
  value: string,
  where: string,
  kind: 'video' | 'image',
  source: Source,
  commit: string,
  errors: string[],
): Media | undefined {
  let url: string;
  let ext: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('not https');
      url = parsed.toString();
      ext = parsed.pathname.split('.').pop()?.toLowerCase() ?? '';
    } catch {
      errors.push(`${where}: URLs must be https`);
      return undefined;
    }
  } else {
    const segments = value.replace(/^\.\//, '').split('/');
    if (value.startsWith('/') || segments.some((s) => s === '' || s === '.' || s === '..' || !/^[A-Za-z0-9._ -]+$/.test(s))) {
      errors.push(`${where}: must be a plain repo-relative path or an https URL`);
      return undefined;
    }
    url = rawUrl(source, commit, segments.map(encodeURIComponent).join('/'));
    ext = segments[segments.length - 1]!.split('.').pop()?.toLowerCase() ?? '';
  }
  const type = MEDIA_TYPES[ext];
  if (!type || !type.startsWith(`${kind}/`)) {
    errors.push(`${where}: unsupported ${kind} file type ".${ext}"`);
    return undefined;
  }
  return { url, type };
}

export type ListingMeta = Pick<
  Listing,
  'tagline' | 'description' | 'category' | 'tags' | 'demo' | 'setup' | 'links'
>;

export interface ReadmeSources {
  atPath: string | null;
}

export function resolveMeta(input: {
  manifest: Manifest;
  author: AuthorListing | null;
  readme: ReadmeSources;
  source: Source;
  commit: string;
}): { meta: ListingMeta } | { errors: string[] } {
  const { manifest, author, readme, source, commit } = input;
  const errors: string[] = [];
  const cut = (text: string, max: number) => [...text].slice(0, max).join('');

  const readmeText = readme.atPath ?? '';
  const demo: ListingMeta['demo'] = { video: null, poster: null, screenshots: [] };
  if (author?.demo?.video) demo.video = resolveMedia(author.demo.video, 'demo.video', 'video', source, commit, errors) ?? null;
  if (author?.demo?.poster) demo.poster = resolveMedia(author.demo.poster, 'demo.poster', 'image', source, commit, errors) ?? null;
  (author?.demo?.screenshots ?? []).forEach((shot, i) => {
    const media = resolveMedia(shot.src, `demo.screenshots[${i}].src`, 'image', source, commit, errors);
    if (media) {
      const entry: Screenshot = shot.caption ? { ...media, caption: shot.caption } : media;
      demo.screenshots.push(entry);
    }
  });
  if (errors.length > 0) return { errors };

  const links: ListingMeta['links'] = { repository: `https://github.com/${source.owner}/${source.repo}` };
  if (author?.links?.docs) links.docs = author.links.docs;
  if (author?.links?.support) links.support = author.links.support;

  return {
    meta: {
      tagline: author?.tagline ?? cut(manifest.description, 100),
      description: author?.description ?? cut(readmeText, 4000),
      category: author?.category ?? manifest.category,
      tags: author?.tags ?? manifest.tags,
      demo,
      setup: author?.setup ?? [],
      links,
    },
  };
}
