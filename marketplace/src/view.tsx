import type { Context } from "@buzz/author";
import {
  accessSummary,
  authorName,
  categories,
  type Index,
  type Listing,
  loadIndex,
  search,
  shared,
  type Sort,
  sorted,
  sorts,
  tierLabels,
} from "./catalog";
import { activePluginIds, type InstallationStatus, type InstallResult, type PluginsCapability, sourceOf } from "./install";
import { connection, loadCommunity, relayOf, SHARE_PROMPT } from "./community";
import { createMarkdown } from "./markdown";
import { type CheckedSource, checkSource, describeSource, listingLinks, parseSourceInput, sourceKey, sourceLine } from "./submit";

type ReactLike = Context["react"];
type Phase = "review" | InstallResult | "failed";
type Node = ReturnType<ReactLike["createElement"]> | string | null;
export const PLUGIN_ID = "xyz.block.community-marketplace";
export const PAGE_ID = "marketplace";

export const VERIFIED_LABEL = "Verified plugin: Buzz reviewed this version";

// Sits on the plugin's name, so the mark reads as the plugin's and not its author's.
const VerifiedMark = (React: ReactLike) => () => (
  <svg className="bm-verified" width="16" height="16" viewBox="0 0 24 24" role="img" aria-label={VERIFIED_LABEL}>
    <title>{VERIFIED_LABEL}</title>
    <path fill="currentColor" d="M12 1.5 14.6 4l3.5-.5.9 3.4 3.2 1.6-1.3 3.3 1.3 3.3-3.2 1.6-.9 3.4-3.5-.5L12 22.1 9.4 19.6l-3.5.5-.9-3.4-3.2-1.6 1.3-3.3-1.3-3.3L5 6.9l.9-3.4 3.5.5z" />
    <path fill="none" stroke="var(--bg-app, #fff)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="m8 12.2 2.7 2.7L16 9.4" />
  </svg>
);

const SearchIcon = (React: ReactLike) => () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const https = (url: string | undefined) => (url?.startsWith("https://") ? url : undefined);

export const listingLink = (slug: string) =>
  `buzz://plugin?id=${PLUGIN_ID}&page=${PAGE_ID}&route.slug=${encodeURIComponent(slug)}`;

export const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const starLabel = (count: number) => `${count.toLocaleString("en-US")} ${count === 1 ? "star" : "stars"} on GitHub`;

export const trustLabel = (listing: Listing) =>
  shared(listing)
    ? "Shared here · not reviewed"
    : listing.official
      ? "Official"
      : listing.verified
        ? "Verified by Buzz"
        : "Community · not reviewed";
// A verified card carries the mark on its name instead of a label beside its author.
export const cardTrustLabel = (listing: Listing) =>
  shared(listing) ? "Shared here" : listing.official ? "Official" : listing.verified ? null : "Unreviewed";
