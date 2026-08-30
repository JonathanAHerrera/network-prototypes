/**
 * 01-plane — static world layout.
 *
 * Entities carry a similarity-space coordinate in [0,1]^2 (`entity.pos`). We
 * scale that into a 4000x4000 world, then run a *synchronous* d3-force pass at
 * module load so cards stop overlapping while staying close to their semantic
 * anchor (forceX/forceY pull back to the anchor, forceCollide pushes apart).
 *
 * Everything here is computed once and frozen — the plane itself never
 * re-simulates, which is what keeps panning cheap.
 */
import { forceCollide, forceSimulation, forceX, forceY } from 'd3-force';
import type { SimulationNodeDatum } from 'd3-force';
import { allEntities, DOMAINS } from '../../shared/data';
import type { Domain, Entity } from '../../shared/data';

/** Square world, in world pixels. */
export const WORLD = 4000;
/** Keep entities off the very edge of the world. */
const PADDING = 250;
/** Extra breathing room between cards, in world px. */
const COLLIDE_PAD = 14;

export interface Pt { x: number; y: number }

/** Rendered card footprint (world px) — matches shared `EntityCard` widths. */
export function cardSize(e: Entity): { w: number; h: number } {
  return e.kind === 'person' ? { w: 170, h: 170 } : { w: 220, h: 240 };
}

function collideRadius(e: Entity) {
  const { w, h } = cardSize(e);
  return Math.max(w, h) / 2 + COLLIDE_PAD;
}

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  /** Anchor derived straight from `entity.pos` — the force pulls back to this. */
  ax: number;
  ay: number;
  r: number;
}

const span = WORLD - PADDING * 2;

const nodes: LayoutNode[] = allEntities.map((e) => {
  const ax = PADDING + e.pos.x * span;
  const ay = PADDING + e.pos.y * span;
  return { id: e.id, ax, ay, r: collideRadius(e), x: ax, y: ay };
});

const sim = forceSimulation<LayoutNode>(nodes)
  .force('x', forceX<LayoutNode>((d) => d.ax).strength(0.3))
  .force('y', forceY<LayoutNode>((d) => d.ay).strength(0.3))
  .force('collide', forceCollide<LayoutNode>((d) => d.r).iterations(2))
  .stop();
// 120 synchronous ticks: enough to resolve overlaps, few enough to stay ~fast.
sim.tick(120);

/** id -> resolved world position (card centre). */
export const POSITIONS: Map<string, Pt> = new Map(
  nodes.map((n) => [n.id, { x: n.x ?? n.ax, y: n.y ?? n.ay }]),
);

/** Mean position of every entity in a domain — where territory blobs sit. */
export const DOMAIN_CENTROIDS: Record<Domain, Pt> = (() => {
  const acc = {} as Record<Domain, { x: number; y: number; n: number }>;
  for (const d of DOMAINS) acc[d] = { x: 0, y: 0, n: 0 };
  for (const e of allEntities) {
    const p = POSITIONS.get(e.id);
    if (!p) continue;
    const a = acc[e.domain];
    a.x += p.x; a.y += p.y; a.n += 1;
  }
  const out = {} as Record<Domain, Pt>;
  for (const d of DOMAINS) {
    const a = acc[d];
    out[d] = a.n ? { x: a.x / a.n, y: a.y / a.n } : { x: WORLD / 2, y: WORLD / 2 };
  }
  return out;
})();

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Bounding box (world px) of the given ids, expanded by each card's footprint. */
export function bboxOf(ids: string[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let found = false;
  for (const id of ids) {
    const p = POSITIONS.get(id);
    if (!p) continue;
    found = true;
    // Half-footprint of the biggest card kind keeps framing safe either way.
    const hw = 130, hh = 140;
    x0 = Math.min(x0, p.x - hw); y0 = Math.min(y0, p.y - hh);
    x1 = Math.max(x1, p.x + hw); y1 = Math.max(y1, p.y + hh);
  }
  return found ? { x0, y0, x1, y1 } : null;
}
