# Buzz plugin template

A minimal Buzz plugin that you can copy, build and list in the Community Marketplace. It adds one page with a counter.

## Files

| File | What it is |
| --- | --- |
| `manifest.json` | The plugin's id, name, API version, description and discovery metadata |
| `src/index.tsx` | The plugin source. It exports `inject` and `apply(ctx)` |
| `plugin.js` | The built module. Buzz runs this file, so commit it |
| `buzz-listing.yaml` | Optional listing details: tagline, description, category, tags, demo media, setup steps and links |
| `vendor/` | Type-only `@buzz/author` package with the plugin API types |

## Make it yours

1. Copy this folder into your own repository, at the root or in a subfolder.
2. In `manifest.json`, set a unique `id` (lowercase letters, digits, dots and dashes, such as `com.yourname.notes`), a `name` and a `description`. Keep `apiVersion` at `1`.
3. Edit `src/index.tsx`. Buzz supplies React and the plugin API at runtime, so import `@buzz/author` as types only and use `ctx.react`.
4. Build with Node 24 and pnpm:

   ```sh
   pnpm install
   pnpm build
   ```

   The build writes `plugin.js` next to `manifest.json`.
5. Try it locally: in Buzz, open **Settings → Plugins → Load from folder**, choose this folder, then install and enable it.
6. Edit or delete `buzz-listing.yaml`. Every field is optional, and unknown fields are errors.

If your plugin needs network access, files, commands or agent hooks, declare them under `host` in `manifest.json`. Buzz shows that access in its install review, and the directory shows it on the listing.

## List it

1. Commit `manifest.json` and `plugin.js` (and `buzz-listing.yaml` if you kept it) and push to a public GitHub repository, on a branch or tag.
2. In Buzz, open the Community Marketplace and choose **Add your plugin**. Enter `owner/repo`, or `owner/repo/path/to/plugin` for a subfolder, and an optional branch or tag.
3. The marketplace checks that the repository is public and has a built plugin, then submits it. It shows up after the next index update.

Each time the index updates it pins your branch or tag's newest commit. Listings are marked as unreviewed community content until a maintainer clears them.
