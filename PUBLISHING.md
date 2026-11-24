# Publishing a plugin to the public directory

This is the checklist for getting a plugin you already run in Buzz listed for everyone. It is written so a person or their agent can follow it top to bottom. Stop at the first step that fails and fix it before going on.

## What a listing needs

| Requirement | How it is checked |
| --- | --- |
| `manifest.json` with a valid `id` | Local check and the pull request check |
| `"apiVersion": 1` in `manifest.json`, which Buzz requires to load it | Local check |
| A built `plugin.js` next to `manifest.json` | Local check and the pull request check |
| Both files committed and pushed, at the repository root or in a folder, and not gitignored | Local check |
| A public GitHub repository, on a branch or tag | Pull request check, without credentials |
| A `buzz-listing.yaml`, if present, with no unknown fields | Local check and the pull request check |
| A description: `description` in the manifest, a README or `buzz-listing.yaml` | Local check, as a note |

A plugin that asks for processes, commands, files, MCP or agent hooks, or that trips an audit flag, is still listed. It shows as not yet cleared until a maintainer reviews that version. [`SPEC.md`](./SPEC.md#audit) lists the flags.

## Steps

1. **Build it.** Run the plugin's build so `plugin.js` is current. Buzz runs the built file, so the directory lists the built file.

2. **Check the folder.** From a checkout of this repository, with Node 24:

   ```sh
   pnpm install
   pnpm run check-plugin /path/to/your/plugin
   ```

   Each line starts with `ok`, `note`, `review` or `FAIL`. The command exits non-zero when anything fails. `review` lines do not block listing; they are what a maintainer will look at. Fix every `FAIL`, then run it again.

3. **Commit and push** `manifest.json`, `plugin.js` and, if you have one, `buzz-listing.yaml` to a public GitHub repository. Run the check once more after pushing: it fails while a built file differs from the last commit or is gitignored, and while the branch has commits its upstream lacks.

4. **Do not publish secrets.** Read `plugin.js` and the repository for tokens, internal hostnames and private data before making it public. Nothing checks this for you.

5. **Ask for the listing.** Add one line to [`sources.txt`](./sources.txt) in a pull request:

   ```
   https://github.com/<owner>/<repo> <branch or tag> [folder]
   ```

   Or open the [**List a plugin**](../../issues/new?template=list-plugin.yml) issue form. **Add** in the Community Marketplace checks the repository and opens either one with the line filled in.

6. **Read the check's comment.** A workflow fetches the repository without credentials and comments with the result. A maintainer merges once it passes, and the listing appears after the next index publish.

7. **Optional: ask for the Verified mark.** Open the [**Verify a plugin**](../../issues/new?template=verify-plugin.yml) form. [`VERIFICATION.md`](./VERIFICATION.md) describes the review. List a tag instead of a branch if you want the mark to stay on one version.

## Updating a listing

Push to the listed branch. The next crawl picks up the new commit and audits it again. A version that needs clearing is uncleared until a maintainer clears the new commit, and a Verified mark does not carry over to it.
