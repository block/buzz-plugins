// src/install.ts
function pluginsCapability(ctx) {
	const capability = ctx.reflect?.get?.("pluginInstaller");
	return typeof capability?.requestInstall === "function" ? capability : void 0;
}
function sourceOf(listing) {
	return {
		repository: listing.source.repository,
		reference: listing.source.ref,
		commit: listing.source.commit,
		...listing.source.path ? { path: listing.source.path } : {}
	};
}
function activePluginIds(ctx) {
	const ids = /* @__PURE__ */ new Set();
	const registries = [ctx.pages, ctx.panels];
	for (const registry of registries) for (const entry of registry?.snapshot?.() ?? []) ids.add(entry.pluginId);
	return ids;
}
// src/styles.ts
var styles = `
.bm-page { height: 100%; overflow-y: auto; color: var(--text-standard); font-family: var(--font-sans); }
.bm-inner { max-width: 1120px; margin: 0 auto; padding: var(--space-8) var(--space-8) var(--space-16); }
.bm-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-6); margin-bottom: var(--space-6); }
.bm-title { margin: 0; font-size: var(--text-title); font-weight: var(--text-title--font-weight); letter-spacing: var(--text-title--letter-spacing); line-height: var(--text-title--line-height); }
.bm-subtitle { margin: var(--space-2) 0 0; color: var(--text-subtle); font-size: var(--text-body-lg); line-height: var(--text-body-lg--line-height); }
.bm-header > .bm-button { flex: none; }
.bm-search { display: flex; align-items: center; gap: var(--space-2); height: 40px; padding: 0 var(--space-3);
  border-radius: var(--radius-pill); background: var(--surface-inset); border: 1px solid var(--border-standard); }
.bm-search:focus-within { border-color: var(--border-focus); }
.bm-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; font-size: var(--text-body); }
.bm-search svg { flex: none; color: var(--text-metadata); }
.bm-toolbar { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin: 0 0 var(--space-3); }
.bm-sort { margin-inline-start: auto; }
.bm-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.bm-chip { height: 32px; padding: 0 var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--border-standard);
  background: var(--surface-panel); color: var(--text-subtle); font: inherit; font-size: var(--text-body-sm); cursor: pointer; }
.bm-chip:hover { background: var(--affordance-row-hover); color: var(--text-standard); }
.bm-chip[aria-pressed="true"] { background: var(--surface-inverse); border-color: var(--surface-inverse); color: var(--text-inverse); }
.bm-key { font-family: var(--font-mono); font-size: .92em; overflow-wrap: anywhere; }
.bm-section-title { margin: var(--space-8) 0 var(--space-3); font-size: var(--text-body); font-weight: var(--font-weight-semibold); color: var(--text-subtle); }
.bm-media { position: relative; aspect-ratio: 16 / 10; border-radius: var(--radius-panel); overflow: hidden; background: var(--surface-inset);
  border: 1px solid var(--border-image, var(--border-standard)); }
.bm-media img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
.bm-art { position: absolute; inset: 0; display: grid; place-items: center; color: white; }
.bm-art span { font-size: 44px; font-weight: 600; letter-spacing: -.02em; text-shadow: 0 2px 12px rgba(0,0,0,.18); }
.bm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: var(--space-4); }
.bm-card { display: grid; grid-template-rows: auto 1fr; grid-template-columns: minmax(0, 1fr); min-width: 0; border-radius: var(--radius-panel); overflow: hidden; background: var(--surface-panel);
  border: 1px solid var(--border-standard); cursor: pointer; text-align: start; padding: 0; color: inherit; font: inherit; transition: transform 160ms ease, box-shadow 160ms ease; }
.bm-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
.bm-card:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.bm-card .bm-media { border: 0; border-radius: 0; aspect-ratio: 16 / 9; }
.bm-card-body { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; padding: var(--space-3) var(--space-4) var(--space-4); }
.bm-card-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
.bm-card-name { font-weight: var(--font-weight-semibold); font-size: var(--text-body); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-card-title { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
.bm-verified { flex: none; color: var(--text-success); }
.bm-detail-name .bm-verified { width: 0.8em; height: 0.8em; margin-inline-start: var(--space-2); vertical-align: -0.05em; }
.bm-card-author { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-card-meta.bm-card-footer { margin-top: auto; padding-top: var(--space-2); }
.bm-card-tagline { color: var(--text-subtle); font-size: var(--text-body-sm); line-height: var(--text-body-sm--line-height);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: calc(2 * var(--text-body-sm--line-height)); }
.bm-card-installs { color: var(--text-metadata); font-size: var(--text-caption); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-card-stars { flex: none; color: var(--text-metadata); font-size: var(--text-caption); font-weight: var(--font-weight-semibold); font-variant-numeric: tabular-nums; }
.bm-card-meta { margin-top: var(--space-2); display: flex; gap: var(--space-2); align-items: center; color: var(--text-metadata); font-size: var(--text-caption); }
.bm-badge { display: inline-flex; align-items: center; height: 20px; padding: 0 var(--space-2); border-radius: var(--radius-pill);
  font-size: var(--text-caption); font-weight: var(--font-weight-semibold); background: var(--surface-inset); color: var(--text-subtle); white-space: nowrap; }
.bm-badge[data-tone="active"] { background: color-mix(in srgb, var(--green-9) 18%, transparent); color: var(--text-success); }
.bm-badge[data-tone="warn"] { background: color-mix(in srgb, var(--amber-9) 22%, transparent); color: var(--text-warning); }
.bm-badge[data-tone="default"] { background: var(--accent-overlay-soft); color: var(--text-standard); }
.bm-button { display: inline-flex; flex-shrink: 0; white-space: nowrap; align-items: center; justify-content: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-4);
  border-radius: var(--radius-pill); border: 0; font: inherit; font-size: var(--text-body); font-weight: var(--font-weight-semibold); cursor: pointer;
  background: var(--affordance-prominent); color: var(--text-on-prominent); }
a.bm-button { text-decoration: none; }
.bm-button:hover { background: var(--affordance-prominent-hover); }
.bm-button:disabled { background: var(--affordance-disabled); color: var(--text-unavailable); cursor: default; }
.bm-button[data-variant="quiet"] { background: var(--affordance-subtle); color: var(--text-standard); }
.bm-button[data-variant="quiet"]:hover { background: var(--affordance-subtle-hover); }
.bm-button[data-size="sm"] { height: 28px; padding: 0 var(--space-3); font-size: var(--text-body-sm); }
.bm-detail { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--space-8); }
.bm-back { display: inline-flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-4); padding: 0; border: 0; background: none;
  color: var(--text-subtle); font: inherit; font-size: var(--text-body-sm); cursor: pointer; }
.bm-link-button { justify-self: start; padding: 0; border: 0; background: none; color: var(--text-subtle); font: inherit; font-size: var(--text-body-sm); cursor: pointer; }
.bm-link-button:hover { color: var(--text-standard); }
.bm-back:hover { color: var(--text-standard); }
.bm-detail-name { margin: 0; font-size: var(--text-title); font-weight: var(--text-title--font-weight); letter-spacing: var(--text-title--letter-spacing); }
.bm-detail-name + .bm-media { margin-top: var(--space-4); }
.bm-detail-tagline { margin: var(--space-2) 0 var(--space-5); color: var(--text-subtle); font-size: var(--text-body-lg); }
.bm-detail .bm-media { aspect-ratio: 16 / 10; box-shadow: var(--shadow-sm); }
.bm-prose { margin-top: var(--space-6); font-size: var(--text-body); line-height: 1.6; }
.bm-prose p { margin: 0 0 var(--space-3); }
.bm-prose ul { margin: 0 0 var(--space-3); padding-inline-start: var(--space-6); }
.bm-prose h4 { margin: var(--space-4) 0 var(--space-2); font-size: var(--text-body); font-weight: var(--font-weight-semibold); }
.bm-prose ol { margin: 0 0 var(--space-3); padding-inline-start: var(--space-6); }
.bm-prose pre { margin: 0 0 var(--space-3); padding: var(--space-3); overflow-x: auto; border-radius: var(--radius-control); background: var(--surface-inset); }
.bm-prose pre code { padding: 0; background: none; }
.bm-prose code { font-family: var(--font-mono); font-size: .92em; padding: 0 .3em; border-radius: 4px; background: var(--surface-inset); }
.bm-prose a, .bm-aside a { color: var(--text-link); text-decoration: underline; }
.bm-shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-3); margin-top: var(--space-4); }
.bm-shots figure { margin: 0; }
.bm-shots img { width: 100%; border-radius: var(--radius-container); border: 1px solid var(--border-standard); }
.bm-shots figcaption { margin-top: var(--space-1); color: var(--text-metadata); font-size: var(--text-caption); }
.bm-aside { display: grid; gap: var(--space-5); align-content: start; position: sticky; top: var(--space-4); }
.bm-aside-card { display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-panel); background: var(--surface-panel); border: 1px solid var(--border-standard); }
.bm-aside h3 { margin: 0; font-size: var(--text-caption); text-transform: uppercase; letter-spacing: .08em; color: var(--text-metadata); font-weight: var(--font-weight-semibold); }
.bm-aside ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); font-size: var(--text-body-sm); }
.bm-aside li code { font-family: var(--font-mono); font-size: .9em; }
.bm-kv { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3); font-size: var(--text-body-sm); }
.bm-kv dt { color: var(--text-metadata); }
.bm-kv dd { margin: 0; overflow-wrap: anywhere; }
.bm-empty { padding: var(--space-16) 0; text-align: center; color: var(--text-subtle); }
.bm-note { font-size: var(--text-caption); color: var(--text-metadata); }
.bm-dialog-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: var(--bg-scrim, rgba(0,0,0,.3)); }
.bm-dialog { box-sizing: border-box; width: min(560px, calc(100vw - 48px)); display: grid; gap: var(--space-4); padding: var(--space-6); border-radius: var(--radius-panel);
  background: var(--surface-popover); box-shadow: var(--shadow-panel), 0 24px 60px rgba(0,0,0,.25); color: var(--text-standard); }
.bm-dialog h2 { margin: 0; font-size: var(--text-heading); font-weight: var(--text-heading--font-weight); }
.bm-dialog ol { margin: 0; padding-inline-start: var(--space-5); display: grid; gap: var(--space-3); font-size: var(--text-body); }
.bm-dialog ol > li { min-width: 0; }
.bm-dialog li > code, .bm-prose li code { font-family: var(--font-mono); font-size: .92em; }
.bm-aside-card > .bm-badge { justify-self: start; }
.bm-copy { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-1); }
.bm-copy code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: var(--space-1h) var(--space-2);
  border-radius: var(--radius-control); background: var(--surface-inset); font-family: var(--font-mono); font-size: var(--text-body-sm); }
.bm-steps { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-3); font-size: var(--text-body-sm); }
.bm-step { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: var(--space-2); align-items: start; }
.bm-step-mark { box-sizing: border-box; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700;
  border: 1.5px solid var(--border-standard); color: var(--text-inverse); }
.bm-step-title { font-weight: var(--font-weight-semibold); color: var(--text-subtle); }
.bm-step-detail { margin-top: var(--space-1); color: var(--text-subtle); line-height: var(--text-body-sm--line-height); }
.bm-step[data-state="todo"] .bm-step-title { color: var(--text-metadata); font-weight: inherit; }
.bm-step:is([data-state="active"], [data-state="next"], [data-state="done"]) .bm-step-title { color: var(--text-standard); }
.bm-step[data-state="next"] .bm-step-mark { border-color: var(--border-focus); }
.bm-step[data-state="active"] .bm-step-mark { border-color: var(--border-focus); border-top-color: transparent; animation: bm-spin 900ms linear infinite; }
.bm-step[data-state="done"] .bm-step-mark { border: 0; background: var(--green-9); }
.bm-step[data-state="failed"] .bm-step-mark { border: 0; background: var(--red-9); }
.bm-step[data-state="failed"] .bm-step-detail { color: var(--text-danger); }
@keyframes bm-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .bm-step[data-state="active"] .bm-step-mark { animation: none; border-top-color: var(--border-focus); } }
.bm-dialog-lede { margin: 0; font-size: var(--text-body); color: var(--text-subtle); }
.bm-requirements { margin: calc(-1 * var(--space-2)) 0 0; padding-inline-start: var(--space-5); display: grid; gap: var(--space-1); font-size: var(--text-body-sm); color: var(--text-subtle); }
.bm-requirements code, .bm-dialog-lede code { font-family: var(--font-mono); font-size: .92em; }
.bm-form { display: grid; gap: var(--space-3); }
.bm-field { display: grid; gap: var(--space-1); font-size: var(--text-body-sm); font-weight: var(--font-weight-semibold); }
.bm-field input { box-sizing: border-box; height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-control); border: 1px solid var(--border-standard);
  background: var(--surface-inset); color: inherit; font: inherit; font-family: var(--font-mono); font-size: var(--text-body-sm); font-weight: normal; outline: 0; }
.bm-field input:focus { border-color: var(--border-focus); }
.bm-check { display: grid; gap: var(--space-2); font-size: var(--text-body-sm); min-height: var(--text-body-sm--line-height); }
.bm-check p { margin: 0; color: var(--text-subtle); }
.bm-check .bm-check-error { color: var(--text-danger); }
.bm-check .bm-check-success { color: var(--text-success); }
.bm-check-found { display: grid; gap: var(--space-1); padding: var(--space-3); border-radius: var(--radius-control); background: var(--surface-inset); min-width: 0; }
.bm-check-found .bm-note { overflow-wrap: anywhere; }
.bm-check-description { color: var(--text-subtle); }
.bm-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
@media (max-width: 900px) { .bm-detail { grid-template-columns: 1fr; } .bm-aside { position: static; } }
@media (max-width: 720px) { .bm-header { flex-wrap: wrap; } }
.bm-flags { gap: var(--space-2); }
.bm-flag { display: grid; gap: var(--space-1); }
.bm-flag code { justify-self: start; padding: 0 var(--space-2); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--red-9) 16%, transparent); color: var(--text-danger); font-weight: var(--font-weight-semibold); }
.bm-warning { color: var(--text-warning); }
.bm-footer { display: grid; gap: var(--space-2); margin-top: var(--space-8); max-width: 640px; }
`;
var fixtures_default = {
	schemaVersion: 1,
	generatedAt: "2026-11-05T23:57:18Z",
	mediaPolicy: "raw.githubusercontent.com at the pinned commit, or https URLs the author lists",
	plugins: [
		{
			"key": "github.com/block/buzz-app/examples/plugins/counter",
			"slug": "github-com--block--buzz-app--examples--plugins--counter",
			"id": "example.counter",
			"name": "Counter playground",
			"tagline": "",
			"description": "",
			"category": "productivity",
			"tags": [],
			"author": { "github": "block" },
			"official": true,
			"verified": false,
			"source": {
				"repository": "https://github.com/block/buzz-app",
				"ref": "main",
				"commit": "b1e3f4c984856804d4042c943118b7d20bd3014b",
				"path": "examples/plugins/counter"
			},
			"host": {
				"networkOrigins": [],
				"processes": [],
				"commands": [],
				"files": false,
				"mcp": false,
				"agentHooks": false
			},
			"audit": {
				"tier": "low",
				"flags": [],
				"accessChanged": false,
				"cleared": true,
				"checkedAt": "2026-11-05T23:57:15Z"
			},
			"demo": {
				"video": null,
				"poster": null,
				"screenshots": []
			},
			"setup": [],
			"links": { "repository": "https://github.com/block/buzz-app" },
			"stars": 101,
			"updatedAt": "2026-11-05T23:50:58Z"
		},
		{
			"key": "github.com/block/buzz-app/examples/plugins/shortcut-counter",
			"slug": "github-com--block--buzz-app--examples--plugins--shortcut-counter",
			"id": "example.shortcut-counter",
			"name": "Shortcut counter",
			"tagline": "",
			"description": "# Shortcut counter\n\nImport this folder from desktop Settings → Plugins, then enable **Shortcut counter**.\nThe prebuilt `plugin.js` has no runtime imports or build step. Requires a host with\n`shortcuts` (host-matched API v1 preview, not a cross-version SDK).\n\nPress **⌘⇧G** on Mac / **Ctrl+Shift+G** elsewhere to increment. The same handler\nbacks the button. The count lasts for the plugin lifetime, not a page mount;\ndisable/re-enable resets it and disposes/re-registers the binding. The typing\nfield demonstrates the default editable-target guard. No custom DOM listener,\nservice instance, or manual unload hook is required.\n",
			"category": "productivity",
			"tags": [],
			"author": { "github": "block" },
			"official": true,
			"verified": false,
			"source": {
				"repository": "https://github.com/block/buzz-app",
				"ref": "main",
				"commit": "b1e3f4c984856804d4042c943118b7d20bd3014b",
				"path": "examples/plugins/shortcut-counter"
			},
			"host": {
				"networkOrigins": [],
				"processes": [],
				"commands": [],
				"files": false,
				"mcp": false,
				"agentHooks": false
			},
			"audit": {
				"tier": "low",
				"flags": [],
				"accessChanged": false,
				"cleared": true,
				"checkedAt": "2026-11-05T23:57:18Z"
			},
			"demo": {
				"video": null,
				"poster": null,
				"screenshots": []
			},
			"setup": [],
			"links": { "repository": "https://github.com/block/buzz-app" },
			"stars": 101,
			"updatedAt": "2026-11-05T23:50:58Z"
		},
		{
			"key": "github.com/nickhenggeler/buzz-projects-plugin",
			"slug": "github-com--nickhenggeler--buzz-projects-plugin",
			"id": "sprig.projects",
			"name": "Projects",
			"tagline": "Browse your community's projects, repositories and linked channels.",
			"description": "# Projects\n\nBrowse your community's projects, repositories and linked channels in Buzz 1.0.\n\nBuzz 1.0 can open a repository from a link, but it has no page that lists them.\nThis plugin adds one, with a folder-based file browser.\n\n## Getting started\n\n1. Open **Projects** in the sidebar.\n2. Choose a repository to browse its folders, files and commits.\n3. Use **Go to file** to find a file by name.\n\nPull requests and issues open in Buzz's built-in repository page.\n\n## Install\n\nIn Buzz, open **Settings → Plugins → Manage plugins**, add the repository\n`nickhenggeler/buzz-projects-plugin`, then review and install it.\n\nOr open this link on a Mac:\n\n```sh\nopen 'buzz://plugin-install?repository=nickhenggeler%2Fbuzz-projects-plugin&ref=main'\n```\n\n## Limits\n\n- Projects is read-only. It can't create or edit projects yet.\n- Buzz gives each repository read about 12 seconds, so large repositories or slow\n  servers can fail to load. Use **Try again** if that happens.\n- READMEs show as plain text.\n\n## Development\n\nThe plugin is one dependency-free file, `plugin.js`, with no build step.\nRun the tests on macOS with `tests/run.sh`.\n\n## License\n\nApache-2.0\n",
			"category": "productivity",
			"tags": ["code", "projects"],
			"author": { "github": "nickhenggeler" },
			"official": false,
			"verified": false,
			"source": {
				"repository": "https://github.com/nickhenggeler/buzz-projects-plugin",
				"ref": "main",
				"commit": "1fb9de5e2df9bf1298c2d86c6f1afd19f9fa46df",
				"path": ""
			},
			"host": {
				"networkOrigins": [],
				"processes": [],
				"commands": [],
				"files": false,
				"mcp": false,
				"agentHooks": false
			},
			"audit": {
				"tier": "low",
				"flags": [],
				"accessChanged": false,
				"cleared": true,
				"checkedAt": "2026-11-05T23:57:14Z"
			},
			"demo": {
				"video": null,
				"poster": null,
				"screenshots": []
			},
			"setup": [],
			"links": { "repository": "https://github.com/nickhenggeler/buzz-projects-plugin" },
			"stars": 0,
			"updatedAt": "2026-11-05T13:50:00Z"
		},
		{
			"key": "github.com/block/buzz-app/examples/plugins/notes",
			"slug": "github-com--block--buzz-app--examples--plugins--notes",
			"id": "example.notes",
			"name": "Notes playground",
			"tagline": "",
			"description": "",
			"category": "productivity",
			"tags": [],
			"author": { "github": "block" },
			"official": true,
			"verified": false,
			"source": {
				"repository": "https://github.com/block/buzz-app",
				"ref": "main",
				"commit": "b1e3f4c984856804d4042c943118b7d20bd3014b",
				"path": "examples/plugins/notes"
			},
			"host": {
				"networkOrigins": [],
				"processes": [],
				"commands": [],
				"files": false,
				"mcp": false,
				"agentHooks": false
			},
			"audit": {
				"tier": "low",
				"flags": [],
				"accessChanged": false,
				"cleared": true,
				"checkedAt": "2026-11-05T23:57:16Z"
			},
			"demo": {
				"video": null,
				"poster": null,
				"screenshots": []
			},
			"setup": [],
			"links": { "repository": "https://github.com/block/buzz-app" },
			"stars": 101,
			"updatedAt": "2026-11-05T23:50:58Z"
		}
	]
};
// src/catalog.ts
var LISTING_REPOSITORY = "block/buzz-plugins";
var INDEX_URL = `https://raw.githubusercontent.com/${LISTING_REPOSITORY}/index/index.json`;
var categories = {
	communication: "Communication",
	agents: "Agents",
	"agent-tools": "Agent tools",
	"developer-tools-and-integrations": "Developer tools",
	"people-and-communities": "People & communities",
	productivity: "Productivity"
};
var sorts = [
	{
		id: "updated",
		label: "Recently updated"
	},
	{
		id: "stars",
		label: "Most stars"
	},
	{
		id: "name",
		label: "A–Z"
	}
];
var KEY = /^github\.com\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})((?:\/[A-Za-z0-9._@+-]{1,100}){0,8})$/;
function parseKey(key) {
	const match = KEY.exec(key);
	if (!match || match[3].split("/").some((segment) => segment === "." || segment === "..")) return null;
	return {
		owner: match[1],
		repo: match[2],
		path: match[3].slice(1)
	};
}
var text = (value) => typeof value === "string" && value.length > 0;
var count = (value) => Number.isSafeInteger(value) && value >= 0;
var strings = (value) => value === void 0 || Array.isArray(value) && value.every(text);
var flag = (value) => value === void 0 || typeof value === "boolean";
var https$1 = (url) => typeof url === "string" && /^https:\/\/[^\s/]+\/\S*$/.test(url);
var media = (value) => value == null || !!value && typeof value === "object" && https$1(value.url);
function validListing(value) {
	const listing = value;
	if (!listing || typeof listing !== "object") return false;
	const parts = typeof listing.key === "string" ? parseKey(listing.key) : null;
	if (!parts) return false;
	const { host, audit, source, demo } = listing;
	return /^[a-z0-9-]{1,120}$/.test(String(listing.slug)) && /^[a-z][a-z0-9.-]{0,79}$/.test(String(listing.id)) && text(listing.name) && typeof listing.tagline === "string" && (listing.description === void 0 || typeof listing.description === "string") && Object.hasOwn(categories, listing.category) && strings(listing.tags) && text(listing.author?.github) && listing.official === (parts.owner === "block") && flag(listing.verified) && source?.repository === `https://github.com/${parts.owner}/${parts.repo}` && text(source.ref) && /^[0-9a-f]{40}$/.test(String(source.commit)) && (source.path === void 0 || source.path === parts.path) && !!host && typeof host === "object" && (host.networkOrigins ?? []).every((origin) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) && strings(host.processes) && strings(host.commands) && [
		host.files,
		host.mcp,
		host.agentHooks
	].every(flag) && [
		"low",
		"medium",
		"high"
	].includes(String(audit?.tier)) && Array.isArray(audit.flags) && audit.flags.every((item) => text(item?.code) && text(item?.detail)) && typeof audit.cleared === "boolean" && (listing.stars === void 0 || count(listing.stars)) && (listing.updatedAt === void 0 || Number.isFinite(Date.parse(String(listing.updatedAt)))) && (demo === void 0 || media(demo.video) && media(demo.poster) && (demo.screenshots ?? []).every((shot) => media(shot))) && (listing.setup ?? []).every((step) => text(step?.title)) && (listing.links === void 0 || !!listing.links && typeof listing.links === "object");
}
function parseIndex(value) {
	const raw = value;
	if (!raw || typeof raw !== "object" || raw.schemaVersion !== 1 || !Array.isArray(raw.plugins)) return null;
	const slugs = /* @__PURE__ */ new Set();
	const keys = /* @__PURE__ */ new Set();
	const plugins = raw.plugins.filter((plugin) => {
		if (!validListing(plugin) || slugs.has(plugin.slug) || keys.has(plugin.key)) return false;
		slugs.add(plugin.slug);
		keys.add(plugin.key);
		return true;
	});
	if (raw.plugins.length && !plugins.length) return null;
	const generatedAt = Date.parse(String(raw.generatedAt));
	if (!Number.isFinite(generatedAt)) return null;
	return {
		schemaVersion: 1,
		generatedAt: new Date(generatedAt).toISOString(),
		plugins
	};
}
var bundledIndex = parseIndex(fixtures_default) ?? {
	schemaVersion: 1,
	generatedAt: (/* @__PURE__ */ new Date(0)).toISOString(),
	plugins: []
};
async function loadIndex(host) {
	if (!host) return {
		index: bundledIndex,
		live: false
	};
	try {
		const response = await host.request({
			url: INDEX_URL,
			timeoutMs: 8e3
		});
		if (response.status !== 200) throw new Error(`index ${response.status}`);
		const index = parseIndex(JSON.parse(response.body));
		if (!index) throw new Error("invalid index");
		return {
			index,
			live: true
		};
	} catch {
		return {
			index: bundledIndex,
			live: false
		};
	}
}
var shared = (listing) => "member" in listing.author;
var authorKey = (listing) => "npub" in listing.author ? listing.author.npub : null;
var authorName = (listing) => "member" in listing.author ? listing.author.member : listing.author.github;
var updated = (listing) => Date.parse(listing.updatedAt ?? "") || 0;
var byName = (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.key < b.key ? -1 : 1);
var comparators = {
	updated: (a, b) => updated(b) - updated(a) || byName(a, b),
	stars: (a, b) => (b.stars ?? 0) - (a.stars ?? 0) || byName(a, b),
	name: byName
};
function sorted(index, sort) {
	return [...index.plugins].sort(comparators[sort]);
}
function search(plugins, query, category) {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return plugins.filter((plugin) => {
		if (category && plugin.category !== category) return false;
		if (!words.length) return true;
		const haystack = [
			plugin.name,
			plugin.tagline,
			plugin.description,
			authorName(plugin),
			...plugin.tags ?? []
		].join(" ").toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}
function accessSummary(host) {
	if (!host) return [];
	return [
		...(host.networkOrigins ?? []).map((origin) => `Connect to ${origin.replace(/^https:\/\//, "")}`),
		...(host.processes ?? []).map((process) => `Run \`${process}\``),
		...(host.commands ?? []).map((command) => `Run \`${command}\``),
		...host.files ? ["Read files on this Mac"] : [],
		...host.mcp ? ["Serve tools to your agents (MCP)"] : [],
		...host.agentHooks ? ["Observe and steer agent turns"] : []
	];
}
var tierLabels = {
	low: "Low access",
	medium: "Network access",
	high: "High access"
};
// src/community.ts
/** Read through `reflect` so a Buzz without the service still runs the marketplace. */
function relayOf(ctx) {
	return ctx.reflect?.get?.("relay");
}
/** Names the connected community and person once this Buzz can read its repositories; empty until then. */
function connection(relay) {
	const snapshot = relay?.snapshot();
	return snapshot?.status === "ready" && snapshot.session?.projectGit ? snapshot.scope ?? "ready" : "";
}
var SHARE_PROMPT = "Share my Buzz plugin with this channel. Push the folder that holds its built manifest.json and plugin.js to this channel's git repository, creating the repository if there is none, then tell me its name.";
var ANNOUNCEMENT = 30617;
var STATE = 30618;
var MAX_REPOSITORIES = 40;
var MAX_REPOSITORIES_PER_OWNER = 5;
var MAX_PLUGINS_PER_REPOSITORY = 8;
var MAX_MANIFEST_BYTES = 262144;
var CONCURRENT_READS = 4;
var OWNER = /^[0-9a-f]{64}$/;
var DTAG = /^[A-Za-z0-9._-]{1,64}$/;
var COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
var BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
var SEGMENT$1 = /^[A-Za-z0-9._@+-]{1,100}$/;
var ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/;
var safePath = (path) => path.split("/").every((segment) => SEGMENT$1.test(segment) && segment !== "." && segment !== "..");
var safeBranch = (branch) => BRANCH.test(branch) && !branch.includes("..") && !branch.startsWith("/") && !branch.endsWith("/");
/** The https origin repositories are served from, or null for a community that isn't on TLS. */
function gitOrigin(origin) {
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" && url.protocol !== "wss:") return null;
		if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
		return `https://${url.host}`;
	} catch {
		return null;
	}
}
var BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
/** A member's key in the form people compare, since a display name is anyone's to pick. */
function npub(hex) {
	const words = [];
	let bits = 0;
	let value = 0;
	for (let index = 0; index < hex.length; index += 2) {
		value = value << 8 | Number.parseInt(hex.slice(index, index + 2), 16);
		bits += 8;
		for (; bits >= 5; bits -= 5) words.push(value >> bits - 5 & 31);
	}
	if (bits) words.push(value << 5 - bits & 31);
	const prefix = [
		...[..."npub"].map((char) => char.charCodeAt(0) >> 5),
		0,
		...[..."npub"].map((char) => char.charCodeAt(0) & 31)
	];
	let check = 1;
	for (const word of [
		...prefix,
		...words,
		0,
		0,
		0,
		0,
		0,
		0
	]) {
		const top = check >> 25;
		check = (check & 33554431) << 5 ^ word;
		[
			996825010,
			642813549,
			513874426,
			1027748829,
			705979059
		].forEach((generator, bit) => {
			if (top >> bit & 1) check ^= generator;
		});
	}
	check ^= 1;
	const checksum = [
		0,
		1,
		2,
		3,
		4,
		5
	].map((index) => check >> 5 * (5 - index) & 31);
	return `npub1${[...words, ...checksum].map((word) => BECH32[word]).join("")}`;
}
var shortKey = (key) => `${key.slice(0, 10)}…${key.slice(-4)}`;
async function pooled(items, limit, run) {
	const results = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await run(items[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}
var record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];
function entry(value) {
	if (typeof value === "string") return value.trim() || null;
	if (!record(value)) return null;
	const program = typeof value.program === "string" ? value.program : typeof value.id === "string" ? value.id : null;
	if (!program) return null;
	return [program, ...Array.isArray(value.args) ? value.args.filter((arg) => typeof arg === "string") : []].join(" ");
}
var declared = (value) => Array.isArray(value) ? value.length > 0 : record(value) ? Object.keys(value).length > 0 : Boolean(value);
var list = (value) => Array.isArray(value) ? value.map(entry).filter((item) => item !== null) : [];
function hostOf(raw) {
	const host = record(raw) ? raw : {};
	const origins = host.networkOrigins === void 0 ? [] : host.networkOrigins;
	if (!Array.isArray(origins) || !origins.every((origin) => typeof origin === "string" && ORIGIN.test(origin))) return null;
	return {
		networkOrigins: origins,
		processes: list(host.processes),
		commands: list(host.commands),
		files: declared(host.files),
		mcp: declared(host.mcp),
		agentHooks: declared(host.agentHooks)
	};
}
var tierOf = (host) => host.processes?.length || host.commands?.length || host.files || host.mcp || host.agentHooks ? "high" : host.networkOrigins?.length ? "medium" : "low";
/** Folders, `""` for the root, that hold a built plugin. */
function pluginFolders(files) {
	const paths = new Set(files.map((file) => file.path));
	return files.filter((file) => (file.path === "manifest.json" || file.path.endsWith("/manifest.json")) && (file.size ?? 0) <= MAX_MANIFEST_BYTES).map((file) => file.path.slice(0, -13).replace(/\/$/, "")).filter((folder, index, all) => all.indexOf(folder) === index).filter((folder) => folder === "" || safePath(folder)).filter((folder) => !folder.split("/").includes("node_modules") && paths.has(folder ? `${folder}/plugin.js` : "plugin.js")).sort().slice(0, MAX_PLUGINS_PER_REPOSITORY);
}
function communityListing(input) {
	if (!ORIGIN.test(input.origin) || !OWNER.test(input.owner) || !DTAG.test(input.dtag) || !COMMIT.test(input.commit)) return null;
	if (!safeBranch(input.branch) || input.folder && !safePath(input.folder) || input.manifest.length > MAX_MANIFEST_BYTES) return null;
	let raw;
	try {
		raw = JSON.parse(input.manifest);
	} catch {
		return null;
	}
	if (!record(raw) || typeof raw.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(raw.id)) return null;
	const discovery = record(raw.discovery) ? raw.discovery : {};
	const host = hostOf(raw.host);
	if (!host) return null;
	const repository = `${input.origin}/git/${input.owner}/${input.dtag}`;
	return {
		key: `${repository.replace(/^https:\/\//, "")}${input.folder ? `/${input.folder}` : ""}`,
		slug: `shared-${input.owner.slice(0, 16)}-${`${input.dtag}${input.folder ? `--${input.folder}` : ""}`.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 120),
		id: raw.id,
		name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : raw.id,
		tagline: typeof raw.description === "string" ? raw.description.trim().slice(0, 100) : "",
		...input.readme ? { description: input.readme.slice(0, 4e3) } : {},
		category: typeof discovery.category === "string" && Object.hasOwn(categories, discovery.category) ? discovery.category : "productivity",
		tags: Array.isArray(discovery.tags) ? discovery.tags.filter((item) => typeof item === "string" && item.length > 0).slice(0, 8) : [],
		author: {
			member: input.member,
			npub: npub(input.owner)
		},
		official: false,
		source: {
			repository,
			ref: input.branch,
			commit: input.commit,
			...input.folder ? { path: input.folder } : {}
		},
		host,
		audit: {
			tier: tierOf(host),
			flags: [],
			cleared: false
		},
		updatedAt: (/* @__PURE__ */ new Date(input.updatedAt * 1e3)).toISOString()
	};
}
/** Built plugins in the repositories this person can read here; empty when this Buzz can't read them. */
async function loadCommunity(ctx, signal) {
	const { status, origin: community, viewer, session } = relayOf(ctx)?.snapshot() ?? { status: "disconnected" };
	const git = session?.projectGit;
	const origin = community ? gitOrigin(community) : null;
	if (status !== "ready" || !origin || !session || !git) return [];
	const [announced, states] = await Promise.all([ANNOUNCEMENT, STATE].map((kind) => session.read([{
		kinds: [kind],
		limit: 200
	}])));
	const newest = /* @__PURE__ */ new Map();
	for (const event of [...announced, ...states]) {
		const dtag = tag(event, "d");
		if (event.kind !== ANNOUNCEMENT && event.kind !== STATE || !OWNER.test(event.pubkey) || !dtag || !DTAG.test(dtag)) continue;
		const id = `${event.kind}:${event.pubkey}:${dtag}`;
		if ((newest.get(id)?.created_at ?? -1) < event.created_at) newest.set(id, event);
	}
	const perOwner = /* @__PURE__ */ new Map();
	const repositories = [...newest.values()].filter((event) => event.kind === ANNOUNCEMENT).sort((a, b) => Number(b.pubkey === viewer) - Number(a.pubkey === viewer) || b.created_at - a.created_at).filter((event) => {
		const count = perOwner.get(event.pubkey) ?? 0;
		perOwner.set(event.pubkey, count + 1);
		return count < MAX_REPOSITORIES_PER_OWNER;
	}).slice(0, MAX_REPOSITORIES);
	const profiles = session.profiles?.snapshot();
	const found = await pooled(repositories, CONCURRENT_READS, async (event) => {
		const owner = event.pubkey;
		const dtag = tag(event, "d");
		const state = newest.get(`${STATE}:${owner}:${dtag}`);
		const branch = state && tag(state, "HEAD")?.match(/^ref: refs\/heads\/(.+)$/)?.[1] || "main";
		const listings = [];
		try {
			const tree = await git.read({
				owner,
				dtag
			}, signal);
			const commit = tree.head;
			if (!commit) return [];
			for (const folder of pluginFolders(tree.files)) {
				const path = folder ? `${folder}/manifest.json` : "manifest.json";
				const manifest = (await git.read({
					owner,
					dtag,
					commit,
					path
				}, signal)).file?.content;
				if (!manifest) continue;
				listings.push(communityListing({
					origin,
					owner,
					dtag,
					folder,
					branch,
					commit,
					manifest,
					readme: folder ? null : tree.readme,
					member: owner === viewer ? "you" : profiles?.get(owner)?.name || "Unnamed member",
					updatedAt: (state ?? event).created_at
				}));
			}
		} catch {}
		return listings;
	});
	const slugs = /* @__PURE__ */ new Set();
	return found.flat().filter((listing) => {
		if (!listing || slugs.has(listing.slug)) return false;
		slugs.add(listing.slug);
		return true;
	});
}
// src/markdown.tsx
var INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\))/g;
var BULLET = /^\s*[-*] /;
var NUMBERED = /^\s*\d+[.)] /;
var HEADING = /^(#{1,6}) +(.*)$/;
var FENCE = /^\s*```/;
function createMarkdown(React) {
	const inline = (text) => text.split(INLINE).map((part, index) => {
		if (part.startsWith("**") && part.endsWith("**")) return /* @__PURE__ */ React.createElement("strong", { key: index }, part.slice(2, -2));
		if (part.startsWith("`") && part.endsWith("`")) return /* @__PURE__ */ React.createElement("code", { key: index }, part.slice(1, -1));
		const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(part);
		if (link) return /* @__PURE__ */ React.createElement("a", {
			key: index,
			href: link[2],
			target: "_blank",
			rel: "noreferrer"
		}, link[1]);
		return part;
	});
	const items = (lines, marker) => {
		const out = [];
		for (const line of lines) if (marker.test(line)) out.push(line.replace(marker, ""));
		else out[out.length - 1] += ` ${line.trim()}`;
		return out;
	};
	return function Markdown({ text, inline: isInline }) {
		if (isInline) return /* @__PURE__ */ React.createElement(React.Fragment, null, inline(text));
		const lines = text.trim().split("\n");
		const blocks = [];
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			if (!line.trim()) {
				i++;
				continue;
			}
			if (FENCE.test(line)) {
				const code = [];
				for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
				i++;
				blocks.push(/* @__PURE__ */ React.createElement("pre", { key: blocks.length }, /* @__PURE__ */ React.createElement("code", null, code.join("\n"))));
				continue;
			}
			const heading = HEADING.exec(line);
			if (heading) {
				i++;
				blocks.push(/* @__PURE__ */ React.createElement("h4", { key: blocks.length }, inline(heading[2])));
				continue;
			}
			const marker = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
			const run = [];
			while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i])) run.push(lines[i++]);
			if (marker) {
				const List = marker === BULLET ? "ul" : "ol";
				blocks.push(/* @__PURE__ */ React.createElement(List, { key: blocks.length }, items(run, marker).map((item, key) => /* @__PURE__ */ React.createElement("li", { key }, inline(item)))));
			} else blocks.push(/* @__PURE__ */ React.createElement("p", { key: blocks.length }, inline(run.join(" "))));
		}
		return /* @__PURE__ */ React.createElement(React.Fragment, null, blocks);
	};
}
// src/submit.ts
var NAME = /^[A-Za-z0-9_.-]{1,100}$/;
var SEGMENT = /^[A-Za-z0-9._-]+$/;
var REF = /^[A-Za-z0-9_][A-Za-z0-9_./+-]{0,199}$/;
var PLUGIN_ID$1 = /^[a-z][a-z0-9.-]{0,79}$/;
var validName = (value) => NAME.test(value) && value !== "." && value !== "..";
var validPath = (segments) => segments.every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..");
var validRef = (ref) => REF.test(ref) && !ref.includes("..") && !ref.endsWith("/") && !ref.endsWith(".lock");
function parseSourceInput(text, refText = "") {
	let rest = text.trim().replace(/^https:\/\/github\.com\//, "").replace(/^github\.com\//, "").replace(/\/+$/, "");
	let ref = refText.trim() || void 0;
	const [owner, rawRepo, ...tail] = rest.split("/").filter((segment) => segment !== "");
	if (!owner || !rawRepo) return null;
	const repo = rawRepo.replace(/\.git$/, "");
	if (!validName(owner) || !validName(repo)) return null;
	let path = tail;
	if (tail[0] === "tree" && tail[1]) {
		ref ??= tail[1];
		path = tail.slice(2);
	}
	if (!validPath(path)) return null;
	if (ref !== void 0 && !validRef(ref)) return null;
	rest = path.join("/");
	return ref === void 0 ? {
		owner,
		repo,
		path: rest
	} : {
		owner,
		repo,
		ref,
		path: rest
	};
}
var describeSource = (source) => source.path ? `${source.owner}/${source.repo}/${source.path}` : `${source.owner}/${source.repo}`;
var where = (path) => path ? `the ${path} folder` : "the repository root";
async function get(host, url, method = "GET") {
	return host.request({
		url,
		method,
		headers: { accept: "application/vnd.github+json, application/json, text/plain, */*" },
		timeoutMs: 1e4
	});
}
async function checkSource(host, input) {
	const label = `${input.owner}/${input.repo}`;
	try {
		const repo = await get(host, `https://api.github.com/repos/${input.owner}/${input.repo}`);
		if (repo.status === 404) return {
			ok: false,
			message: `GitHub can't find ${label}. Check the name, and that the repository is public.`
		};
		if (repo.status !== 200) return {
			ok: false,
			message: `GitHub didn't answer (HTTP ${repo.status}). Try again in a few minutes.`
		};
		const info = JSON.parse(repo.body);
		if (info.private !== false) return {
			ok: false,
			message: `${label} is private. Only public repositories can be listed.`
		};
		const ref = input.ref ?? (typeof info.default_branch === "string" ? info.default_branch : "main");
		const base = `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${ref}${input.path ? `/${input.path}` : ""}`;
		const manifestRes = await get(host, `${base}/manifest.json`);
		if (manifestRes.status === 404) return {
			ok: false,
			message: `There's no manifest.json in ${where(input.path)} on ${ref}. Commit the built manifest.json and plugin.js there.`
		};
		if (manifestRes.status !== 200) return {
			ok: false,
			message: `GitHub didn't return manifest.json (HTTP ${manifestRes.status}). Try again in a few minutes.`
		};
		let manifest;
		try {
			manifest = JSON.parse(manifestRes.body);
		} catch {
			return {
				ok: false,
				message: "manifest.json isn't valid JSON."
			};
		}
		if (typeof manifest !== "object" || manifest === null) return {
			ok: false,
			message: "manifest.json isn't a JSON object."
		};
		if (typeof manifest.id !== "string" || !PLUGIN_ID$1.test(manifest.id)) return {
			ok: false,
			message: "manifest.json needs an id made of lowercase letters, digits, dots and dashes, such as com.example.notes."
		};
		if (typeof manifest.name !== "string" || !manifest.name.trim()) return {
			ok: false,
			message: "manifest.json needs a name."
		};
		const plugin = await get(host, `${base}/plugin.js`, "HEAD");
		if (plugin.status === 404) return {
			ok: false,
			message: `There's no plugin.js next to manifest.json on ${ref}. Commit the built plugin, not only its source.`
		};
		if (plugin.status !== 200) return {
			ok: false,
			message: `GitHub didn't return plugin.js (HTTP ${plugin.status}). Try again in a few minutes.`
		};
		return {
			ok: true,
			source: {
				owner: input.owner,
				repo: input.repo,
				ref,
				path: input.path,
				id: manifest.id,
				name: manifest.name.trim(),
				description: typeof manifest.description === "string" ? manifest.description : ""
			}
		};
	} catch {
		return {
			ok: false,
			message: "Couldn't reach GitHub. Check your connection and try again."
		};
	}
}
var sourceLine = (source) => `https://github.com/${source.owner}/${source.repo} ${source.ref}${source.path ? ` ${source.path}` : ""}`;
var sourceKey = (source) => `github.com/${source.owner}/${source.repo}${source.path ? `/${source.path}` : ""}`;
function listingLinks(source, repository = LISTING_REPOSITORY) {
	const issue = new URLSearchParams({
		template: "list-plugin.yml",
		title: `List: ${source.name}`,
		source: sourceLine(source)
	});
	return {
		pullRequest: `https://github.com/${repository}/edit/main/sources.txt`,
		issue: `https://github.com/${repository}/issues/new?${issue}`
	};
}
// src/view.tsx
var PLUGIN_ID = "xyz.block.community-marketplace";
var PAGE_ID = "marketplace";
var VERIFIED_LABEL = "Verified plugin: Buzz reviewed this version";
var VerifiedMark = (React) => () => /* @__PURE__ */ React.createElement("svg", {
	className: "bm-verified",
	width: "16",
	height: "16",
	viewBox: "0 0 24 24",
	role: "img",
	"aria-label": VERIFIED_LABEL
}, /* @__PURE__ */ React.createElement("title", null, VERIFIED_LABEL), /* @__PURE__ */ React.createElement("path", {
	fill: "currentColor",
	d: "M12 1.5 14.6 4l3.5-.5.9 3.4 3.2 1.6-1.3 3.3 1.3 3.3-3.2 1.6-.9 3.4-3.5-.5L12 22.1 9.4 19.6l-3.5.5-.9-3.4-3.2-1.6 1.3-3.3-1.3-3.3L5 6.9l.9-3.4 3.5.5z"
}), /* @__PURE__ */ React.createElement("path", {
	fill: "none",
	stroke: "var(--bg-app, #fff)",
	strokeWidth: "2.2",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	d: "m8 12.2 2.7 2.7L16 9.4"
}));
var SearchIcon = (React) => () => /* @__PURE__ */ React.createElement("svg", {
	width: "16",
	height: "16",
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: "2",
	"aria-hidden": "true"
}, /* @__PURE__ */ React.createElement("circle", {
	cx: "11",
	cy: "11",
	r: "7"
}), /* @__PURE__ */ React.createElement("path", { d: "m20 20-3.5-3.5" }));
var https = (url) => url?.startsWith("https://") ? url : void 0;
var listingLink = (slug) => `buzz://plugin?id=${PLUGIN_ID}&page=${PAGE_ID}&route.slug=${encodeURIComponent(slug)}`;
var day = (iso) => new Date(iso).toLocaleDateString("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC"
});
var starLabel = (count) => `${count.toLocaleString("en-US")} ${count === 1 ? "star" : "stars"} on GitHub`;
var trustLabel = (listing) => shared(listing) ? "Shared here · not reviewed" : listing.official ? "Official" : listing.verified ? "Verified by Buzz" : "Community · not reviewed";
var cardTrustLabel = (listing) => shared(listing) ? "Shared here" : listing.official ? "Official" : listing.verified ? null : "Unreviewed";
var trustTone = (listing) => listing.official ? "default" : listing.verified ? "active" : void 0;
var tierTone = {
	low: "active",
	medium: void 0,
	high: "warn"
};
function slugFromTarget(target) {
	const params = target?.route?.params;
	return typeof params?.slug === "string" ? params.slug : null;
}
function createViews(ctx, capability) {
	const React = ctx.react;
	const { useEffect, useMemo, useState, useSyncExternalStore } = React;
	const Markdown = createMarkdown(React);
	const Search = SearchIcon(React);
	const Verified = VerifiedMark(React);
	const listeners = /* @__PURE__ */ new Set();
	let active = activePluginIds(ctx);
	const refreshActive = () => {
		active = activePluginIds(ctx);
		for (const listener of listeners) listener();
	};
	ctx.effect(() => ctx.pages.subscribe(refreshActive));
	const panels = ctx.panels;
	if (panels?.subscribe) ctx.effect(() => panels.subscribe(refreshActive));
	const subscribe = (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	const installedState = () => active;
	const phases = /* @__PURE__ */ new Map();
	const phaseListeners = /* @__PURE__ */ new Set();
	const setPhase = (slug, phase) => {
		phases.set(slug, phase);
		for (const listener of phaseListeners) listener();
	};
	const subscribePhase = (listener) => {
		phaseListeners.add(listener);
		return () => phaseListeners.delete(listener);
	};
	const usePhase = (slug) => useSyncExternalStore(subscribePhase, () => phases.get(slug));
	const startInstall = async (listing) => {
		if (!capability || phases.get(listing.slug) === "review") return;
		setPhase(listing.slug, "review");
		try {
			const result = await capability.requestInstall(sourceOf(listing));
			setPhase(listing.slug, result);
		} catch {
			setPhase(listing.slug, "failed");
		}
	};
	const useInstalled = (listing) => {
		return useSyncExternalStore(subscribe, installedState).has(listing.id);
	};
	const readStatus = (id) => {
		try {
			return capability?.getInstallationStatus?.(id) ?? "unavailable";
		} catch {
			return "unavailable";
		}
	};
	const noSubscription = () => () => {};
	const relay = relayOf(ctx);
	const useInstallationStatus = (listing) => {
		const subscribeStatus = React.useCallback((listener) => {
			try {
				return capability?.subscribeInstallationStatus?.(listing.id, () => listener()) ?? noSubscription();
			} catch {
				return noSubscription();
			}
		}, [listing.id]);
		const status = useSyncExternalStore(capability?.getInstallationStatus ? subscribeStatus : noSubscription, () => readStatus(listing.id));
		const active = useInstalled(listing);
		if (capability?.getInstallationStatus) return status;
		return active ? "installed" : "absent";
	};
	const open = (slug) => ctx.navigation.open({
		version: 1,
		kind: "page",
		pluginId: PLUGIN_ID,
		pageId: PAGE_ID,
		...slug ? { route: {
			version: 1,
			params: { slug }
		} } : {}
	});
	function Art({ listing }) {
		const src = https((listing.demo?.poster ?? listing.demo?.screenshots?.[0])?.url);
		const [failed, setFailed] = useState(false);
		if (src && !failed) return /* @__PURE__ */ React.createElement("img", {
			src,
			alt: "",
			loading: "lazy",
			onError: () => setFailed(true)
		});
		const initials = listing.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2);
		return /* @__PURE__ */ React.createElement("div", {
			className: "bm-art",
			style: { background: `var(--art-plugin-${listing.category}-gradient, var(--surface-inverse))` }
		}, /* @__PURE__ */ React.createElement("span", null, initials));
	}
	function AddedBadge({ listing }) {
		return useInstallationStatus(listing) === "installed" ? /* @__PURE__ */ React.createElement("span", {
			className: "bm-badge",
			"data-tone": "active"
		}, "Added") : null;
	}
	function TrustBadge({ listing, compact }) {
		if (compact && cardTrustLabel(listing) === null) return null;
		return /* @__PURE__ */ React.createElement("span", {
			className: "bm-badge",
			"data-tone": trustTone(listing),
			title: compact ? trustLabel(listing) : void 0
		}, compact ? cardTrustLabel(listing) : trustLabel(listing));
	}
	const openOnKey = (event, slug) => {
		if (event.target !== event.currentTarget || event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		open(slug);
	};
	function AddButton({ listing, onManual, size, here }) {
		const installed = useInstallationStatus(listing) === "installed";
		const reviewing = usePhase(listing.slug) === "review";
		const add = (event) => {
			event.stopPropagation();
			if (!capability) return onManual();
			if (!here) open(listing.slug);
			startInstall(listing);
		};
		if (installed && !capability) return size ? null : /* @__PURE__ */ React.createElement("button", {
			className: "bm-button",
			"data-variant": "quiet",
			onClick: add
		}, "How to update");
		return /* @__PURE__ */ React.createElement("button", {
			className: "bm-button",
			"data-size": size,
			disabled: reviewing,
			onClick: add
		}, reviewing ? "Reviewing in Buzz…" : installed ? "Reinstall" : "Add to Buzz");
	}
	function Step({ state, title, children }) {
		return /* @__PURE__ */ React.createElement("li", {
			className: "bm-step",
			"data-state": state
		}, /* @__PURE__ */ React.createElement("span", {
			className: "bm-step-mark",
			"aria-hidden": "true"
		}, state === "done" ? "✓" : state === "failed" ? "!" : null), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "bm-step-title" }, title), children ? /* @__PURE__ */ React.createElement("div", { className: "bm-step-detail" }, children) : null));
	}
	function SetupSteps({ listing, state }) {
		return /* @__PURE__ */ React.createElement(React.Fragment, null, (listing.setup ?? []).map((step) => /* @__PURE__ */ React.createElement(Step, {
			key: step.title,
			state,
			title: step.title
		}, step.detail ? /* @__PURE__ */ React.createElement(Markdown, {
			text: step.detail,
			inline: true
		}) : null, step.command ? /* @__PURE__ */ React.createElement(Copy, { value: step.command }) : null)));
	}
	const failures = {
		cancelled: "The review closed before anything was installed. Nothing changed.",
		unavailable: "Buzz couldn't open its install review. Close any other plugin review in Settings, wait a moment, then try again.",
		failed: "Buzz couldn't use this listing's source. Check its repository, or add it from Settings."
	};
	function Progress({ listing }) {
		const phase = usePhase(listing.slug);
		if (!phase) return null;
		const done = phase === "installed" || phase === "updated";
		const failure = failures[phase];
		const title = done ? phase === "updated" ? "Updated" : "Added to Buzz" : failure ? "Not added" : `Adding ${listing.name}`;
		return /* @__PURE__ */ React.createElement("div", {
			className: "bm-aside-card",
			role: "status",
			"aria-live": "polite",
			"aria-label": title
		}, /* @__PURE__ */ React.createElement("h3", null, title), /* @__PURE__ */ React.createElement("ol", { className: "bm-steps" }, /* @__PURE__ */ React.createElement(Step, {
			state: phase === "review" ? "active" : failure ? "failed" : "done",
			title: "Review in Buzz"
		}, phase === "review" ? "Buzz opened its install review. Check the source, the commit and what it can access, then choose Install plugin." : failure), /* @__PURE__ */ React.createElement(Step, {
			state: done ? "done" : "todo",
			title: phase === "updated" ? "Update" : "Install"
		}, done ? `${listing.name} is ${phase === "updated" ? "updated" : "installed"} and turned on.` : null), /* @__PURE__ */ React.createElement(SetupSteps, {
			listing,
			state: done ? "next" : "todo"
		}), /* @__PURE__ */ React.createElement(Step, {
			state: done && !listing.setup?.length ? "done" : "todo",
			title: "Ready to use"
		}, done ? listing.setup?.length ? "Once the steps above are done." : "Nothing else to set up." : null)), failure ? /* @__PURE__ */ React.createElement("div", { className: "bm-actions" }, /* @__PURE__ */ React.createElement("button", {
			className: "bm-button",
			"data-size": "sm",
			onClick: () => void startInstall(listing)
		}, "Try again")) : done ? /* @__PURE__ */ React.createElement("div", { className: "bm-actions" }, /* @__PURE__ */ React.createElement("button", {
			className: "bm-button",
			"data-variant": "quiet",
			"data-size": "sm",
			onClick: () => void ctx.navigation.open({
				version: 1,
				kind: "settings",
				section: "plugins"
			})
		}, "Manage in Settings")) : null);
	}
	function Copy({ value }) {
		const [copied, setCopied] = useState(false);
		return /* @__PURE__ */ React.createElement("div", { className: "bm-copy" }, /* @__PURE__ */ React.createElement("code", { title: value }, value), /* @__PURE__ */ React.createElement("button", {
			className: "bm-button",
			"data-variant": "quiet",
			"data-size": "sm",
			onClick: () => {
				navigator.clipboard?.writeText(value).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				});
			}
		}, copied ? "Copied" : "Copy"));
	}
	function CopyLink({ slug }) {
		const [copied, setCopied] = useState(false);
		return /* @__PURE__ */ React.createElement("button", {
			className: "bm-link-button",
			onClick: () => {
				navigator.clipboard?.writeText(listingLink(slug)).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				});
			}
		}, copied ? "Link copied" : "Copy link to this plugin");
	}
	function Dialog({ label, onClose, children }) {
		const dialog = React.useRef(null);
		const close = React.useRef(onClose);
		close.current = onClose;
		useEffect(() => {
			const trigger = document.activeElement;
			dialog.current?.focus();
			const onKey = (event) => {
				if (event.key === "Escape") return close.current();
				if (event.key !== "Tab" || !dialog.current) return;
				const focusable = [...dialog.current.querySelectorAll("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
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
		return /* @__PURE__ */ React.createElement("div", {
			className: "bm-dialog-backdrop",
			onClick: onClose
		}, /* @__PURE__ */ React.createElement("div", {
			ref: dialog,
			tabIndex: -1,
			className: "bm-dialog",
			role: "dialog",
			"aria-modal": "true",
			"aria-label": label,
			onClick: (event) => event.stopPropagation()
		}, children));
	}
	function ManualInstall({ listing, onClose }) {
		return /* @__PURE__ */ React.createElement(Dialog, {
			label: `Add ${listing.name}`,
			onClose
		}, /* @__PURE__ */ React.createElement("h2", null, "Add ", listing.name), /* @__PURE__ */ React.createElement("ol", null, /* @__PURE__ */ React.createElement("li", null, "Open ", /* @__PURE__ */ React.createElement("strong", null, "Settings → Plugins → Manage plugins"), " and choose ", /* @__PURE__ */ React.createElement("strong", null, "Git repository"), "."), /* @__PURE__ */ React.createElement("li", null, "Paste the repository and branch:", /* @__PURE__ */ React.createElement(Copy, { value: listing.source.repository }), /* @__PURE__ */ React.createElement(Copy, { value: listing.source.ref })), /* @__PURE__ */ React.createElement("li", null, "Before installing, check that Buzz shows the indexed commit:", /* @__PURE__ */ React.createElement(Copy, { value: listing.source.commit })), /* @__PURE__ */ React.createElement("li", null, listing.source.path ? /* @__PURE__ */ React.createElement(React.Fragment, null, "Pick the ", /* @__PURE__ */ React.createElement("code", null, listing.source.path), " folder, review") : "Review", " ", "what it can access, then install.")), /* @__PURE__ */ React.createElement("p", { className: "bm-note" }, "This Buzz can't install plugins for you yet, so these are the manual steps."), /* @__PURE__ */ React.createElement("div", { className: "bm-actions" }, /* @__PURE__ */ React.createElement("button", {
			className: "bm-button",
			"data-variant": "quiet",
			onClick: onClose
		}, "Close"), /* @__PURE__ */ React.createElement("button", {
			className: "bm-button",
			onClick: () => {
				ctx.navigation.open({
					version: 1,
					kind: "settings",
					section: "plugins"
				});
				onClose();
			}
		}, "Open plugin settings")));
	}
	function AddPlugin({ index, canShare, onClose }) {
		const [everyone, setEveryone] = useState(!canShare);
		const [repository, setRepository] = useState("");
		const [ref, setRef] = useState("");
		const [state, setState] = useState({ step: "idle" });
		const busy = state.step === "checking";
		const run = async () => {
			const input = parseSourceInput(repository, ref);
			if (!input) return setState({ step: "invalid" });
			setState({ step: "checking" });
			const checked = await checkSource(ctx.host, input);
			if (!checked.ok) return setState({
				step: "rejected",
				message: checked.message
			});
			const key = sourceKey(checked.source).toLowerCase();
			const listed = index.plugins.find((plugin) => plugin.key.toLowerCase() === key);
			setState({
				step: "ready",
				source: checked.source,
				listed
			});
		};
		const found = state.step === "ready" ? state.source : null;
		const links = found ? listingLinks(found) : null;
		return /* @__PURE__ */ React.createElement(Dialog, {
			label: "Add your plugin",
			onClose
		}, /* @__PURE__ */ React.createElement("h2", null, "Add your plugin"), canShare ? /* @__PURE__ */ React.createElement("div", {
			className: "bm-chips",
			role: "group",
			"aria-label": "Who gets it"
		}, /* @__PURE__ */ React.createElement("button", {
			className: "bm-chip",
			"aria-pressed": !everyone,
			onClick: () => setEveryone(false)
		}, "This community"), /* @__PURE__ */ React.createElement("button", {
			className: "bm-chip",
			"aria-pressed": everyone,
			onClick: () => setEveryone(true)
		}, "Everyone")) : null, everyone ? publicListing() : communityShare());
		function communityShare() {
			return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "bm-dialog-lede" }, "Push a plugin you run in Buzz to a git repository in one of this community's channels. It then shows under From this community, to the people in that channel."), /* @__PURE__ */ React.createElement("p", { className: "bm-dialog-lede" }, "The repository needs the built ", /* @__PURE__ */ React.createElement("code", null, "manifest.json"), " and ", /* @__PURE__ */ React.createElement("code", null, "plugin.js"), ", at its root or in a folder. Your agent can do it for you. Ask it in the channel:"), /* @__PURE__ */ React.createElement(Copy, { value: SHARE_PROMPT }), /* @__PURE__ */ React.createElement("div", { className: "bm-actions" }, /* @__PURE__ */ React.createElement("button", {
				type: "button",
				className: "bm-button",
				onClick: onClose
			}, "Done")));
		}
		function publicListing() {
			return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "bm-dialog-lede" }, "List a Buzz plugin whose source is in a public GitHub repository. It needs:"), /* @__PURE__ */ React.createElement("ul", { className: "bm-requirements" }, /* @__PURE__ */ React.createElement("li", null, "A built ", /* @__PURE__ */ React.createElement("code", null, "manifest.json"), " and ", /* @__PURE__ */ React.createElement("code", null, "plugin.js"), " committed on a branch or tag, at the repository root or in a folder."), /* @__PURE__ */ React.createElement("li", null, "Optionally, a ", /* @__PURE__ */ React.createElement("code", null, "buzz-listing.yaml"), " next to them with a tagline, description, category, tags and screenshots.")), /* @__PURE__ */ React.createElement("form", {
				className: "bm-form",
				onSubmit: (event) => {
					event.preventDefault();
					if (!busy) run();
				}
			}, /* @__PURE__ */ React.createElement("label", { className: "bm-field" }, /* @__PURE__ */ React.createElement("span", null, "Repository"), /* @__PURE__ */ React.createElement("input", {
				value: repository,
				placeholder: "owner/repo or owner/repo/path/to/plugin",
				spellCheck: false,
				autoCapitalize: "off",
				autoComplete: "off",
				onChange: (event) => setRepository(event.target.value)
			})), /* @__PURE__ */ React.createElement("label", { className: "bm-field" }, /* @__PURE__ */ React.createElement("span", null, "Branch or tag (optional)"), /* @__PURE__ */ React.createElement("input", {
				value: ref,
				placeholder: "Default branch",
				spellCheck: false,
				autoCapitalize: "off",
				autoComplete: "off",
				onChange: (event) => setRef(event.target.value)
			})), /* @__PURE__ */ React.createElement("div", {
				className: "bm-check",
				role: "status",
				"aria-live": "polite"
			}, state.step === "invalid" ? /* @__PURE__ */ React.createElement("p", { className: "bm-check-error" }, "Enter a GitHub repository as owner/repo, owner/repo/folder or a github.com link.") : state.step === "checking" ? /* @__PURE__ */ React.createElement("p", null, "Checking that the repository is public and has a built plugin…") : state.step === "rejected" ? /* @__PURE__ */ React.createElement("p", { className: "bm-check-error" }, state.message) : null, found ? /* @__PURE__ */ React.createElement("div", { className: "bm-check-found" }, /* @__PURE__ */ React.createElement("strong", null, found.name), /* @__PURE__ */ React.createElement("span", { className: "bm-note" }, found.id, " · ", describeSource(found), " @ ", found.ref), found.description ? /* @__PURE__ */ React.createElement("span", { className: "bm-check-description" }, found.description) : null) : null, state.step === "ready" && state.listed ? /* @__PURE__ */ React.createElement("p", { className: "bm-check-success" }, state.listed.name, " is already listed.") : found ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "bm-check-success" }, "It can be listed. Add this line to ", /* @__PURE__ */ React.createElement("code", null, "sources.txt"), " in a pull request, or ask for it in an issue:"), /* @__PURE__ */ React.createElement(Copy, { value: sourceLine(found) })) : null), /* @__PURE__ */ React.createElement("p", { className: "bm-note" }, "Listings are unreviewed community content. Buzz still shows what a plugin can access, and the exact commit, before anyone installs it."), /* @__PURE__ */ React.createElement("div", { className: "bm-actions" }, /* @__PURE__ */ React.createElement("button", {
				type: "button",
				className: "bm-button",
				"data-variant": "quiet",
				onClick: onClose
			}, found ? "Done" : "Cancel"), state.step === "ready" && state.listed ? /* @__PURE__ */ React.createElement("button", {
				type: "button",
				className: "bm-button",
				onClick: () => {
					open(state.listed.slug);
					onClose();
				}
			}, "View listing") : links ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("a", {
				className: "bm-button",
				"data-variant": "quiet",
				href: links.issue,
				target: "_blank",
				rel: "noreferrer"
			}, "Request in an issue"), /* @__PURE__ */ React.createElement("a", {
				className: "bm-button",
				href: links.pullRequest,
				target: "_blank",
				rel: "noreferrer"
			}, "Open a pull request")) : /* @__PURE__ */ React.createElement("button", {
				type: "submit",
				className: "bm-button",
				disabled: busy || !repository.trim()
			}, busy ? "Checking…" : "Check"))));
		}
	}
	function Card({ listing, onManual }) {
		return /* @__PURE__ */ React.createElement("div", {
			className: "bm-card",
			role: "button",
			tabIndex: 0,
			onClick: () => open(listing.slug),
			onKeyDown: (e) => openOnKey(e, listing.slug)
		}, /* @__PURE__ */ React.createElement("div", { className: "bm-media" }, /* @__PURE__ */ React.createElement(Art, { listing })), /* @__PURE__ */ React.createElement("div", { className: "bm-card-body" }, /* @__PURE__ */ React.createElement("div", { className: "bm-card-row" }, /* @__PURE__ */ React.createElement("span", { className: "bm-card-title" }, /* @__PURE__ */ React.createElement("span", { className: "bm-card-name" }, listing.name), listing.verified ? /* @__PURE__ */ React.createElement(Verified, null) : null), /* @__PURE__ */ React.createElement(AddedBadge, { listing })), /* @__PURE__ */ React.createElement("span", { className: "bm-card-tagline" }, listing.tagline), /* @__PURE__ */ React.createElement("div", { className: "bm-card-row" }, /* @__PURE__ */ React.createElement("span", { className: "bm-card-installs" }, listing.updatedAt ? `Updated ${day(listing.updatedAt)}` : "\xA0"), listing.stars ? /* @__PURE__ */ React.createElement("span", {
			className: "bm-card-stars",
			title: starLabel(listing.stars),
			"aria-label": starLabel(listing.stars)
		}, "★ ", listing.stars.toLocaleString("en-US")) : null), /* @__PURE__ */ React.createElement("div", { className: "bm-card-row bm-card-meta" }, /* @__PURE__ */ React.createElement("span", { className: "bm-card-author" }, "by ", authorName(listing), authorKey(listing) ? /* @__PURE__ */ React.createElement(React.Fragment, null, " ", /* @__PURE__ */ React.createElement("code", {
			className: "bm-key",
			title: authorKey(listing)
		}, shortKey(authorKey(listing)))) : null), /* @__PURE__ */ React.createElement(TrustBadge, {
			listing,
			compact: true
		})), /* @__PURE__ */ React.createElement("div", { className: "bm-card-row bm-card-meta bm-card-footer" }, /* @__PURE__ */ React.createElement("span", { className: "bm-card-author" }, categories[listing.category]), /* @__PURE__ */ React.createElement(AddButton, {
			listing,
			size: "sm",
			onManual: () => onManual(listing)
		}))));
	}
	function Browse({ index, community, onManual, onAdd }) {
		const [query, setQuery] = useState("");
		const [category, setCategory] = useState(null);
		const [sort, setSort] = useState("updated");
		const visible = useMemo(() => search(sorted(index, sort), query, category), [
			index,
			sort,
			query,
			category
		]);
		const here = useMemo(() => search(sorted({ plugins: community }, sort), query, category), [
			community,
			sort,
			query,
			category
		]);
		const present = Object.keys(categories).filter((slug) => [...index.plugins, ...community].some((plugin) => plugin.category === slug));
		const heading = query || category ? `${visible.length} ${visible.length === 1 ? "plugin" : "plugins"}` : sorts.find((entry) => entry.id === sort)?.label;
		return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("header", { className: "bm-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", { className: "bm-title" }, "Community Marketplace"), /* @__PURE__ */ React.createElement("p", { className: "bm-subtitle" }, "Open plugins from public Git repositories.")), /* @__PURE__ */ React.createElement("button", {
			className: "bm-button",
			"data-size": "sm",
			"aria-label": "Add your plugin",
			onClick: onAdd
		}, "Add")), /* @__PURE__ */ React.createElement("div", { className: "bm-toolbar" }, /* @__PURE__ */ React.createElement("div", {
			className: "bm-chips",
			role: "group",
			"aria-label": "Categories"
		}, /* @__PURE__ */ React.createElement("button", {
			className: "bm-chip",
			"aria-pressed": category === null,
			onClick: () => setCategory(null)
		}, "All"), present.map((slug) => /* @__PURE__ */ React.createElement("button", {
			key: slug,
			className: "bm-chip",
			"aria-pressed": category === slug,
			onClick: () => setCategory(slug)
		}, categories[slug]))), /* @__PURE__ */ React.createElement("div", {
			className: "bm-chips bm-sort",
			role: "group",
			"aria-label": "Sort"
		}, sorts.map((entry) => /* @__PURE__ */ React.createElement("button", {
			key: entry.id,
			className: "bm-chip",
			"aria-pressed": sort === entry.id,
			onClick: () => setSort(entry.id)
		}, entry.label)))), /* @__PURE__ */ React.createElement("label", { className: "bm-search" }, /* @__PURE__ */ React.createElement(Search, null), /* @__PURE__ */ React.createElement("input", {
			type: "search",
			placeholder: "Search plugins",
			"aria-label": "Search plugins",
			value: query,
			onChange: (event) => setQuery(event.target.value)
		})), here.length ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", { className: "bm-section-title" }, "From this community"), /* @__PURE__ */ React.createElement("div", { className: "bm-grid" }, here.map((listing) => /* @__PURE__ */ React.createElement(Card, {
			key: listing.slug,
			listing,
			onManual
		})))) : null, /* @__PURE__ */ React.createElement("h2", { className: "bm-section-title" }, heading), visible.length ? /* @__PURE__ */ React.createElement("div", { className: "bm-grid" }, visible.map((listing) => /* @__PURE__ */ React.createElement(Card, {
			key: listing.slug,
			listing,
			onManual
		}))) : /* @__PURE__ */ React.createElement("p", { className: "bm-empty" }, query || category ? "No plugins match." : "Nothing is listed yet."));
	}
	function AuditCard({ listing }) {
		const { audit } = listing;
		return /* @__PURE__ */ React.createElement("div", {
			className: "bm-aside-card",
			"aria-label": "Audit"
		}, /* @__PURE__ */ React.createElement("h3", null, "Audit"), /* @__PURE__ */ React.createElement("div", { className: "bm-card-row" }, /* @__PURE__ */ React.createElement("span", {
			className: "bm-badge",
			"data-tone": tierTone[audit.tier]
		}, tierLabels[audit.tier]), /* @__PURE__ */ React.createElement(TrustBadge, { listing })), shared(listing) ? /* @__PURE__ */ React.createElement("span", { className: "bm-note" }, "Not scanned. Only public listings get the automated scan.") : audit.flags.length ? /* @__PURE__ */ React.createElement("ul", { className: "bm-flags" }, audit.flags.map((flag) => /* @__PURE__ */ React.createElement("li", {
			key: flag.code,
			className: "bm-flag"
		}, /* @__PURE__ */ React.createElement("code", null, flag.code), /* @__PURE__ */ React.createElement("span", null, flag.detail)))) : /* @__PURE__ */ React.createElement("span", { className: "bm-note" }, "No flags from the automated scan."), audit.accessChanged ? /* @__PURE__ */ React.createElement("span", { className: "bm-note bm-warning" }, "What it can access changed since the last index.") : null, !audit.cleared && !shared(listing) ? /* @__PURE__ */ React.createElement("span", { className: "bm-note bm-warning" }, "A maintainer hasn't cleared this version yet.") : null, /* @__PURE__ */ React.createElement("span", { className: "bm-note" }, shared(listing) ? "A member keeps this plugin in a git repository on this community. Only people who can read that repository see it, and nobody has reviewed it." : listing.official ? "Published by Block." : listing.verified ? "A Buzz maintainer reviewed this exact version. A newer version is unreviewed until it is checked again." : "Community plugins are indexed automatically from public repositories. Nobody has reviewed this one."));
	}
	function Detail({ listing, onManual }) {
		const access = accessSummary(listing.host);
		const demo = listing.demo;
		const video = https(demo?.video?.url);
		const phase = usePhase(listing.slug);
		const links = Object.entries(listing.links ?? {}).filter(([, url]) => https(url));
		return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", {
			className: "bm-back",
			onClick: () => open(null)
		}, "← All plugins"), /* @__PURE__ */ React.createElement("div", { className: "bm-detail" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", { className: "bm-detail-name" }, listing.name, listing.verified ? /* @__PURE__ */ React.createElement(Verified, null) : null), listing.tagline ? /* @__PURE__ */ React.createElement("p", { className: "bm-detail-tagline" }, listing.tagline) : null, /* @__PURE__ */ React.createElement("div", { className: "bm-media" }, /* @__PURE__ */ React.createElement(Art, { listing })), listing.description ? /* @__PURE__ */ React.createElement("div", { className: "bm-prose" }, /* @__PURE__ */ React.createElement(Markdown, { text: listing.description })) : null, demo?.screenshots?.length ? /* @__PURE__ */ React.createElement("div", { className: "bm-shots" }, demo.screenshots.filter((shot) => https(shot.url)).map((shot) => /* @__PURE__ */ React.createElement("figure", { key: shot.url }, /* @__PURE__ */ React.createElement("img", {
			src: shot.url,
			alt: shot.caption ?? "",
			loading: "lazy"
		}), shot.caption ? /* @__PURE__ */ React.createElement("figcaption", null, shot.caption) : null))) : null), /* @__PURE__ */ React.createElement("aside", { className: "bm-aside" }, /* @__PURE__ */ React.createElement(AuditCard, { listing }), /* @__PURE__ */ React.createElement("div", { className: "bm-aside-card" }, /* @__PURE__ */ React.createElement("div", { className: "bm-card-row" }, /* @__PURE__ */ React.createElement(AddButton, {
			listing,
			here: true,
			onManual: () => onManual(listing)
		}), /* @__PURE__ */ React.createElement(AddedBadge, { listing })), video ? /* @__PURE__ */ React.createElement("a", {
			href: video,
			target: "_blank",
			rel: "noreferrer"
		}, "Watch the demo video") : null, capability ? /* @__PURE__ */ React.createElement(CopyLink, { slug: listing.slug }) : null), /* @__PURE__ */ React.createElement(Progress, { listing }), listing.setup?.length && !phase ? /* @__PURE__ */ React.createElement("div", { className: "bm-aside-card" }, /* @__PURE__ */ React.createElement("h3", null, "After you add it"), /* @__PURE__ */ React.createElement("ol", { className: "bm-steps" }, /* @__PURE__ */ React.createElement(SetupSteps, {
			listing,
			state: "todo"
		}))) : null, /* @__PURE__ */ React.createElement("div", { className: "bm-aside-card" }, /* @__PURE__ */ React.createElement("h3", null, "Can access"), access.length ? /* @__PURE__ */ React.createElement("ul", null, access.map((line) => /* @__PURE__ */ React.createElement("li", { key: line }, /* @__PURE__ */ React.createElement(Markdown, {
			text: line,
			inline: true
		})))) : /* @__PURE__ */ React.createElement("span", { className: "bm-note" }, "Nothing beyond Buzz itself."), /* @__PURE__ */ React.createElement("span", { className: "bm-note" }, "Buzz shows the exact access for you to approve before it installs anything.")), /* @__PURE__ */ React.createElement("div", { className: "bm-aside-card" }, /* @__PURE__ */ React.createElement("h3", null, "About"), /* @__PURE__ */ React.createElement("dl", { className: "bm-kv" }, /* @__PURE__ */ React.createElement("dt", null, "Author"), /* @__PURE__ */ React.createElement("dd", null, authorName(listing)), authorKey(listing) ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("dt", null, "Key"), /* @__PURE__ */ React.createElement("dd", null, /* @__PURE__ */ React.createElement("code", { className: "bm-key" }, authorKey(listing)))) : null, /* @__PURE__ */ React.createElement("dt", null, "Category"), /* @__PURE__ */ React.createElement("dd", null, categories[listing.category] ?? listing.category), listing.stars ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("dt", null, "Stars"), /* @__PURE__ */ React.createElement("dd", null, listing.stars.toLocaleString("en-US"))) : null, /* @__PURE__ */ React.createElement("dt", null, "Version"), /* @__PURE__ */ React.createElement("dd", null, /* @__PURE__ */ React.createElement("code", null, listing.source.commit.slice(0, 7)), " on ", listing.source.ref), /* @__PURE__ */ React.createElement("dt", null, "Source"), /* @__PURE__ */ React.createElement("dd", null, shared(listing) ? listing.key.split("/").slice(3).join("/") : /* @__PURE__ */ React.createElement("a", {
			href: listing.source.repository,
			target: "_blank",
			rel: "noreferrer"
		}, listing.key.replace(/^github\.com\//, "")))), links.map(([label, url]) => /* @__PURE__ */ React.createElement("a", {
			key: label,
			href: url,
			target: "_blank",
			rel: "noreferrer"
		}, label[0].toUpperCase() + label.slice(1)))))));
	}
	return function MarketplacePage({ navigation }) {
		const [state, setState] = useState(null);
		const [manual, setManual] = useState(null);
		const [adding, setAdding] = useState(false);
		const [community, setCommunity] = useState([]);
		useEffect(() => {
			let current = true;
			loadIndex(ctx.host).then((result) => {
				if (current) setState(result);
			});
			return () => {
				current = false;
			};
		}, []);
		const connected = useSyncExternalStore(relay?.subscribe ?? noSubscription, () => connection(relay));
		useEffect(() => {
			setCommunity([]);
			if (!connected) return;
			const controller = new AbortController();
			loadCommunity(ctx, controller.signal).then((listings) => {
				if (!controller.signal.aborted) setCommunity(listings);
			}, () => {});
			return () => controller.abort();
		}, [connected]);
		const slug = slugFromTarget(navigation?.target);
		const listing = slug ? [...state?.index.plugins ?? [], ...community].find((plugin) => plugin.slug === slug) : void 0;
		return /* @__PURE__ */ React.createElement("div", { className: "bm-page" }, /* @__PURE__ */ React.createElement("div", { className: "bm-inner" }, !state ? /* @__PURE__ */ React.createElement("p", { className: "bm-empty" }, "Loading the marketplace…") : listing ? /* @__PURE__ */ React.createElement(Detail, {
			key: listing.slug,
			listing,
			onManual: setManual
		}) : /* @__PURE__ */ React.createElement(Browse, {
			index: state.index,
			community,
			onManual: setManual,
			onAdd: () => setAdding(true)
		}), state ? /* @__PURE__ */ React.createElement("footer", { className: "bm-footer" }, /* @__PURE__ */ React.createElement("p", { className: "bm-note" }, "Index updated ", day(state.index.generatedAt), ". Nothing about what you install is sent anywhere."), !state.live ? /* @__PURE__ */ React.createElement("p", { className: "bm-note" }, "Showing the index built into this version. The live one couldn't be reached.") : null) : null), manual ? /* @__PURE__ */ React.createElement(ManualInstall, {
			listing: manual,
			onClose: () => setManual(null)
		}) : null, adding && state ? /* @__PURE__ */ React.createElement(AddPlugin, {
			index: state.index,
			canShare: !!connected,
			onClose: () => setAdding(false)
		}) : null);
	};
}
// src/index.tsx
var inject = [
	"react",
	"pages",
	"navigation",
	"host"
];
var ICON = "data:image/svg+xml;base64," + btoa("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke=\"currentColor\"><style>svg{color:#525252}@media (prefers-color-scheme:dark){svg{color:#c7c7c7}}</style><path d=\"M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304\"/><path d=\"M9 11v-5a3 3 0 0 1 6 0v5\"/></svg>");
function apply(ctx) {
	const style = document.createElement("style");
	style.dataset.plugin = "xyz.block.community-marketplace";
	style.textContent = styles;
	document.head.append(style);
	ctx.effect(() => () => style.remove());
	const MarketplacePage = createViews(ctx, pluginsCapability(ctx));
	ctx.pages.register({
		id: PAGE_ID,
		title: "Community Marketplace",
		layout: "workspace",
		primary: true,
		placement: "topbar",
		icon: ICON,
		route: {
			version: 1,
			validate: (params) => !!params && typeof params === "object" && !Array.isArray(params) && typeof params.slug === "string" && /^[a-z0-9-]{1,120}$/.test(params.slug)
		},
		component: MarketplacePage
	});
}
export { apply, inject };
