# Buzz Plugins

An open directory of [Buzz](https://github.com/block/buzz-app) plugins that anyone can install from a public Git repository.

Plugin source stays in its author's repository. The directory lists a plugin once its source is publicly fetchable without credentials and audits each pinned commit. GitHub Actions publishes the result as a static `index.json`:

```
https://raw.githubusercontent.com/block/buzz-plugins/index/index.json
```

## Parts

| Path | What it is |
| --- | --- |
| [`indexer/`](./indexer) | Crawls sources, checks they're public, audits access, builds `index.json`, and checks proposed sources |
| [`.github/`](./.github) | The workflows that publish the index and check new sources, and the list-a-plugin issue form |
| [`marketplace/`](./marketplace) | The Community Marketplace Buzz plugin that browses the index |
| [`template/`](./template) | A starter plugin for authors |
| [`SPEC.md`](./SPEC.md) | The contract: listing keys, publicity check, audit, `index.json`, publishing |

## Listing a plugin

1. Start from [`template/`](./template), a minimal plugin with a build script and an example `buzz-listing.yaml`, or bring your own.
2. Commit a built `manifest.json` and `plugin.js` to a public GitHub repository, at the root or in a subfolder, on a branch or tag.
3. Optionally add `buzz-listing.yaml` next to the manifest with a tagline, description, category, tags, demo media, setup steps and links.
4. Add one line to [`sources.txt`](./sources.txt) in a pull request:

   ```
   https://github.com/<owner>/<repo> <branch or tag> [folder]
   ```

   Or open the [**List a plugin**](../../issues/new?template=list-plugin.yml) issue form and a maintainer adds it. **Add your plugin** in the Community Marketplace checks your repository first and opens either one with the line filled in.
5. A check runs on the pull request or issue and comments with the result. Once a maintainer merges, the listing appears after the next index publish, within a few minutes.

Maintainers can also run `pnpm run add owner/repo [ref] [path]`, which runs the same check and appends the line to `sources.txt`.

Every listing is labelled as unreviewed community content. Buzz's own install review, which shows the requested access and the exact commit, is still the gate before anything runs.

## Privacy

The directory collects nothing about who installs a plugin. The index is a static file, and the marketplace plugin only reads it and GitHub's public API.

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm test
pnpm crawl                 # writes .data/index.json and .data/crawl-report.json
cd marketplace && pnpm install && pnpm check
cd ../template && pnpm install && pnpm build
```

## Project resources

| Resource | Description |
| --- | --- |
| [CODEOWNERS](./CODEOWNERS) | Project leads |
| [GOVERNANCE.md](./GOVERNANCE.md) | Project governance |
| [LICENSE](./LICENSE) | Apache License, Version 2.0 |
