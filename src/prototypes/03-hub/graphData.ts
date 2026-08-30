import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { dataset, entityImage, simDistance, DOMAIN_COLORS } from '../../shared/data';
import type { Domain, Entity } from '../../shared/data';

/* ------------------------------------------------------------------ *
 * Sphere (landing globe)
 * ------------------------------------------------------------------ */

export interface SphereNode {
  id: string;
  kind: 'person' | 'project';
  label: string;
  image: string;
  city: string;
  domain: Domain;
  color: string;
  /** Unit vector on the sphere. */
  x: number;
  y: number;
  z: number;
  /** Base pixel radius at unit scale. */
  r: number;
}

export interface SphereEdge {
  a: number;
  b: number;
}

/** Deterministic PRNG so the globe looks identical on every reload. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildSphere(): { nodes: SphereNode[]; edges: SphereEdge[]; projectCount: number; peopleCount: number } {
  const rand = rng(0xc0ffee);
  const projects = dataset.projects.filter((p) => p.status === 'active');
  const nodes: SphereNode[] = [];
  const edges: SphereEdge[] = [];
  const indexById = new Map<string, number>();

  // Projects spread evenly with a Fibonacci sphere.
  const golden = Math.PI * (3 - Math.sqrt(5));
  projects.forEach((p, i) => {
    const y = 1 - (i / Math.max(1, projects.length - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    indexById.set(p.id, nodes.length);
    nodes.push({
      id: p.id,
      kind: 'project',
      label: p.title,
      image: entityImage(p),
      city: p.city,
      domain: p.domain,
      color: DOMAIN_COLORS[p.domain],
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
      r: 4.6,
    });
  });

  // Members orbit close to (the first) project they belong to → short edges.
  projects.forEach((p) => {
    const pi = indexById.get(p.id);
    if (pi === undefined) return;
    const anchor = nodes[pi];
    p.memberIds.forEach((mid) => {
      const person = dataset.byId[mid];
      if (!person || person.kind !== 'person') return;
      let mi = indexById.get(mid);
      if (mi === undefined) {
        // Random tangent offset around the project's direction, then re-normalise.
        const up = Math.abs(anchor.y) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const t1 = norm(cross([anchor.x, anchor.y, anchor.z], up));
        const t2 = norm(cross([anchor.x, anchor.y, anchor.z], t1));
        const ang = rand() * Math.PI * 2;
        const spread = 0.16 + rand() * 0.16;
        const v = norm([
          anchor.x + (Math.cos(ang) * t1[0] + Math.sin(ang) * t2[0]) * spread,
          anchor.y + (Math.cos(ang) * t1[1] + Math.sin(ang) * t2[1]) * spread,
          anchor.z + (Math.cos(ang) * t1[2] + Math.sin(ang) * t2[2]) * spread,
        ]);
        mi = nodes.length;
        indexById.set(mid, mi);
        nodes.push({
          id: person.id,
          kind: 'person',
          label: person.name,
          image: entityImage(person),
          city: person.city,
          domain: person.domain,
          color: DOMAIN_COLORS[person.domain],
          x: v[0],
          y: v[1],
          z: v[2],
          r: 2.6,
        });
      }
      const dot = nodes[mi].x * anchor.x + nodes[mi].y * anchor.y + nodes[mi].z * anchor.z;
      if (dot > 0.55) edges.push({ a: mi, b: pi });
    });
  });

  const peopleCount = nodes.filter((n) => n.kind === 'person').length;
  return { nodes, edges, projectCount: projects.length, peopleCount };
}

function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: number[]) {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
}

/** Built once — the landing globe never changes. */
export const SPHERE = buildSphere();

/* ------------------------------------------------------------------ *
 * Force graph (results view)
 * ------------------------------------------------------------------ */

export interface GNode extends SimulationNodeDatum {
  id: string;
  entity: Entity;
  primary: boolean;
  r: number;
}

export interface GLink extends SimulationLinkDatum<GNode> {
  kind: 'member' | 'sim';
  id: string;
}

const MAX_NEIGHBOURS = 40;

export function nodeRadius(e: Entity, primary: boolean) {
  if (!primary) return 26;
  return e.kind === 'person' ? 62 : 82;
}

function links(e: Entity): string[] {
  return e.kind === 'person' ? e.projectIds : e.memberIds;
}

/** Result ids (big) + their 1-hop neighbours (small), membership + similarity links. */
export function buildGraph(ids: string[]): { nodes: GNode[]; links: GLink[] } {
  const primaryIds = ids.filter((id) => dataset.byId[id]);
  const primarySet = new Set(primaryIds);
  const nodes: GNode[] = primaryIds.map((id) => {
    const entity = dataset.byId[id];
    return { id, entity, primary: true, r: nodeRadius(entity, true) };
  });

  const seen = new Set(primaryIds);
  const out: GLink[] = [];
  const pushLink = (a: string, b: string, kind: GLink['kind']) => {
    const id = kind + ':' + (a < b ? `${a}|${b}` : `${b}|${a}`);
    if (out.some((l) => l.id === id)) return;
    out.push({ id, kind, source: a, target: b });
  };

  let added = 0;
  for (const id of primaryIds) {
    for (const nid of links(dataset.byId[id])) {
      const n = dataset.byId[nid];
      if (!n) continue;
      if (primarySet.has(nid)) {
        pushLink(id, nid, 'member');
        continue;
      }
      if (!seen.has(nid)) {
        if (added >= MAX_NEIGHBOURS) continue;
        seen.add(nid);
        added++;
        nodes.push({ id: nid, entity: n, primary: false, r: nodeRadius(n, false) });
      }
      pushLink(id, nid, 'member');
    }
  }

  // Domain / similarity affinity between results.
  for (let i = 0; i < primaryIds.length; i++) {
    for (let j = i + 1; j < primaryIds.length; j++) {
      const a = dataset.byId[primaryIds[i]];
      const b = dataset.byId[primaryIds[j]];
      if (a.domain === b.domain || simDistance(a, b) < 0.12) pushLink(a.id, b.id, 'sim');
    }
  }

  // Seed positions in a ring so the simulation settles fast and predictably.
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2;
    const rad = n.primary ? 140 : 300;
    n.x = Math.cos(a) * rad;
    n.y = Math.sin(a) * rad;
  });

  return { nodes, links: out };
}
