// API v1 ships one module, so styles are embedded and scoped by the `bm-` prefix.
// Everything reads Buzz design tokens so light, dark and accent themes follow the host.
export const styles = `
.bm-page { height: 100%; overflow-y: auto; color: var(--text-standard); font-family: var(--font-sans); }
.bm-inner { max-width: 1120px; margin: 0 auto; padding: var(--space-8) var(--space-8) var(--space-16); }
.bm-header { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-6); margin-bottom: var(--space-6); }
.bm-title { margin: 0; font-size: var(--text-title); font-weight: var(--text-title--font-weight); letter-spacing: var(--text-title--letter-spacing); line-height: var(--text-title--line-height); }
.bm-subtitle { margin: var(--space-2) 0 0; color: var(--text-subtle); font-size: var(--text-body-lg); line-height: var(--text-body-lg--line-height); }
.bm-header-actions { flex: 0 1 480px; display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); min-width: 0; }
.bm-search { flex: 0 1 320px; min-width: 0; display: flex; align-items: center; gap: var(--space-2); height: 40px; padding: 0 var(--space-3);
  border-radius: var(--radius-pill); background: var(--surface-inset); border: 1px solid var(--border-standard); }
.bm-search:focus-within { border-color: var(--border-focus); }
.bm-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; font-size: var(--text-body); }
.bm-search svg { flex: none; color: var(--text-metadata); }
.bm-toolbar { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin: 0 0 var(--space-6); }
.bm-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.bm-chip { height: 32px; padding: 0 var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--border-standard);
  background: var(--surface-panel); color: var(--text-subtle); font: inherit; font-size: var(--text-body-sm); cursor: pointer; }
.bm-chip:hover { background: var(--affordance-row-hover); color: var(--text-standard); }
.bm-chip[aria-pressed="true"] { background: var(--surface-inverse); border-color: var(--surface-inverse); color: var(--text-inverse); }
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
.bm-card-author { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-card-meta.bm-card-footer { margin-top: auto; padding-top: var(--space-2); }
.bm-card-tagline { color: var(--text-subtle); font-size: var(--text-body-sm); line-height: var(--text-body-sm--line-height);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: calc(2 * var(--text-body-sm--line-height)); }
.bm-card-installs { color: var(--text-metadata); font-size: var(--text-caption); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-card-votes { flex: none; color: var(--text-metadata); font-size: var(--text-caption); font-weight: var(--font-weight-semibold); font-variant-numeric: tabular-nums; }
.bm-upvote { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.bm-upvote .bm-button[aria-pressed="true"] { color: var(--text-standard); background: var(--accent-overlay-soft); }
.bm-card-meta { margin-top: var(--space-2); display: flex; gap: var(--space-2); align-items: center; color: var(--text-metadata); font-size: var(--text-caption); }
.bm-badge { display: inline-flex; align-items: center; height: 20px; padding: 0 var(--space-2); border-radius: var(--radius-pill);
  font-size: var(--text-caption); font-weight: var(--font-weight-semibold); background: var(--surface-inset); color: var(--text-subtle); white-space: nowrap; }
.bm-badge[data-tone="active"] { background: color-mix(in srgb, var(--green-9) 18%, transparent); color: var(--text-success); }
.bm-badge[data-tone="warn"] { background: color-mix(in srgb, var(--amber-9) 22%, transparent); color: var(--text-warning); }
.bm-badge[data-tone="default"] { background: var(--accent-overlay-soft); color: var(--text-standard); }
.bm-button { display: inline-flex; flex-shrink: 0; white-space: nowrap; align-items: center; justify-content: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-4);
  border-radius: var(--radius-pill); border: 0; font: inherit; font-size: var(--text-body); font-weight: var(--font-weight-semibold); cursor: pointer;
  background: var(--affordance-prominent); color: var(--text-on-prominent); }
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
@media (max-width: 720px) { .bm-header { flex-wrap: wrap; } .bm-header-actions { flex-basis: 100%; justify-content: flex-start; } }
.bm-flags { gap: var(--space-2); }
.bm-flag { display: grid; gap: var(--space-1); }
.bm-flag code { justify-self: start; padding: 0 var(--space-2); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--red-9) 16%, transparent); color: var(--text-danger); font-weight: var(--font-weight-semibold); }
.bm-warning { color: var(--text-warning); }
.bm-footer { display: grid; gap: var(--space-2); margin-top: var(--space-8); max-width: 640px; }
.bm-toggle { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-body-sm); color: var(--text-standard); cursor: pointer; }
`;
