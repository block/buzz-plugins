import type { Context } from "@buzz/author";
import snapshot from "../../fixtures/index.json";

export type Media = Readonly<{ url: string; type?: string; caption?: string }>;
export type SetupStep = Readonly<{ title: string; detail?: string; command?: string }>;
export type AuditTier = "low" | "medium" | "high";
export type AuditFlag = Readonly<{ code: string; detail: string }>;
export type Listing = Readonly<{
  key: string;
  slug: string;
  id: string;
  name: string;
  tagline: string;
  description?: string;
  category: string;
  tags?: readonly string[];
  author: Readonly<{ github: string }>;
  official: boolean;
  source: Readonly<{ repository: string; ref: string; commit: string; path?: string }>;
  host: Readonly<{
    networkOrigins?: readonly string[];
    processes?: readonly string[];
    commands?: readonly string[];
    files?: boolean;
    mcp?: boolean;
    agentHooks?: boolean;
  }>;
  audit: Readonly<{ tier: AuditTier; flags: readonly AuditFlag[]; accessChanged?: boolean; cleared: boolean; checkedAt?: string }>;
  demo?: Readonly<{ video?: Media | null; poster?: Media | null; screenshots?: readonly Media[] }>;
  setup?: readonly SetupStep[];
  links?: Readonly<Record<string, string>>;
  stars?: number;
  updatedAt?: string;
  installs: Readonly<{ allTime: number; last24h: number; last7d: number }>;
  upvotes?: number;
}>;
export type Rankings = Readonly<{
  allTime: readonly string[];
  trending: readonly string[];
  hot: readonly string[];
  mostUpvoted: readonly string[];
}>;
export type Index = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  collectionStartedAt: string;
  plugins: readonly Listing[];
  rankings: Rankings;
}>;
export type Sort = keyof Rankings;

export const INDEX_ORIGIN = "https://plugins.buzz.example";
const INDEX_URL = `${INDEX_ORIGIN}/v1/index.json`;

export const categories: Readonly<Record<string, string>> = {
  communication: "Communication",
  agents: "Agents",
  "agent-tools": "Agent tools",
  "developer-tools-and-integrations": "Developer tools",
  "people-and-communities": "People & communities",
  productivity: "Productivity",
};

export const sorts: readonly Readonly<{ id: Sort; label: string }>[] = [
  { id: "allTime", label: "All time" },
  { id: "trending", label: "Trending" },
  { id: "hot", label: "Hot" },
  { id: "mostUpvoted", label: "Most upvoted" },
];

const KEY = /^github\.com\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})((?:\/[A-Za-z0-9._@+-]{1,100}){0,8})$/;

