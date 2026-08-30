import { callAI, SYSTEM, localSearch } from '../../shared/ai';
import {
  allEntities,
  dataset,
  entityLabel,
  geoDistanceKm,
  simDistance,
  me,
  DOMAINS,
} from '../../shared/data';
import type { Domain, Entity } from '../../shared/data';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type Turn =
  | { role: 'user'; id: string; text: string }
  | {
      role: 'assistant';
      id: string;
      text: string;
      ids: string[];
      followUps: string[];
      offline?: boolean;
      error?: boolean;
      pending?: boolean;
      /** question to re-send when the user taps the retry chip */
      retryOf?: string;
    };

export interface Answer {
  reply: string;
  ids: string[];
  followUps: string[];
  offline: boolean;
}

export const STARTERS = [
  'who is working on climate near me?',
  'find robotics projects that need help',
  'who should I meet in Nairobi?',
];

const MAX_IDS = 8;

/* ------------------------------------------------------------------ *
 * Online path — Claude via callAI
 * ------------------------------------------------------------------ */

const PERSONA = `You are Hopa, a friendly pixel mascot. Reply in 1-2 short sentences (max ~160 chars), playful but useful. Always return 1-8 ids that your reply refers to, ordered best first. Give 3 short follow-up questions the user might ask next (max 5 words each, e.g. "show me their projects", "who's nearby?", "narrow to Africa"). Use only catalogue ids.`;

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    ids: { type: 'array', items: { type: 'string' } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['reply', 'ids', 'followUps'],
  additionalProperties: false,
};

function transcript(turns: Turn[]): string {
  return turns
    .filter((t) => t.role === 'user' || !t.pending)
    .slice(-8)
    .map((t) =>
      t.role === 'user'
        ? `USER: ${t.text.slice(0, 300)}`
        : `HOPA: ${t.text.slice(0, 300)}${t.ids.length ? ` [ids: ${t.ids.join(',')}]` : ''}`,
    )
    .join('\n');
}

/**
 * Ask Hopa. Uses Claude when the dev server has an API key; silently falls
 * back to the local resolver on `no_api_key`. Any other failure is rethrown
 * so the UI can show an error turn with a retry chip.
 */
export async function askHopa(turns: Turn[], question: string): Promise<Answer> {
  try {
    const prior = transcript(turns);
    const prompt = `Conversation so far (oldest first):\n${prior || '(nothing yet)'}\nUSER: ${question}\n\nAnswer the last USER message. Resolve references like "their", "them", "that project" against the ids in the previous HOPA turns.`;
    const j = await callAI<{ reply: string; ids: string[]; followUps: string[] }>(prompt, {
      system: `${SYSTEM}\n\n${PERSONA}`,
      schema: SCHEMA,
      max_tokens: 600,
    });
    const ids = (j.ids ?? []).filter((id) => dataset.byId[id]).slice(0, MAX_IDS);
    const followUps = (j.followUps ?? []).map((f) => String(f)).filter(Boolean).slice(0, 3);
    return {
      reply: j.reply?.trim() || 'Here is what I found.',
      ids,
      followUps: followUps.length ? followUps : followUpsFor(ids),
      offline: false,
    };
  } catch (e) {
    if ((e as Error).message !== 'no_api_key') throw e;
    return resolveOffline(turns, question);
  }
}

/* ------------------------------------------------------------------ *
 * Offline path
 * ------------------------------------------------------------------ */

const uniq = <T,>(a: T[]) => [...new Set(a)];
const COUNTRIES = uniq(allEntities.map((e) => e.country));
const CITIES = uniq(allEntities.map((e) => e.city));
const TAGS = uniq(allEntities.flatMap((e) => e.tags));

const REGIONS: Record<string, string[]> = {
  africa: ['Nigeria', 'Kenya', 'Ghana', 'Egypt', 'South Africa'],
  europe: ['Germany', 'Portugal', 'Netherlands', 'Norway'],
  asia: ['India', 'Japan', 'Indonesia', 'South Korea', 'Philippines'],
  'latin america': ['Mexico', 'Brazil', 'Colombia', 'Argentina'],
  'south america': ['Brazil', 'Colombia', 'Argentina'],
  'north america': ['USA', 'Canada', 'Mexico'],
  america: ['USA'],
  us: ['USA'],
  usa: ['USA'],
  texas: ['USA'],
};

