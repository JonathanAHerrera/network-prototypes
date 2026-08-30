/**
 * 07 Mini-network — pure ring assignment + edge builder.
 *
 * Every query yields a small self-contained network: the answer sits at the
 * centre and rings outward get progressively looser but still related.
 * No React, no DOM — unit-testable on its own.
 */
import { allEntities, dataset, entityLabel, simDistance } from '../../shared/data';
import type { Entity } from '../../shared/data';

export type Ring = 0 | 1 | 2 | 3;

export interface NetNode {
  id: string;
  entity: Entity;
  ring: Ring;
  /** Human-readable reason this node made it into the network (tooltip copy). */
  why: string;
}

export interface NetEdge {
  source: string;
  target: string;
  kind: 'member' | 'sim' | 'ring';
}

export interface Network {
  nodes: NetNode[];
  edges: NetEdge[];
}

/** Ring guide captions drawn on the canvas. */
export const RING_LABELS = ['your answer', 'close', 'adjacent', 'wildcard'] as const;

const MAX_NODES = 30;
const RING1_CAP = 10;
const RING1_FROM_SEARCH = 8;
const RING2_CAP = 10;
const RING3_CAP = 5;

/* ------------------------------------------------------------------ utils */

function links(e: Entity): string[] {
  return e.kind === 'person' ? e.projectIds : e.memberIds;
}

function isLinked(a: Entity, b: Entity): boolean {
  return links(a).includes(b.id) || links(b).includes(a.id);
}

function sharedTags(a: Entity, b: Entity): string[] {
  const set = new Set(b.tags);
  return a.tags.filter((t) => set.has(t));
}

function quoteTags(tags: string[]): string {
  return tags.slice(0, 2).map((t) => `“${t}”`).join(' + ');
}

/** Deterministic PRNG so the same centre always shuffles the same way. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ build */

interface BuildOpts {
  /** Ordered ids: search results, or a single id when re-centring. */
  ids: string[];
  ring0Count: number;
  /** `why` copy for the ring-0 nodes. */
  centreWhy: (rank: number) => string;
  ring1SearchWhy: string;
  seed: string;
}