export function parseKey(key: string): { owner: string; repo: string; path: string } | null {
  const match = KEY.exec(key);
  if (!match || match[3].split("/").some((segment) => segment === "." || segment === "..")) return null;
  return { owner: match[1], repo: match[2], path: match[3].slice(1) };
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const strings = (value: unknown) => value === undefined || (Array.isArray(value) && value.every(text));
const flag = (value: unknown) => value === undefined || typeof value === "boolean";
const https = (url: unknown) => typeof url === "string" && /^https:\/\/[^\s/]+\/\S*$/.test(url);
const media = (value: unknown) => value == null || (!!value && typeof value === "object" && https((value as Media).url));

function validListing(value: unknown): value is Listing {
  const listing = value as Listing;
  if (!listing || typeof listing !== "object") return false;
  const parts = typeof listing.key === "string" ? parseKey(listing.key) : null;
  if (!parts) return false;
  const { host, audit, source, installs, demo } = listing;
  return (
    /^[a-z0-9-]{1,120}$/.test(String(listing.slug)) &&
    /^[a-z][a-z0-9.-]{0,79}$/.test(String(listing.id)) &&
    text(listing.name) &&
    typeof listing.tagline === "string" &&
    (listing.description === undefined || typeof listing.description === "string") &&
    Object.hasOwn(categories, listing.category) &&
    strings(listing.tags) &&
    text(listing.author?.github) &&
    listing.official === (parts.owner === "block") &&
    source?.repository === `https://github.com/${parts.owner}/${parts.repo}` &&
    text(source.ref) &&
    /^[0-9a-f]{40}$/.test(String(source.commit)) &&
    (source.path === undefined || source.path === parts.path) &&
    !!host &&
    typeof host === "object" &&
    (host.networkOrigins ?? []).every((origin) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) &&
    strings(host.processes) &&
    strings(host.commands) &&
    [host.files, host.mcp, host.agentHooks].every(flag) &&
    ["low", "medium", "high"].includes(String(audit?.tier)) &&
    Array.isArray(audit.flags) &&
    audit.flags.every((item) => text(item?.code) && text(item?.detail)) &&
    typeof audit.cleared === "boolean" &&
    !!installs &&
    [installs.allTime, installs.last24h, installs.last7d].every(count) &&
    (listing.upvotes === undefined || count(listing.upvotes)) &&
    (demo === undefined ||
      (media(demo.video) && media(demo.poster) && (demo.screenshots ?? []).every((shot) => media(shot)))) &&
    (listing.setup ?? []).every((step) => text(step?.title)) &&
    (listing.links === undefined || (!!listing.links && typeof listing.links === "object"))
  );
}

function sanitizeRankings(value: unknown, plugins: readonly Listing[]): Rankings {
  const byKey = new Map(plugins.map((plugin) => [plugin.key, plugin]));
  const listed = (name: Sort, eligible: (plugin: Listing) => boolean) => {
    const raw = (value as Record<string, unknown> | undefined)?.[name];
    const seen = new Set<string>();
    for (const key of Array.isArray(raw) ? raw : []) {
      const plugin = typeof key === "string" ? byKey.get(key) : undefined;
      if (plugin && eligible(plugin)) seen.add(plugin.key);
    }
    return [...seen];
  };
  const allTime = listed("allTime", () => true);
  const rest = plugins
    .filter((plugin) => !allTime.includes(plugin.key))
    .sort((a, b) => b.installs.allTime - a.installs.allTime)
    .map((plugin) => plugin.key);
  return {
    allTime: [...allTime, ...rest],
    trending: listed("trending", (plugin) => plugin.audit.cleared),
    hot: listed("hot", (plugin) => plugin.audit.cleared),
    mostUpvoted: listed("mostUpvoted", (plugin) => plugin.audit.cleared && (plugin.upvotes ?? 0) > 0),
  };
}

export function parseIndex(value: unknown): Index | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || raw.schemaVersion !== 1 || !Array.isArray(raw.plugins)) return null;
  const slugs = new Set<string>();
  const keys = new Set<string>();
  const plugins = raw.plugins.filter((plugin): plugin is Listing => {
    if (!validListing(plugin) || slugs.has(plugin.slug) || keys.has(plugin.key)) return false;
    slugs.add(plugin.slug);
    keys.add(plugin.key);
    return true;
  });
  if (raw.plugins.length && !plugins.length) return null;
  const generatedAt = Date.parse(String(raw.generatedAt));
  const collectionStartedAt = Date.parse(String(raw.collectionStartedAt));
  if (!Number.isFinite(generatedAt) || !Number.isFinite(collectionStartedAt)) return null;
  return {
    schemaVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    collectionStartedAt: new Date(collectionStartedAt).toISOString(),
    plugins,
    rankings: sanitizeRankings(raw.rankings, plugins),
  };
}

export const bundledIndex: Index = parseIndex(snapshot) ?? {
  schemaVersion: 1,
  generatedAt: new Date(0).toISOString(),
  collectionStartedAt: new Date(0).toISOString(),
  plugins: [],
  rankings: { allTime: [], trending: [], hot: [], mostUpvoted: [] },
};

export async function loadIndex(host: Context["host"] | undefined): Promise<{ index: Index; live: boolean }> {
  if (!host) return { index: bundledIndex, live: false };
  try {
    const response = await host.request({ url: INDEX_URL, timeoutMs: 8000 });
    if (response.status !== 200) throw new Error(`index ${response.status}`);
    const index = parseIndex(JSON.parse(response.body));
    if (!index) throw new Error("invalid index");
    return { index, live: true };
  } catch {
    return { index: bundledIndex, live: false };
  }
}

export function ranked(index: Index, sort: Sort): Listing[] {
  const byKey = new Map(index.plugins.map((plugin) => [plugin.key, plugin]));
  return index.rankings[sort].flatMap((key) => byKey.get(key) ?? []);
}

export function search(plugins: readonly Listing[], query: string, category: string | null) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return plugins.filter((plugin) => {
    if (category && plugin.category !== category) return false;
    if (!words.length) return true;
    const haystack = [plugin.name, plugin.tagline, plugin.description, plugin.author.github, ...(plugin.tags ?? [])]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function accessSummary(host: Listing["host"] | undefined): string[] {
  if (!host) return [];
  return [
    ...(host.networkOrigins ?? []).map((origin) => `Connect to ${origin.replace(/^https:\/\//, "")}`),
    ...(host.processes ?? []).map((process) => `Run \`${process}\``),
    ...(host.commands ?? []).map((command) => `Run \`${command}\``),
    ...(host.files ? ["Read files on this Mac"] : []),
    ...(host.mcp ? ["Serve tools to your agents (MCP)"] : []),
    ...(host.agentHooks ? ["Observe and steer agent turns"] : []),
  ];
}

export const tierLabels: Readonly<Record<AuditTier, string>> = {
  low: "Low access",
  medium: "Network access",
  high: "High access",
};
