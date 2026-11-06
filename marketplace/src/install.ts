import type { Context } from "@buzz/author";
import type { Listing } from "./catalog";

export type PluginSource = Readonly<{ repository: string; reference: string; commit?: string; path?: string }>;
export type InstallResult = "installed" | "updated" | "cancelled" | "unavailable";

export type InstallationStatus = "installed" | "absent" | "unavailable";

export type PluginsCapability = Readonly<{
  requestInstall(source: PluginSource): Promise<InstallResult>;
  getInstallationStatus?(id: string): InstallationStatus;
  subscribeInstallationStatus?(id: string, listener: (status: InstallationStatus) => void): () => void;
}>;

export function pluginsCapability(ctx: Context): PluginsCapability | undefined {
  const reflect = (ctx as unknown as { reflect?: { get?(name: string): unknown } }).reflect;
  const capability = reflect?.get?.("pluginInstaller") as PluginsCapability | undefined;
  return typeof capability?.requestInstall === "function" ? capability : undefined;
}

export function sourceOf(listing: Listing): PluginSource {
  return {
    repository: listing.source.repository,
    reference: listing.source.ref,
    commit: listing.source.commit,
    ...(listing.source.path ? { path: listing.source.path } : {}),
  };
}

// The host does not expose its plugin list to plugins, so a plugin counts as
// active once it contributes a page or panel to registries every plugin can read.
export function activePluginIds(ctx: Context): Set<string> {
  const ids = new Set<string>();
  const registries = [ctx.pages, (ctx as unknown as { panels?: { snapshot?(): readonly { pluginId: string }[] } }).panels];
  for (const registry of registries)
    for (const entry of (registry as { snapshot?(): readonly { pluginId: string }[] } | undefined)?.snapshot?.() ?? [])
      ids.add(entry.pluginId);
  return ids;
}