function build({ ids, ring0Count, centreWhy, ring1SearchWhy, seed }: BuildOpts): Network {
  const valid = ids.filter((id) => dataset.byId[id]);
  const placed = new Map<string, NetNode>();
  /** ring-2/3 node -> the node it was attached to (for the edge pass). */
  const attachedTo = new Map<string, string>();

  const add = (id: string, ring: Ring, why: string) => {
    const entity = dataset.byId[id];
    if (!entity || placed.has(id) || placed.size >= MAX_NODES) return false;
    placed.set(id, { id, entity, ring, why });
    return true;
  };
  const ringNodes = (r: Ring) => [...placed.values()].filter((n) => n.ring === r);

  /* --- ring 0 "your answer" ------------------------------------------- */
  valid.slice(0, ring0Count).forEach((id, i) => add(id, 0, centreWhy(i)));
  const ring0 = ringNodes(0);
  if (!ring0.length) return { nodes: [], edges: [] };

  /* --- ring 1 "close": remaining search hits, then membership neighbours */
  valid
    .slice(ring0Count)
    .filter((id) => !placed.has(id))
    .slice(0, RING1_FROM_SEARCH)
    .forEach((id) => add(id, 1, ring1SearchWhy));

  const neighbours: { id: string; via: NetNode }[] = [];
  for (const n0 of ring0) {
    for (const nid of links(n0.entity)) {
      if (!placed.has(nid) && dataset.byId[nid] && !neighbours.some((n) => n.id === nid)) {
        neighbours.push({ id: nid, via: n0 });
      }
    }
  }
  neighbours.sort((a, b) => dataset.byId[b.id].activeScore - dataset.byId[a.id].activeScore);
  for (const n of neighbours) {
    if (ringNodes(1).length >= RING1_CAP) break;
    const viaLabel = entityLabel(n.via.entity);
    const why =
      dataset.byId[n.id].kind === 'project' ? `${viaLabel} is a member` : `member of ${viaLabel}`;
    if (add(n.id, 1, why)) attachedTo.set(n.id, n.via.id);
  }

  /* --- ring 2 "adjacent": nearest in similarity space ------------------ */
  const anchors = ringNodes(1).length ? ringNodes(1) : ring0;
  const nearest = allEntities
    .filter((e) => !placed.has(e.id))
    .map((e) => {
      let best = anchors[0];
      let dist = Infinity;
      for (const a of anchors) {
        const d = simDistance(e, a.entity);
        if (d < dist) {
          dist = d;
          best = a;
        }
      }
      return { e, dist, anchor: best };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, RING2_CAP);

  for (const n of nearest) {
    const st = sharedTags(n.e, n.anchor.entity);
    const why = st.length
      ? `shares ${quoteTags(st)} with ${entityLabel(n.anchor.entity)}`
      : `similar interests to ${entityLabel(n.anchor.entity)}`;
    if (add(n.e.id, 2, why)) attachedTo.set(n.e.id, n.anchor.id);
  }

  /* --- ring 3 "wildcard": different domain, shared tags ---------------- */
  const ring0Domains = new Set(ring0.map((n) => n.entity.domain));
  const core = [...ring0, ...ringNodes(1)];
  const wildcards = allEntities
    .filter((e) => !placed.has(e.id) && !ring0Domains.has(e.domain))
    .map((e) => {
      let via = core[0];
      let tags: string[] = [];
      for (const c of core) {
        const st = sharedTags(e, c.entity);
        if (st.length > tags.length) {
          tags = st;
          via = c;
        }
      }
      return { e, via, tags };
    })
    .filter((x) => x.tags.length > 0)
    .sort((a, b) => b.tags.length - a.tags.length || b.e.activeScore - a.e.activeScore);

  // Keep the strongest candidates, then shuffle deterministically so the
  // wildcard ring feels serendipitous instead of always identical ordering.
  const pool = shuffle(wildcards.slice(0, RING3_CAP * 3), seeded(seed));
  for (const w of pool) {
    if (ringNodes(3).length >= RING3_CAP) break;
    const why = `wildcard — ${w.e.domain}, but shares ${quoteTags(w.tags)} with ${entityLabel(w.via.entity)}`;
    if (add(w.e.id, 3, why)) attachedTo.set(w.e.id, w.via.id);
  }

  /* --- edges ----------------------------------------------------------- */
  const nodes = [...placed.values()].sort((a, b) => a.ring - b.ring);
  const edges: NetEdge[] = [];
  const seen = new Set<string>();
  const push = (source: string, target: string, kind: NetEdge['kind']) => {
    if (source === target || !placed.has(source) || !placed.has(target)) return;
    const key = [source, target].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };

  // membership — strongest signal, added first so it wins the dedupe.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (isLinked(nodes[i].entity, nodes[j].entity)) push(nodes[i].id, nodes[j].id, 'member');
    }
  }

  // similarity — ring 1 to its nearest ring-0, ring 2 to its anchor.
  for (const n of nodes) {
    if (n.ring === 1) {
      let best = ring0[0];
      let dist = Infinity;
      for (const c of ring0) {
        const d = simDistance(n.entity, c.entity);
        if (d < dist) {
          dist = d;
          best = c;
        }
      }
      push(n.id, best.id, 'sim');
    } else if (n.ring === 2) {
      const anchor = attachedTo.get(n.id);
      if (anchor) push(n.id, anchor, 'sim');
    }
  }

  // ring — wildcards hang off whatever they share tags with.
  for (const n of nodes) {
    if (n.ring === 3) {
      const anchor = attachedTo.get(n.id);
      if (anchor) push(n.id, anchor, 'ring');
    }
  }

  return { nodes, edges };
}

/* ------------------------------------------------------------------- API */

/** Build a mini-network from an ordered list of search-result ids. */
export function buildFromSearch(ids: string[]): Network {
  return build({
    ids,
    ring0Count: Math.min(3, ids.length),
    centreWhy: (rank) => (rank === 0 ? 'top result for your question' : 'a strong match for your question'),
    ring1SearchWhy: 'also matched your question',
    seed: ids.slice(0, 4).join('-') || 'empty',
  });
}

/** Rebuild the network around a single entity — no AI call needed. */
export function buildFromCentre(id: string): Network {
  const entity = dataset.byId[id];
  if (!entity) return { nodes: [], edges: [] };
  // Seed ring 1 with this entity's direct links so re-centring always has
  // something concrete around it before the similarity rings fill in.
  const ids = [id, ...links(entity)];
  return build({
    ids,
    ring0Count: 1,
    centreWhy: () => 'the centre of this network',
    ring1SearchWhy: entity.kind === 'person' ? `a project ${entityLabel(entity)} works on` : `on the ${entityLabel(entity)} team`,
    seed: `centre-${id}`,
  });
}
