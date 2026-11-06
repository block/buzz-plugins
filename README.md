# Buzz Plugins

An open directory of [Buzz](https://github.com/block/buzz-app) plugins that anyone can install from a public Git repository.

Plugin source stays in its author's repository. The directory lists a plugin once its source is publicly fetchable without credentials, audits each pinned commit, and ranks listings by anonymous install counts and upvotes.

## Parts

| Path | What it is |
| --- | --- |
| [`indexer/`](./indexer) | Crawls sources, checks they're public, audits access, and builds `index.json` |
| [`collector/`](./collector) | Install ping and upvote server, plus the ranking job |
| [`marketplace/`](./marketplace) | The Community Marketplace Buzz plugin that browses the index |
| [`SPEC.md`](./SPEC.md) | The contract: listing keys, publicity check, audit, `index.json`, ping and vote APIs, ranking |

## Listing a plugin

1. Commit a built `manifest.json` and `plugin.js` to a public GitHub repository, at the root or in a subfolder, on a branch or tag.
2. Optionally add `buzz-listing.yaml` next to the manifest with a tagline, description, category, tags, demo media, setup steps and links.
3. Add the source with `index add owner/repo [ref] [path]`, or install it once from the Community Marketplace.

Every listing is labelled as unreviewed community content. Buzz's own install review, which shows the requested access and the exact commit, is still the gate before anything runs.

## Privacy

Install pings and upvotes carry a hash of a random value kept only on the installing device, so the server can count distinct installers without learning who they are. No usernames are sent and IP addresses are used only in memory for rate limiting. Sharing can be turned off in the plugin's settings.

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm test
cd marketplace && pnpm install && pnpm check
```

## Project resources

| Resource | Description |
| --- | --- |
| [CODEOWNERS](./CODEOWNERS) | Project leads |
| [GOVERNANCE.md](./GOVERNANCE.md) | Project governance |
| [LICENSE](./LICENSE) | Apache License, Version 2.0 |
