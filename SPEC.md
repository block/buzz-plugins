# Open Buzz plugin index: phase 1 spec

The index lists Buzz plugins that anyone can fetch from a public Git repository, and ranks them by anonymous install counts and upvotes. A plugin's source stays in its author's repository.

Toolchain: Node 24 and pnpm. The indexer and collector run as plain TypeScript with `node --experimental-strip-types` and are tested with `node --test`. Keep dependencies to a minimum; `yaml` is fine.

## Layout

```
SPEC.md
sources.txt           seed sources, one per line: <repository> <ref> [path]
denylist.txt          listing keys never shown, one per line
fixtures/index.json   a sample index the plugin and tests use
indexer/              crawl, publicity check, audit, listing metadata, build index.json
collector/            install ping and upvote HTTP server, stores, ranking job
marketplace/          the Community Marketplace Buzz plugin
```

## Listing key

`<host>/<owner>/<repo>` plus `/<path>` when the plugin isn't at the repository root, for example `github.com/block/buzz-app/examples/plugins/counter`. In v1 the host is always `github.com`. The key is the listing's identity and its page route. `slug` is a URL-safe form of the key: lowercase, `/` becomes `--`, every other character outside `[a-z0-9-]` becomes `-`, and it's capped at 120 characters.

## Publicly available

A source counts as publicly available only when all of these succeed **without credentials**: no token, no cookies, no `gh` auth, `GIT_TERMINAL_PROMPT=0`, an empty `credential.helper`, and `GIT_CONFIG_GLOBAL=/dev/null`.
1. `GET https://api.github.com/repos/<owner>/<repo>` with no Authorization header returns 200 and `"private": false`. If it's rate-limited, retry later and never fall back to an authenticated request.
2. `git ls-remote https://github.com/<owner>/<repo>.git <ref>` resolves the ref to a 40-hex commit.
3. `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<path>/manifest.json` and `.../plugin.js` both return 200. The manifest has to parse, and its `id` must match `^[a-z][a-z0-9.-]{0,79}$`.

If any step fails, the source isn't listed and the reason is recorded in the crawl report, which is never published.

## Author metadata (optional)

An author can add `buzz-listing.yaml` next to `manifest.json`. Unknown fields are errors.

```yaml
tagline: One line on what it does        # 1-100 chars
description: |                           # Markdown, at most 4000 chars
  ...
category: productivity                   # communication | agents | agent-tools | developer-tools-and-integrations | people-and-communities | productivity
tags: [notes]                            # up to 8, 1-32 chars each
demo:
  video: demo/demo.mp4                   # repo-relative path at the same commit, or an https URL
  poster: demo/poster.png
  screenshots:
    - { src: demo/1.png, caption: The notes page }
setup:                                   # up to 5
  - { title: ..., detail: ..., command: ... }
links: { docs: https://..., support: https://... }
```

Fallbacks: the tagline is the manifest `description`, cut to 100 characters. The category is `manifest.discovery.category`, or `productivity` if it's missing. Tags come from `manifest.discovery.tags`. The description is the first 4000 characters of the README at the plugin's path. A plugin in a subfolder never borrows the repository's root README, which usually describes something else. Repo-relative media becomes `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<path>/<file>`.

## Audit

Each crawled commit gets an audit:
- `tier`:
  - `high` if the manifest's `host` declares any `processes`, `commands`, `files`, `mcp` or `agentHooks`;
  - otherwise `medium` if it declares any `networkOrigins`;
  - otherwise `low`.
- `flags`, a list of `{code, detail}` from a static scan of `plugin.js`:
  - `dynamic-code`: `eval(`, `new Function(`, or a string passed to `setTimeout`/`setInterval`;
  - `obfuscated`: a line over 5000 characters with more than 30% `\x`/`\u` escapes, or a base64 blob over 20 KB;
  - `undeclared-origin`: an `https://` URL literal whose origin isn't in `networkOrigins`. Ignore schema and namespace URLs such as `http://www.w3.org/`;
  - `size`: `plugin.js` over 3 MiB.
- `accessChanged`: true when the declared access differs from the previous index's pin for the same key.

A listing whose tier is `high`, or that has any flag, gets `audit.cleared: false` unless its key appears in `cleared.txt` with that commit (a maintainer clearing it). Uncleared listings stay in the index but are left out of `trending` and `hot`.

