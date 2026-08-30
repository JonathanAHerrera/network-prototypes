import { useCallback, useEffect, useRef, useState } from 'react';
import { SPHERE, type SphereNode } from './graphData';

export interface NetworkGlobeProps {
  /** CSS pixel size of the (square) canvas. */
  size: number;
  /** Enables drag-to-spin, hover tooltips and node clicks. */
  interactive?: boolean;
  /** Auto-spin multiplier. 1 = default slow drift. */
  speed?: number;
  /** Orb mode: no labels, no tooltip, fewer effects. */
  mini?: boolean;
  onHover?: (node: SphereNode | null) => void;
  onClickNode?: (node: SphereNode) => void;
}

const TILT = (23 * Math.PI) / 180;
const PERSPECTIVE = 3.2;
const BASE_SPIN = 0.0016;

/* ---- cached glow sprites (one offscreen canvas per colour/shape/size) ---- */
const sprites = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string, square: boolean, radius: number): HTMLCanvasElement {
  const r = Math.max(1, Math.round(radius));
  const key = `${color}|${square ? 's' : 'c'}|${r}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const pad = r * 3;
  const s = pad * 2;
  const cv = document.createElement('canvas');
  cv.width = s;
  cv.height = s;
  const g = cv.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(pad, pad, 0, pad, pad, pad);
    grad.addColorStop(0, hexA(color, 0.85));
    grad.addColorStop(0.35, hexA(color, 0.3));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    g.fillStyle = color;
    if (square) g.fillRect(pad - r, pad - r, r * 2, r * 2);
    else {
      g.beginPath();
      g.arc(pad, pad, r, 0, Math.PI * 2);
      g.fill();
    }
    // pixel highlight
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.fillRect(pad - r + 1, pad - r + 1, Math.max(1, r * 0.6), Math.max(1, r * 0.6));
  }
  sprites.set(key, cv);
  return cv;
}
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

interface Blip {
  edge: number;
  t: number;
  speed: number;
}

/** Faint wire sphere: 6 meridians + 5 parallels, as unit-vector polylines. */
const WIRE: Float32Array[] = (() => {
  const out: Float32Array[] = [];
  const seg = 48;
  for (let m = 0; m < 6; m++) {
    const lon = (m / 6) * Math.PI;
    const pts = new Float32Array((seg + 1) * 3);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts[i * 3] = Math.cos(a) * Math.cos(lon);
      pts[i * 3 + 1] = Math.sin(a);
      pts[i * 3 + 2] = Math.cos(a) * Math.sin(lon);
    }
    out.push(pts);
  }
  for (let k = 1; k <= 5; k++) {
    const lat = (k / 6) * Math.PI - Math.PI / 2;
    const y = Math.sin(lat);
    const rr = Math.cos(lat);
    const pts = new Float32Array((seg + 1) * 3);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts[i * 3] = Math.cos(a) * rr;
      pts[i * 3 + 1] = y;
      pts[i * 3 + 2] = Math.sin(a) * rr;
    }
    out.push(pts);
  }
  return out;
})();

export default function NetworkGlobe({ size, interactive = false, speed = 1, mini = false, onHover, onClickNode }: NetworkGlobeProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<SphereNode | null>(null);

  // Latest props for the animation loop, without restarting it.
  const opts = useRef({ interactive, speed, mini, onHover, onClickNode });
  opts.current = { interactive, speed, mini, onHover, onClickNode };

  // Projected screen positions, refreshed every frame (used for hit-testing).
  const proj = useRef<Float32Array>(new Float32Array(SPHERE.nodes.length * 3));
  const hoverIdx = useRef(-1);

  // Rotation state + travelling blips, persisted across effect re-runs (e.g. a
  // window resize changing `size`) so the globe doesn't visibly snap/reset.
  const yawRef = useRef(0.6);
  const pitchRef = useRef(0.12);
  const yawVelRef = useRef(BASE_SPIN);
  const blipsRef = useRef<Blip[] | null>(null);
  if (!blipsRef.current) {
    blipsRef.current = Array.from({ length: 8 }, () => ({
      edge: Math.floor(Math.random() * SPHERE.edges.length),
      t: Math.random(),
      speed: 0.004 + Math.random() * 0.006,
    }));
  }

  const setHover = useCallback((idx: number) => {
    if (hoverIdx.current === idx) return;
    hoverIdx.current = idx;
    const node = idx >= 0 ? SPHERE.nodes[idx] : null;
    setHovered(node);
    opts.current.onHover?.(node);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = size;
    let h = size;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      // Layout size (ignores any CSS transform scale applied by the parent).
      w = wrap.offsetWidth || size;
      h = wrap.offsetHeight || size;
      if (rect.width === 0) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const blips = blipsRef.current!;

    let dragging = false;
    let last = { x: 0, y: 0 };
    let raf = 0;
    const nodes = SPHERE.nodes;
    const order = nodes.map((_, i) => i);

    /* ---------------- pointer ---------------- */
    const local = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const k = rect.width / (w || 1);
      return { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k };
    };
    const onDown = (e: PointerEvent) => {
      if (!opts.current.interactive) return;
      dragging = true;
      last = local(e);
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!opts.current.interactive) return;
      const p = local(e);
      if (dragging) {
        const dx = p.x - last.x;
        const dy = p.y - last.y;
        last = p;
        yawRef.current += dx * 0.007;
        pitchRef.current = Math.max(-1.15, Math.min(1.15, pitchRef.current + dy * 0.006));
        yawVelRef.current = dx * 0.007;
        setHover(-1);
        return;
      }
      if (opts.current.mini) return;
      // nearest projected node within 10px, skipping back-hemisphere nodes so
      // they can't be hovered through the front; prefer whichever candidate
      // faces more towards the camera when two are within range.
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const z = proj.current[i * 3 + 2];
        if (z < -0.2) continue;
        const d = Math.hypot(proj.current[i * 3] - p.x, proj.current[i * 3 + 1] - p.y);
        if (d >= 10) continue;
        const score = d - z * 4;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      setHover(best);
      const tip = tipRef.current;
      if (tip) {
        tip.style.left = `${p.x + 14}px`;
        tip.style.top = `${p.y + 14}px`;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
    };
    const onLeave = () => setHover(-1);
    const onClick = () => {
      if (!opts.current.interactive || opts.current.mini) return;
      const i = hoverIdx.current;
      if (i >= 0) opts.current.onClickNode?.(nodes[i]);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('click', onClick);

    /* ---------------- draw ---------------- */
    const cosT = Math.cos(TILT);
    const sinT = Math.sin(TILT);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { speed: sp, mini: isMini } = opts.current;
      if (!dragging) {
        // inertia decays back into the gentle auto-spin
        yawVelRef.current = yawVelRef.current * 0.94 + BASE_SPIN * sp * 0.06;
        yawRef.current += yawVelRef.current;
        pitchRef.current += (0.12 - pitchRef.current) * 0.01;
      }

      const cy = Math.cos(yawRef.current);
      const sy = Math.sin(yawRef.current);
      const cp = Math.cos(pitchRef.current);
      const spx = Math.sin(pitchRef.current);
      const R = Math.min(w, h) * 0.4;
      const ox = w / 2;
      const oy = h / 2;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const P = proj.current;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        // yaw (Y) → pitch (X) → tilt (Z)
        let x = n.x * cy + n.z * sy;
        let z = -n.x * sy + n.z * cy;
        let y = n.y * cp - z * spx;
        z = n.y * spx + z * cp;
        const x2 = x * cosT - y * sinT;
        y = x * sinT + y * cosT;
        x = x2;
        const persp = PERSPECTIVE / (PERSPECTIVE - z);
        P[i * 3] = ox + x * R * persp;
        P[i * 3 + 1] = oy - y * R * persp;
        P[i * 3 + 2] = z;
      }

      order.sort((a, b) => P[a * 3 + 2] - P[b * 3 + 2]);

      // faint wire sphere (back hemisphere first, then front)
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? 'rgba(127,178,255,.035)' : 'rgba(127,178,255,.085)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const line of WIRE) {
          let pen = false;
          for (let i = 0; i < line.length; i += 3) {
            let x = line[i] * cy + line[i + 2] * sy;
            let z = -line[i] * sy + line[i + 2] * cy;
            let y = line[i + 1] * cp - z * spx;
            z = line[i + 1] * spx + z * cp;
            const x2 = x * cosT - y * sinT;
            y = x * sinT + y * cosT;
            x = x2;
            if ((pass === 0 && z > 0) || (pass === 1 && z <= 0)) {
              pen = false;
              continue;
            }
            const persp = PERSPECTIVE / (PERSPECTIVE - z);
            const px2 = ox + x * R * persp;
            const py2 = oy - y * R * persp;
            if (pen) ctx.lineTo(px2, py2);
            else ctx.moveTo(px2, py2);
            pen = true;
          }
        }
        ctx.stroke();
      }

      // edges
      ctx.lineWidth = 1;
      for (let e = 0; e < SPHERE.edges.length; e++) {
        const { a, b } = SPHERE.edges[e];
        const za = P[a * 3 + 2];
        const zb = P[b * 3 + 2];
        const d = (za + zb) / 2;
        const alpha = (0.06 + 0.3 * ((d + 1) / 2)) * (isMini ? 0.7 : 1);
        ctx.strokeStyle = `rgba(127,178,255,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(P[a * 3], P[a * 3 + 1]);
        ctx.lineTo(P[b * 3], P[b * 3 + 1]);
        ctx.stroke();
      }

      // nodes, back to front
      const scale = Math.min(w, h) / 560;
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        const n = nodes[i];
        const z = P[i * 3 + 2];
        const depth = (z + 1) / 2;
        const persp = PERSPECTIVE / (PERSPECTIVE - z);
        const r = Math.max(0.6, n.r * scale * persp * (0.55 + 0.45 * depth));
        const a = 0.16 + 0.84 * depth;
        const sprite = glowSprite(n.color, n.kind === 'project', r);
        ctx.globalAlpha = n.kind === 'person' ? a * 0.75 : a;
        ctx.drawImage(sprite, P[i * 3] - sprite.width / 2, P[i * 3 + 1] - sprite.height / 2);
      }
      ctx.globalAlpha = 1;

      // blips travelling along edges
      if (!isMini) {
        for (const bl of blips) {
          const edge = SPHERE.edges[bl.edge];
          if (!edge) continue;
          bl.t += bl.speed;
          if (bl.t >= 1) {
            bl.t = 0;
            bl.edge = Math.floor(Math.random() * SPHERE.edges.length);
            continue;
          }
          const a = edge.a;
          const b = edge.b;
          const z = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * bl.t;
          if (z < -0.15) continue;
          const bx = P[a * 3] + (P[b * 3] - P[a * 3]) * bl.t;
          const by = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * bl.t;
          const tail = Math.max(0, bl.t - 0.16);
          const tx = P[a * 3] + (P[b * 3] - P[a * 3]) * tail;
          const ty = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * tail;
          const g = ctx.createLinearGradient(tx, ty, bx, by);
          g.addColorStop(0, 'rgba(255,210,63,0)');
          g.addColorStop(1, 'rgba(255,210,63,.8)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.fillStyle = '#fff3b0';
          ctx.fillRect(bx - 1.5, by - 1.5, 3, 3);
        }

        // front-facing project labels
        ctx.font = '9px "Silkscreen", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (n.kind !== 'project') continue;
          const z = P[i * 3 + 2];
          if (z < 0.6) continue;
          const label = n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label;
          const alpha = Math.min(1, (z - 0.6) / 0.2);
          ctx.fillStyle = `rgba(11,13,36,${alpha * 0.65})`;
          const wtx = ctx.measureText(label).width;
          ctx.fillRect(P[i * 3] - wtx / 2 - 3, P[i * 3 + 1] + 7, wtx + 6, 12);
          ctx.fillStyle = `rgba(232,236,255,${alpha})`;
          ctx.fillText(label, P[i * 3], P[i * 3 + 1] + 8);
        }
      }

      // hover ring
      const hi = hoverIdx.current;
      if (hi >= 0 && !isMini) {
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(P[hi * 3], P[hi * 3 + 1], 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
    };
  }, [size, setHover]);

  return (
    <div className="p03-globe" ref={wrapRef} style={{ width: size, height: size }}>
      <canvas ref={canvasRef} style={{ cursor: interactive ? 'grab' : 'default', pointerEvents: interactive ? 'auto' : 'none' }} />
      {!mini && (
        <div className="p03-globe__tip" ref={tipRef} style={{ display: hovered ? 'flex' : 'none' }}>
          {hovered && (
            <>
              <img src={hovered.image} alt="" />
              <div>
                <div className="p03-globe__tip-name pixel">{hovered.label}</div>
                <div className="p03-globe__tip-sub mono">
                  {hovered.city} · {hovered.domain}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
