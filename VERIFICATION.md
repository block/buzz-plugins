# Verified plugins

Anyone can list a plugin, and a listing starts out unreviewed. A listing is **Verified by Buzz** when a maintainer has reviewed the exact commit the directory is showing.

## What it means

- A maintainer read the source at that commit, confirmed the committed `plugin.js` is built from it, and found that the plugin does what its listing says with the access it declares.
- It covers one commit. When the author pushes a new one, the listing goes back to unreviewed until that commit is reviewed. Listing a tag in `sources.txt` instead of a branch keeps the badge between releases.
- It covers what that commit pins. A verified listing shows only screenshots, posters and video served from the reviewed commit, and only its repository link. The directory drops media hosted anywhere else and the author's docs and support links from a verified listing, because those can change after the review. Keep demo media in the repository if it should show.
- It does not hide anything. A verified listing still shows its access tier and every flag from the automated scan, and whether a maintainer cleared them.
- It is not a guarantee. Plugins run unsandboxed, and a review can miss things. Buzz's own install review, which shows the requested access and the exact commit, still runs before anything is added.

## Asking for a review

Open the [**Verify a plugin**](../../issues/new?template=verify-plugin.yml) issue form with the listing key and the commit. The plugin has to be listed already, and the request has to come from someone who can push to the plugin's repository.

## Reviewing

A maintainer who didn't write the plugin works through this list at the requested commit and records the result in the issue.

1. **Requester.** The request comes from an owner or collaborator of the plugin's repository.
2. **Source.** The repository has readable source for `plugin.js`, with a committed lockfile if it has dependencies. A plugin that ships only a bundle can't be verified.
3. **Build.** Building from a clean checkout of the commit, with the repository's documented command, produces the committed `plugin.js` byte for byte. A hand-written `plugin.js` is its own source.
4. **Access.** Everything in the manifest's `host` is needed for what the plugin does. Each network origin, process, command and file access has a reason the reviewer can state.
5. **Audit.** Every flag from the automated scan (`dynamic-code`, `obfuscated`, `undeclared-origin`, `size`) is explained by the source. Unexplained flags fail the review.
6. **Behaviour.** The source doesn't send messages, keys, credentials or files anywhere the listing doesn't describe, doesn't load code at run time, and doesn't imitate Buzz's own interface to ask for secrets.
7. **Listing.** The name, tagline and description match what the plugin does.
8. **Run.** The reviewer adds the plugin at that commit in a throwaway Buzz profile and uses it.

## Recording

The reviewer opens a pull request that adds one line to [`verified.txt`](./verified.txt) and links the issue:

```
<key> <commit>
```

The pull request merges under the same rule as any other change to `main`: an approving review from a code owner. When the reviewer is the only code owner, the issue's checklist is the record that the review happened. The listing shows as verified after the next index publish. The pull request and its issue are the record of who reviewed what; earlier lines stay in the file as history.

Verifying doesn't clear the audit. If the listing is high access or has any flag, add the same line to [`cleared.txt`](./cleared.txt) in the same pull request, once step 5 is satisfied. Otherwise it stays marked as not yet cleared.

## Withdrawing

- Remove the line from `verified.txt` when a review turns out to be wrong. The listing goes back to unreviewed at the next publish.
- Add the key to [`denylist.txt`](./denylist.txt) when a plugin shouldn't be listed at all.

Neither removes a plugin that someone has already added to Buzz.
