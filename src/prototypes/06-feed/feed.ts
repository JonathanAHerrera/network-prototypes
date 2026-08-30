/**
 * 06-feed — pure logic for the Daily Feed.
 *
 * Everything here is deterministic given a day seed: same day ⇒ same feed on
 * reload. No React, no DOM (beyond localStorage), so it stays trivially testable.
 */
import { dataset, me, simDistance, geoDistanceKm } from '../../shared/data';
import type { Entity, Person, Project, Domain } from '../../shared/data';
import { callAI, SYSTEM } from '../../shared/ai';

/* ------------------------------------------------------------------ seed */

/** FNV-1a-ish string hash → uint32. */
export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Same PRNG the dataset uses — small, fast, deterministic. */
export function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dayKey = () => new Date().toDateString();
export const seedFor = (dayOffset: number) => hash(`${dayKey()}:${dayOffset}`);

/* ---------------------------------------------------------------- memory */

export type Mark = 'hi' | 'skip';
export type SeenMap = Record<string, Mark>;
/** id → the day offset it was last *shown* on (whether or not it was acted on). */
export type ShownMap = Record<string, number>;

const SEEN_KEY = 'feed06.seen';
const SHOWN_KEY = 'feed06.shown';
const DAY_KEY = 'feed06.day';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSeen(): SeenMap {
  try {
    return safeParse<SeenMap>(localStorage.getItem(SEEN_KEY), {});
  } catch {
    return {};
  }
}

export function saveSeen(seen: SeenMap) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* private mode / quota — the feed still works, just forgets */
  }
}

