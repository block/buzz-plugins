import type { Context } from "@buzz/author";
import { type AuditTier, categories, type Listing } from "./catalog";

// Plugins a member keeps in a git repository on this community's relay. The relay's
// signed repository announcements are the list, so nothing extra has to be published.

type RelayEvent = Readonly<{ pubkey: string; kind: number; created_at: number; tags: readonly (readonly string[])[] }>;
type GitSnapshot = Readonly<{
  head: string | null;
  files: readonly Readonly<{ path: string; size?: number }>[];
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

/** Names the connected community and person once this Buzz can read its repositories; empty until then. */
export function connection(relay: Relay | undefined): string {
  const snapshot = relay?.snapshot();
  return snapshot?.status === "ready" && snapshot.session?.projectGit ? (snapshot.scope ?? "ready") : "";
}

export const SHARE_PROMPT =
  "Share my Buzz plugin with this channel. Push the folder that holds its built manifest.json and plugin.js to this channel's git repository, creating the repository if there is none, then tell me its name.";

const ANNOUNCEMENT = 30617;
const STATE = 30618;
const MAX_REPOSITORIES = 40;
// So one member announcing many repositories can't crowd everyone else out.
const MAX_REPOSITORIES_PER_OWNER = 5;
const MAX_PLUGINS_PER_REPOSITORY = 8;
const MAX_MANIFEST_BYTES = 256 * 1024;
const CONCURRENT_READS = 4;

// Everything below comes from whoever announced the repository, and ends up in an install address.
const OWNER = /^[0-9a-f]{64}$/;
const DTAG = /^[A-Za-z0-9._-]{1,64}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const SEGMENT = /^[A-Za-z0-9._@+-]{1,100}$/;
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/;
const safePath = (path: string) => path.split("/").every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..");
const safeBranch = (branch: string) => BRANCH.test(branch) && !branch.includes("..") && !branch.startsWith("/") && !branch.endsWith("/");

/** The https origin repositories are served from, or null for a community that isn't on TLS. */
export function gitOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "wss:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return `https://${url.host}`;
  } catch {
    return null;
  }
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
/** A member's key in the form people compare, since a display name is anyone's to pick. */
export function npub(hex: string): string {
  const words: number[] = [];
  let bits = 0;
  let value = 0;
  for (let index = 0; index < hex.length; index += 2) {
    value = (value << 8) | Number.parseInt(hex.slice(index, index + 2), 16);
    bits += 8;
    for (; bits >= 5; bits -= 5) words.push((value >> (bits - 5)) & 31);
  }
  if (bits) words.push((value << (5 - bits)) & 31);
  const prefix = [...[..."npub"].map((char) => char.charCodeAt(0) >> 5), 0, ...[..."npub"].map((char) => char.charCodeAt(0) & 31)];
  let check = 1;
  for (const word of [...prefix, ...words, 0, 0, 0, 0, 0, 0]) {
    const top = check >> 25;
    check = ((check & 0x1ffffff) << 5) ^ word;
    [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3].forEach((generator, bit) => {
      if ((top >> bit) & 1) check ^= generator;
    });
  }
  check ^= 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((index) => (check >> (5 * (5 - index))) & 31);
  return `npub1${[...words, ...checksum].map((word) => BECH32[word]).join("")}`;
}
export const shortKey = (key: string) => `${key.slice(0, 10)}…${key.slice(-4)}`;

async function pooled<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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

