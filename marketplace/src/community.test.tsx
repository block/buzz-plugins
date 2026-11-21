import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import demoFixture from "../demo/index.demo.json";
import { INDEX_URL } from "./catalog";
import { communityListing, loadCommunity, pluginFolders, SHARE_PROMPT } from "./community";
import { apply } from "./index";

const OWNER = "a".repeat(64);
const VIEWER = "b".repeat(64);
const COMMIT = "c".repeat(40);
const ORIGIN = "https://relay.example";
const manifest = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "example.shelf", name: "Shelf", apiVersion: 1, description: "Shared from a shelf.", ...overrides });

type Repo = { owner?: string; dtag: string; head?: string; files: Record<string, string>; readme?: string; fails?: boolean; at?: number };
function relayWith(repos: Repo[], options: { status?: string; git?: boolean; names?: Record<string, string> } = {}) {
  const events = repos.flatMap((repo, index) => {
    const base = { pubkey: repo.owner ?? OWNER, created_at: repo.at ?? 1_800_000_000 + index };
    return [
      { ...base, kind: 30617, tags: [["d", repo.dtag]] },
      ...(repo.head ? [{ ...base, kind: 30618, tags: [["d", repo.dtag], ["HEAD", `ref: refs/heads/${repo.head}`]] }] : []),
    ];
  });
  const read = vi.fn(async (input: { owner: string; dtag: string; path?: string }) => {
    const repo = repos.find((entry) => (entry.owner ?? OWNER) === input.owner && entry.dtag === input.dtag);
    if (!repo || repo.fails) throw new Error("denied");
    return {
      head: COMMIT,
      files: Object.keys(repo.files).map((path) => ({ path })),
      readme: repo.readme ?? null,
      file: input.path ? { content: repo.files[input.path] ?? null } : null,
    };
  });
  const session = {
    read: vi.fn(async () => events),
    ...(options.git === false ? {} : { projectGit: { read } }),
    profiles: { snapshot: () => new Map(Object.entries(options.names ?? {}).map(([pubkey, name]) => [pubkey, { name }])) },
  };
  return { read, relay: { snapshot: () => ({ status: options.status ?? "ready", origin: ORIGIN, viewer: VIEWER, session }) } };
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
    expect(listing.author).toEqual({ member: "Ada" });
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

  it("rejects a manifest that isn't JSON or has no valid id", () => {
    expect(communityListing({ ...input, manifest: "{" })).toBeNull();
    expect(communityListing({ ...input, manifest: manifest({ id: "Bad_Id" }) })).toBeNull();
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
      ["Mine", { member: "you" }, "main"],
      ["Shelf", { member: "Ada" }, "trunk"],
    ]);
    expect(listings[1].description).toBe("# Shelf");
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
    expect(within(card).getByText("by Ada")).toBeTruthy();
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