/** Fatigue memory: who has been on screen lately, so tomorrow looks different. */
export function loadShown(): ShownMap {
  try {
    const raw = safeParse<Record<string, unknown>>(localStorage.getItem(SHOWN_KEY), {});
    const out: ShownMap = {};
    for (const [id, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[id] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveShown(shown: ShownMap) {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {
    /* private mode / quota — the feed still works, just forgets */
  }
}

/** Stamp every id in a freshly built feed as "shown on this day offset". */
export function rememberShown(rows: FeedRow[], dayOffset: number): ShownMap {
  const shown = loadShown();
  for (const r of rows) shown[r.id] = dayOffset;
  saveShown(shown);
  return shown;
}

export function loadDayOffset(): number {
  try {
    const n = Number(localStorage.getItem(DAY_KEY));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function saveDayOffset(offset: number) {
  try {
    localStorage.setItem(DAY_KEY, String(offset));
  } catch {
    /* ignore */
  }
}

export function resetMemory() {
  try {
    localStorage.removeItem(SEEN_KEY);
    localStorage.removeItem(SHOWN_KEY);
    localStorage.removeItem(DAY_KEY);
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------------- scoring
 *
 * score = 0.30*interest + 0.20*tagOverlap + 0.17*activeScore + 0.15*geo
 *       + 0.18*rand(seed)            ← jitter is heavy on purpose: it is what
 *                                      makes "new day" actually reshuffle the top
 * minus a fatigue penalty for anyone shown in the last few days (see buildFeed).
 */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

/** me.tags, lower-cased once. */
const MY_TAGS = lower(me.tags);

/**
 * "Where I sit" in similarity space. `me` has no `pos`, so we derive one:
 * centroid of same-domain people who share at least one of my tags, else the
 * centroid of my whole domain.
 */
export const mePos = (() => {
  const domainFolk = dataset.people.filter((p) => p.domain === me.domain);
  const kin = domainFolk.filter((p) => overlap(p.tags, MY_TAGS).length > 0);
  const pool = kin.length >= 3 ? kin : domainFolk.length ? domainFolk : dataset.people;
  const x = pool.reduce((a, p) => a + p.pos.x, 0) / pool.length;
  const y = pool.reduce((a, p) => a + p.pos.y, 0) / pool.length;
  return { pos: { x, y } };
})();

function overlap(a: string[], bLower: string[]): string[] {
  const set = new Set(bLower);
  return a.filter((x) => set.has(x.toLowerCase()));
}

export interface FeedRow {
  id: string;
  entity: Entity;
  kind: 'person' | 'project';
  /** great-circle km from Austin */
  km: number;
  score: number;
  /** tags/skills/needs of theirs that match mine */
  shared: string[];
  sameDomain: boolean;
  /** projects only: their needs line up with me ⇒ "looking for someone like you" */
  looking: boolean;
}

function geoScore(km: number) {
  return 1 - clamp01(Math.log10(1 + km) / 4);
}

function interestScore(e: Entity) {
  return 1 - clamp01(simDistance(e, mePos) / 0.6);
}

function scorePerson(p: Person, jitterRand: number): FeedRow {
  const km = geoDistanceKm(p, me);
  const tagHits = overlap(p.tags, MY_TAGS);
  const skillHits = overlap(p.skills, MY_TAGS);
  const tagOverlap = clamp01((tagHits.length + skillHits.length * 0.5) / MY_TAGS.length);
  const score =
    0.3 * interestScore(p) +
    0.2 * tagOverlap +
    0.17 * p.activeScore +
    0.15 * geoScore(km) +
    0.18 * jitterRand;
  return {
    id: p.id,
    entity: p,
    kind: 'person',
    km,
    score,
    shared: [...new Set([...tagHits, ...skillHits])],
    sameDomain: p.domain === me.domain,
    looking: false,
  };
}

function scoreProject(pr: Project, jitterRand: number): FeedRow {
  const km = geoDistanceKm(pr, me);
  const tagHits = overlap(pr.tags, MY_TAGS);
  const needHits = overlap(pr.needs, MY_TAGS);
  const tagOverlap = clamp01((tagHits.length + needHits.length) / MY_TAGS.length);
  const sameDomain = pr.domain === me.domain;
  const score =
    0.3 * interestScore(pr) +
    0.2 * tagOverlap +
    0.17 * pr.activeScore +
    0.15 * geoScore(km) +
    0.18 * jitterRand;
  return {
    id: pr.id,
    entity: pr,
    kind: 'project',
    km,
    score,
    shared: [...new Set([...tagHits, ...needHits])],
    sameDomain,
    looking: needHits.length > 0 || tagHits.length > 0 || sameDomain,
  };
}

/** Greedy pick with a per-domain cap; relaxes the cap to fill the quota. */
function pickDiverse(rows: FeedRow[], n: number, cap: number): FeedRow[] {
  const out: FeedRow[] = [];
  const used: Partial<Record<Domain, number>> = {};
  for (const r of rows) {
    if (out.length >= n) break;
    const d = r.entity.domain;
    if ((used[d] ?? 0) >= cap) continue;
    used[d] = (used[d] ?? 0) + 1;
    out.push(r);
  }
  if (out.length < n) {
    const taken = new Set(out.map((r) => r.id));
    for (const r of rows) {
      if (out.length >= n) break;
      if (!taken.has(r.id)) out.push(r);
    }
    out.sort((a, b) => b.score - a.score);
  }
  return out;
}

export const PEOPLE_PER_DAY = 8;
export const PROJECTS_PER_DAY = 2;

/** Recently-shown ids get pushed down so a new day looks like a new day. */
export const FATIGUE_PREV_DAY = -0.35;
export const FATIGUE_RECENT = -0.15;
export const FATIGUE_WINDOW = 3;

/**
 * How much to subtract for having already been on screen lately.
 * 0 for ids shown on *this* day offset, so a reload is byte-identical.
 */
function fatigue(id: string, shown: ShownMap, dayOffset: number): number {
  const last = shown[id];
  if (last === undefined) return 0;
  const gap = dayOffset - last;
  if (gap <= 0) return 0;
  if (gap === 1) return FATIGUE_PREV_DAY;
  if (gap <= FATIGUE_WINDOW) return FATIGUE_RECENT;
  return 0;
}

/**
 * Build today's feed: ranked, domain-diverse, never anyone already seen, and
 * biased away from whoever showed up in the last few days.
 * Projects land at positions ~4 and ~8 so the column stays mostly faces.
 *
 * Deterministic: same `seed` + same `seen`/`shown` ⇒ identical rows.
 */
export function buildFeed(
  seed: number,
  seen: SeenMap,
  shown: ShownMap = {},
  dayOffset = 0,
): FeedRow[] {
  const jitter = (id: string) => mulberry32(hash(`${seed}:${id}`))();
  const tire = (r: FeedRow): FeedRow => {
    const penalty = fatigue(r.id, shown, dayOffset);
    return penalty ? { ...r, score: r.score + penalty } : r;
  };

  const people = dataset.people
    .filter((p) => !seen[p.id])
    .map((p) => tire(scorePerson(p, jitter(p.id))))
    .sort((a, b) => b.score - a.score);
  const projects = dataset.projects
    .filter((p) => !seen[p.id])
    .map((p) => tire(scoreProject(p, jitter(p.id))))
    .sort((a, b) => b.score - a.score);

  const pickedPeople = pickDiverse(people, PEOPLE_PER_DAY, 3);
  // prefer projects that actually want someone like me
  const projectPool = [...projects].sort(
    (a, b) => Number(b.looking) - Number(a.looking) || b.score - a.score,
  );
  const pickedProjects = pickDiverse(projectPool, PROJECTS_PER_DAY, 1);

  const out = [...pickedPeople];
  const slots = [3, 7];
  pickedProjects.forEach((pr, i) => {
    const at = Math.min(slots[i] ?? out.length, out.length);
    out.splice(at, 0, pr);
  });
  return out;
}

/* ------------------------------------------------------- local templates */

export interface Enrichment {
  why: string;
  opener: string;
  /** true when it came from the local template engine, not Claude */
  templated: boolean;
}

const firstName = (n: string) => n.split(' ')[0];

function distancePhrase(km: number, city: string) {
  if (km < 60) return 'right here in Austin';
  if (km < 400) return `a short drive away in ${city}`;
  if (km < 2500) return `${Math.round(km)} km out, in ${city}`;
  return `all the way over in ${city}`;
}

function shortDistance(km: number) {
  return km < 60 ? 'in your city' : km < 2500 ? `${Math.round(km)} km away` : 'a long flight away';
}

const pickFrom = <T,>(arr: T[], r: number) => arr[Math.floor(r * arr.length) % arr.length];

/** Deterministic, non-repetitive fallback copy built from real row signals. */
export function localEnrich(row: FeedRow, seed: number): Enrichment {
  const rand = mulberry32(hash(`${seed}:copy:${row.id}`));
  const e = row.entity;
  const shared = row.shared;

  if (e.kind === 'person') {
    const tag = shared[0] ?? e.tags[0];
    const skill = e.skills[0];
    const whys = [
      shared.length
        ? `you're both deep in ${shared.slice(0, 2).join(' + ')}`
        : `${e.domain} brain with a ${e.tags[0]} streak`,
      row.sameDomain
        ? `fellow ${e.domain} person, ${shortDistance(row.km)}`
        : `${e.domain} angle on your ${me.tags[0]} work`,
      `brings ${skill}; wants ${e.lookingFor}`,
      row.km < 60
        ? `Austin local looking for ${e.lookingFor}`
        : `${e.city} ${e.domain} — into ${tag}`,
    ];
    const openers = [
      `hey ${firstName(e.name)} — I'm in Austin, mostly ${me.tags[0]} and ${me.tags[1]}. Saw you're into ${tag}; want to swap notes sometime?`,
      `hi ${firstName(e.name)}! You're ${distancePhrase(row.km, e.city)} — and looking for ${e.lookingFor}. I might be able to help; coffee call this week?`,
      `${firstName(e.name)} — your ${skill} + ${e.tags[0]} combo is exactly the kind of thing I keep bumping into. I'm building ${me.tags[0]} stuff in Austin; say hi back?`,
    ];
    return {
      why: pickFrom(whys, rand()),
      opener: pickFrom(openers, rand()),
      templated: true,
    };
  }

  const need = shared[0] ?? e.needs[0];
  const whys = [
    row.looking
      ? `they need ${need} — that's you`
      : `${e.domain} project circling your ${e.tags[0]} interests`,
    shared.length
      ? `shared ground: ${shared.slice(0, 2).join(' + ')}`
      : `${e.status} in ${e.city}, ${shortDistance(row.km)}`,
    `${e.tags[0]} × ${e.tags[1]} — still hiring ${e.needs[0]}`,
  ];
  const openers = [
    `hi ${e.title} team — I'm in Austin working on ${me.tags[0]} and ${me.tags[2]}. You're looking for ${need}; I'd love to pitch in.`,
    `hey! ${e.title} looks like exactly my kind of ${e.domain} project. I'm Austin-based, strong on ${me.tags[0]}, and happy to start small — where do you need hands?`,
    `hello from Austin — saw ${e.title} needs ${need}. I've done a fair bit of that alongside ${me.tags[1]} work. Can I help?`,
  ];
  return {
    why: pickFrom(whys, rand()),
    opener: pickFrom(openers, rand()),
    templated: true,
  };
}

export function localEnrichAll(rows: FeedRow[], seed: number): Record<string, Enrichment> {
  const out: Record<string, Enrichment> = {};
  for (const r of rows) out[r.id] = localEnrich(r, seed);
  return out;
}

/* ------------------------------------------------------- AI enrichment */

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          why: { type: 'string' },
          opener: { type: 'string' },
        },
        required: ['id', 'why', 'opener'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function rowLine(r: FeedRow) {
  const e = r.entity;
  const km = Math.round(r.km);
  return e.kind === 'person'
    ? `${e.id}|P|${e.name}|${e.city}|${e.domain}|tags:${e.tags.join(',')}|skills:${e.skills.join(',')}|wants:${e.lookingFor}|${km}km`
    : `${e.id}|J|${e.title}|${e.city}|${e.domain}|tags:${e.tags.join(',')}|needs:${e.needs.join(',')}|${e.status}|${km}km`;
}

export interface EnrichResult {
  map: Record<string, Enrichment>;
  offline: boolean;
}

/**
 * Ask Claude for a "why you two" line + an opener per row. Any row Claude
 * skips (or every row, when there's no API key) falls back to the local
 * template engine, so the UI never has a hole in it.
 */
export async function enrichFeed(rows: FeedRow[], seed: number): Promise<EnrichResult> {
  const fallback = localEnrichAll(rows, seed);
  if (!rows.length) return { map: fallback, offline: false };

  const prompt = `Today's feed for ${me.name} (${me.city}; into ${me.tags.join(', ')}).
For EACH row below return:
- "why": one line, max 14 words, lowercase-ish and warm, saying why these two should meet. Use the concrete tags/skills/needs/distance in the row. No emoji.
- "opener": 1-2 friendly sentences written in first person AS ${me.name} in ${me.city}, addressed to that person. For J rows (projects) it is a short note to the team instead.
Never invent facts that aren't in the row. Return one item per row, same ids.

ROWS:
${rows.map(rowLine).join('\n')}`;

  try {
    const j = await callAI<{ items: { id: string; why: string; opener: string }[] }>(prompt, {
      system: SYSTEM,
      schema: ENRICH_SCHEMA,
      max_tokens: 1500,
    });
    const map: Record<string, Enrichment> = { ...fallback };
    let hits = 0;
    for (const it of j?.items ?? []) {
      if (!it || !map[it.id] || !it.why || !it.opener) continue;
      map[it.id] = { why: it.why.trim(), opener: it.opener.trim(), templated: false };
      hits++;
    }
    if (!hits) return { map: fallback, offline: true };
    return { map, offline: false };
  } catch (e) {
    if ((e as Error).message !== 'no_api_key') console.warn('[06-feed] enrichment fell back to templates:', e);
    return { map: fallback, offline: true };
  }
}

/* ------------------------------------------------------------- helpers */

/** Up to `n` member/project cards to show as mini squares on a card. */
export function relatedIds(e: Entity, n = 3): string[] {
  const ids = e.kind === 'person' ? e.projectIds : e.memberIds;
  return ids.filter((id) => dataset.byId[id]).slice(0, n);
}
