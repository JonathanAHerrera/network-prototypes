/**
 * 04-graph — layout brains.
 * Plan schema + validation, the local (offline) planner, graph construction and
 * the d3-force configurations for every layout mode.
 */
import { forceRadial, forceX, forceY } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { z } from 'zod';
import { DOMAINS, DOMAIN_COLORS, allEntities, dataset, entityLabel, simDistance } from '../../shared/data';
import type { Domain, Entity } from '../../shared/data';

/* ------------------------------------------------------------------ graph */

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  entity: Entity;
  /** collision radius at base scale */
  r: number;
  /** rendered card size at base scale (used for glow rings) */
  w: number;
  h: number;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  kind: 'member' | 'sim';
}

export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
  /** id -> neighbour ids (both link kinds) */
  adj: Map<string, Set<string>>;
  index: Map<string, GraphNode>;
}

/** Compact-card footprints (see shared/ui EntityCard `compact`). */
export const CARD = { personW: 120, personH: 120, projectW: 150, projectH: 112 };
export const BASE_SCALE = 0.58;

/** People are circles, projects are squares — build nodes + both edge kinds. */
export function buildGraph(): Graph {
  const nodes: GraphNode[] = allEntities.map((entity) => ({
    id: entity.id,
    entity,
    r: entity.kind === 'person' ? 36 : 48,
    w: entity.kind === 'person' ? CARD.personW : CARD.projectW,
    h: entity.kind === 'person' ? CARD.personH : CARD.projectH,
  }));
  const index = new Map(nodes.map((n) => [n.id, n]));

  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // membership edges (solid)
  for (const p of dataset.people) {
    for (const pid of p.projectIds) {
      if (!index.has(pid) || seen.has(key(p.id, pid))) continue;
      seen.add(key(p.id, pid));
      links.push({ source: index.get(p.id)!, target: index.get(pid)!, kind: 'member' });
    }
  }

  // similarity edges: k-nearest (k = 2) in similarity space (dashed, faint)
  const K = 2;
  for (const n of nodes) {
    const near = nodes
      .filter((o) => o.id !== n.id)
      .map((o) => ({ o, d: simDistance(n.entity, o.entity) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, K);
    for (const { o } of near) {
      if (seen.has(key(n.id, o.id))) continue;
      seen.add(key(n.id, o.id));
      links.push({ source: n, target: o, kind: 'sim' });
    }
  }

  const adj = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const l of links) {
    const a = (l.source as GraphNode).id;
    const b = (l.target as GraphNode).id;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  return { nodes, links, adj, index };
}

/* ------------------------------------------------------------------- plan */

export type Mode = 'default' | 'cluster' | 'axis' | 'radial';

export interface LayoutPlan {
  mode: 'cluster' | 'axis' | 'radial';
  summary: string;
  groups?: { label: string; ids: string[] }[];
  axisLabel?: { left: string; right: string };
  /** id -> score in [-1, 1] */
  scores?: Record<string, number>;
  centerIds?: string[];
}

/** JSON schema handed to callAI (strict — no dynamic keys, hence `scores` as an array). */
export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['cluster', 'axis', 'radial'] },
    summary: { type: 'string' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } },
        required: ['label', 'ids'],
        additionalProperties: false,
      },
    },
    axisLabel: {
      type: 'object',
      properties: { left: { type: 'string' }, right: { type: 'string' } },
      required: ['left', 'right'],
      additionalProperties: false,
    },
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, score: { type: 'number' } },
        required: ['id', 'score'],
        additionalProperties: false,
      },
    },
    centerIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['mode', 'summary'],
  additionalProperties: false,
} as const;

export function buildPrompt(query: string, ids: string[]): string {
  return `Query: "${query}"
Search results (best first): ${ids.join(', ') || '(none)'}
Design a graph layout that best answers this query.
- "radial": use when the question asks who/what could help / is relevant. centerIds = the best results (ring 0); everything else arranged outward.
- "axis": use when the query compares two things (compare / vs / versus / spectrum). Give axisLabel {left,right} and a score in [-1,1] for every relevant id (-1 = fully left, 1 = fully right). Include ~20-40 ids.
- "cluster": use when the query asks to group / categorise / "by". Give 3-6 labelled groups with ids (each id in one group only).
summary: one playful sentence (<= 120 chars) explaining the layout.
Only use ids from the catalogue.`;
}

