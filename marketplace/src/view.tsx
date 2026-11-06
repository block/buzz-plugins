import type { Context } from "@buzz/author";
import {
  accessSummary,
  categories,
  type Index,
  type Listing,
  loadIndex,
  ranked,
  search,
  type Sort,
  sorts,
  tierLabels,
} from "./catalog";
import { activePluginIds, type InstallationStatus, type InstallResult, type PluginsCapability, sourceOf } from "./install";
import { createMarkdown } from "./markdown";
import { canVote, hasReported, hasUpvoted, reportInstall, sendVote, setShareEnabled, shareEnabled } from "./ping";

type ReactLike = Context["react"];
type Phase = "review" | InstallResult | "failed";
type Node = ReturnType<ReactLike["createElement"]> | string | null;
export const PLUGIN_ID = "xyz.block.community-marketplace";
export const PAGE_ID = "marketplace";

const SearchIcon = (React: ReactLike) => () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const https = (url: string | undefined) => (url?.startsWith("https://") ? url : undefined);

export const listingLink = (slug: string) =>
  `buzz://plugin?id=${PLUGIN_ID}&page=${PAGE_ID}&route.slug=${encodeURIComponent(slug)}`;

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const addedBy = (count: number) => `Added by ${count.toLocaleString("en-US")} ${count === 1 ? "person" : "people"}`;

export function installLine(listing: Listing, sort: Sort): string | null {
  const { allTime, last24h, last7d } = listing.installs;
  if (!allTime) return null;
  if (sort === "trending" && last24h) return `${addedBy(allTime)} · +${last24h.toLocaleString("en-US")} today`;
  if (sort === "hot" && last7d) return `${addedBy(allTime)} · +${last7d.toLocaleString("en-US")} this week`;
  return addedBy(allTime);
}

export const upvoteLabel = (count: number) => `${count.toLocaleString("en-US")} ${count === 1 ? "upvote" : "upvotes"}`;

export const trustLabel = (listing: Listing) => (listing.official ? "Official" : "Community · not reviewed");
export const cardTrustLabel = (listing: Listing) => (listing.official ? "Official" : "Unreviewed");
const tierTone = { low: "active", medium: undefined, high: "warn" } as const;

export function slugFromTarget(target: unknown): string | null {
  const params = (target as { route?: { params?: { slug?: unknown } } } | undefined)?.route?.params;
  return typeof params?.slug === "string" ? params.slug : null;
}

