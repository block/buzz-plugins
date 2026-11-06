# Buzz Plugins

An open directory of [Buzz](https://github.com/block/buzz-app) plugins that anyone can install from a public Git repository.

Plugin source stays in its author's repository. The directory lists a plugin once its source is publicly fetchable without credentials, audits each pinned commit, and ranks listings by anonymous install counts and upvotes.

## Parts

| Path | What it is |
| --- | --- |
| [`indexer/`](./indexer) | Crawls sources, checks they're public, audits access, and builds `index.json` |
| [`collector/`](./collector) | Install ping, upvote and source submission server, plus the ranking job |
| [`marketplace/`](./marketplace) | The Community Marketplace Buzz plugin that browses the index |
| [`template/`](./template) | A starter plugin for authors |
| [`SPEC.md`](./SPEC.md) | The contract: listing keys, publicity check, audit, `index.json`, ping and vote APIs, ranking |

## Listing a plugin

1. Start from [`template/`](./template), a minimal plugin with a build script and an example `buzz-listing.yaml`, or bring your own.
2. Commit a built `manifest.json` and `plugin.js` to a public GitHub repository, at the root or in a subfolder, on a branch or tag.
3. Optionally add `buzz-listing.yaml` next to the manifest with a tagline, description, category, tags, demo media, setup steps and links.
4. In the Community Marketplace, choose **Add your plugin** and enter `owner/repo` or `owner/repo/path`, plus an optional branch or tag. It checks the source without credentials, then submits it with `POST /v1/sources`. The listing appears after the next index update.

Maintainers can also add a source directly with `pnpm run add owner/repo [ref] [path]`, which appends it to `sources.txt`.

Every listing is labelled as unreviewed community content. Buzz's own install review, which shows the requested access and the exact commit, is still the gate before anything runs.

## Privacy

Install pings and upvotes carry a hash of a random value kept only on the installing device, so the server can count distinct installers without learning who they are. No usernames are sent and IP addresses are used only in memory for rate limiting. Sharing can be turned off in the plugin's settings.

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm test
cd marketplace && pnpm install && pnpm check
cd ../template && pnpm install && pnpm build
```

## Project resources

| Resource | Description |
| --- | --- |
| [CODEOWNERS](./CODEOWNERS) | Project leads |
| [GOVERNANCE.md](./GOVERNANCE.md) | Project governance |
| [LICENSE](./LICENSE) | Apache License, Version 2.0 |
