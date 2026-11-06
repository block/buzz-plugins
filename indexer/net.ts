import { execFile } from 'node:child_process';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Deps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  git: (args: string[], env: Record<string, string>) => Promise<GitResult>;
  sleep: (ms: number) => Promise<void>;
}

const PASSTHROUGH = [
  'PATH',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
];

export function cleanEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSTHROUGH) {
    const value = base[name];
    if (value !== undefined) env[name] = value;
  }
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_ASKPASS = '';
  env.GCM_INTERACTIVE = 'never';
  return env;
}

export const GIT_ANON_ARGS = ['-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'http.extraHeader='];

const FORBIDDEN_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

export const PUBLIC_HEADERS = {
  accept: 'application/vnd.github+json, application/json, text/plain, */*',
  'user-agent': 'buzz-plugins-public-indexer',
};

export function realDeps(): Deps {
  return {
    fetch: (url, init) => {
      for (const name of Object.keys(init.headers ?? {})) {
        if (FORBIDDEN_HEADERS.has(name.toLowerCase())) throw new Error(`refusing to send ${name} header`);
      }
      return fetch(url, { ...init, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    },
    git: (args, env) =>
      new Promise((resolve) => {
        execFile('git', args, { env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
          const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) + (error && code === 1 && !stderr ? error.message : '') });
        });
      }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export type GetResult =
  | { kind: 'ok'; response: Response }
  | { kind: 'rate-limited'; waitMs: number }
  | { kind: 'error'; detail: string };

export interface GetOptions {
  maxAttempts?: number;
  maxWaitMs?: number;
}

function rateLimitWait(response: Response, bodyText: string, now: number): number | null {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const limited =
    response.status === 429 ||
    (response.status === 403 &&
      (remaining === '0' || response.headers.has('retry-after') || /rate limit/i.test(bodyText)));
  if (!limited) return null;
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - now) + 1000;
  return 60_000;
}

export async function publicGet(
  deps: Deps,
  url: string,
  options: GetOptions = {},
  now: () => number = Date.now,
): Promise<GetResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  let lastDetail = 'no attempt made';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await deps.fetch(url, { method: 'GET', headers: { ...PUBLIC_HEADERS } });
    } catch (error) {
      lastDetail = `network error: ${error instanceof Error ? error.message : String(error)}`;
      if (attempt < maxAttempts) await deps.sleep(1000 * attempt);
      continue;
    }
    if (response.status === 403 || response.status === 429) {
      const body = await response.clone().text().catch(() => '');
      const wait = rateLimitWait(response, body, now());
      if (wait !== null) {
        if (wait > maxWaitMs || attempt === maxAttempts) return { kind: 'rate-limited', waitMs: wait };
        await deps.sleep(wait);
        continue;
      }
    }
    if (response.status >= 500) {
      lastDetail = `HTTP ${response.status}`;
      await response.body?.cancel().catch(() => {});
      if (attempt < maxAttempts) await deps.sleep(1000 * attempt);
      continue;
    }
    return { kind: 'ok', response };
  }
  return { kind: 'error', detail: lastDetail };
}

export async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', bytes: 0, truncated: false };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  return { text, bytes, truncated };
}
