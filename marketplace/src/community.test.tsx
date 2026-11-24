import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import demoFixture from "../demo/index.demo.json";
import { INDEX_URL } from "./catalog";
import { communityListing, gitOrigin, loadCommunity, npub, pluginFolders, SHARE_PROMPT, shortKey } from "./community";
import { apply } from "./index";

const OWNER = "a".repeat(64);
const VIEWER = "b".repeat(64);
const COMMIT = "c".repeat(40);
const ORIGIN = "https://relay.example";
const manifest = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "example.shelf", name: "Shelf", apiVersion: 1, description: "Shared from a shelf.", ...overrides });

type Repo = { owner?: string; dtag: string; head?: string; files: Record<string, string>; readme?: string; fails?: boolean | string; at?: number };
function relayWith(repos: Repo[], options: { status?: string; git?: boolean; names?: Record<string, string>; origin?: string } = {}) {
  const events = repos.flatMap((repo, index) => {
    const base = { pubkey: repo.owner ?? OWNER, created_at: repo.at ?? 1_800_000_000 + index };
    return [
      { ...base, kind: 30617, tags: [["d", repo.dtag]] },
      ...(repo.head ? [{ ...base, kind: 30618, tags: [["d", repo.dtag], ["HEAD", `ref: refs/heads/${repo.head}`]] }] : []),
    ];
  });
  const running = { now: 0, most: 0 };
  const read = vi.fn(async (input: { owner: string; dtag: string; path?: string }) => {
    running.most = Math.max(running.most, ++running.now);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running.now--;
    const repo = repos.find((entry) => (entry.owner ?? OWNER) === input.owner && entry.dtag === input.dtag);
    if (!repo || repo.fails === true || (repo.fails && repo.fails === input.path)) throw new Error("denied");
    return {
      head: COMMIT,
      files: Object.entries(repo.files).map(([path, text]) => ({ path, size: text.length })),
      readme: repo.readme ?? null,
      file: input.path ? { content: repo.files[input.path] ?? null } : null,
    };
  });
  const session = {
    read: vi.fn(async ([filter]: readonly { kinds: number[] }[]) => events.filter((event) => filter.kinds.includes(event.kind))),
    ...(options.git === false ? {} : { projectGit: { read } }),
    profiles: { snapshot: () => new Map(Object.entries(options.names ?? {}).map(([pubkey, name]) => [pubkey, { name }])) },
  };
  return { read, running, relay: { snapshot: () => ({ status: options.status ?? "ready", origin: options.origin ?? ORIGIN, viewer: VIEWER, session }) } };
}
const contextWith = (relay: unknown) => ({ reflect: { get: (name: string) => (name === "relay" ? relay : undefined) } }) as never;
const load = (relay: unknown) => loadCommunity(contextWith(relay), new AbortController().signal);

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style[data-plugin]").forEach((style) => style.remove());
});

describe("pluginFolders", () => {
  const files = (...paths: string[]) => paths.map((path) => ({ path }));

  it("finds a built plugin at the root and in folders", () => {
    expect(pluginFolders(files("manifest.json", "plugin.js", "tools/notes/manifest.json", "tools/notes/plugin.js"))).toEqual(["", "tools/notes"]);
  });

  it("skips a manifest without plugin.js, and dependencies", () => {
    expect(pluginFolders(files("manifest.json", "src/manifest.json", "node_modules/x/manifest.json", "node_modules/x/plugin.js"))).toEqual([]);
  });
});

