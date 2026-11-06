import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import demoFixture from "../demo/index.demo.json";
import realFixture from "../../fixtures/index.json";
import manifest from "../manifest.json";
import { accessSummary, bundledIndex, categories, INDEX_ORIGIN, type Listing, loadIndex, parseIndex, parseKey, ranked, search } from "./catalog";
import { apply } from "./index";
import { sourceOf } from "./install";
import { createMarkdown } from "./markdown";
import { CLIENT, hasReported, hasUpvoted, installerHash, REPORTED_KEY, reportInstall, SALT_KEY, sendVote, SHARE_KEY, VOTES_KEY } from "./ping";
import { addedBy, installLine, listingLink, PAGE_ID, PLUGIN_ID, slugFromTarget, trustLabel, upvoteLabel } from "./view";

const INDEX_URL = `${INDEX_ORIGIN}/v1/index.json`;
const PING_URL = `${INDEX_ORIGIN}/v1/installs`;
const VOTE_URL = `${INDEX_ORIGIN}/v1/votes`;
const SALT = "ab".repeat(32);
const COUNTER_HASH = "baf23647348cbb162473d539ae5f850866ab9a2c39c7f91ea0ffe3c8cb51cd0b";

const demoIndex = parseIndex(demoFixture)!;
const listings = demoIndex.plugins;
const bySlug = (slug: string) => listings.find((plugin) => plugin.slug === slug)!;
const byName = (name: string) => listings.find((plugin) => plugin.name === name)!;
const counter = byName("Counter");
const toolbox = byName("Agent Toolbox");
const names = (plugins: readonly Listing[]) => plugins.map((plugin) => plugin.name);
const rawListing = (overrides: Record<string, unknown> = {}) => ({ ...structuredClone(demoFixture.plugins[0]), ...overrides });
const rawIndex = (plugins: unknown[], rankings: unknown = demoFixture.rankings) => ({ ...demoFixture, plugins, rankings });

