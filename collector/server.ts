import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cli } from '../indexer/args.ts';
import { realDeps } from '../indexer/net.ts';
import type { Deps } from '../indexer/net.ts';
import { parsePending } from '../indexer/pending.ts';
import { isKey } from '../indexer/schema.ts';
import { validateSource } from '../indexer/sources.ts';
import { COMMIT_RE, PLUGIN_ID_RE } from '../indexer/types.ts';
import {
  MAX_PENDING_SOURCES,
  MAX_SUBMISSIONS_PER_IP_PER_DAY,
  checkSubmission,
  defaultPendingPath,
  pendingRow,
  readDenylist,
  sourceFromKey,
  summarize,
  validateSubmission,
} from './submit.ts';
import type { CheckResult } from './submit.ts';

export const MAX_BODY_BYTES = 1024;
export const MAX_PINGS_PER_IP_PER_DAY = 30;
export const MAX_VOTES_PER_IP_PER_DAY = 60;
const MAX_TRACKED_IPS = 1_000_000;
const INSTALLER_RE = /^[0-9a-f]{64}$/;
const CLIENT_RE = /^[A-Za-z0-9._/+-]{1,64}$/;

export interface CollectorOptions {
  storePath: string;
  votesPath?: string;
  indexPath: string;
  now?: () => number;
  trustProxy?: boolean;
  allowTimeOverride?: boolean;
  maxPerDay?: number;
  maxVotesPerDay?: number;
  maxSubmissionsPerDay?: number;
  pendingPath?: string;
  denylistPath?: string;
  deps?: Deps;
}

export function defaultVotesPath(storePath: string): string {
  return storePath.endsWith('.jsonl') ? `${storePath.slice(0, -'.jsonl'.length)}.votes.jsonl` : `${storePath}.votes`;
}

function expandIPv6(address: string): string[] {
  const [head = '', tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = address.includes('::') ? Array(Math.max(0, 8 - left.length - right.length)).fill('0') : [];
  return [...left, ...fill, ...right].map((g) => g.padStart(4, '0'));
}

export function ipBucket(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1]!;
  if (!address.includes(':')) return address;
  return `${expandIPv6(address.split('%')[0]!.toLowerCase()).slice(0, 4).join(':')}::/64`;
}

type Validated = { ok: true; key: string; id: string; commit: string; installer: string; ref?: string } | { ok: false };

export function validatePing(body: unknown): Validated {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const { key, id, commit, installer, client, ref } = body as Record<string, unknown>;
  if (
    !isKey(key) || key.length > 300 ||
    typeof id !== 'string' || !PLUGIN_ID_RE.test(id) ||
    typeof commit !== 'string' || !COMMIT_RE.test(commit) ||
    typeof installer !== 'string' || !INSTALLER_RE.test(installer) ||
    typeof client !== 'string' || !CLIENT_RE.test(client) ||
    (ref !== undefined && (typeof ref !== 'string' || 'error' in validateSource({ owner: 'o', repo: 'r', ref })))
  ) {
    return { ok: false };
  }
  return ref === undefined ? { ok: true, key, id, commit, installer } : { ok: true, key, id, commit, installer, ref };
}

type ValidatedVote = { ok: true; key: string; id: string; voter: string; vote: 0 | 1 } | { ok: false };

