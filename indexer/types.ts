export const CATEGORIES = [
  'communication',
  'agents',
  'agent-tools',
  'developer-tools-and-integrations',
  'people-and-communities',
  'productivity',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Source {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

export interface Host {
  networkOrigins: string[];
  processes: string[];
  commands: string[];
  files: boolean;
  mcp: boolean;
  agentHooks: boolean;
}

export type Tier = 'high' | 'medium' | 'low';

export interface Flag {
  code: 'dynamic-code' | 'obfuscated' | 'undeclared-origin' | 'size';
  detail: string;
}

export interface Audit {
  tier: Tier;
  flags: Flag[];
  accessChanged: boolean;
  cleared: boolean;
  checkedAt: string;
}

export interface Media {
  url: string;
  type: string;
}

export interface Screenshot extends Media {
  caption?: string;
}

export interface SetupStep {
  title: string;
  detail?: string;
  command?: string;
}

export interface Listing {
  key: string;
  slug: string;
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: Category;
  tags: string[];
  author: { github: string };
  official: boolean;
  source: { repository: string; ref: string; commit: string; path: string };
  host: Host;
  audit: Audit;
  demo: { video: Media | null; poster: Media | null; screenshots: Screenshot[] };
  setup: SetupStep[];
  links: { repository: string; docs?: string; support?: string };
  stars: number;
  updatedAt: string;
}

export interface Installs {
  allTime: number;
  last24h: number;
  last7d: number;
}

export interface IndexPlugin extends Listing {
  installs: Installs;
  upvotes: number;
}

export interface Rankings {
  allTime: string[];
  trending: string[];
  hot: string[];
  mostUpvoted: string[];
}

export interface IndexFile {
  schemaVersion: 1;
  generatedAt: string;
  collectionStartedAt: string;
  mediaPolicy: string;
  plugins: IndexPlugin[];
  rankings: Rankings;
}

export interface ListingsFile {
  schemaVersion: 1;
  generatedAt: string;
  plugins: Listing[];
}

export const MEDIA_POLICY =
  'raw.githubusercontent.com at the pinned commit, or https URLs the author lists';

export const PLUGIN_ID_RE = /^[a-z][a-z0-9.-]{0,79}$/;
export const COMMIT_RE = /^[0-9a-f]{40}$/;
