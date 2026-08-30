import { allEntities, dataset, me, geoDistanceKm, entityLabel } from '../data';
import type { Entity } from '../data';

/** Compact catalogue sent to Claude so it can rank by id. ~6k tokens. */
export function catalogue(): string {
  return allEntities
    .map((e) =>
      e.kind === 'person'
        ? `${e.id}|P|${e.name}|${e.city}|${e.domain}|${e.tags.join(',')}|${e.skills.join(',')}|wants ${e.lookingFor}`
        : `${e.id}|J|${e.title}|${e.city}|${e.domain}|${e.tags.join(',')}|needs ${e.needs.join(',')}|${e.status}`,
    )
    .join('\n');
}

export const SYSTEM = `You are the search brain for Hopamine, a network of people and impact projects.
The user is "${me.name}" in ${me.city} (lat ${me.lat}, lng ${me.lng}), interested in ${me.tags.join(', ')}.
Rows are: id|P(erson)/J(project)|name|city|domain|tags|skills-or-needs|extra.
Answer ONLY using ids from the catalogue. Never invent ids.

CATALOGUE:
${catalogue()}`;

export interface SearchResult {
  /** Ordered best-first. */
  ids: string[];
  /** One-line, friendly explanation of what was found. */
  summary: string;
  /** How results should be laid out. */
  intent: 'people' | 'projects' | 'mixed' | 'nearby' | 'chat';
  /** True if the local fallback was used instead of Claude. */
  offline: boolean;
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ids: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    intent: { type: 'string', enum: ['people', 'projects', 'mixed', 'nearby', 'chat'] },
  },
  required: ['ids', 'summary', 'intent'],
  additionalProperties: false,
};

let aiAvailable: boolean | null = null;

/** Generic call: returns text or parsed JSON. Throws on network/API error. */
export async function callAI<T = string>(prompt: string, opts: { system?: string; schema?: object; max_tokens?: number } = {}): Promise<T> {
  const r = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system: opts.system ?? SYSTEM, prompt, schema: opts.schema, max_tokens: opts.max_tokens }),
  });
  if (!r.ok) throw new Error(`ai ${r.status}`);
  const j = await r.json();
  if (j.error === 'no_api_key') { aiAvailable = false; throw new Error('no_api_key'); }
  if (j.error) throw new Error(j.error);
  aiAvailable = true;
  return (opts.schema ? j.json : j.text) as T;
}

/**
 * The main search entry point every prototype should use.
 * Uses Claude when ANTHROPIC_API_KEY is set on the dev server; otherwise a
 * local tag/keyword scorer so the UI always works.
 */
export async function search(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
  const limit = opts.limit ?? 12;
  if (aiAvailable !== false) {
    try {
      const j = await callAI<{ ids: string[]; summary: string; intent: SearchResult['intent'] }>(
        `Query: "${query}"\nReturn up to ${limit} best-matching ids (best first), a one-sentence summary, and the intent. If the query mentions "near me"/"nearby"/"local", prefer entities close to the user's coordinates and use intent "nearby".`,
        { schema: RESULT_SCHEMA, max_tokens: 1000 },
      );
      const ids = j.ids.filter((id) => dataset.byId[id]).slice(0, limit);
      if (ids.length) return { ...j, ids, offline: false };
    } catch (e) {
      if ((e as Error).message !== 'no_api_key') console.warn('[ai] falling back to local search:', e);
    }
  }
  return { ...localSearch(query, limit), offline: true };
}

/** Keyword/tag scorer. Exported so prototypes can use it for instant previews. */
export function localSearch(query: string, limit = 12): Omit<SearchResult, 'offline'> {
  const q = query.toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const wantsNearby = /near me|nearby|local|around here|close to me/.test(q);
  const wantsPeople = /\b(people|person|someone|who|folks|anyone)\b/.test(q);
  const wantsProjects = /\b(project|projects|initiative|team|teams)\b/.test(q);
  const scored = allEntities.map((e) => {
    const hay = haystack(e);
    let s = 0;
    for (const w of words) {
      if (hay.includes(w)) s += 2;
      for (const syn of SYNONYMS[w] ?? []) if (hay.includes(syn)) s += 1.5;
    }
    if (wantsPeople && e.kind === 'person') s += 1;
    if (wantsProjects && e.kind === 'project') s += 1;
    if (wantsNearby) s += Math.max(0, 3 - geoDistanceKm(e, me) / 500);
    s += e.activeScore * 0.3;
    return { e, s };
  }).filter((x) => x.s > 0.5).sort((a, b) => b.s - a.s).slice(0, limit);
  const ids = scored.map((x) => x.e.id);
  const intent: SearchResult['intent'] = wantsNearby ? 'nearby' : wantsPeople && !wantsProjects ? 'people' : wantsProjects && !wantsPeople ? 'projects' : 'mixed';
  const summary = ids.length
    ? `Found ${ids.length} match${ids.length === 1 ? '' : 'es'} for "${query}" — top: ${entityLabel(dataset.byId[ids[0]])}.`
    : `Nothing matched "${query}" — try a domain like climate, robotics, food, or a city.`;
  return { ids, summary, intent };
}

function haystack(e: Entity) {
  return e.kind === 'person'
    ? [e.name, e.bio, e.city, e.country, e.domain, ...e.tags, ...e.skills, e.lookingFor].join(' ').toLowerCase()
    : [e.title, e.tagline, e.description, e.city, e.country, e.domain, ...e.tags, ...e.needs, e.status].join(' ').toLowerCase();
}
const STOP = new Set(['the','and','for','who','are','with','show','find','get','all','into','about','that','this','what','from','near','some']);
const SYNONYMS: Record<string, string[]> = {
  cars: ['mobility','car repair','evs','garage'], car: ['mobility','car repair','evs'], tech: ['software','devtools','apis'],
  electronics: ['embedded','arduino','sensors','hardware'], coding: ['software','react','python','bootcamps'],
  farming: ['food','urban farming','permaculture'], garden: ['food','permaculture','rooftop'], kids: ['education','stem outreach','tutoring'],
  doctor: ['health','clinics','telemedicine'], solar: ['energy'], bikes: ['mobility','bike'], music: ['art','sound'], drawing: ['art','murals','pixel art'],
  robots: ['robotics'], drone: ['drones'], climate: ['carbon','reforestation','ocean'], help: ['mutual aid','volunteer'],
};
