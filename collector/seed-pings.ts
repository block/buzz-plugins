import { createHash } from 'node:crypto';
import { cli } from '../indexer/args.ts';

const HOUR = 3_600_000;
const CLIENT = 'community-marketplace/0.1.0';

type Profile = 'steady' | 'surging' | 'fading';

const PROFILES: { profile: Profile; total: number }[] = [
  { profile: 'steady', total: 150 },
  { profile: 'surging', total: 90 },
  { profile: 'fading', total: 70 },
  { profile: 'surging', total: 30 },
];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleAgeHours(profile: Profile, windowHours: number, u: number): number {
  const lambda = 3 / windowHours;
  const truncated = -Math.log(1 - u * (1 - Math.exp(-lambda * windowHours))) / lambda;
  if (profile === 'steady') return u * windowHours;
  return profile === 'surging' ? truncated : windowHours - truncated;
}

export interface SeedPing {
  at: number;
  key: string;
  id: string;
  commit: string;
  installer: string;
  ip: string;
}

export function generatePings(
  plugins: { key: string; id: string; commit: string }[],
  options: { now: number; days: number; seed: number },
): SeedPing[] {
  const rand = mulberry32(options.seed);
  const randomHex = (bytes: number) => Array.from({ length: bytes }, () => Math.floor(rand() * 256).toString(16).padStart(2, '0')).join('');
  const windowHours = options.days * 24;
  const order = plugins.map((p, i) => ({ p, r: rand(), i })).sort((a, b) => a.r - b.r);
  const pings: SeedPing[] = [];

  order.forEach(({ p }, rank) => {
    const { profile, total } = PROFILES[rank % PROFILES.length]!;
    const count = Math.round(total * (0.85 + rand() * 0.3));
    const installers: string[] = [];
    for (let n = 0; n < count; n++) {
      const age = sampleAgeHours(profile, windowHours, rand());
      const at = options.now - Math.floor(age * HOUR);
      const repeat = installers.length > 0 && rand() < 0.08;
      const installer = repeat
        ? installers[Math.floor(rand() * installers.length)]!
        : createHash('sha256').update(`${randomHex(32)}:${p.id}`).digest('hex');
      if (!repeat) installers.push(installer);
      const ip = `10.${Math.floor(rand() * 256)}.${Math.floor(rand() * 256)}.${1 + Math.floor(rand() * 254)}`;
      pings.push({ at, key: p.key, id: p.id, commit: p.commit, installer, ip });
    }
  });
  return pings.sort((a, b) => a.at - b.at);
}

export interface SeedVote {
  at: number;
  key: string;
  id: string;
  voter: string;
  vote: 0 | 1;
  ip: string;
}

export function generateVotes(pings: SeedPing[], options: { now: number; seed: number }): SeedVote[] {
  const rand = mulberry32(options.seed ^ 0x5eed);
  const firsts = new Map<string, SeedPing>();
  for (const ping of pings) {
    const id = `${ping.key}\n${ping.installer}`;
    const seen = firsts.get(id);
    if (!seen || ping.at < seen.at) firsts.set(id, ping);
  }
  const rate = new Map<string, number>();
  const votes: SeedVote[] = [];
  const ip = () => `10.${Math.floor(rand() * 256)}.${Math.floor(rand() * 256)}.${1 + Math.floor(rand() * 254)}`;
  for (const ping of firsts.values()) {
    if (!rate.has(ping.key)) rate.set(ping.key, 0.1 + rand() * 0.35);
    if (rand() >= rate.get(ping.key)!) continue;
    const at = ping.at + Math.floor(rand() * Math.max(1, options.now - ping.at));
    votes.push({ at, key: ping.key, id: ping.id, voter: ping.installer, vote: 1, ip: ip() });
    if (rand() < 0.05) {
      const later = at + Math.floor(rand() * Math.max(1, options.now - at));
      votes.push({ at: later, key: ping.key, id: ping.id, voter: ping.installer, vote: 0, ip: ip() });
    }
  }
  return votes.sort((a, b) => a.at - b.at);
}

async function main(): Promise<void> {
  const { values } = cli({ url: { type: 'string' }, days: { type: 'string' }, seed: { type: 'string' } });
  const base = (values.url ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
  const days = Number(values.days ?? 10);
  const seed = Number(values.seed ?? 20261105);

  const indexRes = await fetch(`${base}/v1/index.json`);
  if (!indexRes.ok) throw new Error(`GET /v1/index.json returned ${indexRes.status}; run rank first`);
  const index = (await indexRes.json()) as { plugins: { key: string; id: string; source: { commit: string } }[] };
  const plugins = index.plugins.map((p) => ({ key: p.key, id: p.id, commit: p.source.commit }));

  const pings = generatePings(plugins, { now: Date.now(), days, seed });
  const statuses = new Map<number, number>();
  for (const ping of pings) {
    const res = await fetch(`${base}/v1/installs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-collector-time': new Date(ping.at).toISOString(),
        'x-forwarded-for': ping.ip,
      },
      body: JSON.stringify({ key: ping.key, id: ping.id, commit: ping.commit, installer: ping.installer, client: CLIENT }),
    });
    statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
  }
  console.log(`posted ${pings.length} pings for ${plugins.length} plugins over ${days} days`);
  console.log(`  statuses: ${[...statuses].map(([s, n]) => `${s} x${n}`).join(', ')}`);
  if ((statuses.get(202) ?? 0) !== pings.length) {
    console.error('some pings were not accepted; start the server with --trust-proxy --allow-time-override');
    process.exit(1);
  }

  const votes = generateVotes(pings, { now: Date.now(), seed });
  const voteStatuses = new Map<number, number>();
  for (const vote of votes) {
    const res = await fetch(`${base}/v1/votes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-collector-time': new Date(vote.at).toISOString(),
        'x-forwarded-for': vote.ip,
      },
      body: JSON.stringify({ key: vote.key, id: vote.id, voter: vote.voter, vote: vote.vote, client: CLIENT }),
    });
    voteStatuses.set(res.status, (voteStatuses.get(res.status) ?? 0) + 1);
  }
  console.log(`posted ${votes.length} votes`);
  console.log(`  statuses: ${[...voteStatuses].map(([s, n]) => `${s} x${n}`).join(', ')}`);
  if ((voteStatuses.get(202) ?? 0) !== votes.length) {
    console.error('some votes were not accepted');
    process.exit(1);
  }
}

if (import.meta.main) await main();
