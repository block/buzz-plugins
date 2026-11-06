import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildListing } from '../indexer/build.ts';
import type { Deps } from '../indexer/net.ts';
import type { ReasonCode } from '../indexer/publicity.ts';
import type { PendingRow } from '../indexer/pending.ts';
import { parseKeyList, parseRepository, validateSource } from '../indexer/sources.ts';
import type { Listing } from '../indexer/types.ts';

export const MAX_SUBMISSIONS_PER_IP_PER_DAY = 20;
export const MAX_PENDING_SOURCES = 5000;

const TRANSIENT: ReadonlySet<string> = new Set<ReasonCode>(['rate-limited', 'network-error', 'repo-unavailable']);

export interface Submission {
  repository: string;
  ref?: string;
  path?: string;
}

export interface ListingSummary {
  key: string;
  slug: string;
  id: string;
  name: string;
  tagline: string;
  category: string;
  official: boolean;
  source: Listing['source'];
  audit: { tier: Listing['audit']['tier']; flags: string[]; cleared: boolean };
}

export type CheckResult =
  | { ok: true; listing: Listing }
  | { ok: false; reason: string; detail: string; transient: boolean };

export function defaultPendingPath(storePath: string): string {
  return join(dirname(storePath), 'pending-sources.jsonl');
}

const optionalString = (value: unknown, max: number): string | undefined | null => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) return null;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export function validateSubmission(body: unknown): { ok: true; submission: Submission } | { ok: false } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const record = body as Record<string, unknown>;
  const repository = optionalString(record.repository, 200);
  const ref = optionalString(record.ref, 200);
  const path = optionalString(record.path, 300);
  if (!repository || ref === null || path === null) return { ok: false };
  return { ok: true, submission: { repository, ref, path } };
}

export function sourceFromKey(key: string): { owner: string; repo: string; path: string } | null {
  const [host, owner, repo, ...rest] = key.split('/');
  if (host !== 'github.com' || !owner || !repo) return null;
  return { owner, repo, path: rest.join('/') };
}

export function summarize(listing: Listing): ListingSummary {
  return {
    key: listing.key,
    slug: listing.slug,
    id: listing.id,
    name: listing.name,
    tagline: listing.tagline,
    category: listing.category,
    official: listing.official,
    source: listing.source,
    audit: { tier: listing.audit.tier, flags: listing.audit.flags.map((f) => f.code), cleared: listing.audit.cleared },
  };
}

export async function checkSubmission(deps: Deps, submission: Submission, now: () => number): Promise<CheckResult> {
  const repository = parseRepository(submission.repository);
  if (!repository) return { ok: false, reason: 'invalid-source', detail: `expected owner/repo, got "${submission.repository}"`, transient: false };
  const input = { ...repository, ref: submission.ref, path: submission.path };
  const valid = validateSource({ ...input, ref: input.ref ?? 'HEAD' });
  if ('error' in valid) return { ok: false, reason: 'invalid-source', detail: valid.error, transient: false };
  const built = await buildListing(deps, input, { now, previous: new Map(), cleared: new Set() });
  if (!built.ok) return { ok: false, reason: built.reason, detail: built.detail, transient: TRANSIENT.has(built.reason) };
  return { ok: true, listing: built.listing };
}

export function pendingRow(listing: Listing, at: number): PendingRow {
  return {
    ts: new Date(at).toISOString(),
    key: listing.key,
    id: listing.id,
    repository: listing.source.repository,
    ref: listing.source.ref,
    path: listing.source.path,
    commit: listing.source.commit,
  };
}

export async function readDenylist(path: string | undefined): Promise<Set<string>> {
  if (!path) return new Set();
  const text = await readFile(path, 'utf8').catch(() => '');
  return new Set(parseKeyList(text).map((k) => k.toLowerCase()));
}
