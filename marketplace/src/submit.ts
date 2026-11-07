import type { Context } from "@buzz/author";
import { LISTING_REPOSITORY } from "./catalog";

type Host = Context["host"];

export type SourceInput = Readonly<{ owner: string; repo: string; ref?: string; path: string }>;
export type CheckedSource = Readonly<{ owner: string; repo: string; ref: string; path: string; id: string; name: string; description: string }>;
export type CheckResult = { ok: true; source: CheckedSource } | { ok: false; message: string };

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_./+-]{0,199}$/;
const PLUGIN_ID = /^[a-z][a-z0-9.-]{0,79}$/;

const validName = (value: string) => NAME.test(value) && value !== "." && value !== "..";
const validPath = (segments: string[]) => segments.every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..");
export const validRef = (ref: string) => REF.test(ref) && !ref.includes("..") && !ref.endsWith("/") && !ref.endsWith(".lock");

export function parseSourceInput(text: string, refText = ""): SourceInput | null {
  let rest = text.trim().replace(/^https:\/\/github\.com\//, "").replace(/^github\.com\//, "").replace(/\/+$/, "");
  let ref = refText.trim() || undefined;
  const segments = rest.split("/").filter((segment) => segment !== "");
  const [owner, rawRepo, ...tail] = segments;
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/, "");
  if (!validName(owner) || !validName(repo)) return null;
  let path = tail;
  if (tail[0] === "tree" && tail[1]) {
    ref ??= tail[1];
    path = tail.slice(2);
  }
  if (!validPath(path)) return null;
  if (ref !== undefined && !validRef(ref)) return null;
  rest = path.join("/");
  return ref === undefined ? { owner, repo, path: rest } : { owner, repo, ref, path: rest };
}

export const describeSource = (source: Pick<SourceInput, "owner" | "repo" | "path">) =>
  source.path ? `${source.owner}/${source.repo}/${source.path}` : `${source.owner}/${source.repo}`;

const where = (path: string) => (path ? `the ${path} folder` : "the repository root");

async function get(host: Host, url: string, method: "GET" | "HEAD" = "GET") {
  return host.request({ url, method, headers: { accept: "application/vnd.github+json, application/json, text/plain, */*" }, timeoutMs: 10000 });
}

export async function checkSource(host: Host, input: SourceInput): Promise<CheckResult> {
  const label = `${input.owner}/${input.repo}`;
  try {
    const repo = await get(host, `https://api.github.com/repos/${input.owner}/${input.repo}`);
    if (repo.status === 404) return { ok: false, message: `GitHub can't find ${label}. Check the name, and that the repository is public.` };
    if (repo.status !== 200) return { ok: false, message: `GitHub didn't answer (HTTP ${repo.status}). Try again in a few minutes.` };
    const info = JSON.parse(repo.body) as { private?: unknown; default_branch?: unknown };
    if (info.private !== false) return { ok: false, message: `${label} is private. Only public repositories can be listed.` };
    const ref = input.ref ?? (typeof info.default_branch === "string" ? info.default_branch : "main");
    const base = `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${ref}${input.path ? `/${input.path}` : ""}`;

    const manifestRes = await get(host, `${base}/manifest.json`);
    if (manifestRes.status === 404)
      return { ok: false, message: `There's no manifest.json in ${where(input.path)} on ${ref}. Commit the built manifest.json and plugin.js there.` };
    if (manifestRes.status !== 200) return { ok: false, message: `GitHub didn't return manifest.json (HTTP ${manifestRes.status}). Try again in a few minutes.` };
    let manifest: { id?: unknown; name?: unknown; description?: unknown };
    try {
      manifest = JSON.parse(manifestRes.body) as typeof manifest;
    } catch {
      return { ok: false, message: "manifest.json isn't valid JSON." };
    }
    if (typeof manifest !== "object" || manifest === null) return { ok: false, message: "manifest.json isn't a JSON object." };
    if (typeof manifest.id !== "string" || !PLUGIN_ID.test(manifest.id))
      return { ok: false, message: "manifest.json needs an id made of lowercase letters, digits, dots and dashes, such as com.example.notes." };
    if (typeof manifest.name !== "string" || !manifest.name.trim()) return { ok: false, message: "manifest.json needs a name." };

    const plugin = await get(host, `${base}/plugin.js`, "HEAD");
    if (plugin.status === 404)
      return { ok: false, message: `There's no plugin.js next to manifest.json on ${ref}. Commit the built plugin, not only its source.` };
    if (plugin.status !== 200) return { ok: false, message: `GitHub didn't return plugin.js (HTTP ${plugin.status}). Try again in a few minutes.` };

    return {
      ok: true,
      source: {
        owner: input.owner,
        repo: input.repo,
        ref,
        path: input.path,
        id: manifest.id,
        name: manifest.name.trim(),
        description: typeof manifest.description === "string" ? manifest.description : "",
      },
    };
  } catch {
    return { ok: false, message: "Couldn't reach GitHub. Check your connection and try again." };
  }
}

export const sourceLine = (source: Pick<CheckedSource, "owner" | "repo" | "ref" | "path">) =>
  `https://github.com/${source.owner}/${source.repo} ${source.ref}${source.path ? ` ${source.path}` : ""}`;

export const sourceKey = (source: Pick<SourceInput, "owner" | "repo" | "path">) =>
  `github.com/${source.owner}/${source.repo}${source.path ? `/${source.path}` : ""}`;

export function listingLinks(source: CheckedSource, repository = LISTING_REPOSITORY) {
  const issue = new URLSearchParams({
    template: "list-plugin.yml",
    title: `List: ${source.name}`,
    source: sourceLine(source),
  });
  return {
    pullRequest: `https://github.com/${repository}/edit/main/sources.txt`,
    issue: `https://github.com/${repository}/issues/new?${issue}`,
  };
}