type Reply = { status: number; body: string } | Error;
function hostWith(
  routes: { index?: unknown; indexStatus?: number; github?: Reply; ping?: Reply; vote?: Reply } = {},
) {
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
    if (input.url === PING_URL) return reply(routes.ping ?? { status: 202, body: "{}" });
    if (input.url === VOTE_URL) return reply(routes.vote ?? { status: 202, body: "{}" });
    throw new Error(`unexpected ${input.url}`);
  });
  return {
    request,
    calls,
    pings: () => calls.filter((call) => call.url === PING_URL),
    votes: () => calls.filter((call) => call.url === VOTE_URL).map((call) => JSON.parse(call.body!)),
  };
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
    expect(demoIndex.rankings.allTime).toHaveLength(listings.length);
  });

  it("accepts the bundled crawl output without dropping anything", () => {
    expect(bundledIndex.plugins.length).toBeGreaterThan(0);
    expect(bundledIndex.plugins.map((plugin) => plugin.key)).toEqual(realFixture.plugins.map((plugin) => plugin.key));
    expect(bundledIndex.rankings.allTime).toEqual(realFixture.rankings.allTime);
    expect(bundledIndex.rankings.trending).toEqual(realFixture.rankings.trending);
    expect(bundledIndex.rankings.hot).toEqual(realFixture.rankings.hot);
  });

  it("accepts a well-formed index", () => {
    const parsed = parseIndex(rawIndex([rawListing()], { allTime: [demoFixture.plugins[0].key], trending: [], hot: [] }));
    expect(parsed?.plugins).toHaveLength(1);
    expect(parsed?.generatedAt).toBe("2026-11-05T23:00:00.000Z");
  });

  it("rejects wrong shapes outright", () => {
    for (const value of [null, "index", [], {}, { ...demoFixture, schemaVersion: 2 }, { ...demoFixture, plugins: "none" }, { ...demoFixture, generatedAt: "yesterday" }, { ...demoFixture, collectionStartedAt: undefined }])
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
      rawListing({ author: {} }),
      rawListing({ host: undefined }),
      rawListing({ host: { ...good.host, networkOrigins: ["http://insecure.example"] } }),
      rawListing({ audit: { ...good.audit, tier: "extreme" } }),
      rawListing({ audit: { ...good.audit, cleared: "yes" } }),
      rawListing({ audit: { ...good.audit, flags: [{ code: "x" }] } }),
      rawListing({ installs: { allTime: -1, last24h: 0, last7d: 0 } }),
      rawListing({ installs: { allTime: 1.5, last24h: 0, last7d: 0 } }),
      rawListing({ installs: undefined }),
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
  it("reads the index from the index origin", async () => {
    const { request, calls } = hostWith({ index: rawIndex([rawListing()], { allTime: [], trending: [], hot: [] }) });
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
  it("lists every plugin in All time order, uncleared ones included", () => {
    expect(names(ranked(demoIndex, "allTime"))).toEqual([
      "Counter",
      "Agent Toolbox",
      "Notes",
      "Projects",
      "Shortcut Counter",
      "PR Digest",
      "Standup",
      "Roster",
    ]);
  });

  it("orders Trending by new installers over the daily average", () => {
    expect(names(ranked(demoIndex, "trending"))).toEqual(["PR Digest", "Projects", "Notes", "Standup", "Counter"]);
  });

  it("orders Hot by recent installs", () => {
    expect(names(ranked(demoIndex, "hot"))).toEqual(["Notes", "PR Digest", "Projects", "Standup", "Counter", "Shortcut Counter"]);
  });

  it("keeps uncleared listings out of Trending and Hot even when the index ranks them", () => {
    expect(toolbox.audit.cleared).toBe(false);
    const parsed = parseIndex(
      rawIndex(demoFixture.plugins, {
        allTime: demoFixture.rankings.allTime,
        trending: [toolbox.key, ...demoFixture.rankings.trending],
        hot: [toolbox.key, ...demoFixture.rankings.hot],
      }),
    )!;
    expect(names(ranked(parsed, "trending"))).not.toContain("Agent Toolbox");
    expect(names(ranked(parsed, "hot"))).not.toContain("Agent Toolbox");
    expect(names(ranked(parsed, "allTime"))).toContain("Agent Toolbox");
  });

  it("ignores unknown and repeated ranking keys and appends unranked listings to All time", () => {
    const [first, second] = demoFixture.plugins;
    const other = { ...structuredClone(second), installs: { allTime: 500, last24h: 0, last7d: 0 } };
    const parsed = parseIndex(rawIndex([first, other], { allTime: [first.key, first.key, "github.com/x/missing"], trending: ["github.com/x/missing"], hot: 5 }))!;
    expect(parsed.rankings).toEqual({ allTime: [first.key, other.key], trending: [], hot: [], mostUpvoted: [] });
  });
});

describe("upvotes in the index", () => {
  it("orders Most upvoted by upvotes, leaving out uncleared listings and listings without upvotes", () => {
    expect(names(ranked(demoIndex, "mostUpvoted"))).toEqual(["Notes", "Projects", "Counter", "PR Digest", "Standup", "Shortcut Counter"]);
    const parsed = parseIndex(
      rawIndex(
        demoFixture.plugins.map((plugin) => (plugin.name === "Standup" ? { ...plugin, upvotes: 0 } : plugin)),
        { ...demoFixture.rankings, mostUpvoted: [toolbox.key, ...demoFixture.rankings.mostUpvoted] },
      ),
    )!;
    expect(names(ranked(parsed, "mostUpvoted"))).toEqual(["Notes", "Projects", "Counter", "PR Digest", "Shortcut Counter"]);
  });

  it("accepts an index without upvotes and drops listings with bad counts", () => {
    const { upvotes: _, ...plain } = rawListing();
    const older = parseIndex(rawIndex([plain], { allTime: [plain.key], trending: [], hot: [] }))!;
    expect(older.plugins).toHaveLength(1);
    expect(older.rankings.mostUpvoted).toEqual([]);
    for (const upvotes of [-1, 1.5, "3", null]) expect(parseIndex(rawIndex([rawListing({ upvotes }), plain]))?.plugins).toHaveLength(1);
  });

  it("keeps the bundled crawl's upvotes and ranking", () => {
    expect(bundledIndex.rankings.mostUpvoted).toEqual(realFixture.rankings.mostUpvoted);
    expect(bundledIndex.plugins.map((plugin) => plugin.upvotes)).toEqual(realFixture.plugins.map((plugin) => plugin.upvotes));
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

  it("keeps ranked order after filtering", () => {
    expect(names(search(ranked(demoIndex, "hot"), "", "productivity"))).toEqual(["Notes", "Projects"]);
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

  it("labels trust and counts", () => {
    expect(trustLabel(counter)).toBe("Official");
    expect(trustLabel(toolbox)).toBe("Community · not reviewed");
    expect(addedBy(1)).toBe("Added by 1 person");
    expect(addedBy(1234)).toBe("Added by 1,234 people");
    expect(installLine(counter, "allTime")).toBe("Added by 388 people");
    expect(installLine(counter, "trending")).toBe("Added by 388 people · +4 today");
    expect(installLine(counter, "hot")).toBe("Added by 388 people · +22 this week");
    expect(installLine({ ...counter, installs: { allTime: 0, last24h: 0, last7d: 0 } }, "allTime")).toBeNull();
    expect(upvoteLabel(1)).toBe("1 upvote");
    expect(upvoteLabel(1234)).toBe("1,234 upvotes");
  });
});

describe("manifest", () => {
  it("declares exactly the index, GitHub API and raw file origins and nothing to run", () => {
    expect(manifest.id).toBe("xyz.block.community-marketplace");
    expect(manifest.name).toBe("Community Marketplace");
    expect(manifest.host).toEqual({ networkOrigins: ["https://plugins.buzz.example", "https://api.github.com", "https://raw.githubusercontent.com"] });
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

  it("shows cards with install counts, author and a trust label", async () => {
    const { registered } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    expect(await screen.findByRole("heading", { name: "Community Marketplace", level: 1 })).toBeTruthy();
    expect(cardNames()).toEqual(names(ranked(demoIndex, "allTime")));
    const card = screen.getByText("Counter", { selector: ".bm-card-name" }).closest(".bm-card") as HTMLElement;
    expect(within(card).getByText("Added by 388 people")).toBeTruthy();
    expect(within(card).getByText("by block")).toBeTruthy();
    expect(within(card).getByText("Official")).toBeTruthy();
    const community = screen.getByText("Agent Toolbox", { selector: ".bm-card-name" }).closest(".bm-card") as HTMLElement;
    expect(within(community).getByText("Unreviewed").getAttribute("title")).toBe("Community · not reviewed");
    expect(within(community).getByText("by relaycrew")).toBeTruthy();
    expect(screen.queryByText(/Showing the index built into this version/)).toBeNull();
  });

  it("shows the bundled index and says so when the live one can't be reached", async () => {
    const { registered } = fakeContext({ request: hostWith({ indexStatus: 503 }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    expect(await screen.findByText(/Showing the index built into this version/)).toBeTruthy();
    expect(cardNames()).toEqual(names(ranked(bundledIndex, "allTime")));
  });

  it("switches between All time, Trending and Hot", async () => {
    const { registered } = fakeContext({ request: hostWith({ index: demoFixture }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    const sort = await screen.findByRole("group", { name: "Sort" });
    expect(within(sort).getByRole("button", { name: "All time" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/Showing the index built into this version/)).toBeNull();

    fireEvent.click(within(sort).getByRole("button", { name: "Trending" }));
    expect(cardNames()).toEqual(names(ranked(demoIndex, "trending")));
    expect(cardNames()).not.toContain("Agent Toolbox");
    expect(screen.getByText("Added by 74 people · +18 today")).toBeTruthy();

    fireEvent.click(within(sort).getByRole("button", { name: "Hot" }));
    expect(cardNames()).toEqual(names(ranked(demoIndex, "hot")));
    expect(cardNames()).not.toContain("Agent Toolbox");
    expect(screen.getByText("Added by 251 people · +64 this week")).toBeTruthy();

    fireEvent.click(within(sort).getByRole("button", { name: "Most upvoted" }));
    expect(cardNames()).toEqual(names(ranked(demoIndex, "mostUpvoted")));
    expect(screen.getByRole("heading", { name: "Most upvoted", level: 2 })).toBeTruthy();

    fireEvent.click(within(sort).getByRole("button", { name: "All time" }));
    expect(cardNames()).toContain("Agent Toolbox");
  });

  it("shows each card's upvote count, and none when it has no upvotes", async () => {
    const plugins = demoFixture.plugins.map((plugin) => (plugin.name === "Roster" ? { ...plugin, upvotes: 0 } : plugin));
    const { registered } = fakeContext({ request: hostWith({ index: rawIndex(plugins) }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    await screen.findByRole("heading", { name: "Community Marketplace", level: 1 });
    const card = (name: string) => screen.getByText(name, { selector: ".bm-card-name" }).closest(".bm-card") as HTMLElement;
    expect(within(card("Notes")).getByLabelText("96 upvotes").textContent).toBe("▲ 96");
    expect(card("Roster").querySelector(".bm-card-votes")).toBeNull();
  });

  it("explains an empty Most upvoted list", async () => {
    const empty = rawIndex(demoFixture.plugins, { ...demoFixture.rankings, mostUpvoted: [] });
    const { registered } = fakeContext({ request: hostWith({ index: empty }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    fireEvent.click(await screen.findByRole("button", { name: "Most upvoted" }));
    expect(screen.getByText(/Nothing has upvotes yet/)).toBeTruthy();
  });

  it("searches and filters by category within a sort", async () => {
    const { registered, open } = fakeContext();
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    await screen.findByRole("heading", { name: "Community Marketplace", level: 1 });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plugins" }), { target: { value: "counter" } });
    expect(screen.getByText("2 plugins")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hot" }));
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

  it("explains an empty Trending list", async () => {
    const empty = rawIndex(demoFixture.plugins, { allTime: demoFixture.rankings.allTime, trending: [], hot: [] });
    const { registered } = fakeContext({ request: hostWith({ index: empty }).request });
    const Page = registered[0].component;
    await act(async () => render(<Page />));
    fireEvent.click(await screen.findByRole("button", { name: "Trending" }));
    expect(screen.getByText(/Nothing is ranked here yet/)).toBeTruthy();
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
    expect(audit.textContent).toContain("isn't ranked in Trending or Hot");
    expect(audit.textContent).toContain("changed since the last index");
    const access = screen.getByText("Can access").closest(".bm-aside-card") as HTMLElement;
    expect(access.textContent).toContain("Connect to api.relaycrew.dev");
    expect(access.textContent).toContain("relaycrew-helper --serve");
    expect(access.textContent).toContain("Read files on this Mac");
    expect(access.textContent).toContain("Serve tools to your agents (MCP)");
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
    expect(audit.textContent).not.toContain("isn't ranked");
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

describe("install pings", () => {
  const outcomes = ["installed", "updated", "cancelled", "unavailable", "failed"];

  async function add(slug: string, outcome: string, routes: Parameters<typeof hostWith>[0] = { index: demoFixture }) {
    const net = hostWith(routes);
    const requestInstall = vi.fn(async () => {
      if (outcome === "failed") throw new Error("bad source");
      return outcome;
    });
    const { registered } = fakeContext({ request: net.request, ...installer(requestInstall) });
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(slug) }} />));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Add to Buzz" })));
    await flush();
    return net;
  }

  it("sends one ping with the right body and hash after an installed result", async () => {
    window.localStorage.setItem(SALT_KEY, SALT);
    const net = await add(counter.slug, "installed");
    const github = net.calls.filter((call) => call.url.startsWith("https://api.github.com"));
    expect(github).toEqual([
      { url: "https://api.github.com/repos/block/buzz-app", method: "GET", headers: { accept: "application/vnd.github+json" }, body: undefined },
    ]);
    expect(net.calls.findIndex((call) => call.url === PING_URL)).toBeGreaterThan(net.calls.indexOf(github[0]));
    const [ping] = net.pings();
    expect(net.pings()).toHaveLength(1);
    expect(ping.method).toBe("POST");
    expect(ping.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(ping.body!)).toEqual({
      key: counter.key,
      id: "xyz.block.examples.counter",
      commit: counter.source.commit,
      installer: COUNTER_HASH,
      client: CLIENT,
    });
    expect(CLIENT).toBe("community-marketplace/0.1.0");
    expect(ping.body!.length).toBeLessThan(1024);
  });

  it("sends nothing but the repository check unless the result is installed", async () => {
    for (const outcome of outcomes.filter((name) => name !== "installed")) {
      cleanup();
      const net = await add(counter.slug, outcome);
      expect(net.pings(), outcome).toHaveLength(0);
      expect(net.calls.filter((call) => call.url.includes("api.github.com")), outcome).toHaveLength(0);
    }
  });

  it("is on by default and generates a persistent 32-byte salt on first use", async () => {
    expect(window.localStorage.getItem(SHARE_KEY)).toBeNull();
    const net = await add(counter.slug, "installed");
    expect(net.pings()).toHaveLength(1);
    const salt = window.localStorage.getItem(SALT_KEY)!;
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(await installerHash(counter.id)).toBe(JSON.parse(net.pings()[0].body!).installer);
    expect(await installerHash(counter.id)).toBe(await installerHash(counter.id));
    expect(await installerHash("xyz.block.examples.notes")).not.toBe(await installerHash(counter.id));
    expect(window.localStorage.getItem(SALT_KEY)).toBe(salt);
  });

  it("sends nothing, not even the GitHub check, while the toggle is off", async () => {
    window.localStorage.setItem(SHARE_KEY, "off");
    const net = await add(counter.slug, "installed");
    expect(net.pings()).toHaveLength(0);
    expect(net.calls.filter((call) => call.url.includes("api.github.com"))).toHaveLength(0);
  });

  it("turns pings off from the page and back on", async () => {
    const net = hostWith({ index: demoFixture });
    const requestInstall = vi.fn(async () => "installed");
    const { registered } = fakeContext({ request: net.request, ...installer(requestInstall) });
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    const toggle = (await screen.findByRole("switch", { name: "Share anonymous install counts and upvotes" })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByText(/We send the plugin's address and a random ID that stays on this device/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(window.localStorage.getItem(SHARE_KEY)).toBe("off");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to Buzz" })));
    await flush();
    expect(net.pings()).toHaveLength(0);
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(SHARE_KEY)).toBe("on");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to Buzz" })));
    await flush();
    expect(net.pings()).toHaveLength(1);
  });

  it("sends nothing when GitHub says the repository is private, unreadable or unexpected", async () => {
    const cases: Record<string, Reply> = {
      private: { status: 200, body: JSON.stringify({ private: true }) },
      missing: { status: 404, body: JSON.stringify({ message: "Not Found" }) },
      limited: { status: 403, body: "{}" },
      "no flag": { status: 200, body: JSON.stringify({}) },
      "string flag": { status: 200, body: JSON.stringify({ private: "false" }) },
      "not json": { status: 200, body: "<html>" },
      offline: new Error("offline"),
    };
    for (const [name, github] of Object.entries(cases)) {
      cleanup();
      const net = await add(counter.slug, "installed", { index: demoFixture, github });
      expect(net.calls.some((call) => call.url.includes("api.github.com")), name).toBe(true);
      expect(net.pings(), name).toHaveLength(0);
      expect(screen.getByRole("status", { name: "Added to Buzz" }), name).toBeTruthy();
    }
  });

  it("never sends the GitHub check with credentials", async () => {
    const net = await add(counter.slug, "installed");
    const check = net.calls.find((call) => call.url.includes("api.github.com"))!;
    expect(Object.keys(check.headers ?? {}).map((name) => name.toLowerCase())).toEqual(["accept"]);
  });

  it("pings for a nested plugin using its repository, not its folder", async () => {
    const net = await add(counter.slug, "installed");
    expect(net.calls.find((call) => call.url.includes("api.github.com"))?.url).toBe("https://api.github.com/repos/block/buzz-app");
  });

  it("finishes the install even when the ping fails", async () => {
    const net = await add(counter.slug, "installed", { index: demoFixture, ping: new Error("collector down") });
    expect(net.pings()).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Added to Buzz" }).textContent).toContain("Counter is installed and turned on.");
    cleanup();
    const rejected = await add(counter.slug, "installed", { index: demoFixture, ping: { status: 429, body: "" } });
    expect(rejected.pings()).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Added to Buzz" })).toBeTruthy();
  });

  it("doesn't wait for the ping before reporting the result", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const request = vi.fn(async (input: { url: string }) => {
      if (input.url === INDEX_URL) return { status: 200, headers: {}, body: JSON.stringify(demoFixture) };
      if (input.url.includes("api.github.com")) {
        await hold;
        return { status: 200, headers: {}, body: JSON.stringify({ private: false }) };
      }
      return { status: 202, headers: {}, body: "{}" };
    });
    const { registered } = fakeContext({ request, ...installer(vi.fn(async () => "installed")) });
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Add to Buzz" })));
    expect(screen.getByRole("status", { name: "Added to Buzz" })).toBeTruthy();
    release();
    await flush();
  });

  it("only pings for a key that is in the index", async () => {
    const host = hostWith();
    expect(await reportInstall(host as never, counter, false)).toBeUndefined();
    expect(host.request).not.toHaveBeenCalled();
    await reportInstall(host as never, counter, true);
    expect(host.pings()).toHaveLength(1);
    await reportInstall(host as never, { ...counter, key: "gitlab.com/o/r" }, true);
    expect(host.pings()).toHaveLength(1);
    await expect(reportInstall(undefined, counter, true)).resolves.toBeUndefined();
  });

  it("skips the ping when no salt can be kept on this device", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const host = hostWith();
    await reportInstall(host as never, counter, true);
    storage.mockRestore();
    expect(host.pings()).toHaveLength(0);
  });
});

describe("upvoting", () => {
  function statusHost(initial: "installed" | "absent" = "absent") {
    let status: "installed" | "absent" = initial;
    const listeners = new Set<(status: "installed" | "absent") => void>();
    return {
      set(next: "installed" | "absent") {
        status = next;
        act(() => listeners.forEach((listener) => listener(next)));
      },
      service: (requestInstall: () => Promise<string>) => ({
        requestInstall,
        getInstallationStatus: vi.fn(() => status),
        subscribeInstallationStatus: vi.fn((_id: string, listener: (status: "installed" | "absent") => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }),
      }),
    };
  }

  async function page(options: { routes?: Parameters<typeof hostWith>[0]; status?: "installed" | "absent" } = {}) {
    const net = hostWith(options.routes ?? { index: demoFixture });
    const status = statusHost(options.status);
    const requestInstall = vi.fn(async () => {
      status.set("installed");
      return "installed";
    });
    const service = status.service(requestInstall);
    const { registered } = fakeContext({ request: net.request, reflect: { get: (name: string) => (name === "pluginInstaller" ? service : undefined) } });
    const Page = registered[0].component;
    await act(async () => render(<Page navigation={{ target: targetFor(counter.slug) }} />));
    await screen.findByRole("button", { name: /Add to Buzz|Reinstall/ });
    const upvote = () => screen.getByRole("button", { name: /▲ Upvote/ }) as HTMLButtonElement;
    const add = async () => {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add to Buzz|Reinstall/ })));
      await flush();
    };
    return { net, status, service, upvote, add };
  }

  it("stays off until the plugin is added from here, then sends an upvote with the install hash", async () => {
    window.localStorage.setItem(SALT_KEY, SALT);
    const view = await page();
    expect(view.upvote().disabled).toBe(true);
    expect(screen.getByText("Add it to Buzz from here to upvote it.")).toBeTruthy();
    expect(screen.getByText("64 upvotes")).toBeTruthy();
    await view.add();
    expect(hasReported(counter.key)).toBe(true);
    expect(screen.getByRole("button", { name: "Reinstall" })).toBeTruthy();
    expect(screen.getByText("Added", { selector: ".bm-badge" })).toBeTruthy();
    expect(view.upvote().disabled).toBe(false);
    expect(screen.queryByText("Add it to Buzz from here to upvote it.")).toBeNull();
    await act(async () => fireEvent.click(view.upvote()));
    await flush();
    expect(view.net.votes()).toEqual([{ key: counter.key, id: "xyz.block.examples.counter", voter: COUNTER_HASH, vote: 1, client: CLIENT }]);
    expect(view.upvote().getAttribute("aria-pressed")).toBe("true");
    expect(view.upvote().textContent).toBe("▲ Upvoted");
    expect(screen.getByText("65 upvotes")).toBeTruthy();
    expect(hasUpvoted(counter.key)).toBe(true);
    await act(async () => fireEvent.click(view.upvote()));
    await flush();
    expect(view.net.votes()[1].vote).toBe(0);
    expect(screen.getByText("64 upvotes")).toBeTruthy();
    expect(hasUpvoted(counter.key)).toBe(false);
  });

  it("doesn't unlock when the install ping wasn't accepted, or for a plugin installed elsewhere", async () => {
    const rejected = await page({ routes: { index: demoFixture, ping: { status: 404, body: "{}" } } });
    await rejected.add();
    expect(rejected.upvote().disabled).toBe(true);
    cleanup();
    const elsewhere = await page({ status: "installed" });
    expect(elsewhere.upvote().disabled).toBe(true);
    expect(screen.getByText("Add it to Buzz from here to upvote it.")).toBeTruthy();
  });

  it("is off while anonymous sharing is off", async () => {
    const view = await page();
    await view.add();
    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous install counts and upvotes" }));
    expect(view.upvote().disabled).toBe(true);
    expect(screen.getByText("Turn on anonymous sharing below to upvote.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous install counts and upvotes" }));
    expect(view.upvote().disabled).toBe(false);
  });

  it("is off when the plugin is removed again", async () => {
    const view = await page();
    await view.add();
    expect(view.upvote().disabled).toBe(false);
    view.status.set("absent");
    expect(view.upvote().disabled).toBe(true);
  });

  it("shows the upvote right away and takes it back when the collector refuses it or the request fails", async () => {
    for (const vote of [{ status: 403, body: "{}" }, new Error("offline")]) {
      const view = await page({ routes: { index: demoFixture, vote } });
      await view.add();
      fireEvent.click(view.upvote());
      expect(screen.getByText("65 upvotes")).toBeTruthy();
      expect(view.upvote().disabled).toBe(true);
      await flush();
      expect(screen.getByText("64 upvotes")).toBeTruthy();
      expect(view.upvote().getAttribute("aria-pressed")).toBe("false");
      expect(hasUpvoted(counter.key)).toBe(false);
      cleanup();
      window.localStorage.clear();
    }
  });

  it("remembers an upvote on this device without counting it twice", async () => {
    window.localStorage.setItem(REPORTED_KEY, JSON.stringify([counter.key]));
    window.localStorage.setItem(VOTES_KEY, JSON.stringify([counter.key]));
    const view = await page({ status: "installed" });
    expect(view.upvote().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("64 upvotes")).toBeTruthy();
    expect(view.upvote().disabled).toBe(false);
  });

  it("sendVote never throws and sends nothing it isn't allowed to", async () => {
    const host = hostWith();
    expect(await sendVote(host as never, counter, true)).toBe(false);
    window.localStorage.setItem(REPORTED_KEY, JSON.stringify([counter.key]));
    window.localStorage.setItem(SHARE_KEY, "off");
    expect(await sendVote(host as never, counter, true)).toBe(false);
    expect(host.request).not.toHaveBeenCalled();
    window.localStorage.setItem(SHARE_KEY, "on");
    expect(await sendVote(undefined, counter, true)).toBe(false);
    const failing = { request: vi.fn(async () => Promise.reject(new Error("down"))) };
    await expect(sendVote(failing as never, counter, true)).resolves.toBe(false);
    window.localStorage.setItem(REPORTED_KEY, "not json");
    expect(hasReported(counter.key)).toBe(false);
  });
});
