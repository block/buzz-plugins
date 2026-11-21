import type { Context } from "@buzz/author";
import { type AuditTier, categories, type Listing } from "./catalog";

// Plugins a member keeps in a git repository on this community's relay. The relay's
// signed repository announcements are the list, so nothing extra has to be published.

type RelayEvent = Readonly<{ pubkey: string; kind: number; created_at: number; tags: readonly (readonly string[])[] }>;
type GitSnapshot = Readonly<{
  head: string | null;
  files: readonly Readonly<{ path: string }>[];
  readme: string | null;
  file: Readonly<{ content: string | null }> | null;
}>;
type Session = Readonly<{
  read(filters: readonly object[]): Promise<readonly RelayEvent[]>;
  projectGit?: Readonly<{ read(input: { owner: string; dtag: string; commit?: string; path?: string }, signal: AbortSignal): Promise<GitSnapshot> }>;
  profiles?: Readonly<{ snapshot(): Readonly<{ get(pubkey: string): { name?: string } | undefined }> }>;
}>;
type Relay = Readonly<{
  snapshot(): Readonly<{ status: string; scope?: string; origin?: string; viewer?: string; session?: Session }>;
  subscribe?(listener: () => void): () => void;
}>;

/** Read through `reflect` so a Buzz without the service still runs the marketplace. */
export function relayOf(ctx: Context): Relay | undefined {
  return (ctx as unknown as { reflect?: { get?(name: string): unknown } }).reflect?.get?.("relay") as Relay | undefined;
}

/** Changes when a different community, or a different person, is connected; empty until one is. */
export function connection(relay: Relay | undefined): string {
  const snapshot = relay?.snapshot();
  return snapshot?.status === "ready" ? (snapshot.scope ?? "ready") : "";
}

const ANNOUNCEMENT = 30617;
const STATE = 30618;
const MAX_REPOSITORIES = 40;
const MAX_PLUGINS_PER_REPOSITORY = 8;

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const tag = (event: RelayEvent, name: string) => event.tags.find((entry) => entry[0] === name)?.[1];

function entry(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!record(value)) return null;
  const program = typeof value.program === "string" ? value.program : typeof value.id === "string" ? value.id : null;
  if (!program) return null;
  return [program, ...(Array.isArray(value.args) ? value.args.filter((arg) => typeof arg === "string") : [])].join(" ");
}
const declared = (value: unknown) => (Array.isArray(value) ? value.length > 0 : record(value) ? Object.keys(value).length > 0 : Boolean(value));
const list = (value: unknown) => (Array.isArray(value) ? value.map(entry).filter((item): item is string => item !== null) : []);

// The same normalization and tiers the indexer gives a public listing.
function hostOf(raw: unknown): Listing["host"] {
  const host = record(raw) ? raw : {};
  return {
    networkOrigins: list(host.networkOrigins).filter((origin) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)),
    processes: list(host.processes),
    commands: list(host.commands),
    files: declared(host.files),
    mcp: declared(host.mcp),
    agentHooks: declared(host.agentHooks),
  };
}
const tierOf = (host: Listing["host"]): AuditTier =>
  host.processes?.length || host.commands?.length || host.files || host.mcp || host.agentHooks ? "high" : host.networkOrigins?.length ? "medium" : "low";

/** Folders, `""` for the root, that hold a built plugin. */
export function pluginFolders(files: readonly Readonly<{ path: string }>[]): string[] {
  const paths = new Set(files.map((file) => file.path));
  return [...paths]
    .filter((path) => path === "manifest.json" || path.endsWith("/manifest.json"))
    .map((path) => path.slice(0, -"manifest.json".length).replace(/\/$/, ""))
    .filter((folder) => !folder.split("/").includes("node_modules") && paths.has(folder ? `${folder}/plugin.js` : "plugin.js"))
    .sort()
    .slice(0, MAX_PLUGINS_PER_REPOSITORY);
}

