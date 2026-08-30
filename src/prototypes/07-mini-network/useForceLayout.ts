/**
 * 07 Mini-network — d3-force simulation + canvas renderer.
 *
 * Everything that changes every frame (sim positions, pan/zoom transform,
 * hover) lives in refs so the rAF loop never triggers a React render. The only
 * state that escapes is `hoveredId`, which changes at human speed.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type ForceCollide,
  type ForceRadial,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { entityImage, entityLabel } from '../../shared/data';
import { RING_LABELS, type NetEdge, type NetNode, type Network } from './buildNetwork';

const INK = '#1b1f3a';
const YELLOW = '#ffd23f';
const BASE_RADIUS = [34, 24, 17, 13];
const RING_FRACTION = [0.16, 0.46, 0.72, 0.97];
const STAGGER_MS = 150;
// One spoke per ring so the captions never stack on top of each other.
const GUIDE_LABEL_ANGLE = [-Math.PI / 2, -Math.PI / 4, -Math.PI / 6, -Math.PI / 12];
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;

interface SimNode extends SimulationNodeDatum {
  id: string;
  net: NetNode;
  ring: number;
  r: number;
  releaseAt: number;
  released: boolean;
  angle: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { kind: NetEdge['kind'] };

/* --------------------------------------------------------- image cache */

const imgCache = new Map<string, HTMLImageElement>();
function cachedImage(src: string): HTMLImageElement {
  let img = imgCache.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'sync';
    img.src = src; // data: URI — resolves synchronously-ish, no network
    imgCache.set(src, img);
  }
  return img;
}

/* -------------------------------------------------------- path helpers */

function shapePath(ctx: CanvasRenderingContext2D, node: SimNode, r: number) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  ctx.beginPath();
  if (node.net.entity.kind === 'person') {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    return;
  }
  const rad = Math.max(3, r * 0.32);
  const l = x - r;
  const t = y - r;
  const w = r * 2;
  ctx.moveTo(l + rad, t);
  ctx.lineTo(l + w - rad, t);
  ctx.quadraticCurveTo(l + w, t, l + w, t + rad);
  ctx.lineTo(l + w, t + w - rad);
  ctx.quadraticCurveTo(l + w, t + w, l + w - rad, t + w);
  ctx.lineTo(l + rad, t + w);
  ctx.quadraticCurveTo(l, t + w, l, t + w - rad);
  ctx.lineTo(l, t + rad);
  ctx.quadraticCurveTo(l, t, l + rad, t);
  ctx.closePath();
}

