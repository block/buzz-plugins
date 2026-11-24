import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import demoFixture from "../demo/index.demo.json";
import realFixture from "../../fixtures/index.json";
import manifest from "../manifest.json";
import { accessSummary, bundledIndex, categories, INDEX_URL, type Listing, loadIndex, parseIndex, parseKey, search, sorted } from "./catalog";
import { apply } from "./index";
import { sourceOf } from "./install";
import { createMarkdown } from "./markdown";
import { checkSource, listingLinks, parseSourceInput, sourceLine } from "./submit";
import { listingLink, PAGE_ID, PLUGIN_ID, slugFromTarget, starLabel, trustLabel, VERIFIED_LABEL } from "./view";

const demoIndex = parseIndex(demoFixture)!;
const listings = demoIndex.plugins;
const bySlug = (slug: string) => listings.find((plugin) => plugin.slug === slug)!;
const byName = (name: string) => listings.find((plugin) => plugin.name === name)!;
const counter = byName("Counter");
const toolbox = byName("Agent Toolbox");
const digest = byName("PR Digest");
const names = (plugins: readonly Listing[]) => plugins.map((plugin) => plugin.name);
const rawListing = (overrides: Record<string, unknown> = {}) => ({ ...structuredClone(demoFixture.plugins[0]), ...overrides });
const rawIndex = (plugins: unknown[]) => ({ ...demoFixture, plugins });

type Reply = { status: number; body: string } | Error;
function hostWith(routes: { index?: unknown; indexStatus?: number; github?: Reply } = {}) {
  const calls: { url: string; method: string; headers?: Record<string, string>; body?: string }[] = [];
  const request = vi.fn(async (input: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url: input.url, method: input.method ?? "GET", headers: input.headers, body: input.body });
    const reply = (value: Reply) => {
      if (value instanceof Error) throw value;
      return { headers: {}, ...value };
    };
    if (input.url === INDEX_URL)
      return reply({ status: routes.indexStatus ?? 200, body: JSON.stringify(routes.index === undefined ? demoFixture : routes.index) });
    if (input.url.startsWith("https://api.github.com/repos/"))
      return reply(routes.github ?? { status: 200, body: JSON.stringify({ private: false }) });
    throw new Error(`unexpected ${input.url}`);
  });
  return { request, calls };
}

function fakeContext(overrides: { reflect?: unknown; request?: unknown; panels?: unknown; runEffects?: boolean } = {}) {
  const registered: { component: React.ComponentType<{ navigation?: { target: unknown } }>; route: { validate(p: unknown): boolean } }[] = [];
  const open = vi.fn(async () => ({ status: "opened" as const }));
  const ctx = {
    react: React,
    effect: overrides.runEffects ? vi.fn((setup: () => unknown) => setup()) : vi.fn(),
    pages: {
      register: vi.fn((page) => registered.push(page)),
      subscribe: vi.fn(() => () => {}),
      snapshot: () => [{ pluginId: PLUGIN_ID }],
    },
    navigation: { open },
    host: { request: overrides.request ?? hostWith().request },
    ...(overrides.reflect ? { reflect: overrides.reflect } : {}),
    ...(overrides.panels ? { panels: overrides.panels } : {}),
  };
  apply(ctx as never);
  return { registered, open };
}

const installer = (requestInstall: (source: unknown) => Promise<string>) => ({
  reflect: { get: (name: string) => (name === "pluginInstaller" ? { requestInstall } : undefined) },
});
const targetFor = (slug: string) => ({ kind: "page", route: { version: 1, params: { slug } } });
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
const cardNames = () => [...document.querySelectorAll(".bm-card-name")].map((name) => name.textContent);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.head.querySelectorAll("style[data-plugin]").forEach((style) => style.remove());
});

