// Stands in for Buzz's native plugin IPC, the same boundary Buzz's own browser
// tests use, so the demo shows the real Settings import and review. The Git
// fetch is simulated from the listing's pinned commit and every network call
// the plugin makes is answered here; nothing leaves the page.
import { bundledPlugins } from "/src/bundled/index.ts";
import fixture from "./index.demo.json";

const demoIndex = { ...fixture, plugins: fixture.plugins.map((plugin) => ({ ...plugin, demo: { screenshots: [] } })) };

const ok = (status, body) => ({ status, headers: {}, body: JSON.stringify(body) });

function hostRequest({ url }) {
  if (url === "https://raw.githubusercontent.com/block/buzz-plugins/index/index.json") return ok(200, demoIndex);
  const repo = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/.exec(url);
  if (repo) return ok(200, { full_name: `${repo[1]}/${repo[2]}`, private: false });
  throw new Error("Not available in the demo");
}

const candidateFor = (repository, path = "") => {
  const listing = demoIndex.plugins.find((plugin) => plugin.source.repository === repository && plugin.source.path === path);
  return listing && { listing, path };
};

const manifestOf = ({ listing }) => ({
  id: listing.id,
  name: listing.name,
  apiVersion: 1,
  description: listing.tagline,
  discovery: { category: listing.category, tags: listing.tags },
  host: { networkOrigins: listing.host.networkOrigins },
});

const plugins = bundledPlugins.map(({ manifest, enabledByDefault = true }) => ({
  manifest,
  source: "bundled",
  enabled: enabledByDefault,
  revision: "bundled",
  previous: null,
  reloadable: false,
  error: null,
}));
const ready = () => ({
  status: "ready",
  externalPluginsPaused: false,
  catalog: { profile: "demo", location: "Demo profile", plugins: structuredClone(plugins) },
});

let pending = null;
let source = null;
let nextCallback = 0;
const callbacks = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

window.isTauri = true;
window.__TAURI_INTERNALS__ = {
  transformCallback(callback, once = false) {
    const id = ++nextCallback;
    callbacks.set(id, (value) => {
      if (once) callbacks.delete(id);
      callback?.(value);
    });
    return id;
  },
  unregisterCallback(id) {
    callbacks.delete(id);
  },
  async invoke(command, args) {
    switch (command) {
      case "deep_link_take":
        return [];
      case "deep_link_watch":
        return;
      case "app_agent_state_load":
        return {};
      case "app_agent_state_set":
        return;
      case "keep_awake_set":
        return;
      case "credential_pairing_communities":
        return;
      case "plugin_host_mcp_pairing":
        return null;
      case "plugin_catalog":
        return ready();
      case "plugin_import_git": {
        await delay(900);
        const found = candidateFor(args.repository);
        if (!found) throw new Error("This repository isn't available in the demo");
        source = { repository: args.repository, reference: args.reference };
        const preview = {
          source: args.repository,
          commit: args.commit ?? found.listing.source.commit,
          warnings: [],
          candidates: [{ path: found.path, revision: found.listing.source.commit.slice(0, 12), manifest: manifestOf(found) }],
        };
        if (args.checkOnly) return preview;
        pending = { ...preview, token: "demo-preview" };
        return structuredClone(pending);
      }
      case "plugin_import_discard":
        if (pending?.token === args.token) pending = null;
        return;
      case "plugin_import_install": {
        if (!pending || pending.token !== args.token) throw new Error("This import preview expired");
        const candidate = pending.candidates.find((entry) => entry.path === args.path);
        plugins.push({
          ...structuredClone(candidate),
          source: "external",
          enabled: true,
          previous: null,
          reloadable: true,
          updateSource: { ...source, path: candidate.path },
          error: null,
        });
        pending = null;
        return ready();
      }
      case "plugin_change": {
        const index = plugins.findIndex((plugin) => plugin.manifest.id === args.id);
        if (args.action === "remove") plugins.splice(index, 1);
        else plugins[index].enabled = args.action === "enable";
        return ready();
      }
      case "plugin_host_request":
        return hostRequest(args.request);
      case "plugin_module":
        return "export function apply() {}";
      default:
        throw new Error(`Not available in the demo: ${command}`);
    }
  },
};