const planSchema = z.object({
  mode: z.enum(['cluster', 'axis', 'radial']),
  summary: z.string(),
  groups: z
    .array(z.object({ label: z.string(), ids: z.array(z.string()) }))
    .nullish(),
  axisLabel: z.object({ left: z.string(), right: z.string() }).nullish(),
  scores: z.array(z.object({ id: z.string(), score: z.number() })).nullish(),
  centerIds: z.array(z.string()).nullish(),
});

/** Validate + sanitise a plan coming back from Claude. Unknown ids are dropped. */
export function parsePlan(raw: unknown): LayoutPlan | null {
  const p = planSchema.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  const known = (id: string) => Boolean(dataset.byId[id]);
  const used = new Set<string>();

  const groups = (d.groups ?? [])
    .map((g) => ({
      label: g.label.slice(0, 28),
      ids: g.ids.filter((id) => known(id) && !used.has(id) && (used.add(id), true)),
    }))
    .filter((g) => g.ids.length > 0)
    .slice(0, 6);

  const scores: Record<string, number> = {};
  for (const s of d.scores ?? []) {
    if (!known(s.id) || !Number.isFinite(s.score)) continue;
    scores[s.id] = Math.max(-1, Math.min(1, s.score));
  }
  const centerIds = (d.centerIds ?? []).filter(known).slice(0, 12);

  const plan: LayoutPlan = {
    mode: d.mode,
    summary: d.summary.slice(0, 200),
    groups: groups.length ? groups : undefined,
    axisLabel: d.axisLabel ?? undefined,
    scores: Object.keys(scores).length ? scores : undefined,
    centerIds: centerIds.length ? centerIds : undefined,
  };

  // A mode with no usable payload is worse than no plan at all.
  if (plan.mode === 'cluster' && !plan.groups) return null;
  if (plan.mode === 'axis' && !plan.scores) return null;
  return plan;
}

/* ----------------------------------------------------------- local planner */

const STOP = new Set([
  'the', 'and', 'for', 'who', 'are', 'with', 'show', 'find', 'get', 'all', 'into', 'about', 'that',
  'this', 'what', 'from', 'near', 'some', 'could', 'help', 'people', 'person', 'project', 'projects',
  'compare', 'versus', 'group', 'them', 'their', 'they', 'them', 'kind', 'kinds', 'type', 'types',
  'need', 'needs', 'best', 'good', 'most', 'more', 'than', 'like', 'want', 'wants', 'looking',
]);