describe("index parsing", () => {
  it("keeps every listing of the demo index", () => {
    expect(listings).toHaveLength(demoFixture.plugins.length);
  });

  it("accepts the bundled crawl output without dropping anything", () => {
    expect(bundledIndex.plugins.length).toBeGreaterThan(0);
    expect(bundledIndex.plugins.map((plugin) => plugin.key)).toEqual(realFixture.plugins.map((plugin) => plugin.key));
  });

  it("accepts a well-formed index", () => {
    const parsed = parseIndex(rawIndex([rawListing()]));
    expect(parsed?.plugins).toHaveLength(1);
    expect(parsed?.generatedAt).toBe("2026-11-05T23:00:00.000Z");
  });

  it("rejects wrong shapes outright", () => {
    for (const value of [null, "index", [], {}, { ...demoFixture, schemaVersion: 2 }, { ...demoFixture, plugins: "none" }, { ...demoFixture, generatedAt: "yesterday" }])
      expect(parseIndex(value)).toBeNull();
  });

  it("drops malformed listings and keeps the good ones", () => {
    const good = rawListing();
    const second = rawListing({ key: "github.com/someone/else", slug: "github-com--someone--else", source: { ...good.source, repository: "https://github.com/someone/else", path: "" }, author: { github: "someone" } });
    const bad: unknown[] = [
      null,
      "x",
      rawListing({ slug: "Bad Slug" }),
      rawListing({ slug: "x".repeat(121) }),
      rawListing({ key: "gitlab.com/o/r" }),
      rawListing({ key: "github.com/o/r/../x" }),
      rawListing({ id: "Bad Id" }),
      rawListing({ name: "" }),
      rawListing({ tagline: 5 }),
      rawListing({ category: "x) url(evil" }),
      rawListing({ source: null }),
      rawListing({ source: { ...good.source, commit: "abc123" } }),
      rawListing({ source: { ...good.source, repository: "https://github.com/other/place" } }),
      rawListing({ source: { ...good.source, path: "/nested" } }),
      rawListing({ official: true }),
      rawListing({ verified: "yes" }),
      rawListing({ author: {} }),
      rawListing({ host: undefined }),
      rawListing({ host: { ...good.host, networkOrigins: ["http://insecure.example"] } }),
      rawListing({ audit: { ...good.audit, tier: "extreme" } }),
      rawListing({ audit: { ...good.audit, cleared: "yes" } }),
      rawListing({ audit: { ...good.audit, flags: [{ code: "x" }] } }),
      rawListing({ stars: -1 }),
      rawListing({ stars: 1.5 }),
      rawListing({ updatedAt: "last week" }),
      rawListing({ demo: { poster: { url: "javascript:alert(1)" }, screenshots: [] } }),
      good,
    ];
    const parsed = parseIndex(rawIndex([...bad, second]));
    expect(parsed?.plugins.map((plugin) => plugin.key)).toEqual([good.key, second.key]);
  });

  it("accepts a listing whose tagline is empty", () => {
    expect(parseIndex(rawIndex([rawListing({ tagline: "" })]))?.plugins).toHaveLength(1);
  });

  it("drops duplicate keys and slugs", () => {
    const first = rawListing();
    const parsed = parseIndex(rawIndex([first, structuredClone(first), { ...rawListing(), key: "github.com/block/other", official: true, source: { ...first.source, repository: "https://github.com/block/other" } }]));
    expect(parsed?.plugins).toHaveLength(1);
  });

  it("treats an index with no usable listing as invalid", () => {
    expect(parseIndex(rawIndex([{ slug: "nope" }]))).toBeNull();
    expect(parseIndex(rawIndex([]))?.plugins).toEqual([]);
  });

  it("splits a listing key into owner, repository and path", () => {
    expect(parseKey("github.com/o/r")).toEqual({ owner: "o", repo: "r", path: "" });
    expect(parseKey("github.com/block/buzz-app/examples/plugins/counter")).toEqual({
      owner: "block",
      repo: "buzz-app",
      path: "examples/plugins/counter",
    });
    expect(parseKey("github.com/o")).toBeNull();
    expect(parseKey("example.com/o/r")).toBeNull();
  });
});

describe("loadIndex", () => {
  it("reads the published index", async () => {
    const { request, calls } = hostWith({ index: rawIndex([rawListing()]) });
    const result = await loadIndex({ request } as never);
    expect(result.live).toBe(true);
    expect(result.index.plugins).toHaveLength(1);
    expect(calls).toEqual([{ url: INDEX_URL, method: "GET", headers: undefined, body: undefined }]);
  });

  it("falls back to the bundled copy when the index can't be used", async () => {
    const fallback = { index: bundledIndex, live: false };
    expect(await loadIndex(undefined)).toEqual(fallback);
    expect(await loadIndex({ request: hostWith({ indexStatus: 503 }).request } as never)).toEqual(fallback);
    expect(await loadIndex({ request: hostWith({ index: demoFixture, indexStatus: 500 }).request } as never)).toEqual(fallback);
    expect(await loadIndex({ request: hostWith({ index: { schemaVersion: 3 } }).request } as never)).toEqual(fallback);
    expect(await loadIndex({ request: hostWith({ index: rawIndex([{ slug: "nope" }]) }).request } as never)).toEqual(fallback);
    expect(await loadIndex({ request: vi.fn(async () => Promise.reject(new Error("offline"))) } as never)).toEqual(fallback);
    expect(await loadIndex({ request: vi.fn(async () => ({ status: 200, headers: {}, body: "<html>" })) } as never)).toEqual(fallback);
  });
});

