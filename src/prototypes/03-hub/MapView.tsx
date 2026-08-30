import { useEffect, useMemo, useRef, useState } from 'react';
import { dataset, entityLabel, geoDistanceKm, me, DOMAIN_COLORS } from '../../shared/data';
import type { Entity } from '../../shared/data';
import { Chip, EntityCard } from '../../shared/ui';
import { landDots } from './world';
import { useHub } from './store';

const MIN_K_PAD = 1.35;

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export default function MapView() {
  const result = useHub((s) => s.result);
  const runSearch = useHub((s) => s.runSearch);
  const selectedId = useHub((s) => s.selectedId);
  const setSelected = useHub((s) => s.setSelected);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  hoverRef.current = hoverId ?? selectedId;

  const entities = useMemo<Entity[]>(
    () => (result?.ids ?? []).map((id) => dataset.byId[id]).filter(Boolean),
    [result],
  );
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const dots = useMemo(() => landDots(), []);

  // view = world-space centre (lng, -lat) + pixels-per-degree
  const view = useRef({ cx: 0, cy: 0, k: 2 });
  const target = useRef({ cx: 0, cy: 0, k: 2 });
  const sizeRef = useRef({ w: 1, h: 1 });

  /* auto-frame whenever the results change */
  const fitRef = useRef<() => void>(() => {});
  fitRef.current = () => {
    const { w, h } = sizeRef.current;
    const pts = [...entities.map((e) => ({ lat: e.lat, lng: e.lng })), { lat: me.lat, lng: me.lng }];
    const kMin = Math.min(w / 360, h / 180);
    if (pts.length < 2) {
      target.current = { cx: 0, cy: 0, k: kMin };
      return;
    }
    let x0 = 180;
    let x1 = -180;
    let y0 = 90;
    let y1 = -90;
    for (const p of pts) {
      x0 = Math.min(x0, p.lng);
      x1 = Math.max(x1, p.lng);
      y0 = Math.min(y0, -p.lat);
      y1 = Math.max(y1, -p.lat);
    }
    const bw = Math.max(12, x1 - x0) * MIN_K_PAD;
    const bh = Math.max(12, y1 - y0) * MIN_K_PAD;
    const k = Math.max(kMin, Math.min(9, Math.min(w / bw, h / bh)));
    target.current = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k };
  };
  useEffect(() => {
    fitRef.current();
  }, [entities]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const kMin = Math.min(w / 360, h / 180);
      if (target.current.k < kMin) target.current.k = kMin;
      if (view.current.k < kMin) view.current.k = kMin;
    };
    resize();
    // first frame: land on the framed view immediately
    fitRef.current();
    view.current = { ...target.current };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    /* ---- interaction ---- */
    let dragging = false;
    let last = { x: 0, y: 0 };
    let moved = false;

    // keep the pan target/view centred over the world — never let it drift
    // far enough that the map can be dragged/zoomed off-world.
    const clamp = (c: { cx: number; cy: number; k: number }) => {
      const { w, h } = sizeRef.current;
      const halfW = w / 2 / c.k;
      const halfH = h / 2 / c.k;
      c.cx = halfW >= 180 ? 0 : Math.max(-180 + halfW, Math.min(180 - halfW, c.cx));
      c.cy = halfH >= 90 ? 0 : Math.max(-90 + halfH, Math.min(90 - halfH, c.cy));
    };

    const screen = (lng: number, lat: number) => {
      const { w, h } = sizeRef.current;
      const v = view.current;
      return [(lng - v.cx) * v.k + w / 2, (-lat - v.cy) * v.k + h / 2];
    };
    const pick = (px: number, py: number) => {
      let best: string | null = null;
      let bestD = 18;
      for (const e of entitiesRef.current) {
        const [x, y] = screen(e.lng, e.lat);
        const d = Math.hypot(x - px, y - py);
        if (d < bestD) {
          bestD = d;
          best = e.id;
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      last = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (dragging) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        last = { x: e.clientX, y: e.clientY };
        target.current.cx -= dx / view.current.k;
        target.current.cy -= dy / view.current.k;
        view.current.cx -= dx / view.current.k;
        view.current.cy -= dy / view.current.k;
        clamp(target.current);
        clamp(view.current);
        return;
      }
      const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      setHoverId((prev) => (prev === hit ? prev : hit));
    };
    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      dragging = false;
      canvas.style.cursor = 'grab';
    };
    const onClick = (e: MouseEvent) => {
      if (moved) return;
      const rect = canvas.getBoundingClientRect();
      const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) return;
      setSelected(hit);
      const card = cardRefs.current.get(hit);
      card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { w, h } = sizeRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const v = view.current;
      const kMin = Math.min(w / 360, h / 180);
      const k2 = Math.max(kMin, Math.min(14, v.k * Math.exp(-e.deltaY * 0.0015)));
      // keep the world point under the cursor fixed
      const wx = (px - w / 2) / v.k + v.cx;
      const wy = (py - h / 2) / v.k + v.cy;
      v.cx = wx - (px - w / 2) / k2;
      v.cy = wy - (py - h / 2) / k2;
      v.k = k2;
      clamp(v);
      target.current = { ...v };
      clamp(target.current);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    const onPointerLeave = () => setHoverId(null);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    /* ---- draw ---- */
    let raf = 0;
    let t = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      t += 1 / 60;
      const { w, h } = sizeRef.current;
      const v = view.current;
      const tg = target.current;
      v.cx += (tg.cx - v.cx) * 0.12;
      v.cy += (tg.cy - v.cy) * 0.12;
      v.k += (tg.k - v.k) * 0.12;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const sx = (lng: number) => (lng - v.cx) * v.k + w / 2;
      const sy = (lat: number) => (-lat - v.cy) * v.k + h / 2;

      // graticule
      ctx.strokeStyle = 'rgba(127,178,255,.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lng = -180; lng <= 180; lng += 20) {
        const x = sx(lng);
        if (x < -5 || x > w + 5) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let lat = -80; lat <= 80; lat += 20) {
        const y = sy(lat);
        if (y < -5 || y > h + 5) continue;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // land dot matrix (batched into one path)
      const px = Math.max(2, Math.min(4, Math.round(v.k * 0.9)));
      ctx.fillStyle = 'rgba(47,107,255,.35)';
      ctx.beginPath();
      for (let i = 0; i < dots.length; i++) {
        const x = sx(dots[i].lng);
        if (x < -4 || x > w + 4) continue;
        const y = sy(dots[i].lat);
        if (y < -4 || y > h + 4) continue;
        ctx.rect(x, y, px, px);
      }
      ctx.fill();

      const list = entitiesRef.current;
      const mx = sx(me.lng);
      const my = sy(me.lat);

      // faint lines from "you" to every result
      ctx.strokeStyle = 'rgba(127,178,255,.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const e of list) {
        ctx.moveTo(mx, my);
        ctx.lineTo(sx(e.lng), sy(e.lat));
      }
      ctx.stroke();

      // markers
      const active = hoverRef.current;
      list.forEach((e, i) => {
        const x = sx(e.lng);
        const y = sy(e.lat);
        const color = DOMAIN_COLORS[e.domain];
        const isActive = e.id === active;
        const pulse = (t * 0.9 + i * 0.17) % 1;
        // pulsing ring
        ctx.strokeStyle = hexA(color, (1 - pulse) * (isActive ? 0.9 : 0.45));
        ctx.lineWidth = isActive ? 2 : 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 5 + pulse * (isActive ? 22 : 14), 0, Math.PI * 2);
        ctx.stroke();
        // glow
        const g = ctx.createRadialGradient(x, y, 0, x, y, isActive ? 22 : 14);
        g.addColorStop(0, hexA(color, 0.75));
        g.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 22, y - 22, 44, 44);
        // pixel core: square = project, circle = person
        ctx.fillStyle = isActive ? '#fffdf5' : color;
        const s = isActive ? 9 : 7;
        if (e.kind === 'project') ctx.fillRect(x - s / 2, y - s / 2, s, s);
        else {
          ctx.beginPath();
          ctx.arc(x, y, s / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(11,13,36,.75)';
        ctx.lineWidth = 1;
        if (e.kind === 'project') ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      });

      // labels for the top 6 (+ whatever is hovered)
      ctx.font = '9px "Silkscreen", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      list.forEach((e, i) => {
        if (i >= 6 && e.id !== active) return;
        const x = sx(e.lng);
        const y = sy(e.lat);
        const label = entityLabel(e);
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = e.id === active ? 'rgba(255,210,63,.92)' : 'rgba(11,13,36,.7)';
        ctx.fillRect(x - tw / 2 - 4, y - 24, tw + 8, 13);
        ctx.fillStyle = e.id === active ? '#1b1f3a' : '#e8ecff';
        ctx.fillText(label, x, y - 14);
      });

      // "you", blinking
      if (Math.floor(t * 2) % 2 === 0) {
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(mx - 4, my - 4, 8, 8);
        ctx.fillStyle = 'rgba(255,210,63,.35)';
        ctx.fillRect(mx - 8, my - 8, 16, 16);
      }
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - 4.5, my - 4.5, 9, 9);
      ctx.font = '9px "Silkscreen", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('you · austin', mx + 9, my + 4);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [dots, setSelected]);

  return (
    <div className="p03-map">
      <div className="p03-map__canvas" ref={wrapRef}>
        <canvas ref={canvasRef} />
        <div className="p03-map__legend mono">equirectangular · scroll to zoom · drag to pan</div>
      </div>
      <div className="p03-map__strip" ref={stripRef}>
        {entities.map((e) => (
          <div
            key={e.id}
            className={`p03-map__slot${(hoverId ?? selectedId) === e.id ? ' is-active' : ''}`}
            ref={(el) => {
              if (el) cardRefs.current.set(e.id, el);
              else cardRefs.current.delete(e.id);
            }}
            onMouseEnter={() => setHoverId(e.id)}
            onMouseLeave={() => setHoverId(null)}
          >
            <EntityCard entity={e} compact selected={selectedId === e.id} onClick={() => runSearch(entityLabel(e))} />
            <Chip>{Math.round(geoDistanceKm(me, e)).toLocaleString()} km</Chip>
          </div>
        ))}
      </div>
    </div>
  );
}