/** strip accents + punctuation so "Bogotá" matches "bogota" */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ents = (ids: string[]) => ids.map((id) => dataset.byId[id]).filter(Boolean);
const idsOf = (list: Entity[]) => list.slice(0, MAX_IDS).map((e) => e.id);

/** ids from the most recent non-pending assistant turn that returned results */
export function lastAssistantIds(turns: Turn[]): string[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === 'assistant' && !t.pending && !t.error && t.ids.length) return t.ids;
  }
  return [];
}

interface Facets {
  kind?: Entity['kind'];
  city?: string;
  countries?: string[];
  domain?: Domain;
  tag?: string;
  label?: string;
}

/** whole-word containment so "us" doesn't match "because" and "art" doesn't match "start" */
const hasWord = (q: string, phrase: string) => {
  const p = norm(phrase);
  if (!p) return false;
  return new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q);
};

function detectFacets(q: string): Facets {
  const f: Facets = {};
  const city = CITIES.find((c) => hasWord(q, c));
  if (city) { f.city = city; f.label = city; }
  if (!f.city) {
    const country = COUNTRIES.find((c) => hasWord(q, c));
    const region = Object.keys(REGIONS).find((r) => hasWord(q, r));
    if (country) { f.countries = [country]; f.label = country; }
    else if (region) { f.countries = REGIONS[region]; f.label = region.replace(/\b\w/g, (m) => m.toUpperCase()); }
  }
  const domain = DOMAINS.find((d) => hasWord(q, d));
  if (domain) { f.domain = domain; f.label = f.label ?? domain; }
  if (!f.domain) {
    const tag = TAGS.find((t) => t.length > 3 && hasWord(q, t));
    if (tag) { f.tag = tag; f.label = f.label ?? tag; }
  }
  if (/\b(people|person|persons|folks|humans|members)\b/.test(q)) f.kind = 'person';
  else if (/\b(projects?|initiatives?|teams?)\b/.test(q)) f.kind = 'project';
  f.label = f.label ?? (f.kind === 'person' ? 'people' : f.kind === 'project' ? 'projects' : undefined);
  return f;
}

const hasFacet = (f: Facets) => Boolean(f.city || f.countries || f.domain || f.tag || f.kind);

function applyFacets(list: Entity[], f: Facets): Entity[] {
  let out = list;
  if (f.kind) out = out.filter((e) => e.kind === f.kind);
  if (f.city) out = out.filter((e) => e.city === f.city);
  if (f.countries) out = out.filter((e) => f.countries!.includes(e.country));
  if (f.domain) out = out.filter((e) => e.domain === f.domain);
  if (f.tag) out = out.filter((e) => e.tags.includes(f.tag!));
  return out;
}