describe("sort orders", () => {
  it("lists every plugin, newest commit first, uncleared ones included", () => {
    expect(names(sorted(demoIndex, "updated"))).toEqual([
      "Roster",
      "Agent Toolbox",
      "Standup",
      "PR Digest",
      "Projects",
      "Counter",
      "Notes",
      "Shortcut Counter",
    ]);
  });

  it("orders by GitHub stars, then by name", () => {
    expect(names(sorted(demoIndex, "stars"))).toEqual(["Counter", "Notes", "Shortcut Counter", "Agent Toolbox", "Projects", "PR Digest", "Standup", "Roster"]);
  });

  it("orders by name", () => {
    expect(names(sorted(demoIndex, "name"))).toEqual(["Agent Toolbox", "Counter", "Notes", "PR Digest", "Projects", "Roster", "Shortcut Counter", "Standup"]);
  });

  it("puts listings without stars or a date last, and never reorders the index itself", () => {
    const { stars: _s, updatedAt: _u, ...bare } = rawListing({ key: "github.com/someone/bare", slug: "github-com--someone--bare", name: "Bare", author: { github: "someone" }, source: { ...demoFixture.plugins[0].source, repository: "https://github.com/someone/bare", path: "" } });
    const parsed = parseIndex(rawIndex([bare, ...demoFixture.plugins]))!;
    expect(names(sorted(parsed, "updated")).at(-1)).toBe("Bare");
    expect(names(sorted(parsed, "stars")).at(-1)).toBe("Bare");
    expect(parsed.plugins[0].name).toBe("Bare");
  });
});

describe("search and categories", () => {
  it("matches every word across name, tagline, tags and author", () => {
    expect(names(search(listings, "github reviews", null))).toEqual(["PR Digest"]);
    expect(names(search(listings, "ada-ostrow", null))).toEqual(["PR Digest"]);
    expect(names(search(listings, "STANDUP summary", null))).toEqual(["Standup"]);
    expect(search(listings, "no such plugin anywhere", null)).toEqual([]);
  });

  it("filters by category and combines it with search", () => {
    const tools = search(listings, "", "developer-tools-and-integrations");
    expect(names(tools).sort()).toEqual(["Counter", "PR Digest", "Shortcut Counter"]);
    expect(names(search(listings, "counter", "developer-tools-and-integrations")).sort()).toEqual(["Counter", "Shortcut Counter"]);
    expect(search(listings, "counter", "communication")).toEqual([]);
  });

  it("keeps the sort order after filtering", () => {
    expect(names(search(sorted(demoIndex, "updated"), "", "productivity"))).toEqual(["Projects", "Notes"]);
  });

  it("only uses known categories", () => {
    expect(listings.every((plugin) => Object.hasOwn(categories, plugin.category))).toBe(true);
  });
});

