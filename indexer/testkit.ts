import type { Deps, GitResult } from './net.ts';

export type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

export const COMMIT = 'a'.repeat(40);
export const NOW = Date.parse('2026-11-05T23:00:00Z');

export interface Mock {
  deps: Deps;
  fetchCalls: { url: string; headers: Record<string, string> }[];
  gitCalls: { args: string[]; env: Record<string, string> }[];
  sleeps: number[];
  routes: Map<string, Reply | Reply[]>;
}

function toResponse(reply: Reply): Response {
  if (reply instanceof Error) throw reply;
  const body = reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
  return new Response(reply.status === 204 || reply.status === 304 ? null : body, { status: reply.status, headers: reply.headers });
}

export function mock(
  routes: Record<string, Reply | Reply[]>,
  git: (args: string[]) => GitResult = () => ({ code: 0, stdout: `${COMMIT}\trefs/heads/main\n`, stderr: '' }),
): Mock {
  const state: Mock = { fetchCalls: [], gitCalls: [], sleeps: [], routes: new Map(Object.entries(routes)), deps: undefined as never };
  state.deps = {
    fetch: async (url, init) => {
      state.fetchCalls.push({ url, headers: { ...(init.headers as Record<string, string>) } });
      const entry = state.routes.get(url);
      if (entry === undefined) return new Response('not found', { status: 404 });
      if (Array.isArray(entry)) return toResponse(entry.length > 1 ? entry.shift()! : entry[0]!);
      return toResponse(entry);
    },
    git: async (args, env) => {
      state.gitCalls.push({ args, env });
      return git(args);
    },
    sleep: async (ms) => {
      state.sleeps.push(ms);
    },
  };
  return state;
}

export interface RepoFixture {
  owner?: string;
  repo?: string;
  path?: string;
  manifest?: unknown;
  pluginJs?: string;
  readme?: string | null;
  rootReadme?: string | null;
  listingYaml?: string | null;
  stars?: number;
  commit?: string;
  commitDate?: string;
}

export function repoRoutes(f: RepoFixture = {}): Record<string, Reply> {
  const owner = f.owner ?? 'octo';
  const repo = f.repo ?? 'plug';
  const commit = f.commit ?? COMMIT;
  const dir = f.path ? `${f.path}/` : '';
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${commit}`;
  const routes: Record<string, Reply> = {
    [`https://api.github.com/repos/${owner}/${repo}`]: {
      status: 200,
      body: { private: false, stargazers_count: f.stars ?? 7, default_branch: 'main' },
    },
    [`https://api.github.com/repos/${owner}/${repo}/commits/${commit}`]: {
      status: 200,
      body: { commit: { committer: { date: f.commitDate ?? '2026-11-04T10:20:30Z' } } },
    },
    [`${raw}/${dir}manifest.json`]: {
      status: 200,
      body: f.manifest ?? { id: 'octo.plug', name: 'Plug', apiVersion: 1, description: 'Does a thing.' },
    },
    [`${raw}/${dir}plugin.js`]: { status: 200, body: f.pluginJs ?? 'export default {};' },
  };
  if (f.readme != null) routes[`${raw}/${dir}README.md`] = { status: 200, body: f.readme };
  if (f.rootReadme != null) routes[`${raw}/README.md`] = { status: 200, body: f.rootReadme };
  if (f.listingYaml != null) routes[`${raw}/${dir}buzz-listing.yaml`] = { status: 200, body: f.listingYaml };
  return routes;
}