const trustTone = (listing: Listing) => (listing.official ? "default" : listing.verified ? "active" : undefined);
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
  const Verified = VerifiedMark(React);

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
  const relay = relayOf(ctx);
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
    if (compact && cardTrustLabel(listing) === null) return null;
    return (
      <span className="bm-badge" data-tone={trustTone(listing)} title={compact ? trustLabel(listing) : undefined}>
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

  function Dialog({ label, onClose, children }: { label: string; onClose(): void; children: Node | Node[] }) {
    const dialog = React.useRef<HTMLDivElement>(null);
    const close = React.useRef(onClose);
    close.current = onClose;
    useEffect(() => {
      const trigger = document.activeElement as HTMLElement | null;
      dialog.current?.focus();
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") return close.current();
        if (event.key !== "Tab" || !dialog.current) return;
        const focusable = [
          ...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"),
        ];
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
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  }

  function ManualInstall({ listing, onClose }: { listing: Listing; onClose(): void }) {
    return (
      <Dialog label={`Add ${listing.name}`} onClose={onClose}>
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
      </Dialog>
    );
  }

  type AddState =
    | { step: "idle" }
    | { step: "invalid" }
    | { step: "checking" }
    | { step: "rejected"; message: string }
    | { step: "ready"; source: CheckedSource; listed?: Listing };

  function AddPlugin({ index, canShare, onClose }: { index: Index; canShare: boolean; onClose(): void }) {
    const [everyone, setEveryone] = useState(!canShare);
    const [repository, setRepository] = useState("");
    const [ref, setRef] = useState("");
    const [state, setState] = useState<AddState>({ step: "idle" });
    const busy = state.step === "checking";
    const run = async () => {
      const input = parseSourceInput(repository, ref);
      if (!input) return setState({ step: "invalid" });
      setState({ step: "checking" });
      const checked = await checkSource(ctx.host, input);
      if (!checked.ok) return setState({ step: "rejected", message: checked.message });
      const key = sourceKey(checked.source).toLowerCase();
      const listed = index.plugins.find((plugin) => plugin.key.toLowerCase() === key);
      setState({ step: "ready", source: checked.source, listed });
    };
    const found = state.step === "ready" ? state.source : null;
    const links = found ? listingLinks(found) : null;
    return (
      <Dialog label="Add your plugin" onClose={onClose}>
        <h2>Add your plugin</h2>
        {canShare ? (
          <div className="bm-chips" role="group" aria-label="Who gets it">
            <button className="bm-chip" aria-pressed={!everyone} onClick={() => setEveryone(false)}>
              This community
            </button>
            <button className="bm-chip" aria-pressed={everyone} onClick={() => setEveryone(true)}>
              Everyone
            </button>
          </div>
        ) : null}
        {everyone ? publicListing() : communityShare()}
      </Dialog>
    );

    // Called, not rendered: as components they would remount, and lose the form, on every keystroke.
    function communityShare() {
      return (
        <>
          <p className="bm-dialog-lede">
            Push a plugin you run in Buzz to a git repository in one of this community's channels. It then shows under From this community, to
            the people in that channel.
          </p>
          <p className="bm-dialog-lede">
            The repository needs the built <code>manifest.json</code> and <code>plugin.js</code>, at its root or in a folder. Your agent can do
            it for you. Ask it in the channel:
          </p>
          <Copy value={SHARE_PROMPT} />
          <div className="bm-actions">
            <button type="button" className="bm-button" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      );
    }

    function publicListing() {
      return (
        <>
          <p className="bm-dialog-lede">List a Buzz plugin whose source is in a public GitHub repository. It needs:</p>
          <ul className="bm-requirements">
            <li>
              A built <code>manifest.json</code> and <code>plugin.js</code> committed on a branch or tag, at the repository root or in a folder.
            </li>
            <li>
              Optionally, a <code>buzz-listing.yaml</code> next to them with a tagline, description, category, tags and screenshots.
            </li>
          </ul>
          <form
            className="bm-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void run();
            }}
          >
            <label className="bm-field">
              <span>Repository</span>
              <input
                value={repository}
                placeholder="owner/repo or owner/repo/path/to/plugin"
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                onChange={(event) => setRepository(event.target.value)}
              />
            </label>
            <label className="bm-field">
              <span>Branch or tag (optional)</span>
              <input
                value={ref}
                placeholder="Default branch"
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                onChange={(event) => setRef(event.target.value)}
              />
            </label>
            <div className="bm-check" role="status" aria-live="polite">
              {state.step === "invalid" ? (
                <p className="bm-check-error">Enter a GitHub repository as owner/repo, owner/repo/folder or a github.com link.</p>
              ) : state.step === "checking" ? (
                <p>Checking that the repository is public and has a built plugin…</p>
              ) : state.step === "rejected" ? (
                <p className="bm-check-error">{state.message}</p>
              ) : null}
              {found ? (
                <div className="bm-check-found">
                  <strong>{found.name}</strong>
                  <span className="bm-note">
                    {found.id} · {describeSource(found)} @ {found.ref}
                  </span>
                  {found.description ? <span className="bm-check-description">{found.description}</span> : null}
                </div>
              ) : null}
              {state.step === "ready" && state.listed ? (
                <p className="bm-check-success">{state.listed.name} is already listed.</p>
              ) : found ? (
                <>
                  <p className="bm-check-success">
                    It can be listed. Add this line to <code>sources.txt</code> in a pull request, or ask for it in an issue:
                  </p>
                  <Copy value={sourceLine(found)} />
                </>
              ) : null}
            </div>
            <p className="bm-note">
              Listings are unreviewed community content. Buzz still shows what a plugin can access, and the exact commit, before anyone installs it.
            </p>
            <div className="bm-actions">
              <button type="button" className="bm-button" data-variant="quiet" onClick={onClose}>
                {found ? "Done" : "Cancel"}
              </button>
              {state.step === "ready" && state.listed ? (
                <button
                  type="button"
                  className="bm-button"
                  onClick={() => {
                    void open(state.listed!.slug);
                    onClose();
                  }}
                >
                  View listing
                </button>
              ) : links ? (
                <>
                  <a className="bm-button" data-variant="quiet" href={links.issue} target="_blank" rel="noreferrer">
                    Request in an issue
                  </a>
                  <a className="bm-button" href={links.pullRequest} target="_blank" rel="noreferrer">
                    Open a pull request
                  </a>
                </>
              ) : (
                <button type="submit" className="bm-button" disabled={busy || !repository.trim()}>
                  {busy ? "Checking…" : "Check"}
                </button>
              )}
            </div>
          </form>
        </>
      );
    }
  }

  function Card({ listing, onManual }: { listing: Listing; onManual(listing: Listing): void }) {
    return (
      <div className="bm-card" role="button" tabIndex={0} onClick={() => open(listing.slug)} onKeyDown={(e) => openOnKey(e, listing.slug)}>
        <div className="bm-media">
          <Art listing={listing} />
        </div>
        <div className="bm-card-body">
          <div className="bm-card-row">
            <span className="bm-card-title">
              <span className="bm-card-name">{listing.name}</span>
              {listing.verified ? <Verified /> : null}
            </span>
            <AddedBadge listing={listing} />
          </div>
          <span className="bm-card-tagline">{listing.tagline}</span>
          <div className="bm-card-row">
            <span className="bm-card-installs">{listing.updatedAt ? `Updated ${day(listing.updatedAt)}` : "\u00a0"}</span>
            {listing.stars ? (
              <span className="bm-card-stars" title={starLabel(listing.stars)} aria-label={starLabel(listing.stars)}>
                ★ {listing.stars.toLocaleString("en-US")}
              </span>
            ) : null}
          </div>
          <div className="bm-card-row bm-card-meta">
            <span className="bm-card-author">by {authorName(listing)}</span>
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

  function Browse({
    index,
    community,
    onManual,
    onAdd,
  }: {
    index: Index;
    community: readonly Listing[];
    onManual(listing: Listing): void;
    onAdd(): void;
  }) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<string | null>(null);
    const [sort, setSort] = useState<Sort>("updated");
    const visible = useMemo(() => search(sorted(index, sort), query, category), [index, sort, query, category]);
    const here = useMemo(() => search(sorted({ plugins: community }, sort), query, category), [community, sort, query, category]);
    const present = Object.keys(categories).filter((slug) => [...index.plugins, ...community].some((plugin) => plugin.category === slug));
    const heading =
      query || category ? `${visible.length} ${visible.length === 1 ? "plugin" : "plugins"}` : sorts.find((entry) => entry.id === sort)?.label;
    return (
      <>
        <header className="bm-header">
          <div>
            <h1 className="bm-title">Community Marketplace</h1>
            <p className="bm-subtitle">Open plugins from public Git repositories.</p>
          </div>
          <button className="bm-button" data-size="sm" aria-label="Add your plugin" onClick={onAdd}>
            Add
          </button>
        </header>
        <div className="bm-toolbar">
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
          <div className="bm-chips bm-sort" role="group" aria-label="Sort">
            {sorts.map((entry) => (
              <button key={entry.id} className="bm-chip" aria-pressed={sort === entry.id} onClick={() => setSort(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
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
        {here.length ? (
          <>
            <h2 className="bm-section-title">From this community</h2>
            <div className="bm-grid">
              {here.map((listing) => (
                <Card key={listing.slug} listing={listing} onManual={onManual} />
              ))}
            </div>
          </>
        ) : null}
        <h2 className="bm-section-title">{heading}</h2>
        {visible.length ? (
          <div className="bm-grid">
            {visible.map((listing) => (
              <Card key={listing.slug} listing={listing} onManual={onManual} />
            ))}
          </div>
        ) : (
          <p className="bm-empty">{query || category ? "No plugins match." : "Nothing is listed yet."}</p>
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
        {shared(listing) ? (
          <span className="bm-note">Not scanned. Only public listings get the automated scan.</span>
        ) : audit.flags.length ? (
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
        {!audit.cleared && !shared(listing) ? (
          <span className="bm-note bm-warning">A maintainer hasn't cleared this version yet.</span>
        ) : null}
        <span className="bm-note">
          {shared(listing)
            ? "A member keeps this plugin in a git repository on this community. Only people who can read that repository see it, and nobody has reviewed it."
            : listing.official
            ? "Published by Block."
            : listing.verified
              ? "A Buzz maintainer reviewed this exact version. A newer version is unreviewed until it is checked again."
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
            <h1 className="bm-detail-name">
              {listing.name}
              {listing.verified ? <Verified /> : null}
            </h1>
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
                <dd>{authorName(listing)}</dd>
                <dt>Category</dt>
                <dd>{categories[listing.category] ?? listing.category}</dd>
                {listing.stars ? (
                  <>
                    <dt>Stars</dt>
                    <dd>{listing.stars.toLocaleString("en-US")}</dd>
                  </>
                ) : null}
                <dt>Version</dt>
                <dd>
                  <code>{listing.source.commit.slice(0, 7)}</code> on {listing.source.ref}
                </dd>
                <dt>Source</dt>
                <dd>
                  {shared(listing) ? (
                    listing.key.split("/").slice(3).join("/")
                  ) : (
                    <a href={listing.source.repository} target="_blank" rel="noreferrer">
                      {listing.key.replace(/^github\.com\//, "")}
                    </a>
                  )}
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

  return function MarketplacePage({ navigation }: { navigation?: { target: unknown } }) {
    const [state, setState] = useState<{ index: Index; live: boolean } | null>(null);
    const [manual, setManual] = useState<Listing | null>(null);
    const [adding, setAdding] = useState(false);
    const [community, setCommunity] = useState<readonly Listing[]>([]);
    useEffect(() => {
      let current = true;
      void loadIndex(ctx.host).then((result) => {
        if (current) setState(result);
      });
      return () => {
        current = false;
      };
    }, []);
    // Apart from the public index, which never waits on the community's repositories.
    const connected = useSyncExternalStore(relay?.subscribe ?? noSubscription, () => connection(relay));
    useEffect(() => {
      setCommunity([]);
      if (!connected) return;
      const controller = new AbortController();
      loadCommunity(ctx, controller.signal).then(
        (listings) => {
          if (!controller.signal.aborted) setCommunity(listings);
        },
        () => {},
      );
      return () => controller.abort();
    }, [connected]);
    const slug = slugFromTarget(navigation?.target);
    const listing = slug ? [...community, ...(state?.index.plugins ?? [])].find((plugin) => plugin.slug === slug) : undefined;
    return (
      <div className="bm-page">
        <div className="bm-inner">
          {!state ? (
            <p className="bm-empty">Loading the marketplace…</p>
          ) : listing ? (
            <Detail key={listing.slug} listing={listing} onManual={setManual} />
          ) : (
            <Browse index={state.index} community={community} onManual={setManual} onAdd={() => setAdding(true)} />
          )}
          {state ? (
            <footer className="bm-footer">
              <p className="bm-note">Index updated {day(state.index.generatedAt)}. Nothing about what you install is sent anywhere.</p>
              {!state.live ? <p className="bm-note">Showing the index built into this version. The live one couldn't be reached.</p> : null}
            </footer>
          ) : null}
        </div>
        {manual ? <ManualInstall listing={manual} onClose={() => setManual(null)} /> : null}
        {adding && state ? <AddPlugin index={state.index} canShare={!!connected} onClose={() => setAdding(false)} /> : null}
      </div>
    );
  };
}