// The same normalization and tiers the indexer gives a public listing. An origin this can't show as
// written, such as http:// or a wildcard, makes the whole listing unlistable instead of looking like less access.
function hostOf(raw: unknown): Listing["host"] | null {
  const host = record(raw) ? raw : {};
  const origins = host.networkOrigins === undefined ? [] : host.networkOrigins;
  if (!Array.isArray(origins) || !origins.every((origin) => typeof origin === "string" && ORIGIN.test(origin))) return null;
  return {
    networkOrigins: origins as string[],
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
export function pluginFolders(files: readonly Readonly<{ path: string; size?: number }>[]): string[] {
  const paths = new Set(files.map((file) => file.path));
  return files
    .filter((file) => (file.path === "manifest.json" || file.path.endsWith("/manifest.json")) && (file.size ?? 0) <= MAX_MANIFEST_BYTES)
    .map((file) => file.path.slice(0, -"manifest.json".length).replace(/\/$/, ""))
    .filter((folder, index, all) => all.indexOf(folder) === index)
    .filter((folder) => folder === "" || safePath(folder))
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
  if (!ORIGIN.test(input.origin) || !OWNER.test(input.owner) || !DTAG.test(input.dtag) || !COMMIT.test(input.commit)) return null;
  if (!safeBranch(input.branch) || (input.folder && !safePath(input.folder)) || input.manifest.length > MAX_MANIFEST_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(input.manifest);
  } catch {
    return null;
  }
  if (!record(raw) || typeof raw.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(raw.id)) return null;
  const discovery = record(raw.discovery) ? raw.discovery : {};
  const host = hostOf(raw.host);
  if (!host) return null;
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
    author: { member: input.member, npub: npub(input.owner) },
    official: false,
    source: { repository, ref: input.branch, commit: input.commit, ...(input.folder ? { path: input.folder } : {}) },
    host,
    audit: { tier: tierOf(host), flags: [], cleared: false },
    updatedAt: new Date(input.updatedAt * 1000).toISOString(),
  };
}

/** Built plugins in the repositories this person can read here; empty when this Buzz can't read them. */
export async function loadCommunity(ctx: Context, signal: AbortSignal): Promise<Listing[]> {
  const { status, origin: community, viewer, session } = relayOf(ctx)?.snapshot() ?? { status: "disconnected" };
  const git = session?.projectGit;
  const origin = community ? gitOrigin(community) : null;
  if (status !== "ready" || !origin || !session || !git) return [];
  // Read apart, so a flood of one kind can't push the other out of the page.
  const [announced, states] = await Promise.all([ANNOUNCEMENT, STATE].map((kind) => session.read([{ kinds: [kind], limit: 200 }])));
  const newest = new Map<string, RelayEvent>();
  for (const event of [...announced, ...states]) {
    const dtag = tag(event, "d");
    if ((event.kind !== ANNOUNCEMENT && event.kind !== STATE) || !OWNER.test(event.pubkey) || !dtag || !DTAG.test(dtag)) continue;
    const id = `${event.kind}:${event.pubkey}:${dtag}`;
    if ((newest.get(id)?.created_at ?? -1) < event.created_at) newest.set(id, event);
  }
  const perOwner = new Map<string, number>();
  const repositories = [...newest.values()]
    .filter((event) => event.kind === ANNOUNCEMENT)
    // Your own first, then the newest.
    .sort((a, b) => Number(b.pubkey === viewer) - Number(a.pubkey === viewer) || b.created_at - a.created_at)
    .filter((event) => {
      const count = perOwner.get(event.pubkey) ?? 0;
      perOwner.set(event.pubkey, count + 1);
      return count < MAX_REPOSITORIES_PER_OWNER;
    })
    .slice(0, MAX_REPOSITORIES);
  const profiles = session.profiles?.snapshot();
  const found = await pooled(repositories, CONCURRENT_READS, async (event): Promise<(Listing | null)[]> => {
    const owner = event.pubkey;
    const dtag = tag(event, "d")!;
    const state = newest.get(`${STATE}:${owner}:${dtag}`);
    const branch = (state && tag(state, "HEAD")?.match(/^ref: refs\/heads\/(.+)$/)?.[1]) || "main";
    const listings: (Listing | null)[] = [];
    try {
      const tree = await git.read({ owner, dtag }, signal);
      const commit = tree.head;
      if (!commit) return [];
      // One at a time: the pool, not the repository, sets how many reads run at once.
      for (const folder of pluginFolders(tree.files)) {
        const path = folder ? `${folder}/manifest.json` : "manifest.json";
        const manifest = (await git.read({ owner, dtag, commit, path }, signal)).file?.content;
        if (!manifest) continue;
        listings.push(
          communityListing({
            origin,
            owner,
            dtag,
            folder,
            branch,
            commit,
            manifest,
            // A plugin in a folder never borrows the repository's README.
            readme: folder ? null : tree.readme,
            member: owner === viewer ? "you" : profiles?.get(owner)?.name || "Unnamed member",
            updatedAt: (state ?? event).created_at,
          }),
        );
      }
    } catch {
      // One unreadable repository must not hide the rest, nor what was already read from it.
    }
    return listings;
  });
  const slugs = new Set<string>();
  return found.flat().filter((listing): listing is Listing => {
    if (!listing || slugs.has(listing.slug)) return false;
    slugs.add(listing.slug);
    return true;
  });
}