function words(s: string) {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function haystack(e: Entity) {
  return (
    e.kind === 'person'
      ? [e.name, e.bio, e.city, e.country, e.domain, ...e.tags, ...e.skills, e.lookingFor]
      : [e.title, e.tagline, e.description, e.city, e.country, e.domain, ...e.tags, ...e.needs, e.status]
  )
    .join(' ')
    .toLowerCase();
}

function hits(e: Entity, ws: string[]) {
  if (!ws.length) return 0;
  const hay = haystack(e);
  let n = 0;
  for (const w of ws) if (hay.includes(w)) n++;
  return n;
}

function pickMode(q: string): LayoutPlan['mode'] {
  const s = q.toLowerCase();
  if (/\bcompare\b|\bvs\.?\b|\bversus\b|spectrum|between/.test(s)) return 'axis';
  if (/\bgroup\b|\bby\b|categor|\bkinds?\b|\btypes?\b|\bsort\b|\bbucket/.test(s)) return 'cluster';
  return 'radial';
}

const DOMAIN_SET = new Set<string>(DOMAINS);
const isDomain = (s: string): s is Domain => DOMAIN_SET.has(s);

/**
 * Offline / fallback planner. Mode is chosen by keyword, then the layout is
 * filled in from the local keyword scorer so the graph still says something.
 */
export function localPlan(query: string, ids: string[]): LayoutPlan {
  const mode = pickMode(query);
  const known = ids.filter((id) => dataset.byId[id]);

  if (mode === 'axis') {
    const s = query.toLowerCase();
    const m = s.split(/\bvs\.?\b|\bversus\b|\bagainst\b|\bor\b|\bcompared? (?:to|with)\b/);
    const leftRaw = (m[0] ?? '').replace(/^\s*compare\s*/, '').trim();
    const rightRaw = (m[1] ?? '').trim();
    const lw = words(leftRaw);
    const rw = words(rightRaw);
    const label = (raw: string, ws: string[], fb: string) =>
      (ws[0] ? ws.slice(0, 2).join(' ') : raw.slice(0, 18).trim()) || fb;

    const scores: Record<string, number> = {};
    const scored = allEntities
      .map((e) => {
        const l = hits(e, lw);
        const r = hits(e, rw);
        return { e, l, r, total: l + r };
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 40);
    for (const x of scored) scores[x.e.id] = (x.r - x.l) / x.total;
    // keep the search hits on the board even if they matched neither side
    for (const id of known) if (!(id in scores)) scores[id] = 0;

    return {
      mode: 'axis',
      summary: `${label(leftRaw, lw, 'left')} on the left, ${label(rightRaw, rw, 'right')} on the right — everyone placed by which way they lean.`,
      axisLabel: { left: label(leftRaw, lw, 'left'), right: label(rightRaw, rw, 'right') },
      scores,
    };
  }

  if (mode === 'cluster') {
    const ws = words(query);
    const wantsProjects = /\bprojects?\b|\bteams?\b|\binitiatives?\b/.test(query.toLowerCase());
    const wantsPeople = /\bpeople\b|\bperson\b|\bfolks\b|\bwho\b/.test(query.toLowerCase());
    const pool = new Map<string, Entity>();
    for (const id of known) pool.set(id, dataset.byId[id]);
    const extra = allEntities
      .filter((e) => (wantsProjects && !wantsPeople ? e.kind === 'project' : wantsPeople && !wantsProjects ? e.kind === 'person' : true))
      .map((e) => ({ e, s: hits(e, ws) + e.activeScore * 0.2 }))
      .filter((x) => x.s > 0.9)
      .sort((a, b) => b.s - a.s)
      .slice(0, 36);
    for (const { e } of extra) pool.set(e.id, e);

    const byDomain = new Map<Domain, string[]>();
    for (const e of pool.values()) {
      if (!byDomain.has(e.domain)) byDomain.set(e.domain, []);
      byDomain.get(e.domain)!.push(e.id);
    }
    const groups = [...byDomain.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([d, gids]) => ({ label: d, ids: gids }));

    if (!groups.length) {
      return { mode: 'radial', summary: `Nothing matched "${query}" — showing the network as it was.`, centerIds: [] };
    }
    return {
      mode: 'cluster',
      summary: `Sorted ${[...pool.keys()].length} matches into ${groups.length} piles — one per domain.`,
      groups,
    };
  }

  const centerIds = known.slice(0, 8);
  return {
    mode: 'radial',
    summary: centerIds.length
      ? `${centerIds.length} closest match${centerIds.length === 1 ? '' : 'es'} pulled into the bullseye — ${entityLabel(dataset.byId[centerIds[0]])} leads.`
      : `Nothing matched "${query}" — try a domain like climate, robotics or food.`,
    centerIds,
  };
}

/* ---------------------------------------------------------------- geometry */

export interface Dims { w: number; h: number }

export interface Geometry {
  mode: Mode;
  cx: number;
  cy: number;
  /** cluster / default: label + members (label drawn at the live centroid) */
  groups: { label: string; color: string; ids: Set<string> }[];
  axis?: { left: string; right: string; halfW: number };
  rings?: number[];
  /** ids that should read as "results" for hull/label emphasis */
  scored?: Record<string, number>;
}

const domainColor = (d: string) => (isDomain(d) ? DOMAIN_COLORS[d] : '#7fb2ff');

const GROUP_PALETTE = ['#4f7cff', '#ffb340', '#37c96c', '#ff5fa2', '#c86bff', '#21c2d6'];

/**
 * Swap the mode forces on an existing simulation (never re-create it) and
 * return the geometry the canvas needs to draw labels/hulls/rings.
 */
export function applyLayout(
  sim: Simulation<GraphNode, GraphLink>,
  graph: Graph,
  plan: LayoutPlan | null,
  dims: Dims,
): Geometry {
  const cx = dims.w / 2;
  const cy = dims.h / 2;
  const R = Math.min(dims.w, dims.h);

  const setForces = (
    tx: (n: GraphNode) => number,
    sx: (n: GraphNode) => number,
    ty: (n: GraphNode) => number,
    sy: (n: GraphNode) => number,
    radius: ((n: GraphNode) => number) | null,
    sr: (n: GraphNode) => number,
  ) => {
    sim.force('mx', forceX<GraphNode>(tx).strength(sx));
    sim.force('my', forceY<GraphNode>(ty).strength(sy));
    if (radius) sim.force('mr', forceRadial<GraphNode>(radius, cx, cy).strength(sr));
    else sim.force('mr', null);
  };

  // ---------------------------------------------------------------- default
  if (!plan) {
    const cyD = cy + 40;
    const ring = 0.52 * R;
    const centres = new Map<string, { x: number; y: number }>();
    DOMAINS.forEach((d, i) => {
      const a = (i / DOMAINS.length) * Math.PI * 2 - Math.PI / 2;
      centres.set(d, { x: cx + ring * Math.cos(a), y: cyD + ring * Math.sin(a) * 0.82 });
    });
    setForces(
      (n) => centres.get(n.entity.domain)!.x,
      () => 0.3,
      (n) => centres.get(n.entity.domain)!.y,
      () => 0.3,
      null,
      () => 0,
    );
    return {
      mode: 'default',
      cx,
      cy: cyD,
      groups: DOMAINS.map((d) => ({
        label: d,
        color: domainColor(d),
        ids: new Set(graph.nodes.filter((n) => n.entity.domain === d).map((n) => n.id)),
      })),
    };
  }

  // ---------------------------------------------------------------- cluster
  if (plan.mode === 'cluster' && plan.groups?.length) {
    const gs = plan.groups;
    const ring = 0.33 * R;
    const centres = gs.map((_, i) => {
      const a = (i / gs.length) * Math.PI * 2 - Math.PI / 2;
      return { x: cx + ring * Math.cos(a), y: cy + ring * Math.sin(a) * 0.9 };
    });
    const owner = new Map<string, number>();
    gs.forEach((g, i) => g.ids.forEach((id) => owner.set(id, i)));

    setForces(
      (n) => centres[owner.get(n.id) ?? 0].x,
      (n) => (owner.has(n.id) ? 0.3 : 0),
      (n) => centres[owner.get(n.id) ?? 0].y,
      (n) => (owner.has(n.id) ? 0.3 : 0),
      () => 0.62 * R,
      (n) => (owner.has(n.id) ? 0 : 0.05),
    );
    return {
      mode: 'cluster',
      cx,
      cy,
      groups: gs.map((g, i) => ({
        label: g.label,
        color: isDomain(g.label.toLowerCase()) ? domainColor(g.label.toLowerCase()) : GROUP_PALETTE[i % GROUP_PALETTE.length],
        ids: new Set(g.ids),
      })),
    };
  }

  // ------------------------------------------------------------------- axis
  if (plan.mode === 'axis' && plan.scores) {
    const scores = plan.scores;
    const halfW = 0.40 * dims.w;
    setForces(
      (n) => cx + (scores[n.id] ?? 0) * halfW,
      (n) => (n.id in scores ? 0.5 : 0),
      (n) => (n.id in scores ? cy : cy + 0.38 * dims.h),
      (n) => (n.id in scores ? 0.15 : 0.06),
      null,
      () => 0,
    );
    return {
      mode: 'axis',
      cx,
      cy,
      groups: [],
      axis: { left: plan.axisLabel?.left ?? 'left', right: plan.axisLabel?.right ?? 'right', halfW },
      scored: scores,
    };
  }

  // ----------------------------------------------------------------- radial
  const centers = new Set(plan.centerIds ?? []);
  const ring1 = new Set<string>();
  for (const id of centers) for (const nb of graph.adj.get(id) ?? []) if (!centers.has(nb)) ring1.add(nb);
  const r1 = 0.2 * R;
  const r2 = 0.44 * R;
  setForces(
    () => cx,
    () => 0.01,
    () => cy,
    () => 0.01,
    (n) => (centers.has(n.id) ? 0 : ring1.has(n.id) ? r1 : r2),
    (n) => (centers.has(n.id) ? 0.6 : ring1.has(n.id) ? 0.35 : 0.25),
  );
  return { mode: 'radial', cx, cy, groups: [], rings: [r1, r2] };
}
