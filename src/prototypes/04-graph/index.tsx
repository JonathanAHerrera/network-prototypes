/**
 * 04-graph — "Reorganizing Graph"
 * The whole network (80 people + ~40 projects) as one force-directed graph that
 * re-arranges itself into cluster / axis / radial layouts in answer to a question.
 *
 * Rendering split: a DPR-aware <canvas> draws edges, domain hulls, layout labels
 * and result glow rings; an HTML layer holds the EntityCards. Both share the same
 * pan/zoom transform. Node positions are written straight to the DOM from the
 * rAF loop — no React state per tick.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { Simulation } from 'd3-force';
import { polygonHull } from 'd3-polygon';
import { callAI, search } from '../../shared/ai';
import { DOMAIN_COLORS, dataset, entityImage, entityLabel } from '../../shared/data';
import { Button, Chip, EntityCard, SearchBar } from '../../shared/ui';
import {
  BASE_SCALE, PLAN_SCHEMA, applyLayout, buildGraph, buildPrompt, localPlan, parsePlan,
} from './layout';
import type { Geometry, GraphLink, GraphNode, LayoutPlan } from './layout';
import './graph.css';

const EXAMPLES = [
  'who could help with solar in Africa',
  'compare hardware vs software people',
  'group projects by what they need',
];

const MIN_K = 0.25;
const MAX_K = 3;
const FIT_K = 0.66;
// height of the fixed search bar/chips overlay (.p04__top, top: 14px, ~160px tall)
// that top-of-ring cards must not settle underneath
const TOP_INSET = 150;

/* ------------------------------------------------------------ canvas utils */

function rgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function pixelLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, k: number, size = 13) {
  const fs = size / k;
  ctx.font = `700 ${fs}px 'Silkscreen', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 20 / k;
  const h = fs + 14 / k;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 7 / k);
  ctx.fillStyle = 'rgba(11,13,36,.86)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / k;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHull(ctx: CanvasRenderingContext2D, pts: [number, number][], color: string, pad: number, k: number) {
  if (!pts.length) return;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length;
  cy /= pts.length;

  const hull = pts.length >= 3 ? polygonHull(pts) : null;
  ctx.beginPath();
  if (!hull || hull.length < 3) {
    let r = pad;
    for (const [x, y] of pts) r = Math.max(r, Math.hypot(x - cx, y - cy) + pad);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else {
    const exp = hull.map(([x, y]) => {
      const d = Math.hypot(x - cx, y - cy) || 1;
      return [x + ((x - cx) / d) * pad, y + ((y - cy) / d) * pad] as [number, number];
    });
    const n = exp.length;
    const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number];
    const start = mid(exp[n - 1], exp[0]);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i++) {
      const p = exp[i];
      const m = mid(p, exp[(i + 1) % n]);
      ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    ctx.closePath();
  }
  ctx.fillStyle = rgba(color, 0.12);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.4);
  ctx.lineWidth = 2 / k;
  ctx.stroke();
}

/* -------------------------------------------------------------------- node */

const NodeCard = memo(function NodeCard({ node, selected, register }: {
  node: GraphNode; selected: boolean; register: (id: string, el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="p04-node" data-id={node.id} ref={(el) => { register(node.id, el); }}>
      <EntityCard entity={node.entity} compact selected={selected} />
    </div>
  );
});

/* ------------------------------------------------------------------- main */

export default function Prototype() {
  const graph = useMemo(() => buildGraph(), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<{ text: string; offline: boolean } | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const [offline, setOffline] = useState(false);
  const [hintOpen, setHintOpen] = useState(true);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasTopRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const elsRef = useRef(new Map<string, HTMLDivElement>());
  const visRef = useRef(new Map<string, { s: number; o: number }>());

  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const viewRef = useRef({ k: FIT_K, x: 0, y: 0 });
  const dimsRef = useRef({ w: 1, h: 1 });
  const geoRef = useRef<Geometry | null>(null);
  const planRef = useRef<LayoutPlan | null>(null);
  const resultsRef = useRef<Set<string>>(new Set());
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const dirtyRef = useRef(true);

  const register = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) elsRef.current.set(id, el);
    else elsRef.current.delete(id);
  }, []);

  /** Swap forces + result set without ever re-creating the simulation. */
  const applyPlan = useCallback((plan: LayoutPlan | null, ids: Set<string>) => {
    const sim = simRef.current;
    if (!sim) return;
    planRef.current = plan;
    resultsRef.current = ids;
    geoRef.current = applyLayout(sim, graph, plan, dimsRef.current);
    sim.alpha(0.6).restart();
    dirtyRef.current = true;
    setHasPlan(ids.size > 0);
  }, [graph]);

  const fitView = useCallback(() => {
    const { w, h } = dimsRef.current;
    viewRef.current = { k: FIT_K, x: (w / 2) * (1 - FIT_K), y: (h / 2) * (1 - FIT_K) + TOP_INSET / 2 };
    dirtyRef.current = true;
  }, []);

  /* ------------------------------------------------------------- lifecycle */
  useEffect(() => {
    const stage = stageRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    // second canvas, stacked above the cards, so layout labels are never occluded
    const canvasTop = canvasTopRef.current!;
    const ctxTop = canvasTop.getContext('2d')!;
    const nodes = graph.nodes;

    const measure = () => {
      const r = stage.getBoundingClientRect();
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      dimsRef.current = { w, h };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const c of [canvas, canvasTop]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
      return dpr;
    };
    let dpr = measure();

    // seed positions from similarity space so the first settle looks intentional
    const { w: w0, h: h0 } = dimsRef.current;
    const span = Math.min(w0, h0) * 0.95;
    for (const n of nodes) {
      n.x = w0 / 2 + (n.entity.pos.x - 0.5) * span + (Math.random() - 0.5) * 24;
      n.y = h0 / 2 + (n.entity.pos.y - 0.5) * span + (Math.random() - 0.5) * 24;
    }

    const sim = forceSimulation<GraphNode>(nodes)
      .force('charge', forceManyBody<GraphNode>().strength(-95).distanceMax(300))
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(graph.links)
          .id((d) => d.id)
          .distance((l) => (l.kind === 'member' ? 78 : 130))
          .strength((l) => (l.kind === 'member' ? 0.45 : 0.05)),
      )
      .force('collide', forceCollide<GraphNode>((n) => n.r + 4).iterations(2))
      .velocityDecay(0.35)
      .alphaDecay(0.02);
    simRef.current = sim;
    sim.on('tick', () => { dirtyRef.current = true; });

    geoRef.current = applyLayout(sim, graph, null, dimsRef.current);
    viewRef.current = { k: FIT_K, x: (w0 / 2) * (1 - FIT_K), y: (h0 / 2) * (1 - FIT_K) + TOP_INSET / 2 };

    /* ------------------------------------------------------------- drawing */
    const visualFor = (id: string) => {
      const results = resultsRef.current;
      const planned = results.size > 0;
      let scale = BASE_SCALE;
      let opacity = 1;
      if (planned) {
        if (results.has(id)) scale = 0.8;
        else { scale = 0.45; opacity = 0.35; }
      }
      const hov = hoverRef.current;
      if (hov) {
        if (id === hov) { scale *= 1.08; opacity = 1; }
        else if (graph.adj.get(hov)?.has(id)) opacity = Math.max(opacity, 0.95);
        else opacity *= 0.25;
      }
      return { scale, opacity };
    };

    const drawEdges = (k: number) => {
      const hov = hoverRef.current;
      const nbs = hov ? graph.adj.get(hov) : null;
      const isHi = (l: GraphLink) => {
        if (!hov) return false;
        const a = (l.source as GraphNode).id;
        const b = (l.target as GraphNode).id;
        return a === hov || b === hov;
      };
      const dim = hov ? 0.25 : 1;

      const batch = (pick: (l: GraphLink) => boolean) => {
        ctx.beginPath();
        for (const l of graph.links) {
          if (!pick(l)) continue;
          const s = l.source as GraphNode;
          const t = l.target as GraphNode;
          ctx.moveTo(s.x!, s.y!);
          ctx.lineTo(t.x!, t.y!);
        }
        ctx.stroke();
      };

      ctx.setLineDash([5 / k, 5 / k]);
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = `rgba(141,149,196,${0.2 * dim})`;
      batch((l) => l.kind === 'sim' && !isHi(l));

      ctx.setLineDash([]);
      ctx.lineWidth = 1.4 / k;
      ctx.strokeStyle = `rgba(127,178,255,${0.32 * dim})`;
      batch((l) => l.kind === 'member' && !isHi(l));

      if (hov && nbs) {
        ctx.save();
        ctx.shadowColor = '#7fb2ff';
        ctx.shadowBlur = 12 / k;
        ctx.lineWidth = 2.4 / k;
        ctx.strokeStyle = 'rgba(255,210,63,.9)';
        batch((l) => l.kind === 'member' && isHi(l));
        ctx.setLineDash([5 / k, 5 / k]);
        ctx.lineWidth = 1.8 / k;
        ctx.strokeStyle = 'rgba(127,178,255,.8)';
        batch((l) => l.kind === 'sim' && isHi(l));
        ctx.setLineDash([]);
        ctx.restore();
      }
    };

    const drawRings = (k: number, t: number) => {
      const results = resultsRef.current;
      if (!results.size) return;
      ctx.save();
      let i = 0;
      for (const n of nodes) {
        if (!results.has(n.id)) continue;
        const pulse = 1 + 0.05 * Math.sin(t / 380 + i * 0.7);
        i++;
        const s = 0.8 * pulse;
        const pad = 9 / k;
        ctx.shadowColor = '#7fb2ff';
        ctx.shadowBlur = 16 / k;
        for (const [color, extra, lw] of [['#2f6bff', pad + 5 / k, 4 / k], ['#ffd23f', pad, 2.5 / k]] as const) {
          ctx.beginPath();
          if (n.entity.kind === 'person') {
            ctx.arc(n.x!, n.y!, (n.w * s) / 2 + extra, 0, Math.PI * 2);
          } else {
            const w = n.w * s + extra * 2;
            const h = n.h * s + extra * 2;
            ctx.roundRect(n.x! - w / 2, n.y! - h / 2, w, h, 6 / k);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const drawGeometry = (k: number, tx: number, ty: number, t: number) => {
      const geo = geoRef.current;
      if (!geo) return;
      const { w, h } = dimsRef.current;
      /**
       * Layout labels live on the top canvas in SCREEN space: constant size at any
       * zoom, and clamped inside the viewport so a lobe that drifts off the edge
       * (or under the search bar) still tells you what it is.
       */
      const label = (text: string, wx: number, wy: number, color: string, size: number) => {
        const sx = Math.min(Math.max(70, wx * k + tx), Math.max(70, w - 70));
        const sy = Math.min(Math.max(178, wy * k + ty), Math.max(178, h - 52));
        pixelLabel(ctxTop, text, sx, sy, color, 1, size);
      };

      if (geo.mode === 'default' || geo.mode === 'cluster') {
        const labels: { text: string; x: number; y: number; color: string }[] = [];
        for (const g of geo.groups) {
          const pts: [number, number][] = [];
          for (const id of g.ids) {
            const n = graph.index.get(id);
            if (n?.x != null && n.y != null) pts.push([n.x, n.y]);
          }
          if (pts.length < 2) continue;
          const pad = 66;
          drawHull(ctx, pts, g.color, pad, k);
          // park the label just outside the lobe, pointing away from the middle,
          // so cards (which live above the canvas) don't sit on top of it
          let gx = 0;
          let gy = 0;
          for (const [x, y] of pts) { gx += x; gy += y; }
          gx /= pts.length;
          gy /= pts.length;
          let far = 0;
          for (const [x, y] of pts) far = Math.max(far, Math.hypot(x - gx, y - gy));
          const dx = gx - geo.cx;
          const dy = gy - geo.cy;
          const len = Math.hypot(dx, dy) || 1;
          const out = Math.max(far, 90) + pad + 14;
          labels.push({
            text: g.label.toUpperCase(),
            x: gx + (len > 1 ? (dx / len) * out : 0),
            y: gy + (len > 1 ? (dy / len) * out : -out),
            color: g.color,
          });
        }
        for (const l of labels) label(l.text, l.x, l.y, l.color, geo.mode === 'cluster' ? 14 : 12);
      }

      if (geo.mode === 'axis' && geo.axis) {
        const { cx, cy } = geo;
        const ext = geo.axis.halfW + 170;
        const x0 = cx - ext;
        const x1 = cx + ext;
        ctx.save();
        ctx.setLineDash([9 / k, 7 / k]);
        ctx.strokeStyle = 'rgba(127,178,255,.45)';
        ctx.lineWidth = 2 / k;
        ctx.beginPath();
        ctx.moveTo(x0, cy);
        ctx.lineTo(x1, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const x of [x0, cx, x1]) {
          ctx.beginPath();
          ctx.moveTo(x, cy - 10 / k);
          ctx.lineTo(x, cy + 10 / k);
          ctx.stroke();
        }
        ctx.restore();
        label(`◀ ${geo.axis.left.toUpperCase()}`, x0, cy, '#ffd23f', 14);
        label(`${geo.axis.right.toUpperCase()} ▶`, x1, cy, '#7fb2ff', 14);
      }

      if (geo.mode === 'radial' && geo.rings) {
        ctx.save();
        ctx.setLineDash([7 / k, 8 / k]);
        ctx.lineWidth = 2 / k;
        geo.rings.forEach((r, i) => {
          ctx.strokeStyle = i === 0 ? 'rgba(255,210,63,.4)' : 'rgba(127,178,255,.28)';
          ctx.beginPath();
          ctx.arc(geo.cx, geo.cy, r, 0, Math.PI * 2);
          ctx.stroke();
        });
        ctx.restore();
        const bob = Math.sin(t / 500) * 3;
        label('BEST MATCHES', geo.cx, geo.cy - geo.rings[0] - 30 + bob, '#ffd23f', 13);
        label('CONNECTED', geo.cx, geo.cy + geo.rings[1] + 30, '#7fb2ff', 12);
      }
    };

    /* ---------------------------------------------------------- frame loop */
    let raf = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (!dirtyRef.current && !resultsRef.current.size) return;
      const pulsing = resultsRef.current.size > 0;
      dirtyRef.current = pulsing;

      const { k, x: tx, y: ty } = viewRef.current;

      // background art rides the pan/zoom transform; the label plate stays in
      // screen space so pixel type never blurs or wanders off the viewport
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
      ctx.lineCap = 'round';
      ctxTop.setTransform(1, 0, 0, 1, 0, 0);
      ctxTop.clearRect(0, 0, canvasTop.width, canvasTop.height);
      ctxTop.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGeometry(k, tx, ty, t);
      drawEdges(k);
      drawRings(k, t);

      // html layer
      const layer = layerRef.current;
      if (layer) layer.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${k})`;
      const els = elsRef.current;
      const vis = visRef.current;
      let unsettled = false;
      for (const n of nodes) {
        const el = els.get(n.id);
        if (!el) continue;
        const v = visualFor(n.id);
        let cur = vis.get(n.id);
        if (!cur) { cur = { s: BASE_SCALE, o: 1 }; vis.set(n.id, cur); }
        cur.s += (v.scale - cur.s) * 0.18;
        cur.o += (v.opacity - cur.o) * 0.18;
        if (Math.abs(v.scale - cur.s) > 0.005 || Math.abs(v.opacity - cur.o) > 0.005) unsettled = true;
        el.style.transform = `translate3d(${n.x}px, ${n.y}px, 0) scale(${cur.s}) translate(-50%, -50%)`;
        const o = cur.o.toFixed(2);
        if (el.style.opacity !== o) el.style.opacity = o;
      }
      if (unsettled) dirtyRef.current = true;

      // popover follows its node
      const sel = selectedRef.current;
      const pop = popRef.current;
      if (sel && pop) {
        const n = graph.index.get(sel);
        if (n?.x != null && n.y != null) {
          const { w, h } = dimsRef.current;
          const px = Math.min(Math.max(12, n.x * k + tx + (n.w * 0.8 * k) / 2 + 14), Math.max(12, w - 284));
          const py = Math.min(Math.max(12, n.y * k + ty - 90), Math.max(12, h - 300));
          pop.style.transform = `translate3d(${px}px, ${py}px, 0)`;
        }
      }
    };
    raf = requestAnimationFrame(frame);

    /* --------------------------------------------------------- interaction */
    const drag = {
      kind: null as null | 'pan' | 'node',
      id: '' as string,
      lastX: 0,
      lastY: 0,
      moved: 0,
      offX: 0,
      offY: 0,
    };

    const toWorld = (clientX: number, clientY: number) => {
      const r = stage.getBoundingClientRect();
      const { k, x, y } = viewRef.current;
      return { x: (clientX - r.left - x) / k, y: (clientY - r.top - y) / k };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const v = viewRef.current;
      const next = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.0015)));
      if (next === v.k) return;
      v.x = mx - ((mx - v.x) * next) / v.k;
      v.y = my - ((my - v.y) * next) / v.k;
      v.k = next;
      dirtyRef.current = true;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement).closest('.p04-node') as HTMLElement | null;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.moved = 0;
      if (el) {
        const id = el.dataset.id!;
        const n = graph.index.get(id);
        if (!n) return;
        const p = toWorld(e.clientX, e.clientY);
        drag.kind = 'node';
        drag.id = id;
        drag.offX = (n.x ?? 0) - p.x;
        drag.offY = (n.y ?? 0) - p.y;
        n.fx = n.x;
        n.fy = n.y;
        sim.alphaTarget(0.3).restart();
      } else {
        drag.kind = 'pan';
      }
      stage.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag.kind) {
        const el = (e.target as HTMLElement).closest('.p04-node') as HTMLElement | null;
        const id = el?.dataset.id ?? null;
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          dirtyRef.current = true;
        }
        return;
      }
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.kind === 'pan') {
        viewRef.current.x += dx;
        viewRef.current.y += dy;
      } else {
        const n = graph.index.get(drag.id);
        if (n) {
          const p = toWorld(e.clientX, e.clientY);
          n.fx = p.x + drag.offX;
          n.fy = p.y + drag.offY;
        }
      }
      dirtyRef.current = true;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!drag.kind) return;
      const wasNode = drag.kind === 'node';
      const id = drag.id;
      const clicked = drag.moved < 5;
      if (wasNode) {
        const n = graph.index.get(id);
        if (n) { n.fx = null; n.fy = null; }
        sim.alphaTarget(0);
      }
      drag.kind = null;
      drag.id = '';
      if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
      if (clicked) setSelectedId(wasNode ? id : null);
      dirtyRef.current = true;
    };

    const onPointerLeave = () => {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        dirtyRef.current = true;
      }
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('pointerleave', onPointerLeave);

    const ro = new ResizeObserver(() => {
      dpr = measure();
      geoRef.current = applyLayout(sim, graph, planRef.current, dimsRef.current);
      sim.alpha(0.3).restart();
      dirtyRef.current = true;
    });
    ro.observe(stage);

    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) dirtyRef.current = true; }).catch(() => {});

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
      stage.removeEventListener('pointerleave', onPointerLeave);
      sim.on('tick', null);
      sim.stop();
      simRef.current = null;
    };
  }, [graph]);

  useEffect(() => { selectedRef.current = selectedId; dirtyRef.current = true; }, [selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------------------------------------------------------- search */
  const runSearch = useCallback(async (q: string) => {
    setBusy(true);
    setStatus('thinking…');
    setSelectedId(null);
    try {
      const res = await search(q, { limit: 14 });
      setOffline(res.offline);
      let plan: LayoutPlan | null = null;
      if (!res.offline) {
        try {
          const raw = await callAI<unknown>(buildPrompt(q, res.ids), { schema: PLAN_SCHEMA, max_tokens: 1500 });
          plan = parsePlan(raw);
          if (!plan) console.warn('[04-graph] layout plan failed validation — using local fallback');
        } catch (err) {
          console.warn('[04-graph] layout AI failed — using local fallback:', err);
        }
      }
      if (!plan) plan = localPlan(q, res.ids);

      const ids = new Set<string>(res.ids);
      plan.groups?.forEach((g) => g.ids.forEach((id) => ids.add(id)));
      plan.centerIds?.forEach((id) => ids.add(id));
      if (plan.scores) Object.keys(plan.scores).forEach((id) => ids.add(id));

      if (!ids.size) {
        setBanner({ text: `Nothing matched "${q}" — try climate, robotics, solar, food, or a city.`, offline: res.offline });
        applyPlan(null, new Set());
      } else {
        setBanner({ text: plan.summary, offline: res.offline });
        applyPlan(plan, ids);
      }
    } catch (err) {
      console.warn('[04-graph] search failed:', err);
      setBanner({ text: 'Something glitched on the way to the brain — the graph stayed put.', offline: true });
    } finally {
      setBusy(false);
      setStatus(undefined);
    }
  }, [applyPlan]);

  const reset = useCallback(() => {
    setBanner(null);
    setSelectedId(null);
    applyPlan(null, new Set());
    fitView();
  }, [applyPlan, fitView]);

  const focusSelected = useCallback(() => {
    if (!selectedId) return;
    const n = graph.index.get(selectedId);
    if (n?.x == null || n.y == null) return;
    const { w, h } = dimsRef.current;
    const k = Math.max(viewRef.current.k, 1);
    viewRef.current = { k, x: w / 2 - n.x * k, y: h / 2 - n.y * k };
    dirtyRef.current = true;
  }, [graph, selectedId]);

  const selected = selectedId ? dataset.byId[selectedId] : null;
  const selectedLinks = selectedId ? (graph.adj.get(selectedId)?.size ?? 0) : 0;

  return (
    <div className="p04">
      <div className="p04__stage" ref={stageRef}>
        <canvas className="p04__canvas" ref={canvasRef} />
        <div className="p04__layer" ref={layerRef}>
          {graph.nodes.map((n) => (
            <NodeCard key={n.id} node={n} selected={selectedId === n.id} register={register} />
          ))}
        </div>
        <canvas className="p04__canvas p04__canvas--top" ref={canvasTopRef} />
      </div>

      <div className="p04__top">
        <SearchBar onSearch={runSearch} busy={busy} status={status} placeholder="ask the network to reorganize…" />
        <div className="p04__chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="p04__chip" onClick={() => runSearch(ex)} disabled={busy}>
              {ex}
            </button>
          ))}
        </div>
        {banner && (
          <div className="p04__banner">
            <span className="p04__banner-text">{banner.text}</span>
            {banner.offline && <span className="p04__pill">offline</span>}
          </div>
        )}
      </div>

      {hasPlan && (
        <div className="p04__reset">
          <Button onClick={reset}>↺ reset</Button>
        </div>
      )}

      {selected && (
        <div className="p04-pop" ref={popRef}>
          <button className="p04-pop__close" onClick={() => setSelectedId(null)} aria-label="close">×</button>
          <img className="p04-pop__img" src={entityImage(selected)} alt="" />
          <div className="p04-pop__name pixel">{entityLabel(selected)}</div>
          <div className="p04-pop__bio">{selected.kind === 'person' ? selected.bio : selected.tagline}</div>
          <div className="hp-chips p04-pop__tags">
            {selected.tags.slice(0, 4).map((t) => <Chip key={t}>{t}</Chip>)}
          </div>
          <div className="p04-pop__meta">
            <span className="p04-pop__dot" style={{ background: DOMAIN_COLORS[selected.domain] }} />
            <span>{selected.domain}</span>
            <span className="p04-pop__sep">·</span>
            <span>{selectedLinks} link{selectedLinks === 1 ? '' : 's'}</span>
          </div>
          <Button onClick={focusSelected}>◎ focus</Button>
        </div>
      )}

      {hintOpen && (
        <div className="p04__hint mono">
          drag to pan · wheel to zoom · drag nodes · hover to see links · ask a question to reorganize
          {offline && ' · offline: local fallback'}
          <button className="p04__hint-x" onClick={() => setHintOpen(false)} aria-label="dismiss hint">×</button>
        </div>
      )}
    </div>
  );
}