describe("pure helpers", () => {
  it("summarizes host access in plain language", () => {
    expect(accessSummary({ networkOrigins: ["https://api.example.com"], commands: ["gh auth token"], processes: ["helper --serve"], files: true, mcp: true, agentHooks: true })).toEqual([
      "Connect to api.example.com",
      "Run `helper --serve`",
      "Run `gh auth token`",
      "Read files on this Mac",
      "Serve tools to your agents (MCP)",
      "Observe and steer agent turns",
    ]);
    expect(accessSummary({})).toEqual([]);
  });

  it("renders markdown as text, never HTML", () => {
    const Markdown = createMarkdown(React as never);
    const { container } = render(<Markdown text={"Hi **there** <img src=x onerror=alert(1)>\n\n- [docs](https://example.com/x) and `code`\n- [bad](javascript:alert(1))"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("there");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/x");
  });

  it("joins wrapped list items", () => {
    const Markdown = createMarkdown(React as never);
    const { container } = render(<Markdown text={"- one\n  continued\n- two"} />);
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["one continued", "two"]);
  });

  it("renders headings, numbered lists and code blocks from a README", () => {
    const Markdown = createMarkdown(React as never);
    const { container } = render(
      <Markdown text={"# Title\n\nIntro line\ncontinued.\n\n## Steps\n\n1. Open **Projects**\n2. Pick a repo\n\n```sh\nopen 'x'\n\n<b>raw</b>\n```\n\nDone"} />,
    );
    expect([...container.querySelectorAll("h4")].map((h) => h.textContent)).toEqual(["Title", "Steps"]);
    expect(container.querySelector("p")?.textContent).toBe("Intro line continued.");
    expect([...container.querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["Open Projects", "Pick a repo"]);
    expect(container.querySelector("pre code")?.textContent).toBe("open 'x'\n\n<b>raw</b>");
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("builds a Buzz link to a listing", () => {
    expect(listingLink("a--b")).toBe("buzz://plugin?id=xyz.block.community-marketplace&page=marketplace&route.slug=a--b");
  });

  it("reads the listing slug from a page route", () => {
    expect(slugFromTarget(targetFor("a--b"))).toBe("a--b");
    expect(slugFromTarget({ kind: "page" })).toBeNull();
  });

  it("labels trust and stars", () => {
    expect(trustLabel(counter)).toBe("Official");
    expect(trustLabel(toolbox)).toBe("Community · not reviewed");
    expect(trustLabel(digest)).toBe("Verified by Buzz");
    expect(trustLabel({ ...digest, verified: undefined })).toBe("Community · not reviewed");
    expect(starLabel(1)).toBe("1 star on GitHub");
    expect(starLabel(1234)).toBe("1,234 stars on GitHub");
  });
});

describe("manifest", () => {
  it("declares exactly the GitHub API and raw file origins and nothing to run", () => {
    expect(manifest.id).toBe("xyz.block.community-marketplace");
    expect(manifest.name).toBe("Community Marketplace");
    expect(manifest.host).toEqual({ networkOrigins: ["https://api.github.com", "https://raw.githubusercontent.com"] });
    expect(manifest.host.networkOrigins).toContain(new URL(INDEX_URL).origin);
  });
});

describe("marketplace page", () => {
  it("registers one primary page that only accepts listing slugs", () => {
    const { registered } = fakeContext();
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ id: PAGE_ID, title: "Community Marketplace", primary: true, placement: "topbar" });
    expect(registered[0].route.validate({ slug: counter.slug })).toBe(true);
    expect(registered[0].route.validate({ slug: "../x" })).toBe(false);
    expect(registered[0].route.validate(null)).toBe(false);
  });

  it("draws its tab icon with currentColor so Buzz can tint it like its own tabs", () => {
    const { registered } = fakeContext();
    const { icon } = registered[0] as unknown as { icon: string };
    const svg = atob(icon.slice("data:image/svg+xml;base64,".length));
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toMatch(/stroke\s*:\s*#/);
  });

  it("shows cards with stars, last update, author and a trust label", async () => {
    const { registered } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    expect(await screen.findByRole("heading", { name: "Community Marketplace", level: 1 })).toBeTruthy();
    expect(cardNames()).toEqual(names(sorted(demoIndex, "updated")));
    const card = screen.getByText("Counter", { selector: ".bm-card-name" }).closest(".bm-card") as HTMLElement;
    expect(within(card).getByText("Updated Oct 12, 2026")).toBeTruthy();
    expect(within(card).getByLabelText("410 stars on GitHub").textContent).toBe("★ 410");
    expect(within(card).getByText("by block")).toBeTruthy();
    expect(within(card).getByText("Official")).toBeTruthy();
    const community = screen.getByText("Agent Toolbox", { selector: ".bm-card-name" }).closest(".bm-card") as HTMLElement;
    expect(within(community).getByText("Unreviewed").getAttribute("title")).toBe("Community · not reviewed");
    expect(within(community).getByText("by relaycrew")).toBeTruthy();
    const verified = screen.getByText("PR Digest", { selector: ".bm-card-name" }).closest(".bm-card") as HTMLElement;
    expect(within(verified).getByRole("img", { name: VERIFIED_LABEL }).closest(".bm-card-title")).toBe(within(verified).getByText("PR Digest").parentElement);
    expect(within(verified).queryByText(/Verified|Unreviewed/, { selector: ".bm-badge" })).toBeNull();
    expect(within(community).queryByRole("img", { name: VERIFIED_LABEL })).toBeNull();
    expect(screen.queryByText(/Showing the index built into this version/)).toBeNull();
    expect(screen.getByText(/Index updated Nov 5, 2026\. Nothing about what you install is sent anywhere\./)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("shows the bundled index and says so when the live one can't be reached", async () => {
    const { registered } = fakeContext({ request: hostWith({ indexStatus: 503 }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    expect(await screen.findByText(/Showing the index built into this version/)).toBeTruthy();
    expect(cardNames()).toEqual(names(sorted(bundledIndex, "updated")));
  });

  it("switches between Recently updated, Most stars and A–Z", async () => {
    const { registered } = fakeContext({ request: hostWith({ index: demoFixture }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    const sort = await screen.findByRole("group", { name: "Sort" });
    expect(within(sort).getByRole("button", { name: "Recently updated" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "Recently updated", level: 2 })).toBeTruthy();

    fireEvent.click(within(sort).getByRole("button", { name: "Most stars" }));
    expect(cardNames()).toEqual(names(sorted(demoIndex, "stars")));
    fireEvent.click(within(sort).getByRole("button", { name: "A–Z" }));
    expect(cardNames()).toEqual(names(sorted(demoIndex, "name")));
    expect(cardNames()).toContain("Agent Toolbox");
  });

  it("leaves out the star count when a plugin has none", async () => {
    const plugins = demoFixture.plugins.map((plugin) => (plugin.name === "Roster" ? { ...plugin, stars: 0 } : plugin));
    const { registered } = fakeContext({ request: hostWith({ index: rawIndex(plugins) }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    await screen.findByRole("heading", { name: "Community Marketplace", level: 1 });
    const card = screen.getByText("Roster", { selector: ".bm-card-name" }).closest(".bm-card") as HTMLElement;
    expect(card.querySelector(".bm-card-stars")).toBeNull();
  });

  it("searches and filters by category within a sort", async () => {
    const { registered, open } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    await screen.findByRole("heading", { name: "Community Marketplace", level: 1 });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plugins" }), { target: { value: "counter" } });
    expect(screen.getByText("2 plugins")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Most stars" }));
    expect(cardNames()).toEqual(["Counter", "Shortcut Counter"]);
    fireEvent.click(within(screen.getByRole("group", { name: "Categories" })).getByRole("button", { name: "Communication" }));
    expect(screen.getByText("No plugins match.")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Categories" })).getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByText("Shortcut Counter", { selector: ".bm-card-name" }));
    expect(open).toHaveBeenCalledWith({
      version: 1,
      kind: "page",
      pluginId: PLUGIN_ID,
      pageId: PAGE_ID,
      route: { version: 1, params: { slug: bySlug("github-com--block--buzz-app--examples--plugins--shortcut-counter").slug } },
    });
  });

  it("says when nothing is listed", async () => {
    const { registered } = fakeContext({ request: hostWith({ index: rawIndex([]) }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    expect(await screen.findByText("Nothing is listed yet.")).toBeTruthy();
  });

  it("shows the audit tier and flags above Add to Buzz, with access, setup and links", async () => {
    const { registered } = fakeContext(installer(vi.fn(async () => "installed")));
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(toolbox.slug) }} />));
    const add = await screen.findByRole("button", { name: "Add to Buzz" });
    const audit = screen.getByLabelText("Audit");
    expect(audit.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(audit).getByText("High access")).toBeTruthy();
    expect(within(audit).getByText("dynamic-code")).toBeTruthy();
    expect(within(audit).getByText("undeclared-origin")).toBeTruthy();
    expect(within(audit).getByText("Community · not reviewed")).toBeTruthy();
    expect(audit.textContent).toContain("hasn't cleared this version");
    expect(audit.textContent).toContain("changed since the last index");
    const access = screen.getByText("Can access").closest(".bm-aside-card") as HTMLElement;
    expect(access.textContent).toContain("Connect to api.relaycrew.dev");
    expect(access.textContent).toContain("relaycrew-helper --serve");
    expect(access.textContent).toContain("Read files on this Mac");
    expect(access.textContent).toContain("Serve tools to your agents (MCP)");
  });

  it("marks a verified plugin on its own name and in its audit, and leaves others unmarked", async () => {
    const { registered } = fakeContext(installer(vi.fn(async () => "installed")));
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(digest.slug) }} />));
    await screen.findByRole("button", { name: "Add to Buzz" });
    expect(within(screen.getByRole("heading", { level: 1 })).getByRole("img", { name: VERIFIED_LABEL })).toBeTruthy();
    const audit = screen.getByLabelText("Audit");
    expect(within(audit).getByText("Verified by Buzz")).toBeTruthy();
    expect(audit.textContent).toContain("reviewed this exact version");
    cleanup();
    await act(async () => render(<Page navigation={{ target: targetFor(toolbox.slug) }} />));
    await screen.findByRole("button", { name: "Add to Buzz" });
    expect(screen.queryByRole("img", { name: VERIFIED_LABEL })).toBeNull();
  });

  it("shows setup steps, links, demo media and a clear audit on a reviewed listing", async () => {
    const { registered } = fakeContext(installer(vi.fn(async () => "installed")));
    const Page = registered[0].component;
    const projects = byName("Projects");
    await act(async () => render(<Page navigation={{ target: targetFor(projects.slug) }} />));
    await screen.findByRole("button", { name: "Add to Buzz" });
    const audit = screen.getByLabelText("Audit");
    expect(within(audit).getByText("Low access")).toBeTruthy();
    expect(within(audit).getByText("No flags from the automated scan.")).toBeTruthy();
    expect(audit.textContent).not.toContain("hasn't cleared");
    expect(screen.getByText("Nothing beyond Buzz itself.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Watch the demo video" }).getAttribute("href")).toBe(projects.demo?.video?.url);
    expect(document.querySelectorAll(".bm-shots img")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Repository" }).getAttribute("href")).toBe("https://github.com/nickhenggeler/buzz-projects-plugin");
    const prDigest = byName("PR Digest");
    cleanup();
    await act(async () => render(<Page navigation={{ target: targetFor(prDigest.slug) }} />));
    expect((await screen.findByText("After you add it")).closest(".bm-aside-card")?.textContent).toContain("Enter your GitHub username");
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe("https://github.com/ada-ostrow/buzz-pr-digest#usage");
    expect(screen.getByText("Network access")).toBeTruthy();
  });

  it("falls back to initials when demo art fails to load", async () => {
    const { registered } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    await screen.findByRole("heading", { name: "Community Marketplace", level: 1 });
    const card = document.querySelector(".bm-card img")!.closest(".bm-card") as HTMLElement;
    fireEvent.error(card.querySelector("img")!);
    expect(card.querySelector(".bm-art")).toBeTruthy();
  });
});

describe("Add to Buzz", () => {
  it("walks through manual install when the host can't install plugins", async () => {
    const { registered, open } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    fireEvent.click(await screen.findByRole("button", { name: "Add to Buzz" }));
    const dialog = screen.getByRole("dialog", { name: "Add Counter" });
    expect(dialog.textContent).toContain("https://github.com/block/buzz-app");
    expect(dialog.textContent).toContain(counter.source.commit);
    expect(dialog.textContent).toContain("examples/plugins/counter");
    fireEvent.click(screen.getByRole("button", { name: "Open plugin settings" }));
    expect(open).toHaveBeenCalledWith({ version: 1, kind: "settings", section: "plugins" });
  });

  it("keeps keyboard focus inside the manual install dialog and returns it on close", async () => {
    const { registered } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    const add = await screen.findByRole("button", { name: "Add to Buzz" });
    add.focus();
    fireEvent.click(add);
    const dialog = screen.getByRole("dialog", { name: "Add Counter" });
    expect(document.activeElement).toBe(dialog);
    const buttons = [...dialog.querySelectorAll("button")];
    buttons.at(-1)!.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons.at(-1));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add to Buzz" }));
  });

  it("tracks panel-only plugins becoming active", async () => {
    let panelIds: string[] = [];
    const listeners = new Set<() => void>();
    const panels = {
      snapshot: () => panelIds.map((pluginId) => ({ pluginId })),
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    };
    const { registered } = fakeContext({ panels, runEffects: true });
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    expect(await screen.findByRole("button", { name: "Add to Buzz" })).toBeTruthy();
    panelIds = [counter.id];
    act(() => listeners.forEach((listener) => listener()));
    expect(screen.getByRole("button", { name: "How to update" })).toBeTruthy();
    panelIds = [];
    act(() => listeners.forEach((listener) => listener()));
    expect(screen.getByRole("button", { name: "Add to Buzz" })).toBeTruthy();
  });

  it("passes the pinned source to the installer, with the plugin folder only when there is one", async () => {
    const requestInstall = vi.fn(async (_source: unknown) => "installed");
    const { registered } = fakeContext(installer(requestInstall));
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Add to Buzz" })));
    expect(requestInstall).toHaveBeenCalledWith({
      repository: "https://github.com/block/buzz-app",
      reference: "main",
      commit: counter.source.commit,
      path: "examples/plugins/counter",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link to this plugin" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Added to Buzz" }).textContent).toContain("Counter is installed and turned on.");
    const projects = byName("Projects");
    expect(sourceOf(projects)).toEqual({ repository: "https://github.com/nickhenggeler/buzz-projects-plugin", reference: "main", commit: projects.source.commit });
    expect(sourceOf(counter)).toEqual({ repository: "https://github.com/block/buzz-app", reference: "main", commit: counter.source.commit, path: "examples/plugins/counter" });
  });

  it("shows each step of the install, then the listing's setup", async () => {
    let finish: (outcome: string) => void = () => {};
    const requestInstall = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const { registered } = fakeContext(installer(requestInstall));
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    expect((await screen.findByText("After you add it")).closest(".bm-aside-card")?.textContent).toContain("Open the Counter page");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to Buzz" })));
    expect((screen.getByRole("button", { name: "Reviewing in Buzz…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status", { name: "Adding Counter" }).textContent).toContain("Buzz opened its install review");
    await act(async () => finish("installed"));
    const status = screen.getByRole("status", { name: "Added to Buzz" });
    expect(status.querySelector('[data-state="next"]')?.textContent).toContain("Open the Counter page");
    expect(requestInstall).toHaveBeenCalledTimes(1);
  });

  it("says nothing changed when the review is cancelled, and offers to retry", async () => {
    const requestInstall = vi.fn(async () => "cancelled");
    const { registered } = fakeContext(installer(requestInstall));
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Add to Buzz" })));
    expect(screen.getByRole("status", { name: "Not added" }).textContent).toContain("Nothing changed.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(requestInstall).toHaveBeenCalledTimes(2);
  });

  it("opens the listing when a card starts an install", async () => {
    const requestInstall = vi.fn(async () => "installed");
    const { registered, open } = fakeContext(installer(requestInstall));
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    await act(async () => fireEvent.click((await screen.findAllByRole("button", { name: "Add to Buzz" }))[0]));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ pageId: PAGE_ID, route: { version: 1, params: { slug: expect.any(String) } } }));
    expect(requestInstall).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable review and a source the host rejects", async () => {
    for (const [outcome, text] of [
      ["unavailable", "couldn't open its install review"],
      ["failed", "couldn't use this listing's source"],
    ]) {
      cleanup();
      const requestInstall = vi.fn(async () => {
        if (outcome === "failed") throw new Error("bad source");
        return outcome;
      });
      const { registered } = fakeContext(installer(requestInstall));
      const Page = registered[0].component;
      await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
      await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Add to Buzz" })));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("status").textContent).toContain(text);
    }
  });

  it("hides the Buzz link on hosts that can't open it", async () => {
    const { registered } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    await screen.findByRole("button", { name: "Add to Buzz" });
    expect(screen.queryByRole("button", { name: "Copy link to this plugin" })).toBeNull();
  });

  it("doesn't navigate when Enter is pressed on a card's button", async () => {
    const { registered, open } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    const add = (await screen.findAllByRole("button", { name: "Add to Buzz" }))[0];
    fireEvent.keyDown(add, { key: "Enter" });
    expect(open).not.toHaveBeenCalled();
    fireEvent.keyDown(add.closest(".bm-card")!, { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(1);
  });
});


describe("privacy", () => {
  it("sends nothing after an install, and only ever reads the index", async () => {
    const net = hostWith();
    const requestInstall = vi.fn(async () => "installed");
    const { registered } = fakeContext({ request: net.request, ...installer(requestInstall) });
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add to Buzz" }));
    });
    await flush();
    expect(requestInstall).toHaveBeenCalledTimes(1);
    expect(net.calls.map((call) => `${call.method} ${call.url}`)).toEqual([`GET ${INDEX_URL}`]);
    expect(window.localStorage.length).toBe(0);
    expect(screen.queryByRole("button", { name: /Upvote/ })).toBeNull();
  });
});

describe("Add your plugin", () => {
  const RAW = "https://raw.githubusercontent.com/octo/plug/main";
  type Route = { status: number; body?: string } | Error;
  function submitHost(overrides: Record<string, Route> = {}) {
    const routes: Record<string, Route> = {
      [INDEX_URL]: { status: 200, body: JSON.stringify(demoFixture) },
      "https://api.github.com/repos/octo/plug": { status: 200, body: JSON.stringify({ private: false, default_branch: "main" }) },
      [`${RAW}/manifest.json`]: { status: 200, body: JSON.stringify({ id: "octo.plug", name: "Plug", apiVersion: 1, description: "Does a thing." }) },
      [`${RAW}/plugin.js`]: { status: 200, body: "" },
      ...overrides,
    };
    const calls: { url: string; method: string; headers?: Record<string, string>; body?: string }[] = [];
    const request = vi.fn(async (input: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
      calls.push({ url: input.url, method: input.method ?? "GET", headers: input.headers, body: input.body });
      const route = routes[input.url];
      if (route instanceof Error) throw route;
      return { headers: {}, body: "", ...(route ?? { status: 404, body: "not found" }) };
    });
    return { request, calls };
  }

  async function openDialog(host = submitHost()) {
    const { registered, open } = fakeContext({ request: host.request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    const trigger = await screen.findByRole("button", { name: "Add your plugin" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Add your plugin" });
    const [repository, ref] = within(dialog).getAllByRole("textbox") as HTMLInputElement[];
    const submit = async (value: string, refValue = "") => {
      fireEvent.change(repository!, { target: { value } });
      fireEvent.change(ref!, { target: { value: refValue } });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Check" }));
      });
      await flush();
    };
    return { dialog, submit, host, open };
  }

  it("parses owner/repo, folders, links and refs", () => {
    expect(parseSourceInput("octo/plug")).toEqual({ owner: "octo", repo: "plug", path: "" });
    expect(parseSourceInput(" https://github.com/octo/plug.git/ ")).toEqual({ owner: "octo", repo: "plug", path: "" });
    expect(parseSourceInput("octo/plug/plugins/one", "v1.2.0")).toEqual({ owner: "octo", repo: "plug", ref: "v1.2.0", path: "plugins/one" });
    expect(parseSourceInput("https://github.com/octo/plug/tree/dev/plugins/one")).toEqual({ owner: "octo", repo: "plug", ref: "dev", path: "plugins/one" });
    for (const bad of ["", "octo", "octo/..", "octo/plug/../x", "git@github.com:octo/plug", "octo/plug/a b"]) expect(parseSourceInput(bad)).toBeNull();
    expect(parseSourceInput("octo/plug", "bad..ref")).toBeNull();
  });

  it("states what a listing needs", async () => {
    const { dialog } = await openDialog();
    expect(dialog.textContent).toContain("public GitHub repository");
    expect(within(dialog).getByText("manifest.json")).toBeTruthy();
    expect(within(dialog).getByText("plugin.js")).toBeTruthy();
    expect(within(dialog).getByText("buzz-listing.yaml")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Check" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("checks the repository anonymously, then links to a pull request and a prefilled issue", async () => {
    const { dialog, submit, host } = await openDialog();
    await submit("octo/plug");
    expect(within(dialog).getByText("Plug")).toBeTruthy();
    expect(within(dialog).getByText(/octo\.plug · octo\/plug @ main/)).toBeTruthy();
    expect(within(dialog).getByText(/It can be listed/)).toBeTruthy();
    expect(within(dialog).getByText("https://github.com/octo/plug main")).toBeTruthy();
    const urls = host.calls.filter((call) => call.url !== INDEX_URL).map((call) => `${call.method} ${call.url}`);
    expect(urls).toEqual(["GET https://api.github.com/repos/octo/plug", `GET ${RAW}/manifest.json`, `HEAD ${RAW}/plugin.js`]);
    for (const call of host.calls) expect(Object.keys(call.headers ?? {}).map((name) => name.toLowerCase())).not.toContain("authorization");
    const pr = within(dialog).getByRole("link", { name: "Open a pull request" });
    expect(pr.getAttribute("href")).toBe("https://github.com/block/buzz-plugins/edit/main/sources.txt");
    expect(pr.getAttribute("target")).toBe("_blank");
    const issue = new URL(within(dialog).getByRole("link", { name: "Request in an issue" }).getAttribute("href")!);
    expect(`${issue.origin}${issue.pathname}`).toBe("https://github.com/block/buzz-plugins/issues/new");
    expect(Object.fromEntries(issue.searchParams)).toEqual({ template: "list-plugin.yml", title: "List: Plug", source: "https://github.com/octo/plug main" });
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("puts the folder and ref in the source line", async () => {
    const base = "https://raw.githubusercontent.com/octo/plug/v2/plugins/one";
    const host = submitHost({
      [`${base}/manifest.json`]: { status: 200, body: JSON.stringify({ id: "octo.one", name: "One" }) },
      [`${base}/plugin.js`]: { status: 200 },
    });
    const { dialog, submit } = await openDialog(host);
    await submit("octo/plug/plugins/one", "v2");
    expect(within(dialog).getByText("https://github.com/octo/plug v2 plugins/one")).toBeTruthy();
    const issue = new URL(within(dialog).getByRole("link", { name: "Request in an issue" }).getAttribute("href")!);
    expect(issue.searchParams.get("source")).toBe("https://github.com/octo/plug v2 plugins/one");
  });

  it("builds source lines and links the way sources.txt and the issue form expect", () => {
    const source = { owner: "o", repo: "r", ref: "main", path: "", id: "o.r", name: "R & D", description: "" };
    expect(sourceLine(source)).toBe("https://github.com/o/r main");
    expect(sourceLine({ ...source, path: "a/b" })).toBe("https://github.com/o/r main a/b");
    const links = listingLinks(source, "someone/fork");
    expect(links.pullRequest).toBe("https://github.com/someone/fork/edit/main/sources.txt");
    expect(new URL(links.issue).searchParams.get("title")).toBe("List: R & D");
  });

  it("explains each reason the check fails, and offers no links", async () => {
    const cases: [Record<string, Route>, RegExp][] = [
      [{ "https://api.github.com/repos/octo/plug": { status: 404 } }, /can't find octo\/plug/],
      [{ "https://api.github.com/repos/octo/plug": { status: 200, body: JSON.stringify({ private: true }) } }, /is private/],
      [{ "https://api.github.com/repos/octo/plug": { status: 403 } }, /HTTP 403/],
      [{ [`${RAW}/manifest.json`]: { status: 404 } }, /no manifest\.json in the repository root on main/],
      [{ [`${RAW}/manifest.json`]: { status: 200, body: "{nope" } }, /isn't valid JSON/],
      [{ [`${RAW}/manifest.json`]: { status: 200, body: JSON.stringify({ id: "Bad Id", name: "x" }) } }, /needs an id/],
      [{ [`${RAW}/plugin.js`]: { status: 404 } }, /no plugin\.js next to manifest\.json/],
      [{ "https://api.github.com/repos/octo/plug": new Error("offline") }, /Couldn't reach GitHub/],
    ];
    for (const [overrides, message] of cases) {
      const { dialog, submit, host } = await openDialog(submitHost(overrides));
      await submit("octo/plug");
      expect(within(dialog).getByText(message)).toBeTruthy();
      expect(within(dialog).queryByRole("link", { name: "Open a pull request" })).toBeNull();
      cleanup();
    }
  });

  it("asks for a usable repository before checking anything", async () => {
    const { dialog, submit, host } = await openDialog();
    await submit("not a repo");
    expect(within(dialog).getByText(/Enter a GitHub repository/)).toBeTruthy();
    expect(host.calls.filter((call) => call.url !== INDEX_URL)).toEqual([]);
  });

  it("links to a listing that already exists instead of offering to list it again", async () => {
    const counterRaw = `https://raw.githubusercontent.com/block/buzz-app/main/examples/plugins/counter`;
    const listed = await openDialog(
      submitHost({
        "https://api.github.com/repos/block/buzz-app": { status: 200, body: JSON.stringify({ private: false, default_branch: "main" }) },
        [`${counterRaw}/manifest.json`]: { status: 200, body: JSON.stringify({ id: "example.counter", name: "Counter" }) },
        [`${counterRaw}/plugin.js`]: { status: 200 },
      }),
    );
    await listed.submit("block/buzz-app/examples/plugins/counter");
    expect(within(listed.dialog).getByText("Counter is already listed.")).toBeTruthy();
    expect(within(listed.dialog).queryByRole("link", { name: "Open a pull request" })).toBeNull();
    fireEvent.click(within(listed.dialog).getByRole("button", { name: "View listing" }));
    expect(listed.open).toHaveBeenCalledWith(expect.objectContaining({ route: { version: 1, params: { slug: counter.slug } } }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and keeps focus inside while open", async () => {
    const { dialog } = await openDialog();
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add your plugin" }));
  });

  it("checkSource stays inside the declared origins", async () => {
    const host = submitHost();
    const checked = await checkSource(host as never, { owner: "octo", repo: "plug", path: "" });
    expect(checked.ok).toBe(true);
    const origins = new Set(host.calls.map((call) => new URL(call.url).origin));
    for (const origin of origins) expect(manifest.host.networkOrigins).toContain(origin);
  });
});
