import type { Context } from "@buzz/author";
import { INDEX_ORIGIN, type Listing, parseKey } from "./catalog";

export const CLIENT = "community-marketplace/0.1.0";
export const SALT_KEY = "xyz.block.community-marketplace.salt.v1";
export const SHARE_KEY = "xyz.block.community-marketplace.share-installs.v1";
export const REPORTED_KEY = "xyz.block.community-marketplace.reported.v1";
export const VOTES_KEY = "xyz.block.community-marketplace.votes.v1";

export function shareEnabled(): boolean {
  try {
    return window.localStorage.getItem(SHARE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setShareEnabled(on: boolean) {
  try {
    window.localStorage.setItem(SHARE_KEY, on ? "on" : "off");
  } catch {
    // Without storage the choice only lasts until the page reloads, and no salt can persist either.
  }
}

function readKeys(storageKey: string): Set<string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function writeKeys(storageKey: string, keys: Set<string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // Without storage the state only lasts until the page reloads.
  }
}

export const hasReported = (key: string) => readKeys(REPORTED_KEY).has(key);
export const hasUpvoted = (key: string) => readKeys(VOTES_KEY).has(key);

function rememberVote(key: string, vote: boolean) {
  const keys = readKeys(VOTES_KEY);
  if (vote) keys.add(key);
  else keys.delete(key);
  writeKeys(VOTES_KEY, keys);
}

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function localSalt(): string | null {
  try {
    const stored = window.localStorage.getItem(SALT_KEY);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
    const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
    window.localStorage.setItem(SALT_KEY, salt);
    return window.localStorage.getItem(SALT_KEY) === salt ? salt : null;
  } catch {
    return null;
  }
}

export async function installerHash(id: string): Promise<string | null> {
  const salt = localSalt();
  if (!salt) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${id}`));
  return hex(new Uint8Array(digest));
}

async function isPublicRepository(host: Context["host"], owner: string, repo: string) {
  const response = await host.request({
    url: `https://api.github.com/repos/${owner}/${repo}`,
    headers: { accept: "application/vnd.github+json" },
    timeoutMs: 8000,
  });
  if (response.status !== 200) return false;
  return (JSON.parse(response.body) as { private?: unknown }).private === false;
}

export function reportInstall(host: Context["host"] | undefined, listing: Listing, indexed: boolean): Promise<void> {
  const parts = parseKey(listing.key);
  if (!host || !indexed || !parts || !shareEnabled()) return Promise.resolve();
  return (async () => {
    if (!(await isPublicRepository(host, parts.owner, parts.repo))) return;
    if (!shareEnabled()) return;
    const installer = await installerHash(listing.id);
    if (!installer) return;
    const response = await host.request({
      url: `${INDEX_ORIGIN}/v1/installs`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: listing.key, id: listing.id, commit: listing.source.commit, installer, client: CLIENT }),
      timeoutMs: 8000,
    });
    if (response.status === 202) writeKeys(REPORTED_KEY, readKeys(REPORTED_KEY).add(listing.key));
  })().then(
    () => undefined,
    () => undefined,
  );
}

export function canVote(listing: Listing): boolean {
  return shareEnabled() && hasReported(listing.key);
}

export function sendVote(host: Context["host"] | undefined, listing: Listing, vote: boolean): Promise<boolean> {
  if (!host || !canVote(listing)) return Promise.resolve(false);
  return (async () => {
    const voter = await installerHash(listing.id);
    if (!voter) return false;
    const response = await host.request({
      url: `${INDEX_ORIGIN}/v1/votes`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: listing.key, id: listing.id, voter, vote: vote ? 1 : 0, client: CLIENT }),
      timeoutMs: 8000,
    });
    if (response.status !== 202) return false;
    rememberVote(listing.key, vote);
    return true;
  })().catch(() => false);
}
