# Open Buzz plugin index: phase 1 spec

The index lists Buzz plugins that anyone can fetch from a public Git repository. A plugin's source stays in its author's repository. The index is a static `index.json` that GitHub Actions builds from `sources.txt`; nothing about who installs a plugin is collected.

Toolchain: Node 24 and pnpm. The indexer runs as plain TypeScript with `node --experimental-strip-types` and are tested with `node --test`. Keep dependencies to a minimum; `yaml` is fine.

## Layout

```
SPEC.md
sources.txt           listed sources, one per line: <repository> <ref> [path]
denylist.txt          listing keys never shown, one per line
cleared.txt           <key> <commit> pairs a maintainer has cleared
verified.txt          <key> <commit> pairs a maintainer has reviewed
fixtures/index.json   a sample index the plugin and tests use
indexer/              crawl, publicity check, audit, listing metadata, build index.json, source checks
.github/              publish and check workflows, and the list-a-plugin issue form
marketplace/          the Community Marketplace Buzz plugin
template/             a minimal plugin for authors to copy
```

## Listing key

`<host>/<owner>/<repo>` plus `/<path>` when the plugin isn't at the repository root, for example `github.com/block/buzz-app/examples/plugins/counter`. In v1 the host is always `github.com`. The key is the listing's identity and its page route. `slug` is a URL-safe form of the key: lowercase, `/` becomes `--`, every other character outside `[a-z0-9-]` becomes `-`, and it's capped at 120 characters.

## Publicly available

A source counts as publicly available only when all of these succeed **without credentials**: no token, no cookies, no `gh` auth, `GIT_TERMINAL_PROMPT=0`, an empty `credential.helper`, and `GIT_CONFIG_GLOBAL=/dev/null`.
1. `GET https://api.github.com/repos/<owner>/<repo>` with no Authorization header returns 200 and `"private": false`. If it's rate-limited, retry later and never fall back to an authenticated request.
2. `git ls-remote https://github.com/<owner>/<repo>.git <ref>` resolves the ref to a 40-hex commit.
3. `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<path>/manifest.json` and `.../plugin.js` both return 200. The manifest has to parse, and its `id` must match `^[a-z][a-z0-9.-]{0,79}$`.

If any step fails, the source isn't listed and the reason is recorded in the crawl report, which is never published.

## Sources

`sources.txt` is the whole list. Adding a plugin means adding one line to it, by pull request, or by opening the **List a plugin** issue form for a maintainer to add. Keys in `denylist.txt` are skipped by the crawl and rejected by the source check (keys compare case-insensitively).

### Source check

`indexer/check-sources.ts` compares a proposed `sources.txt` (or the **Source line** field of a list-plugin issue) with the one on `main` and checks only the lines that are new or changed. Each must parse, must not repeat a key that stays listed, must not be denylisted, and must pass the same credential-free publicity check, manifest check and `buzz-listing.yaml` validation as the crawl. It writes a Markdown table with one row per line and exits non-zero if any line fails.

The **Check sources** workflow runs it on pull requests that touch `sources.txt` and on issues labelled `list-plugin`, and comments with the table. It uses `pull_request_target` so it can comment on pull requests from forks, and it only ever runs the code on the default branch: the pull request's `sources.txt` and the issue body are read as data.

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

A listing whose tier is `high`, or that has any flag, gets `audit.cleared: false` unless its key appears in `cleared.txt` with that commit (a maintainer clearing it). `verified.txt` doesn't clear a listing. Uncleared listings stay in the index; the marketplace says nobody has cleared that version.

## Verified

`verified.txt` holds `<key> <commit>` pairs, in the same form as `cleared.txt`. A listing gets `verified: true` only when the commit the crawl resolved is paired with its key there (keys and commits compare case-insensitively). A source that moves to a new commit is `verified: false` again until that commit is added. Lines for other commits are ignored and stay as history.

A verified listing carries only what its commit pins: `demo` media whose URL is on `raw.githubusercontent.com` at that commit, and `links.repository`. Other media and `links.docs`/`links.support` are dropped from the entry, since they can change after the review. Its `audit` is the same as it would be unverified.

`verified` is about a review and `official` is about the owner; neither implies the other. [`VERIFICATION.md`](./VERIFICATION.md) is the review process.