describe("communityListing", () => {
  const input = { origin: ORIGIN, owner: OWNER, dtag: "Shelf.Repo", folder: "", branch: "main", commit: COMMIT, readme: "# Shelf", member: "Ada", updatedAt: 1_800_000_000 };

  it("points the install at the relay repository and the read commit", () => {
    const listing = communityListing({ ...input, folder: "tools/notes", manifest: manifest() })!;
    expect(listing.source).toEqual({ repository: `${ORIGIN}/git/${OWNER}/Shelf.Repo`, ref: "main", commit: COMMIT, path: "tools/notes" });
    expect(listing.slug).toMatch(/^[a-z0-9-]{1,120}$/);
    expect(listing.author).toEqual({ member: "Ada", npub: npub(OWNER) });
    expect(listing.official).toBe(false);
    expect(listing.verified).toBeUndefined();
  });

  it("tiers the declared access like the public index", () => {
    const tier = (host: unknown) => communityListing({ ...input, manifest: manifest({ host }) })!.audit.tier;
    expect(tier(undefined)).toBe("low");
    expect(tier({ networkOrigins: ["https://api.example.com"] })).toBe("medium");
    expect(tier({ commands: [{ id: "status", program: "git", args: ["status"] }] })).toBe("high");
    expect(communityListing({ ...input, manifest: manifest({ host: { commands: [{ program: "git", args: ["status"] }] } }) })!.host.commands).toEqual(["git status"]);
  });

  it("refuses an origin it can't show as written, so less access is never implied", () => {
    for (const networkOrigins of [["http://api.example.com"], ["https://*.example.com"], ["https://ok.example.com", "https://example.com/path"], [7], "https://example.com"])
      expect(communityListing({ ...input, manifest: manifest({ host: { networkOrigins } }) })).toBeNull();
  });

  it("refuses names that don't belong in an install address", () => {
    const ok = { ...input, manifest: manifest() };
    expect(communityListing(ok)).not.toBeNull();
    for (const dtag of ["a/b", "a b", "../x", "x?y=1", "x#y", "", "x".repeat(65)]) expect(communityListing({ ...ok, dtag })).toBeNull();
    for (const origin of ["http://relay.example", "ws://relay.example", "https://relay.example/x", "https://user@relay.example"])
      expect(communityListing({ ...ok, origin })).toBeNull();
    for (const folder of ["../up", "a//b", "a/./b", "a b"]) expect(communityListing({ ...ok, folder })).toBeNull();
    for (const branch of ["a..b", "/main", "main/", "ma in", "x".repeat(101)]) expect(communityListing({ ...ok, branch })).toBeNull();
    expect(communityListing({ ...ok, owner: "A".repeat(64) })).toBeNull();
    expect(communityListing({ ...ok, commit: "main" })).toBeNull();
    expect(communityListing({ ...ok, manifest: manifest({ pad: "x".repeat(256 * 1024) }) })).toBeNull();
  });

  it("keeps shelf slugs apart from public ones", () => {
    const slug = communityListing({ ...input, dtag: "github-com--block--buzz-app", manifest: manifest() })!.slug;
    expect(slug.startsWith("shared-")).toBe(true);
    expect(demoFixture.plugins.some((plugin) => plugin.slug === slug || plugin.slug.startsWith("shared-"))).toBe(false);
  });

  it("rejects a manifest that isn't JSON or has no valid id", () => {
    expect(communityListing({ ...input, manifest: "{" })).toBeNull();
    expect(communityListing({ ...input, manifest: manifest({ id: "Bad_Id" }) })).toBeNull();
  });
});

describe("keys and origins", () => {
  it("encodes a member's key as an npub", () => {
    const key = npub("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");
    expect(key).toBe("npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6");
    expect(shortKey(key)).toBe("npub180cvv…h6w6");
  });

  it("serves repositories only from a community on TLS", () => {
    expect(gitOrigin("https://relay.example")).toBe("https://relay.example");
    expect(gitOrigin("wss://relay.example:8443")).toBe("https://relay.example:8443");
    for (const origin of ["ws://relay.example", "http://relay.example", "https://relay.example/x", "https://a:b@relay.example", "nope"])
      expect(gitOrigin(origin)).toBeNull();
  });
});