## index.json (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-05T23:00:00Z",
  "collectionStartedAt": "2026-11-05T00:00:00Z",
  "mediaPolicy": "raw.githubusercontent.com at the pinned commit, or https URLs the author lists",
  "plugins": [
    {
      "key": "github.com/nickhenggeler/buzz-projects-plugin",
      "slug": "github-com--nickhenggeler--buzz-projects-plugin",
      "id": "<manifest id>",
      "name": "<manifest name>",
      "tagline": "...",
      "description": "...markdown...",
      "category": "productivity",
      "tags": ["projects"],
      "author": { "github": "nickhenggeler" },
      "official": false,
      "source": { "repository": "https://github.com/nickhenggeler/buzz-projects-plugin", "ref": "main", "commit": "<40-hex>", "path": "" },
      "host": { "networkOrigins": [], "processes": [], "commands": [], "files": false, "mcp": false, "agentHooks": false },
      "audit": { "tier": "low", "flags": [], "accessChanged": false, "cleared": true, "checkedAt": "..." },
      "demo": { "video": { "url": "...", "type": "video/mp4" }, "poster": { "url": "...", "type": "image/png" }, "screenshots": [] },
      "setup": [],
      "links": { "repository": "https://github.com/nickhenggeler/buzz-projects-plugin" },
      "stars": 0,
      "updatedAt": "<commit date>",
      "installs": { "allTime": 0, "last24h": 0, "last7d": 0 },
      "upvotes": 0
    }
  ],
  "rankings": { "allTime": ["<key>", "..."], "trending": ["..."], "hot": ["..."], "mostUpvoted": ["..."] }
}
```

`official` is true when the owner is `block`. `host` is copied from the manifest's `host` and normalized: process and command entries become display strings such as `my-cli sync`. `source.path` is `""` for the repository root and never starts or ends with `/`.

## Install ping API (collector)

`POST /v1/installs` with JSON and a 1 KiB limit:

```json
{ "key": "github.com/o/r[/path]", "id": "<manifest id>", "commit": "<40-hex>", "installer": "<64-hex>", "client": "community-marketplace/0.1.0" }
```

- `installer` is `sha256(localSalt + ":" + id)` in hex. `localSalt` is 32 random bytes kept only on the device. The collector never sees anything that identifies a person.
- The response is `202 {}` on accept. A malformed body gets `400`, an unknown key `404` (only keys in the current index are accepted), and more than 30 pings per IP per UTC day `429`. IPs are only counted in memory for the rate limit and are never stored.
- Storage is append-only JSONL with these fields: `{ts, key, id, commit, installer}`.
- Dedup: one row per `(key, installer)` counts toward `allTime`. For windows, count distinct installers whose first ping for that key falls in the window.

## Upvote API (collector)

`POST /v1/votes` with JSON and a 1 KiB limit:

```json
{ "key": "github.com/o/r[/path]", "id": "<manifest id>", "voter": "<64-hex>", "vote": 1, "client": "community-marketplace/0.1.0" }
```

- `voter` is the same hash the device sent as `installer` for that plugin. `vote` is `1` to upvote and `0` to take it back.
- The response is `202 {}` on accept. A malformed body gets `400`, an unknown key `404`, a voter with no install ping for that key `403`, and more than 60 votes per IP per UTC day `429`. Votes have their own daily budget, separate from install pings.
- Storage is append-only JSONL next to the install store (`installs.jsonl` → `installs.votes.jsonl`) with these fields: `{ts, key, id, voter, vote}`.
- The latest row per `(key, voter)` wins. `upvotes` counts voters whose latest vote is `1` and who have an install ping for that key, so it never exceeds `installs.allTime`.

`GET /v1/index.json` serves the newest built index. CORS is open for GET.

### Ranking job

`collector/rank.ts` reads the store and the crawled listings and writes `index.json`:
- `allTime`: distinct installers, descending. Ties go to the newer `updatedAt`, then the key.
- `trending`: distinct new installers in the last 24h, minus the daily average over the previous 7 days. Only positive scores count, and only cleared listings with at least 3 all-time installers.
- `hot`: `Σ exp(-age_hours / 72)` over each installer's first ping in the last 7 days, under the same eligibility rule as `trending`.
- `mostUpvoted`: `upvotes`, descending, under the same eligibility rule as `trending`, and only listings with at least one upvote. Ties go to more all-time installers, then the key.
- Keys in `denylist.txt` are dropped everywhere.

## Community Marketplace plugin

- Manifest id `xyz.block.community-marketplace`, name "Community Marketplace".
- `host.networkOrigins` is exactly the index/collector origin, `https://api.github.com` and `https://raw.githubusercontent.com`. In phase 1 the index origin is a placeholder, `https://plugins.buzz.example`. Don't add any `processes` or `commands`.
- What the plugin does:
  - It reads `index.json` from the index origin, and falls back to a bundled copy of `fixtures/index.json`.
  - Sort choices are All time, Trending, Hot and Most upvoted, plus Category and search. Each card shows its install count, its upvote count, the author, and an Official or "Community · not reviewed" label.
  - The listing page shows the audit tier and flags above **Add to Buzz**, and an access summary from `host`.
  - **Add to Buzz** uses `ctx.reflect.get("pluginInstaller").requestInstall({repository, reference: ref, commit, path})`. Older hosts get the manual Git import steps.
  - The plugin sends a ping only after an `installed` result, only for a key that's in the index, and only after its own `GET https://api.github.com/repos/<owner>/<repo>` returns `private: false`. The ping is fire-and-forget and never changes the install result.
  - The listing page has an **Upvote** toggle. It's enabled only while the host reports the plugin `installed`, this device's install ping for that key was accepted, and sharing is on. It sends `POST /v1/votes` with the same hash as the install ping, updates the count at once, and reverts if the collector doesn't accept it. The device remembers its own upvotes so the toggle survives a reload.
  - A settings toggle, "Share anonymous install counts and upvotes", is on by default and stored in plugin storage or localStorage. While it's off, no ping or vote is sent.
- None of the plugin's text, or this repository's, names other products or sites as a design source.