## index.json (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-05T23:00:00Z",
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
      "verified": false,
      "source": { "repository": "https://github.com/nickhenggeler/buzz-projects-plugin", "ref": "main", "commit": "<40-hex>", "path": "" },
      "host": { "networkOrigins": [], "processes": [], "commands": [], "files": false, "mcp": false, "agentHooks": false },
      "audit": { "tier": "low", "flags": [], "accessChanged": false, "cleared": true, "checkedAt": "..." },
      "demo": { "video": { "url": "...", "type": "video/mp4" }, "poster": { "url": "...", "type": "image/png" }, "screenshots": [] },
      "setup": [],
      "links": { "repository": "https://github.com/nickhenggeler/buzz-projects-plugin" },
      "stars": 0,
      "updatedAt": "<commit date>"
    }
  ]
}
```

`official` is true when the owner is `block`. `verified` was added without a schema version change, so readers treat a listing without it as unverified. `host` is copied from the manifest's `host` and normalized: process and command entries become display strings such as `my-cli sync`. `source.path` is `""` for the repository root and never starts or ends with `/`.

Plugins are sorted by key. Consumers sort and filter for themselves.

## Publishing

The **Publish index** workflow runs every three hours, on pushes to `main` that change `sources.txt`, `denylist.txt`, `cleared.txt`, `verified.txt` or `indexer/`, and on demand. It:

1. Reads the current `index.json` from the `index` branch as the previous index, so `accessChanged` compares against what was last published.
2. Runs the crawl and validates the result against the schema. If every source failed because GitHub was rate limiting or unreachable, it stops without publishing, so a GitHub outage never blanks the index.
3. Commits `index.json` and `crawl-report.json` to the `index` branch, an orphan branch that holds nothing else. Runs where only `generatedAt` and `audit.checkedAt` changed commit nothing.

The published index is `https://raw.githubusercontent.com/<owner>/<repo>/index/index.json`. The workflow uses only the job's `GITHUB_TOKEN`, to push the `index` branch; the crawl itself never sends credentials.

## Community Marketplace plugin

- Manifest id `xyz.block.community-marketplace`, name "Community Marketplace".
- `host.networkOrigins` is exactly `https://api.github.com` and `https://raw.githubusercontent.com`. The index is read from the `index` branch on `raw.githubusercontent.com`. Don't add any `processes` or `commands`.
- What the plugin does:
  - It reads the published `index.json`, and falls back to a bundled copy of `fixtures/index.json`.
  - Sort choices are Recently updated, Most stars and A–Z, plus Category and search. Each card shows the author, its stars, when it was last updated, and an Official or "Community · not reviewed" label. A verified plugin carries a check mark on its own name, on the card and on its page, instead of a label beside its author; its audit says "Verified by Buzz".
  - The listing page shows the audit tier and flags above **Add to Buzz**, and an access summary from `host`.
  - **Add to Buzz** uses `ctx.reflect.get("pluginInstaller").requestInstall({repository, reference: ref, commit, path})`. Older hosts get the manual Git import steps.
  - The header has an **Add** button, like the one in Buzz's plugin settings, for listing your own plugin. It opens a dialog that states the requirements: a built `manifest.json` and `plugin.js` committed on a public branch or tag, and an optional `buzz-listing.yaml`. The author enters `owner/repo`, `owner/repo/path` or a github.com link, plus an optional branch or tag.
  - The dialog first checks the source itself, without credentials: `GET https://api.github.com/repos/<owner>/<repo>` must return `private: false`, then `manifest.json` must parse with a valid `id` and `name`, and `plugin.js` must exist at `raw.githubusercontent.com` on that ref. It shows what it found, or why the source can't be listed. A source that passes is shown as its `sources.txt` line, with two links on github.com: **Open a pull request**, which edits `sources.txt`, and **Request in an issue**, which opens the list-plugin issue form with the line filled in. A source whose key is already listed links to its listing instead.
  - The plugin sends nothing about installs or the person using it.
  - **From this community** lists plugins a member keeps in a git repository on the connected community's relay. The plugin reads the relay's repository announcements (kind 30617) and their state (kind 30618) through the `relay` service, then reads each repository at its head through the host's repository reader. Every folder holding both `manifest.json` and `plugin.js`, the root included, is one listing, up to 8 per repository and 40 repositories. **Add to Buzz** passes `https://<community>/git/<owner pubkey>/<name>`, the branch `HEAD` names (`main` when the state is missing) and the head commit. A member sees only the repositories they can read. These listings are labelled "Shared here · not reviewed", are not scanned, and never appear in `index.json`. The section is absent when nothing is shared or the host can't read repositories.
- None of the plugin's text, or this repository's, names other products or sites as a design source.