export function createViews(ctx: Context, capability: PluginsCapability | undefined) {
  const React = ctx.react;
  const { useEffect, useMemo, useState, useSyncExternalStore } = React;
  const Markdown = createMarkdown(React);
  const Search = SearchIcon(React);

  const listeners = new Set<() => void>();
  let active = activePluginIds(ctx);
  const refreshActive = () => {
    active = activePluginIds(ctx);
    for (const listener of listeners) listener();
  };
  ctx.effect(() => ctx.pages.subscribe(refreshActive));
  const panels = (ctx as unknown as { panels?: { subscribe?(listener: () => void): () => void } }).panels;
  if (panels?.subscribe) ctx.effect(() => panels.subscribe!(refreshActive));
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const installedState = () => active;

  let indexedKeys = new Set<string>();

  // Kept outside the page so a card's Add to Buzz can hand off to the listing's page.
  const phases = new Map<string, Phase>();
  const phaseListeners = new Set<() => void>();
  const setPhase = (slug: string, phase: Phase) => {
    phases.set(slug, phase);
    for (const listener of phaseListeners) listener();
  };
  const subscribePhase = (listener: () => void) => {
    phaseListeners.add(listener);
    return () => phaseListeners.delete(listener);
  };
  const usePhase = (slug: string) => useSyncExternalStore(subscribePhase, () => phases.get(slug));
  const startInstall = async (listing: Listing) => {
    if (!capability || phases.get(listing.slug) === "review") return;
    setPhase(listing.slug, "review");
    try {
      const result = await capability.requestInstall(sourceOf(listing));
      setPhase(listing.slug, result);
      // Only a first install counts; updates, cancellations and failures are not adoption.
      if (result === "installed") void reportInstall(ctx.host, listing, indexedKeys.has(listing.key)).then(notifyVotes);
    } catch {
      setPhase(listing.slug, "failed");
    }
  };
  const useInstalled = (listing: Listing) => {
    const ids = useSyncExternalStore(subscribe, installedState);
    return ids.has(listing.id);
  };

  const readStatus = (id: string): InstallationStatus => {
    try {
      return capability?.getInstallationStatus?.(id) ?? "unavailable";
    } catch {
      return "unavailable";
    }
  };
  const noSubscription = () => () => {};
  const useInstallationStatus = (listing: Listing): InstallationStatus => {
    const subscribeStatus = React.useCallback(
      (listener: () => void) => {
        try {
          return capability?.subscribeInstallationStatus?.(listing.id, () => listener()) ?? noSubscription();
        } catch {
          return noSubscription();
        }
      },
      [listing.id],
    );
    const status = useSyncExternalStore(capability?.getInstallationStatus ? subscribeStatus : noSubscription, () => readStatus(listing.id));
    const active = useInstalled(listing);
    if (capability?.getInstallationStatus) return status;
    return active ? "installed" : "absent";
  };

  const voteOverrides = new Map<string, boolean>();
  const voteBaseline = new Map<string, boolean>();
  const votesPending = new Set<string>();
  const voteListeners = new Set<() => void>();
  let voteVersion = 0;
  function notifyVotes() {
    voteVersion++;
    for (const listener of voteListeners) listener();
  }
  const subscribeVotes = (listener: () => void) => {
    voteListeners.add(listener);
    return () => voteListeners.delete(listener);
  };
  const baseline = (key: string) => {
    if (!voteBaseline.has(key)) voteBaseline.set(key, hasUpvoted(key));
    return voteBaseline.get(key)!;
  };
  const useVote = (listing: Listing) => {
    useSyncExternalStore(subscribeVotes, () => voteVersion);
    const voted = voteOverrides.get(listing.key) ?? baseline(listing.key);
    const count = Math.max(0, (listing.upvotes ?? 0) + Number(voted) - Number(baseline(listing.key)));
    return { voted, count, pending: votesPending.has(listing.key) };
  };
  const toggleVote = (listing: Listing, voted: boolean) => {
    if (votesPending.has(listing.key)) return;
    voteOverrides.set(listing.key, !voted);
    votesPending.add(listing.key);
    notifyVotes();
    void sendVote(ctx.host, listing, !voted).then((ok) => {
      if (!ok) voteOverrides.set(listing.key, voted);
      votesPending.delete(listing.key);
      notifyVotes();
    });
  };

  const open = (slug: string | null) =>
    ctx.navigation.open({
      version: 1,
      kind: "page",
      pluginId: PLUGIN_ID,
      pageId: PAGE_ID,
      ...(slug ? { route: { version: 1, params: { slug } } } : {}),
    });

  function Art({ listing }: { listing: Listing }) {
    const image = listing.demo?.poster ?? listing.demo?.screenshots?.[0];
    const src = https(image?.url);
    const [failed, setFailed] = useState(false);
    if (src && !failed) return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
    const initials = listing.name
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 2);
    return (
      <div className="bm-art" style={{ background: `var(--art-plugin-${listing.category}-gradient, var(--surface-inverse))` }}>
        <span>{initials}</span>
      </div>
    );
  }

  function AddedBadge({ listing }: { listing: Listing }) {
    return useInstallationStatus(listing) === "installed" ? (
      <span className="bm-badge" data-tone="active">
        Added
      </span>
    ) : null;
  }

  function TrustBadge({ listing, compact }: { listing: Listing; compact?: boolean }) {
    return (
      <span className="bm-badge" data-tone={listing.official ? "default" : undefined} title={compact ? trustLabel(listing) : undefined}>
        {compact ? cardTrustLabel(listing) : trustLabel(listing)}
      </span>
    );
  }

  // Only the card itself; Enter on a nested button must not also navigate.
  const openOnKey = (event: { key: string; target: unknown; currentTarget: unknown; preventDefault(): void }, slug: string) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    open(slug);
  };

  function AddButton({ listing, onManual, size, here }: { listing: Listing; onManual(): void; size?: "sm"; here?: boolean }) {
    const installed = useInstallationStatus(listing) === "installed";
    const reviewing = usePhase(listing.slug) === "review";
    const add = (event: { stopPropagation(): void }) => {
      event.stopPropagation();
      if (!capability) return onManual();
      if (!here) open(listing.slug);
      void startInstall(listing);
    };
    if (installed && !capability)
      return size ? null : (
        <button className="bm-button" data-variant="quiet" onClick={add}>
          How to update
        </button>
      );
    return (
      <button className="bm-button" data-size={size} disabled={reviewing} onClick={add}>
        {reviewing ? "Reviewing in Buzz…" : installed ? "Reinstall" : "Add to Buzz"}
      </button>
    );
  }

  function Step({ state, title, children }: { state: "todo" | "next" | "active" | "done" | "failed"; title: string; children?: Node | Node[] }) {
    return (
      <li className="bm-step" data-state={state}>
        <span className="bm-step-mark" aria-hidden="true">
          {state === "done" ? "✓" : state === "failed" ? "!" : null}
        </span>
        <div>
          <span className="bm-step-title">{title}</span>
          {children ? <div className="bm-step-detail">{children}</div> : null}
        </div>
      </li>
    );
  }

  function SetupSteps({ listing, state }: { listing: Listing; state: "todo" | "next" }) {
    return (
      <>
        {(listing.setup ?? []).map((step) => (
          <Step key={step.title} state={state} title={step.title}>
            {step.detail ? <Markdown text={step.detail} inline /> : null}
            {step.command ? <Copy value={step.command} /> : null}
          </Step>
        ))}
      </>
    );
  }

  const failures: Partial<Record<Phase, string>> = {
    cancelled: "The review closed before anything was installed. Nothing changed.",
    unavailable: "Buzz couldn't open its install review. Close any other plugin review in Settings, wait a moment, then try again.",
    failed: "Buzz couldn't use this listing's source. Check its repository, or add it from Settings.",
  };

  function Progress({ listing }: { listing: Listing }) {
    const phase = usePhase(listing.slug);
    if (!phase) return null;
    const done = phase === "installed" || phase === "updated";
    const failure = failures[phase];
    const title = done ? (phase === "updated" ? "Updated" : "Added to Buzz") : failure ? "Not added" : `Adding ${listing.name}`;
    return (
      <div className="bm-aside-card" role="status" aria-live="polite" aria-label={title}>
        <h3>{title}</h3>
        <ol className="bm-steps">
          <Step state={phase === "review" ? "active" : failure ? "failed" : "done"} title="Review in Buzz">
            {phase === "review"
              ? "Buzz opened its install review. Check the source, the commit and what it can access, then choose Install plugin."
              : failure}
          </Step>
          <Step state={done ? "done" : "todo"} title={phase === "updated" ? "Update" : "Install"}>
            {done ? `${listing.name} is ${phase === "updated" ? "updated" : "installed"} and turned on.` : null}
          </Step>
          <SetupSteps listing={listing} state={done ? "next" : "todo"} />
          <Step state={done && !listing.setup?.length ? "done" : "todo"} title="Ready to use">
            {done ? (listing.setup?.length ? "Once the steps above are done." : "Nothing else to set up.") : null}
          </Step>
        </ol>
        {failure ? (
          <div className="bm-actions">
            <button className="bm-button" data-size="sm" onClick={() => void startInstall(listing)}>
              Try again
            </button>
          </div>
        ) : done ? (
          <div className="bm-actions">
            <button
              className="bm-button"
              data-variant="quiet"
              data-size="sm"
              onClick={() => void ctx.navigation.open({ version: 1, kind: "settings", section: "plugins" })}
            >
              Manage in Settings
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function Copy({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    return (
      <div className="bm-copy">
        <code title={value}>{value}</code>
        <button
          className="bm-button"
          data-variant="quiet"
          data-size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    );
  }

  function CopyLink({ slug }: { slug: string }) {
    const [copied, setCopied] = useState(false);
    return (
      <button
        className="bm-link-button"
        onClick={() => {
          void navigator.clipboard?.writeText(listingLink(slug)).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Link copied" : "Copy link to this plugin"}
      </button>
    );
  }

  function ManualInstall({ listing, onClose }: { listing: Listing; onClose(): void }) {
    const dialog = React.useRef<HTMLDivElement>(null);
    const close = React.useRef(onClose);
    close.current = onClose;
    useEffect(() => {
      const trigger = document.activeElement as HTMLElement | null;
      dialog.current?.focus();
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") return close.current();
        if (event.key !== "Tab" || !dialog.current) return;
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")];
        if (focusable.length === 0) return event.preventDefault();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const inside = dialog.current.contains(document.activeElement);
        if (event.shiftKey && (!inside || document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
          event.preventDefault();
          first.focus();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => {
        window.removeEventListener("keydown", onKey);
        if (trigger?.isConnected) trigger.focus();
      };
    }, []);
    return (
      <div className="bm-dialog-backdrop" onClick={onClose}>
        <div
          ref={dialog}
          tabIndex={-1}
          className="bm-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={`Add ${listing.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <h2>Add {listing.name}</h2>
          <ol>
            <li>
              Open <strong>Settings → Plugins → Manage plugins</strong> and choose <strong>Git repository</strong>.
            </li>
            <li>
              Paste the repository and branch:
              <Copy value={listing.source.repository} />
              <Copy value={listing.source.ref} />
            </li>
            <li>
              Before installing, check that Buzz shows the indexed commit:
              <Copy value={listing.source.commit} />
            </li>
            <li>
              {listing.source.path ? (
                <>
                  Pick the <code>{listing.source.path}</code> folder, review
                </>
              ) : (
                "Review"
              )}{" "}
              what it can access, then install.
            </li>
          </ol>
          <p className="bm-note">This Buzz can't install plugins for you yet, so these are the manual steps.</p>
          <div className="bm-actions">
            <button className="bm-button" data-variant="quiet" onClick={onClose}>
              Close
            </button>
            <button
              className="bm-button"
              onClick={() => {
                void ctx.navigation.open({ version: 1, kind: "settings", section: "plugins" });
                onClose();
              }}
            >
              Open plugin settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  function CardVotes({ listing }: { listing: Listing }) {
    const { count } = useVote(listing);
    return count ? (
      <span className="bm-card-votes" title={upvoteLabel(count)} aria-label={upvoteLabel(count)}>
        ▲ {count.toLocaleString("en-US")}
      </span>
    ) : null;
  }

  function UpvoteButton({ listing }: { listing: Listing }) {
    const { voted, count, pending } = useVote(listing);
    const installed = useInstallationStatus(listing) === "installed";
    const reason = !installed || !hasReported(listing.key)
      ? "Add it to Buzz from here to upvote it."
      : !shareEnabled()
        ? "Turn on anonymous sharing below to upvote."
        : null;
    const enabled = !reason && canVote(listing);
    return (
      <div className="bm-upvote">
        <button
          className="bm-button"
          data-variant="quiet"
          data-size="sm"
          aria-pressed={voted}
          disabled={!enabled || pending}
          onClick={() => toggleVote(listing, voted)}
        >
          {voted ? "▲ Upvoted" : "▲ Upvote"}
        </button>
        <span className="bm-note">{count ? upvoteLabel(count) : "No upvotes yet"}</span>
        {reason ? <span className="bm-note">{reason}</span> : null}
      </div>
    );
  }

  function Card({ listing, sort, onManual }: { listing: Listing; sort: Sort; onManual(listing: Listing): void }) {
    const line = installLine(listing, sort);
    return (
      <div className="bm-card" role="button" tabIndex={0} onClick={() => open(listing.slug)} onKeyDown={(e) => openOnKey(e, listing.slug)}>
        <div className="bm-media">
          <Art listing={listing} />
        </div>
        <div className="bm-card-body">
          <div className="bm-card-row">
            <span className="bm-card-name">{listing.name}</span>
            <AddedBadge listing={listing} />
          </div>
          <span className="bm-card-tagline">{listing.tagline}</span>
          <div className="bm-card-row">
            <span className="bm-card-installs">{line ?? "New"}</span>
            <CardVotes listing={listing} />
          </div>
          <div className="bm-card-row bm-card-meta">
            <span className="bm-card-author">by {listing.author.github}</span>
            <TrustBadge listing={listing} compact />
          </div>
          <div className="bm-card-row bm-card-meta bm-card-footer">
            <span className="bm-card-author">{categories[listing.category]}</span>
            <AddButton listing={listing} size="sm" onManual={() => onManual(listing)} />
          </div>
        </div>
      </div>
    );
  }

  function Browse({ index, onManual }: { index: Index; onManual(listing: Listing): void }) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<string | null>(null);
    const [sort, setSort] = useState<Sort>("allTime");
    const visible = useMemo(() => search(ranked(index, sort), query, category), [index, sort, query, category]);
    const present = Object.keys(categories).filter((slug) => index.plugins.some((plugin) => plugin.category === slug));
    const heading =
      query || category ? `${visible.length} ${visible.length === 1 ? "plugin" : "plugins"}` : sorts.find((entry) => entry.id === sort)?.label;
    return (
      <>
        <header className="bm-header">
          <div>
            <h1 className="bm-title">Community Marketplace</h1>
            <p className="bm-subtitle">Open plugins from public Git repositories, ranked by how many people add and upvote them.</p>
          </div>
          <label className="bm-search">
            <Search />
            <input
              type="search"
              placeholder="Search plugins"
              aria-label="Search plugins"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </header>
        <div className="bm-toolbar">
          <div className="bm-chips" role="group" aria-label="Sort">
            {sorts.map((entry) => (
              <button key={entry.id} className="bm-chip" aria-pressed={sort === entry.id} onClick={() => setSort(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
          <div className="bm-chips" role="group" aria-label="Categories">
            <button className="bm-chip" aria-pressed={category === null} onClick={() => setCategory(null)}>
              All
            </button>
            {present.map((slug) => (
              <button key={slug} className="bm-chip" aria-pressed={category === slug} onClick={() => setCategory(slug)}>
                {categories[slug]}
              </button>
            ))}
          </div>
        </div>
        <h2 className="bm-section-title">{heading}</h2>
        {visible.length ? (
          <div className="bm-grid">
            {visible.map((listing) => (
              <Card key={listing.slug} listing={listing} sort={sort} onManual={onManual} />
            ))}
          </div>
        ) : (
          <p className="bm-empty">
            {query || category
              ? "No plugins match."
              : sort === "allTime"
                ? "Nothing is listed yet."
                : sort === "mostUpvoted"
                  ? "Nothing has upvotes yet. People who add a plugin from here can upvote it."
                  : "Nothing is ranked here yet. Trending and Hot only include reviewed plugins with a few installs."}
          </p>
        )}
      </>
    );
  }

  function AuditCard({ listing }: { listing: Listing }) {
    const { audit } = listing;
    return (
      <div className="bm-aside-card" aria-label="Audit">
        <h3>Audit</h3>
        <div className="bm-card-row">
          <span className="bm-badge" data-tone={tierTone[audit.tier]}>
            {tierLabels[audit.tier]}
          </span>
          <TrustBadge listing={listing} />
        </div>
        {audit.flags.length ? (
          <ul className="bm-flags">
            {audit.flags.map((flag) => (
              <li key={flag.code} className="bm-flag">
                <code>{flag.code}</code>
                <span>{flag.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="bm-note">No flags from the automated scan.</span>
        )}
        {audit.accessChanged ? <span className="bm-note bm-warning">What it can access changed since the last index.</span> : null}
        {!audit.cleared ? (
          <span className="bm-note bm-warning">A maintainer hasn't cleared this version, so it isn't ranked in Trending or Hot.</span>
        ) : null}
        <span className="bm-note">
          {listing.official
            ? "Published by Block."
            : "Community plugins are indexed automatically from public repositories. Nobody has reviewed this one."}
        </span>
      </div>
    );
  }

  function Detail({ listing, onManual }: { listing: Listing; onManual(listing: Listing): void }) {
    const access = accessSummary(listing.host);
    const demo = listing.demo;
    const video = https(demo?.video?.url);
    const phase = usePhase(listing.slug);
    const links = Object.entries(listing.links ?? {}).filter(([, url]) => https(url));
    return (
      <>
        <button className="bm-back" onClick={() => open(null)}>
          ← All plugins
        </button>
        <div className="bm-detail">
          <div>
            <h1 className="bm-detail-name">{listing.name}</h1>
            {listing.tagline ? <p className="bm-detail-tagline">{listing.tagline}</p> : null}
            <div className="bm-media">
              <Art listing={listing} />
            </div>
            {listing.description ? (
              <div className="bm-prose">
                <Markdown text={listing.description} />
              </div>
            ) : null}
            {demo?.screenshots?.length ? (
              <div className="bm-shots">
                {demo.screenshots
                  .filter((shot) => https(shot.url))
                  .map((shot) => (
                    <figure key={shot.url}>
                      <img src={shot.url} alt={shot.caption ?? ""} loading="lazy" />
                      {shot.caption ? <figcaption>{shot.caption}</figcaption> : null}
                    </figure>
                  ))}
              </div>
            ) : null}
          </div>
          <aside className="bm-aside">
            <AuditCard listing={listing} />
            <div className="bm-aside-card">
              <div className="bm-card-row">
                <AddButton listing={listing} here onManual={() => onManual(listing)} />
                <AddedBadge listing={listing} />
              </div>
              <UpvoteButton listing={listing} />
              {video ? (
                <a href={video} target="_blank" rel="noreferrer">
                  Watch the demo video
                </a>
              ) : null}
              {capability ? <CopyLink slug={listing.slug} /> : null}
            </div>
            <Progress listing={listing} />
            {listing.setup?.length && !phase ? (
              <div className="bm-aside-card">
                <h3>After you add it</h3>
                <ol className="bm-steps">
                  <SetupSteps listing={listing} state="todo" />
                </ol>
              </div>
            ) : null}
            <div className="bm-aside-card">
              <h3>Can access</h3>
              {access.length ? (
                <ul>
                  {access.map((line) => (
                    <li key={line}>
                      <Markdown text={line} inline />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="bm-note">Nothing beyond Buzz itself.</span>
              )}
              <span className="bm-note">Buzz shows the exact access for you to approve before it installs anything.</span>
            </div>
            <div className="bm-aside-card">
              <h3>About</h3>
              <dl className="bm-kv">
                <dt>Author</dt>
                <dd>{listing.author.github}</dd>
                <dt>Category</dt>
                <dd>{categories[listing.category] ?? listing.category}</dd>
                {listing.installs.allTime ? (
                  <>
                    <dt>Installs</dt>
                    <dd>{addedBy(listing.installs.allTime)}</dd>
                  </>
                ) : null}
                {listing.upvotes ? (
                  <>
                    <dt>Upvotes</dt>
                    <dd>{listing.upvotes.toLocaleString("en-US")}</dd>
                  </>
                ) : null}
                <dt>Version</dt>
                <dd>
                  <code>{listing.source.commit.slice(0, 7)}</code> on {listing.source.ref}
                </dd>
                <dt>Source</dt>
                <dd>
                  <a href={listing.source.repository} target="_blank" rel="noreferrer">
                    {listing.key.replace(/^github\.com\//, "")}
                  </a>
                </dd>
              </dl>
              {links.map(([label, url]) => (
                <a key={label} href={url} target="_blank" rel="noreferrer">
                  {label[0].toUpperCase() + label.slice(1)}
                </a>
              ))}
            </div>
          </aside>
        </div>
      </>
    );
  }

  function ShareToggle() {
    const [on, setOn] = useState(shareEnabled);
    return (
      <label className="bm-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(event) => {
            setShareEnabled(event.target.checked);
            setOn(event.target.checked);
            notifyVotes();
          }}
        />
        Share anonymous install counts and upvotes
      </label>
    );
  }

  return function MarketplacePage({ navigation }: { navigation?: { target: unknown } }) {
    const [state, setState] = useState<{ index: Index; live: boolean } | null>(null);
    const [manual, setManual] = useState<Listing | null>(null);
    useEffect(() => {
      let current = true;
      void loadIndex(ctx.host).then((result) => {
        if (!current) return;
        indexedKeys = new Set(result.index.plugins.map((plugin) => plugin.key));
        setState(result);
      });
      return () => {
        current = false;
      };
    }, []);
    const slug = slugFromTarget(navigation?.target);
    const listing = slug ? state?.index.plugins.find((plugin) => plugin.slug === slug) : undefined;
    return (
      <div className="bm-page">
        <div className="bm-inner">
          {!state ? (
            <p className="bm-empty">Loading the marketplace…</p>
          ) : listing ? (
            <Detail key={listing.slug} listing={listing} onManual={setManual} />
          ) : (
            <Browse index={state.index} onManual={setManual} />
          )}
          {state ? (
            <footer className="bm-footer">
              <ShareToggle />
              <p className="bm-note">
                Counts are people who added a plugin from here, one per device, since {day(state.index.collectionStartedAt)} and updated{" "}
                {day(state.index.generatedAt)}. We send the plugin's address and a random ID that stays on this device, only for public
                repositories. An upvote sends the same random ID and only counts if you added the plugin from here. Earlier installs and plugins added elsewhere aren't counted.
              </p>
              {!state.live ? <p className="bm-note">Showing the index built into this version. The live one couldn't be reached.</p> : null}
            </footer>
          ) : null}
        </div>
        {manual ? <ManualInstall listing={manual} onClose={() => setManual(null)} /> : null}
      </div>
    );
  };
}