export interface ForceLayoutOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  wrapRef: RefObject<HTMLDivElement | null>;
  tooltipRef: RefObject<HTMLDivElement | null>;
  network: Network | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function useForceLayout({
  canvasRef,
  wrapRef,
  tooltipRef,
  network,
  selectedId,
  onSelect,
}: ForceLayoutOptions) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Mutable mirrors so the rAF loop reads fresh values without re-subscribing.
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;

  const viewRef = useRef({ k: 1, tx: 0, ty: 0 });
  const fontsReadyRef = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) {
      fontsReadyRef.current = true;
      return;
    }
    let alive = true;
    document.fonts.ready.then(() => {
      if (alive) fontsReadyRef.current = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    /* ---------------------------------------------------------- state */
    let w = wrap.clientWidth || 1;
    let h = wrap.clientHeight || 1;
    let scale = 1;
    let radii = [0, 0, 0, 0];
    let raf = 0;
    let disposed = false;

    viewRef.current = { k: 1, tx: 0, ty: 0 };
    hoverRef.current = null;
    setHoveredId(null);

    const nodes: SimNode[] = (network?.nodes ?? []).map((n) => ({
      id: n.id,
      net: n,
      ring: n.ring,
      r: BASE_RADIUS[n.ring],
      releaseAt: 0,
      released: n.ring === 0,
      angle: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const linkData: SimLink[] = (network?.edges ?? [])
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, kind: e.kind }));

    for (const n of nodes) cachedImage(entityImage(n.net.entity));

    // Search bar + summary + breadcrumbs live at the top and the hint at the
    // bottom, so the network is centred in what's left rather than the raw
    // canvas — otherwise the wildcard ring slides under the header.
    const TOP_INSET = 150;
    const BOTTOM_INSET = 60;
    let ox = 0;
    let oy = 0;

    function measure() {
      w = Math.max(1, wrap!.clientWidth);
      h = Math.max(1, wrap!.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      const availH = Math.max(160, h - TOP_INSET - BOTTOM_INSET);
      ox = w / 2;
      oy = TOP_INSET + availH / 2;
      scale = Math.max(0.55, Math.min(1, Math.min(w, availH) / 700));
      const outer = Math.min(w, availH) / 2 - 34 * scale;
      radii = RING_FRACTION.map((f) => Math.max(24, outer) * f);
      for (const n of nodes) n.r = BASE_RADIUS[n.ring] * scale;
      return dpr;
    }
    let dpr = measure();

    const cx = () => ox;
    const cy = () => oy;

    // Everything spawns at the centre, pinned, and is released ring by ring.
    // forceRadial only pushes along the centre->node vector, so each node gets
    // an evenly-spaced launch angle: without it they all drift out as one clump.
    const t0 = performance.now();
    const ringCount = [0, 0, 0, 0];
    for (const n of nodes) ringCount[n.ring]++;
    const ringSeen = [0, 0, 0, 0];
    for (const n of nodes) {
      const i = ringSeen[n.ring]++;
      const a =
        (i / Math.max(1, ringCount[n.ring])) * Math.PI * 2 +
        n.ring * 0.7 +
        (Math.random() - 0.5) * 0.18;
      n.angle = a;
      const spawn = 6;
      n.x = cx() + Math.cos(a) * spawn;
      n.y = cy() + Math.sin(a) * spawn;
      n.releaseAt = t0 + n.ring * STAGGER_MS;
      n.released = n.ring === 0;
      if (!n.released) {
        // Pinned just off-centre so the launch angle survives the hold.
        n.fx = n.x;
        n.fy = n.y;
      }
    }

    /* ------------------------------------------------------ simulation */
    const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(nodes)
      .force(
        'radial',
        forceRadial<SimNode>((d) => radii[d.ring], cx(), cy()).strength(0.9),
      )
      .force(
        'collide',
        forceCollide<SimNode>((d) => d.r + (d.ring <= 1 ? 14 : 7) * scale).strength(0.9),
      )
      .force('charge', forceManyBody<SimNode>().strength(-34))
      .force(
        'link',
        forceLink<SimNode, SimLink>(linkData)
          .id((d) => d.id)
          .distance((l) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            return 40 + Math.abs(radii[t.ring] - radii[s.ring]) * 0.8;
          })
          .strength(0.06),
      )
      .alpha(1)
      .alphaDecay(0.045)
      .alphaMin(0.002)
      .stop();

    function retarget() {
      const radial = sim.force('radial') as ForceRadial<SimNode> | undefined;
      radial?.x(cx()).y(cy()).radius((d) => radii[d.ring]);
      const collide = sim.force('collide') as ForceCollide<SimNode> | undefined;
      collide?.radius((d) => d.r + (d.ring <= 1 ? 14 : 7) * scale);
      for (const n of nodes) if (!n.released) {
        n.fx = cx() + Math.cos(n.angle) * 6;
        n.fy = cy() + Math.sin(n.angle) * 6;
      }
      sim.alpha(Math.max(sim.alpha(), 0.35));
    }

    /* --------------------------------------------------------- drawing */
    function worldFromScreen(sx: number, sy: number) {
      const { k, tx, ty } = viewRef.current;
      return { x: (sx - tx) / k, y: (sy - ty) / k };
    }

    function hitTest(sx: number, sy: number): SimNode | null {
      const p = worldFromScreen(sx, sy);
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
        if (d <= n.r + 3 && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    }

    function drawEdges(now: number) {
      const hovered = hoverRef.current;
      for (const l of linkData) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (!s || !t) continue;
        const hot = hovered === s.id || hovered === t.id;
        ctx!.save();
        if (hot) {
          ctx!.strokeStyle = YELLOW;
          ctx!.lineWidth = 2.6;
          ctx!.setLineDash([]);
          ctx!.globalAlpha = 0.85 + 0.15 * Math.sin(now / 200);
        } else if (l.kind === 'member') {
          ctx!.strokeStyle = 'rgba(232,236,255,.55)';
          ctx!.lineWidth = 1.6;
          ctx!.setLineDash([]);
        } else if (l.kind === 'sim') {
          ctx!.strokeStyle = 'rgba(127,178,255,.3)';
          ctx!.lineWidth = 1.3;
          ctx!.setLineDash([5, 5]);
        } else {
          ctx!.strokeStyle = 'rgba(255,255,255,.08)';
          ctx!.lineWidth = 1.2;
          ctx!.setLineDash([2, 6]);
        }
        ctx!.beginPath();
        ctx!.moveTo(s.x ?? 0, s.y ?? 0);
        ctx!.lineTo(t.x ?? 0, t.y ?? 0);
        ctx!.stroke();
        ctx!.restore();
      }
    }

    function drawGuides() {
      const c = ctx!;
      c.save();
      c.setLineDash([2, 7]);
      c.strokeStyle = 'rgba(255,255,255,.12)';
      c.lineWidth = 1;
      c.font = `${Math.round(9 * Math.max(0.85, scale))}px 'Silkscreen', monospace`;
      c.fillStyle = 'rgba(255,255,255,.28)';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const labels = fontsReadyRef.current;
      radii.forEach((r0, i) => {
        const r = Math.max(r0, BASE_RADIUS[0] * scale + 20);
        c.beginPath();
        c.arc(cx(), cy(), r, 0, Math.PI * 2);
        c.stroke();
        if (!labels) return;
        const a = GUIDE_LABEL_ANGLE[i];
        // ring 0's guide sits inside its own nodes — push the caption clear.
        const lr = i === 0 ? r + BASE_RADIUS[0] * scale * 1.5 : r;
        const lx = cx() + Math.cos(a) * lr;
        const ly = cy() + Math.sin(a) * lr;
        c.save();
        c.setLineDash([]);
        c.fillStyle = 'rgba(11,13,36,.85)';
        const tw = c.measureText(RING_LABELS[i]).width + 10;
        c.fillRect(lx - tw / 2, ly - 8, tw, 16);
        c.fillStyle = 'rgba(232,236,255,.42)';
        c.fillText(RING_LABELS[i], lx, ly);
        c.restore();
      });
      c.restore();
    }

    function drawNodeShape(n: SimNode, now: number) {
      const c = ctx!;
      const hovered = hoverRef.current === n.id;
      const selected = selectedRef.current === n.id;
      const pulse = hovered || selected ? 1 + 0.28 * Math.sin(now / 220) : 1;
      const r = n.r * (hovered ? 1.07 : 1);
      const color = n.net.entity.color;

      // glow
      c.save();
      c.shadowColor = color;
      c.shadowBlur = (n.ring === 0 ? 30 : n.ring === 1 ? 18 : 11) * pulse * scale;
      c.fillStyle = '#0e1030';
      shapePath(c, n, r);
      c.fill();
      c.fill();
      c.restore();

      // artwork, clipped inside the shape
      c.save();
      shapePath(c, n, r);
      c.clip();
      c.fillStyle = '#0e1030';
      c.fill();
      const img = cachedImage(entityImage(n.net.entity));
      if (img.complete && img.naturalWidth > 0) {
        c.imageSmoothingEnabled = false;
        c.drawImage(img, (n.x ?? 0) - r, (n.y ?? 0) - r, r * 2, r * 2);
      }
      c.restore();

      // thick ink border
      c.save();
      shapePath(c, n, r);
      c.strokeStyle = INK;
      c.lineWidth = 3;
      c.stroke();
      if (selected) {
        shapePath(c, n, r + 5);
        c.strokeStyle = YELLOW;
        c.lineWidth = 3;
        c.stroke();
      } else if (hovered) {
        shapePath(c, n, r + 4);
        c.strokeStyle = 'rgba(255,210,63,.55)';
        c.lineWidth = 2;
        c.stroke();
      }
      c.restore();

    }

    function drawNodeLabel(n: SimNode) {
      const c = ctx!;
      const hovered = hoverRef.current === n.id;
      const selected = selectedRef.current === n.id;
      const r = n.r * (hovered ? 1.07 : 1);
      const showLabel = n.ring <= 1 || hovered || selected;
      if (!showLabel || !fontsReadyRef.current) return;
      const alpha = n.ring <= 1 ? 1 : 0.85;
      c.save();
      c.font = `${Math.round(14 * Math.max(0.8, scale))}px 'VT323', monospace`;
      c.textAlign = 'center';
      c.textBaseline = 'top';
      const label = entityLabel(n.net.entity);
      const ty = (n.y ?? 0) + r + 6;
      c.globalAlpha = alpha;
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(11,13,36,.9)';
      c.strokeText(label, n.x ?? 0, ty);
      c.fillStyle = hovered || selected ? YELLOW : 'rgba(232,236,255,.9)';
      c.fillText(label, n.x ?? 0, ty);
      c.restore();
    }

    function draw(now: number) {
      const c = ctx!;
      const { k, tx, ty } = viewRef.current;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      c.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
      c.lineJoin = 'round';
      drawGuides();
      drawEdges(now);
      // faded rings first so ring-0 glow sits on top
      const ordered = [...nodes].sort((a, b) => b.ring - a.ring);
      for (const n of ordered) drawNodeShape(n, now);
      for (const n of ordered) drawNodeLabel(n);
    }

    /* ------------------------------------------------------------ loop */
    function frame(now: number) {
      if (disposed) return;
      let woke = false;
      for (const n of nodes) {
        if (!n.released && now >= n.releaseAt) {
          n.released = true;
          n.fx = null;
          n.fy = null;
          woke = true;
        }
      }
      if (woke) sim.alpha(Math.max(sim.alpha(), 0.9));
      if (sim.alpha() > sim.alphaMin()) sim.tick();
      draw(now);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    /* -------------------------------------------------------- pointers */
    let dragging = false;
    let moved = false;
    let downNode: SimNode | null = null;
    let last = { x: 0, y: 0 };

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const rect = canvas!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    function positionTooltip(sx: number, sy: number) {
      const el = tooltipRef.current;
      if (!el) return;
      const tw = el.offsetWidth || 220;
      const th = el.offsetHeight || 80;
      const x = sx + tw + 24 > w ? sx - tw - 16 : sx + 16;
      const y = sy + th + 24 > h ? sy - th - 16 : sy + 16;
      el.style.transform = `translate3d(${Math.max(8, x)}px, ${Math.max(8, y)}px, 0)`;
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e);
      if (dragging) {
        if (Math.hypot(p.x - last.x, p.y - last.y) > 1) moved = true;
        viewRef.current.tx += p.x - last.x;
        viewRef.current.ty += p.y - last.y;
        last = p;
        return;
      }
      // A press that drifts off its node is a drag, not a click.
      if (downNode && Math.hypot(p.x - last.x, p.y - last.y) > 4) moved = true;
      const hit = hitTest(p.x, p.y);
      const id = hit?.id ?? null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        setHoveredId(id);
      }
      canvas!.style.cursor = id ? 'pointer' : 'grab';
      if (id) positionTooltip(p.x, p.y);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = local(e);
      downNode = hitTest(p.x, p.y);
      moved = false;
      last = p;
      if (!downNode) {
        dragging = true;
        canvas!.style.cursor = 'grabbing';
        canvas!.setPointerCapture(e.pointerId);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (dragging) {
        dragging = false;
        canvas!.style.cursor = 'grab';
        if (canvas!.hasPointerCapture(e.pointerId)) canvas!.releasePointerCapture(e.pointerId);
        if (!moved) onSelectRef.current(null);
        return;
      }
      if (downNode && !moved) onSelectRef.current(downNode.id);
      downNode = null;
    };

    const onPointerLeave = () => {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        setHoveredId(null);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const v = viewRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * Math.exp(-e.deltaY * 0.0015)));
      if (next === v.k) return;
      v.tx = p.x - (p.x - v.tx) * (next / v.k);
      v.ty = p.y - (p.y - v.ty) * (next / v.k);
      v.k = next;
    };

    const onDblClick = (e: MouseEvent) => {
      const p = local(e);
      if (hitTest(p.x, p.y)) return;
      viewRef.current = { k: 1, tx: 0, ty: 0 };
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);

    const ro = new ResizeObserver(() => {
      dpr = measure();
      retarget();
    });
    ro.observe(wrap);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      sim.stop();
      sim.nodes([]);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
    };
    // Re-runs only when a brand-new network arrives (replays the intro).
  }, [network, canvasRef, wrapRef, tooltipRef]);

  return { hoveredId };
}