export function validateVote(body: unknown): ValidatedVote {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const { key, id, voter, vote, client } = body as Record<string, unknown>;
  if (
    !isKey(key) || key.length > 300 ||
    typeof id !== 'string' || !PLUGIN_ID_RE.test(id) ||
    typeof voter !== 'string' || !INSTALLER_RE.test(voter) ||
    (vote !== 0 && vote !== 1) ||
    typeof client !== 'string' || !CLIENT_RE.test(client)
  ) {
    return { ok: false };
  }
  return { ok: true, key, id, voter, vote };
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data');
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createCollector(options: CollectorOptions): Server {
  const now = options.now ?? Date.now;
  const maxPerDay = options.maxPerDay ?? MAX_PINGS_PER_IP_PER_DAY;
  mkdirSync(dirname(options.storePath), { recursive: true });

  const maxVotesPerDay = options.maxVotesPerDay ?? MAX_VOTES_PER_IP_PER_DAY;
  const votesPath = options.votesPath ?? defaultVotesPath(options.storePath);
  mkdirSync(dirname(votesPath), { recursive: true });

  const dailyCounter = () => {
    let counts = new Map<string, number>();
    let countsDay = '';
    return (bucket: string, at: number): number | null => {
      const day = new Date(at).toISOString().slice(0, 10);
      if (day !== countsDay) {
        counts = new Map();
        countsDay = day;
      }
      if (!counts.has(bucket) && counts.size >= MAX_TRACKED_IPS) return null;
      const n = (counts.get(bucket) ?? 0) + 1;
      counts.set(bucket, n);
      return n;
    };
  };
  const countPing = dailyCounter();
  const countVote = dailyCounter();
  const countSubmission = dailyCounter();
  const maxSubmissionsPerDay = options.maxSubmissionsPerDay ?? MAX_SUBMISSIONS_PER_IP_PER_DAY;
  const pendingPath = options.pendingPath ?? defaultPendingPath(options.storePath);
  mkdirSync(dirname(pendingPath), { recursive: true });
  const baseDeps = options.deps ?? realDeps();
  const deps: Deps = { ...baseDeps, sleep: (ms) => baseDeps.sleep(Math.min(ms, 3000)) };

  const installerId = (key: string, installer: string) => `${key}\n${installer}`;
  let installers: Promise<Set<string>> | null = null;
  const knownInstallers = (): Promise<Set<string>> => {
    installers ??= readFile(options.storePath, 'utf8')
      .catch(() => '')
      .then((text) => {
        const set = new Set<string>();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line) as { key?: unknown; installer?: unknown };
            if (typeof row.key === 'string' && typeof row.installer === 'string') set.add(installerId(row.key, row.installer));
          } catch {
            /* unreadable rows are skipped, as rank.ts does */
          }
        }
        return set;
      });
    return installers;
  };

  let known = { mtimeMs: -1, size: -1, keys: new Set<string>() };
  const knownKeys = async (): Promise<Set<string>> => {
    try {
      const s = await stat(options.indexPath);
      if (s.mtimeMs !== known.mtimeMs || s.size !== known.size) {
        const index = JSON.parse(await readFile(options.indexPath, 'utf8')) as { plugins?: { key?: unknown }[] };
        const keys = new Set<string>();
        for (const p of index.plugins ?? []) if (typeof p.key === 'string') keys.add(p.key);
        known = { mtimeMs: s.mtimeMs, size: s.size, keys };
      }
      return known.keys;
    } catch {
      return new Set();
    }
  };

  let pending: Promise<Map<string, string>> | null = null;
  const pendingKeys = (): Promise<Map<string, string>> => {
    pending ??= readFile(pendingPath, 'utf8')
      .catch(() => '')
      .then((text) => new Map(parsePending(text).map((row) => [row.key.toLowerCase(), row.id])));
    return pending;
  };
  const isListed = async (key: string): Promise<boolean> => {
    const lower = key.toLowerCase();
    for (const k of await knownKeys()) if (k.toLowerCase() === lower) return true;
    return false;
  };

  let writes: Promise<unknown> = Promise.resolve();
  const append = (path: string, line: string): Promise<void> => {
    const next = writes.then(() => appendFile(path, line, { flag: 'a' }));
    writes = next.catch(() => {});
    return next;
  };

  const clientBucket = (req: IncomingMessage): string => {
    if (options.trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim();
      if (forwarded) return ipBucket(forwarded);
    }
    return ipBucket(req.socket.remoteAddress ?? 'unknown');
  };

  const closeAfter = (req: IncomingMessage, res: ServerResponse) => res.once('finish', () => req.socket.destroy());

  const readRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    count: (bucket: string, at: number) => number | null,
    limit: number,
  ): Promise<{ at: number; body: unknown } | null> => {
    let at = now();
    if (options.allowTimeOverride && req.headers['x-collector-time']) {
      const override = Date.parse(String(req.headers['x-collector-time']));
      if (Number.isNaN(override)) {
        send(res, 400, { error: 'bad time' });
        return null;
      }
      at = override;
    }
    const n = count(clientBucket(req), now());
    if (n === null || n > limit) {
      closeAfter(req, res);
      send(res, 429, { error: 'rate limited' }, { connection: 'close', 'retry-after': '3600' });
      return null;
    }
    const tooBig = () => {
      closeAfter(req, res);
      send(res, 400, { error: 'body too large' }, { connection: 'close' });
      return null;
    };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooBig();
    const raw = await readBody(req);
    if (raw === null) return tooBig();
    try {
      return { at, body: JSON.parse(raw.toString('utf8')) };
    } catch {
      send(res, 400, { error: 'malformed body' });
      return null;
    }
  };

  const store = async (res: ServerResponse, path: string, row: object): Promise<boolean> => {
    try {
      await append(path, `${JSON.stringify(row)}\n`);
      return true;
    } catch {
      send(res, 500, { error: 'storage failure' });
      return false;
    }
  };

  const overSubmissionBudget = (req: IncomingMessage, res: ServerResponse): boolean => {
    const n = countSubmission(clientBucket(req), now());
    if (n !== null && n <= maxSubmissionsPerDay) return false;
    send(res, 429, { error: 'rate limited' }, { 'retry-after': '3600' });
    return true;
  };

  const queue = async (res: ServerResponse, checked: Extract<CheckResult, { ok: true }>, at: number, rejectStatus: 404 | 422): Promise<'queued' | 'listed' | null> => {
    const { listing } = checked;
    if ((await readDenylist(options.denylistPath)).has(listing.key.toLowerCase())) {
      send(res, rejectStatus, { error: rejectStatus === 404 ? 'unknown key' : 'not listable', reason: 'denylisted', detail: `${listing.key} is in the denylist` });
      return null;
    }
    if (await isListed(listing.key)) return 'listed';
    const keys = await pendingKeys();
    const lower = listing.key.toLowerCase();
    if (keys.has(lower)) return 'queued';
    if (keys.size >= MAX_PENDING_SOURCES) {
      send(res, 503, { error: 'queue full' }, { 'retry-after': '3600' });
      return null;
    }
    keys.set(lower, listing.id);
    if (!(await store(res, pendingPath, pendingRow(listing, at)))) {
      keys.delete(lower);
      return null;
    }
    return 'queued';
  };

  const sendCheckFailure = (res: ServerResponse, failure: Extract<CheckResult, { ok: false }>, status: number) =>
    failure.transient
      ? send(res, 503, { error: 'check unavailable', reason: failure.reason, detail: failure.detail }, { 'retry-after': '600' })
      : send(res, status, { error: status === 404 ? 'unknown key' : 'not listable', reason: failure.reason, detail: failure.detail });

  const postSource = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const request = await readRequest(req, res, countSubmission, maxSubmissionsPerDay);
    if (!request) return;
    const body = validateSubmission(request.body);
    if (!body.ok) return send(res, 400, { error: 'malformed body' });
    const checked = await checkSubmission(deps, body.submission, now);
    if (!checked.ok) return sendCheckFailure(res, checked, 422);
    const status = await queue(res, checked, request.at, 422);
    if (status) send(res, 200, { status, listing: summarize(checked.listing) });
  };

  const admitUnlisted = async (req: IncomingMessage, res: ServerResponse, ping: Extract<Validated, { ok: true }>, at: number): Promise<boolean> => {
    const queued = (await pendingKeys()).get(ping.key.toLowerCase());
    if (queued !== undefined) {
      if (queued === ping.id) return true;
      send(res, 404, { error: 'unknown key', reason: 'id-mismatch', detail: 'the queued source has a different manifest id' });
      return false;
    }
    if (overSubmissionBudget(req, res)) return false;
    const source = sourceFromKey(ping.key);
    if (!source) {
      send(res, 404, { error: 'unknown key' });
      return false;
    }
    const checked = await checkSubmission(deps, { repository: `${source.owner}/${source.repo}`, ref: ping.ref, path: source.path }, now);
    if (!checked.ok) {
      sendCheckFailure(res, checked, 404);
      return false;
    }
    if (checked.listing.key !== ping.key || checked.listing.id !== ping.id) {
      send(res, 404, { error: 'unknown key', reason: 'id-mismatch', detail: `the source's manifest id is ${checked.listing.id}` });
      return false;
    }
    return (await queue(res, checked, at, 404)) !== null;
  };

  const postInstall = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const request = await readRequest(req, res, countPing, maxPerDay);
    if (!request) return;
    const ping = validatePing(request.body);
    if (!ping.ok) return send(res, 400, { error: 'malformed body' });
    if (!(await knownKeys()).has(ping.key) && !(await admitUnlisted(req, res, ping, request.at))) return;
    const row = { ts: new Date(request.at).toISOString(), key: ping.key, id: ping.id, commit: ping.commit, installer: ping.installer };
    if (!(await store(res, options.storePath, row))) return;
    if (installers) (await installers).add(installerId(ping.key, ping.installer));
    send(res, 202, {});
  };

  const postVote = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const request = await readRequest(req, res, countVote, maxVotesPerDay);
    if (!request) return;
    const vote = validateVote(request.body);
    if (!vote.ok) return send(res, 400, { error: 'malformed body' });
    if (!(await knownKeys()).has(vote.key)) return send(res, 404, { error: 'unknown key' });
    await writes;
    if (!(await knownInstallers()).has(installerId(vote.key, vote.voter))) return send(res, 403, { error: 'install first' });
    const row = { ts: new Date(request.at).toISOString(), key: vote.key, id: vote.id, voter: vote.voter, vote: vote.vote };
    if (!(await store(res, votesPath, row))) return;
    send(res, 202, {});
  };

  const getPending = async (res: ServerResponse): Promise<void> => {
    await writes;
    const body = await readFile(pendingPath, 'utf8').catch(() => '');
    send(res, 200, body, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
  };

  const getIndex = async (res: ServerResponse): Promise<void> => {
    let body: string;
    try {
      body = await readFile(options.indexPath, 'utf8');
      JSON.parse(body);
    } catch {
      return send(res, 503, { error: 'index not available' }, { 'access-control-allow-origin': '*' });
    }
    send(res, 200, body, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' });
  };

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://collector').pathname;
    const handle = async () => {
      if (path === '/v1/installs') {
        if (req.method === 'POST') return postInstall(req, res);
        return send(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
      }
      if (path === '/v1/sources') {
        if (req.method === 'POST') return postSource(req, res);
        return send(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
      }
      if (path === '/v1/pending-sources.jsonl') {
        if (req.method === 'GET') return getPending(res);
        return send(res, 405, { error: 'method not allowed' }, { allow: 'GET' });
      }
      if (path === '/v1/votes') {
        if (req.method === 'POST') return postVote(req, res);
        return send(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
      }
      if (path === '/v1/index.json') {
        if (req.method === 'GET' || req.method === 'HEAD') return getIndex(res);
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, HEAD, OPTIONS',
            'access-control-max-age': '86400',
          });
          return void res.end();
        }
        return send(res, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD, OPTIONS' });
      }
      send(res, 404, { error: 'not found' });
    };
    handle().catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 50;
  return server;
}

function main(): void {
  const { values } = cli({
    port: { type: 'string' },
    host: { type: 'string' },
    store: { type: 'string' },
    votes: { type: 'string' },
    index: { type: 'string' },
    pending: { type: 'string' },
    denylist: { type: 'string' },
    'trust-proxy': { type: 'boolean' },
    'allow-time-override': { type: 'boolean' },
  });
  if (!values.store || !values.index) {
    console.error('usage: server.ts --port 8787 --store <installs.jsonl> [--votes <votes.jsonl>] [--pending <pending-sources.jsonl>] [--denylist denylist.txt] --index <index.json> [--host 127.0.0.1] [--trust-proxy]');
    process.exit(2);
  }
  const host = values.host ?? '127.0.0.1';
  if (values['allow-time-override'] && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    console.error('--allow-time-override is only for loopback hosts');
    process.exit(2);
  }
  const server = createCollector({
    storePath: values.store,
    votesPath: values.votes,
    indexPath: values.index,
    pendingPath: values.pending,
    denylistPath: values.denylist,
    trustProxy: values['trust-proxy'],
    allowTimeOverride: values['allow-time-override'],
  });
  server.listen(Number(values.port ?? 8787), host, () => console.log(`collector listening on http://${host}:${values.port ?? 8787}`));
}

if (import.meta.main) main();