describe("loadCommunity", () => {
  it("lists built plugins from readable repositories, on the branch HEAD names", async () => {
    const { relay } = relayWith(
      [
        { dtag: "shelf", head: "trunk", files: { "manifest.json": manifest(), "plugin.js": "" }, readme: "# Shelf" },
        { dtag: "notes", files: { "README.md": "" } },
        { dtag: "secret", files: {}, fails: true },
        { dtag: "mine", owner: VIEWER, files: { "manifest.json": manifest({ id: "example.mine", name: "Mine" }), "plugin.js": "" } },
      ],
      { names: { [OWNER]: "Ada" } },
    );
    const listings = await load(relay);
    expect(listings.map((listing) => [listing.name, listing.author, listing.source.ref])).toEqual([
      ["Mine", { member: "you", npub: npub(VIEWER) }, "main"],
      ["Shelf", { member: "Ada", npub: npub(OWNER) }, "trunk"],
    ]);
    expect(listings[1].description).toBe("# Shelf");
  });

  it("keeps what it read from a repository when a later read fails", async () => {
    const built = (id: string) => ({ [`${id}/manifest.json`]: manifest({ id: `example.${id}`, name: id }), [`${id}/plugin.js`]: "" });
    const { relay } = relayWith([{ dtag: "shelf", files: { ...built("a"), ...built("b") }, fails: "b/manifest.json" }]);
    expect((await load(relay)).map((listing) => listing.name)).toEqual(["a"]);
  });

  it("uses the newest announcement and state of a repository", async () => {
    const files = { "manifest.json": manifest(), "plugin.js": "" };
    const { relay } = relayWith([
      { dtag: "shelf", head: "old", files, at: 1_800_000_000 },
      { dtag: "shelf", head: "new", files, at: 1_800_000_500 },
    ]);
    const listings = await load(relay);
    expect(listings).toHaveLength(1);
    expect(listings[0].source.ref).toBe("new");
    expect(listings[0].updatedAt).toBe(new Date(1_800_000_500_000).toISOString());
  });

  it("skips repositories whose name or branch can't go in an install address", async () => {
    const files = { "manifest.json": manifest(), "plugin.js": "" };
    const { relay, read } = relayWith([
      { dtag: "bad/name", files },
      { dtag: "bad name", files },
      { dtag: "odd-branch", head: "a..b", files },
      { dtag: "fine", files },
    ]);
    expect((await load(relay)).map((listing) => listing.source.repository)).toEqual([`${ORIGIN}/git/${OWNER}/fine`]);
    expect(read.mock.calls.some(([input]) => input.dtag.startsWith("bad"))).toBe(false);
  });

  it("lists nothing from a community that isn't on TLS", async () => {
    const repos = [{ dtag: "shelf", files: { "manifest.json": manifest(), "plugin.js": "" } }];
    const { relay, read } = relayWith(repos, { origin: "ws://relay.example" });
    expect(await load(relay)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect((await load(relayWith(repos, { origin: "wss://relay.example" }).relay))[0].source.repository).toBe(`${ORIGIN}/git/${OWNER}/shelf`);
  });

  it("caps repositories per member and in all, reads four at a time, and puts yours first", async () => {
    const files = { "manifest.json": manifest(), "plugin.js": "" };
    const flood = Array.from({ length: 30 }, (_, index) => ({ dtag: `spam-${index}`, files, at: 1_900_000_000 + index }));
    const others = Array.from({ length: 50 }, (_, index) => ({ owner: index.toString(16).padStart(4, "0").padEnd(64, "0"), dtag: "shelf", files, at: 1_800_000_000 + index }));
    const mine = { owner: VIEWER, dtag: "mine", files, at: 1_700_000_000 };
    const { relay, running } = relayWith([...flood, ...others, mine]);
    const listings = await load(relay);
    expect(listings).toHaveLength(40);
    expect(listings[0].author).toEqual({ member: "you", npub: npub(VIEWER) });
    expect(listings.filter((listing) => listing.source.repository.includes(OWNER))).toHaveLength(5);
    expect(running.most).toBe(4);
  });

  it("skips a manifest over the size cap without reading it, and more than eight plugins in one repository", async () => {
    const built = (id: string, text = manifest({ id: `example.${id}` })) => ({ [`${id}/manifest.json`]: text, [`${id}/plugin.js`]: "" });
    const big = relayWith([{ dtag: "shelf", files: { ...built("big", manifest({ pad: "x".repeat(256 * 1024) })), ...built("ok") } }]);
    expect((await load(big.relay)).map((listing) => listing.id)).toEqual(["example.ok"]);
    expect(big.read.mock.calls.some(([input]) => input.path === "big/manifest.json")).toBe(false);
    const many = Object.assign({}, ...Array.from({ length: 12 }, (_, index) => built(`p${String(index).padStart(2, "0")}`)));
    expect(await load(relayWith([{ dtag: "shelf", files: many }]).relay)).toHaveLength(8);
  });

  it("is empty when the community isn't ready or this Buzz can't read repositories", async () => {
    const repos = [{ dtag: "shelf", files: { "manifest.json": manifest(), "plugin.js": "" } }];
    expect(await load(relayWith(repos, { status: "connecting" }).relay)).toEqual([]);
    expect(await load(relayWith(repos, { git: false }).relay)).toEqual([]);
    expect(await load(undefined)).toEqual([]);
  });
});

describe("From this community", () => {
  function page(relay: unknown, requestInstall = vi.fn(async (_source: unknown) => "installed")) {
    const registered: { component: React.ComponentType<{ navigation?: { target: unknown } }> }[] = [];
    const services: Record<string, unknown> = { relay, pluginInstaller: { requestInstall } };
    const open = vi.fn(async () => ({ status: "opened" as const }));
    apply({
      react: React,
      effect: vi.fn(),
      pages: { register: vi.fn((entry) => registered.push(entry)), subscribe: vi.fn(() => () => {}), snapshot: () => [] },
      navigation: { open },
      host: {
        request: vi.fn(async (input: { url: string }) => {
          if (input.url !== INDEX_URL) throw new Error(`unexpected ${input.url}`);
          return { status: 200, headers: {}, body: JSON.stringify(demoFixture) };
        }),
      },
      reflect: { get: (name: string) => services[name] },
    } as never);
    return { Page: registered[0].component, requestInstall, open };
  }
  const shelf = () => relayWith([{ dtag: "shelf", files: { "manifest.json": manifest(), "plugin.js": "" }, readme: "About the shelf." }], { names: { [OWNER]: "Ada" } });

  it("shows shared plugins above the public ones and installs from the relay repository", async () => {
    const { Page, requestInstall } = page(shelf().relay);
    await act(async () => render(<Page />));
    const heading = await screen.findByRole("heading", { name: "From this community" });
    const card = screen.getByText("Shelf", { selector: ".bm-card-name" }).closest(".bm-card") as HTMLElement;
    expect(heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText(/by Ada/)).toBeTruthy();
    expect(within(card).getByTitle(npub(OWNER)).textContent).toBe(shortKey(npub(OWNER)));
    expect(within(card).getByText("Shared here").getAttribute("title")).toBe("Shared here · not reviewed");
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Add to Buzz" })));
    expect(requestInstall).toHaveBeenCalledWith({ repository: `${ORIGIN}/git/${OWNER}/shelf`, reference: "main", commit: COMMIT });
  });

  it("has no shelf when nothing is shared", async () => {
    const { Page } = page(relayWith([]).relay);
    await act(async () => render(<Page />));
    await screen.findByRole("heading", { name: "Community Marketplace", level: 1 });
    expect(screen.queryByRole("heading", { name: "From this community" })).toBeNull();
  });

  it("says on the listing page that it is unscanned and unreviewed", async () => {
    const listing = (await load(shelf().relay))[0];
    const { Page } = page(shelf().relay);
    await act(async () => render(<Page navigation={{ target: { route: { params: { slug: listing.slug } } } }} />));
    expect(await screen.findByRole("heading", { name: "Shelf", level: 1 })).toBeTruthy();
    const audit = screen.getByLabelText("Audit");
    expect(within(audit).getByText("Shared here · not reviewed")).toBeTruthy();
    expect(within(audit).getByText(/Not scanned/)).toBeTruthy();
    expect(within(audit).queryByText(/hasn't cleared/)).toBeNull();
    expect(screen.getByText("About the shelf.")).toBeTruthy();
    expect(screen.getByText(npub(OWNER))).toBeTruthy();
  });

  it("opens the public listing when a shelf listing claims its slug", async () => {
    const publicListing = demoFixture.plugins[0];
    const { relay } = shelf();
    const { Page } = page(relay);
    await act(async () => render(<Page navigation={{ target: { route: { params: { slug: publicListing.slug } } } }} />));
    expect(await screen.findByRole("heading", { name: publicListing.name, level: 1 })).toBeTruthy();
    expect(within(screen.getByLabelText("Audit")).queryByText("Shared here · not reviewed")).toBeNull();
  });
});

describe("Add your plugin, with a community to share in", () => {
  async function dialogWith(relay: unknown) {
    const registered: { component: React.ComponentType }[] = [];
    apply({
      react: React,
      effect: vi.fn(),
      pages: { register: vi.fn((entry) => registered.push(entry)), subscribe: vi.fn(() => () => {}), snapshot: () => [] },
      navigation: { open: vi.fn() },
      host: { request: vi.fn(async () => ({ status: 200, headers: {}, body: JSON.stringify(demoFixture) })) },
      reflect: { get: (name: string) => (name === "relay" ? relay : undefined) },
    } as never);
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    fireEvent.click(await screen.findByRole("button", { name: "Add your plugin" }));
    return screen.getByRole("dialog", { name: "Add your plugin" });
  }

  it("leads with sharing in this community and a request to hand an agent", async () => {
    const dialog = await dialogWith(relayWith([]).relay);
    expect(within(dialog).getByRole("button", { name: "This community" }).getAttribute("aria-pressed")).toBe("true");
    expect(dialog.textContent).toContain("From this community");
    expect(within(dialog).getByTitle(SHARE_PROMPT)).toBeTruthy();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });

  it("keeps what is typed in the public form", async () => {
    const dialog = await dialogWith(relayWith([]).relay);
    fireEvent.click(within(dialog).getByRole("button", { name: "Everyone" }));
    const [repository] = within(dialog).getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(repository!, { target: { value: "octo/plug" } });
    expect((within(dialog).getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("octo/plug");
    expect(within(dialog).getAllByRole("textbox")[0]).toBe(repository);
  });

  it("offers only the public form when this Buzz can't read repositories", async () => {
    const dialog = await dialogWith(relayWith([], { git: false }).relay);
    expect(within(dialog).queryByRole("button", { name: "This community" })).toBeNull();
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(2);
  });
});