export function communityListing(input: {
  origin: string;
  owner: string;
  dtag: string;
  folder: string;
  branch: string;
  commit: string;
  manifest: string;
  readme: string | null;
  member: string;
  updatedAt: number;
}): Listing | null {
  let raw: unknown;
  try {
    raw = JSON.parse(input.manifest);
  } catch {
    return null;
  }
  if (!record(raw) || typeof raw.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(raw.id)) return null;
  const discovery = record(raw.discovery) ? raw.discovery : {};
  const host = hostOf(raw.host);
  const repository = `${input.origin}/git/${input.owner}/${input.dtag}`;
  const key = `${repository.replace(/^https:\/\//, "")}${input.folder ? `/${input.folder}` : ""}`;
  return {
    key,
    slug: `shared-${input.owner.slice(0, 16)}-${`${input.dtag}${input.folder ? `--${input.folder}` : ""}`.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 120),
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : raw.id,
    tagline: typeof raw.description === "string" ? raw.description.trim().slice(0, 100) : "",
    ...(input.readme ? { description: input.readme.slice(0, 4000) } : {}),
    category: typeof discovery.category === "string" && Object.hasOwn(categories, discovery.category) ? discovery.category : "productivity",
    tags: Array.isArray(discovery.tags) ? discovery.tags.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 8) : [],
    author: { member: input.member },
    official: false,
    source: { repository, ref: input.branch, commit: input.commit, ...(input.folder ? { path: input.folder } : {}) },
    host,
    audit: { tier: tierOf(host), flags: [], cleared: false },
    updatedAt: new Date(input.updatedAt * 1000).toISOString(),
  };
}

/** Built plugins in the repositories this person can read here; empty when this Buzz can't read them. */
export async function loadCommunity(ctx: Context, signal: AbortSignal): Promise<Listing[]> {
  const { status, origin, viewer, session } = relayOf(ctx)?.snapshot() ?? { status: "disconnected" };
  const git = session?.projectGit;
  if (status !== "ready" || !origin || !session || !git) return [];
  const events = await session.read([{ kinds: [ANNOUNCEMENT, STATE], limit: 200 }]);
  const newest = new Map<string, RelayEvent>();
  for (const event of events) {
    const dtag = tag(event, "d");
    if (!dtag) continue;
    const id = `${event.kind}:${event.pubkey}:${dtag}`;
    if ((newest.get(id)?.created_at ?? -1) < event.created_at) newest.set(id, event);
  }
  const repositories = [...newest.values()]
    .filter((event) => event.kind === ANNOUNCEMENT)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_REPOSITORIES);
  const profiles = session.profiles?.snapshot();
  const found = await Promise.all(
    repositories.map(async (event): Promise<(Listing | null)[]> => {
      const owner = event.pubkey;
      const dtag = tag(event, "d")!;
      const state = newest.get(`${STATE}:${owner}:${dtag}`);
      const branch = (state && tag(state, "HEAD")?.match(/^ref: refs\/heads\/(.+)$/)?.[1]) || "main";
      try {
        const tree = await git.read({ owner, dtag }, signal);
        const commit = tree.head;
        if (!commit) return [];
        return await Promise.all(
          pluginFolders(tree.files).map(async (folder) => {
            const path = folder ? `${folder}/manifest.json` : "manifest.json";
            const manifest = (await git.read({ owner, dtag, commit, path }, signal)).file?.content;
            if (!manifest) return null;
            return communityListing({
              origin: origin.replace(/^ws/, "http"),
              owner,
              dtag,
              folder,
              branch,
              commit,
              manifest,
              // A plugin in a folder never borrows the repository's README.
              readme: folder ? null : tree.readme,
              member: owner === viewer ? "you" : profiles?.get(owner)?.name || `${owner.slice(0, 8)}…`,
              updatedAt: (state ?? event).created_at,
            });
          }),
        );
      } catch {
        // One unreadable repository must not hide the rest.
        return [];
      }
    }),
  );
  const slugs = new Set<string>();
  return found.flat().filter((listing): listing is Listing => {
    if (!listing || slugs.has(listing.slug)) return false;
    slugs.add(listing.slug);
    return true;
  });
}