function byName(raw: string): Entity | null {
  const n = norm(raw).replace(/^(the|a)\s+/, '');
  if (n.length < 3) return null;
  const scored = allEntities
    .map((e) => {
      const label = norm(entityLabel(e));
      const handle = e.kind === 'person' ? norm(e.handle) : '';
      if (label === n) return { e, s: 3 };
      if (n.startsWith(label) || label.startsWith(n)) return { e, s: 2 };
      if (label.includes(n) || (handle && handle.includes(n))) return { e, s: 1 };
      return { e, s: 0 };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored[0]?.e ?? null;
}

/** entities linked by membership: person -> projects, project -> members */
export function linkedEntities(e: Entity): Entity[] {
  const ids = e.kind === 'person' ? e.projectIds : e.memberIds;
  return ents(ids);
}

/** rank ids by how many source entities pointed at them, then by activity */
function rankLinked(sources: Entity[], get: (e: Entity) => string[]): Entity[] {
  const count = new Map<string, number>();
  for (const s of sources) for (const id of get(s)) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count.entries()]
    .map(([id, c]) => ({ e: dataset.byId[id], c }))
    .filter((x) => x.e)
    .sort((a, b) => b.c - a.c || b.e.activeScore - a.e.activeScore)
    .map((x) => x.e);
}

const km = (e: Entity) => Math.round(geoDistanceKm(e, me));
const label = (e: Entity) => entityLabel(e);
const IRREGULAR: Record<string, string> = { person: 'people', match: 'matches', human: 'humans' };
const plural = (n: number, s: string) => `${n} ${n === 1 ? s : IRREGULAR[s] ?? `${s}s`}`;

/**
 * Resolve a question locally. Follow-ups are resolved against the ids of the
 * previous assistant turn using membership links, geo distance and facets;
 * anything else falls through to `localSearch`.
 */
export function resolveOffline(turns: Turn[], question: string): Answer {
  const q = norm(question);
  const prev = ents(lastAssistantIds(turns));
  const prevPeople = prev.filter((e) => e.kind === 'person');
  const prevProjects = prev.filter((e) => e.kind === 'project');
  const words = q.split(' ').filter(Boolean);
  const pronoun = /\b(their|them|they|these|those|his|her|it|its|there)\b/.test(q);

  const done = (list: Entity[], reply: string): Answer => {
    const ids = idsOf(list);
    return { reply, ids, followUps: followUpsFor(ids, q), offline: true };
  };

  /* 1 — "tell me about X" / "who is X" -------------------------------- */
  const about = question.match(
    /(?:tell me (?:more )?about|what(?:'s| is| are)|who(?:'s| is| are)|more about|info on|details on|open|show me)\s+(.{2,60})$/i,
  );
  if (about) {
    const hit = byName(about[1]);
    if (hit) {
      const links = linkedEntities(hit);
      const blurb =
        hit.kind === 'person'
          ? `${hit.name} — ${hit.domain} in ${hit.city}, into ${hit.tags[0]}. Wants ${hit.lookingFor}.`
          : `${hit.title} — ${hit.status} ${hit.domain} project in ${hit.city}. Needs ${hit.needs[0]}.`;
      return done([hit, ...links], blurb);
    }
  }

  /* 2 — projects of the people we just showed ------------------------- */
  const asksProjects = /\bprojects?\b/.test(q) || /\bworking on\b/.test(q) || /\bshipping\b/.test(q);
  if (prevPeople.length && asksProjects && (pronoun || /^(show|list|what|find|any)\b/.test(q))) {
    const linked = rankLinked(prevPeople, (e) => (e.kind === 'person' ? e.projectIds : []));
    if (linked.length) {
      return done(
        linked,
        `Those ${plural(prevPeople.length, 'human')} are on ${plural(linked.length, 'project')} — top: ${label(linked[0])}.`,
      );
    }
    return done([], `None of those ${prevPeople.length} have joined a project yet. Try another angle?`);
  }

  /* 3 — people behind the projects we just showed --------------------- */
  const asksMembers =
    /\b(members?|team|crew|roster)\b/.test(q) ||
    /\bwho\b[\s\S]*\b(on|behind|in|works|working|built|building)\b/.test(q);
  if (prevProjects.length && asksMembers) {
    const linked = rankLinked(prevProjects, (e) => (e.kind === 'project' ? e.memberIds : []));
    if (linked.length) {
      return done(
        linked,
        `${plural(linked.length, 'person')} behind ${prevProjects.length === 1 ? label(prevProjects[0]) : `those ${prevProjects.length}`} — starting with ${label(linked[0])}.`,
      );
    }
    return done([], `Those projects have no members listed yet. Want something else?`);
  }

  /* 4 — "who's nearby?" ---------------------------------------------- */
  if (/\bnear(by|est| me| here)?\b|\bclosest\b|\bclose to me\b|\baround (me|here)\b|\blocal\b|\bmy area\b/.test(q)) {
    // strip the "near me" part so relevance isn't swamped by the proximity boost,
    // then rank the topically-relevant set purely by distance.
    const topical = question.replace(
      /\bnear(by| me| here)?\b|\bclosest\b|\bclose to me\b|\baround (me|here)\b|\blocal\b|\b(in )?my area\b/gi,
      ' ',
    ).trim();
    let base = prev.length ? prev : ents(localSearch(topical || question, 40).ids);
    if (!base.length) base = allEntities;
    const facets = detectFacets(q);
    const kind = facets.kind ?? (/\bwho\b/.test(q) ? 'person' : undefined);
    // honour topical facets (domain/tag/city) before sorting by distance, then relax to kind-only, then the raw pool
    const strict = applyFacets(base, { ...facets, kind });
    const narrowed = strict.length ? strict : applyFacets(base, { kind });
    const pool = (narrowed.length ? narrowed : base).slice();
    pool.sort((a, b) => geoDistanceKm(a, me) - geoDistanceKm(b, me));
    const top = pool.slice(0, MAX_IDS);
    if (top.length) {
      return done(
        top,
        `${plural(top.length, 'match')} closest to ${me.city} — ${label(top[0])} is ~${km(top[0])}km out in ${top[0].city}.`,
      );
    }
  }

  /* 5 — "narrow to <city / country / region / domain / tag / kind>" ---- */
  const facets = detectFacets(q);
  const explicitNarrow =
    /\b(narrow|filter|only|just|limit|restrict|these|those|which|among)\b/.test(q) || words.length <= 3;
  if (hasFacet(facets) && (explicitNarrow || pronoun) && prev.length) {
    const kept = applyFacets(prev, facets);
    if (kept.length) {
      return done(kept, `Narrowed to ${plural(kept.length, 'match')} in ${facets.label} — top: ${label(kept[0])}.`);
    }
    const wider = applyFacets(allEntities, facets).sort((a, b) => b.activeScore - a.activeScore);
    if (wider.length) {
      return done(wider, `None of those were in ${facets.label} — but here are ${wider.length > MAX_IDS ? MAX_IDS : wider.length} that are.`);
    }
  }

  /* 6 — "more like these" / "who else" -------------------------------- */
  if (prev.length && /\b(more like|similar|others like|who else|what else|anything else|like (these|those|that|them|him|her))\b/.test(q)) {
    const seed = prev[0];
    const seen = new Set(prev.map((e) => e.id));
    const near = allEntities
      .filter((e) => !seen.has(e.id))
      .map((e) => ({ e, d: simDistance(e, seed) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.e);
    return done(near, `${MAX_IDS} more in the same neighbourhood as ${label(seed)}.`);
  }

  /* 7 — plain search -------------------------------------------------- */
  const r = localSearch(question, MAX_IDS);
  return { reply: r.summary, ids: r.ids, followUps: followUpsFor(r.ids, q), offline: true };
}

/* ------------------------------------------------------------------ *
 * Follow-up chips
 * ------------------------------------------------------------------ */

export function followUpsFor(ids: string[], q = ''): string[] {
  const list = ents(ids);
  if (!list.length) return STARTERS.slice(0, 3);
  const people = list.filter((e) => e.kind === 'person');
  const projects = list.filter((e) => e.kind === 'project');
  const top = list[0];
  const out: string[] = [];

  if (people.length && people.some((p) => p.kind === 'person' && p.projectIds.length)) out.push('show me their projects');
  if (projects.length && projects.some((p) => p.kind === 'project' && p.memberIds.length)) out.push("who's on these?");
  if (!/near/.test(q)) out.push("who's nearby?");

  const countries = uniq(list.map((e) => e.country));
  if (countries.length > 1) out.push(`narrow to ${countries[1]}`);
  const tally = new Map<string, number>();
  for (const e of list) tally.set(e.domain, (tally.get(e.domain) ?? 0) + 1);
  const [topDomain, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  if (tally.size > 1 && count >= 2) out.push(`only ${topDomain} ones`);
  out.push(`tell me about ${entityLabel(top)}`);
  out.push('more like these');

  return uniq(out).slice(0, 3);
}
