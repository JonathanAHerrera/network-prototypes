/**
 * 01-plane — the stage.
 *
 * Owns gestures (drag/wheel/pinch + keyboard) and the single transformed world
 * layer. Gestures mutate the camera singleton in `store.ts` and write the
 * transform directly; React only re-renders the culled card list, which is
 * isolated in <WorldCards/> so the stage itself stays static while panning.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { allEntities } from '../../shared/data';
import { Card, type CardMode } from './Card';
import { Territories } from './Territories';
import { cardSize, POSITIONS, WORLD } from './layout';
import {
  attachWorld, cam, cancelCameraAnimations, clearAll, commit, CULL_MARGIN,
  fitWorld, panBy, select, setViewport, startInertia, usePlane, zoomAbout, zoomByFactor,
} from './store';

/** Zoom thresholds for the three card representations. */
const MINI_BELOW = 0.45;
const FULL_ABOVE = 0.9;
const LABEL_ABOVE = 0.3;

function modeForZoom(k: number): CardMode {
  if (k < MINI_BELOW) return 'mini';
  if (k < FULL_ABOVE) return 'compact';
  return 'full';
}

/** Half-footprints precomputed once — used by the culler. */
const HALF = new Map(allEntities.map((e) => {
  const s = cardSize(e);
  return [e.id, { hw: s.w / 2, hh: s.h / 2 }] as const;
}));

function WorldCards() {
  const camera = usePlane((s) => s.camera);
  const viewport = usePlane((s) => s.viewport);
  const selectedId = usePlane((s) => s.selectedId);
  const results = usePlane((s) => s.results);

  const resultSet = useMemo(() => new Set(results?.ids ?? []), [results]);
  const mode = modeForZoom(camera.k);
  const showLabel = camera.k > LABEL_ABOVE;

  // World-space viewport rect, expanded by the cull margin.
  const visible = useMemo(() => {
    const { x, y, k } = camera;
    const x0 = -x / k - CULL_MARGIN;
    const y0 = -y / k - CULL_MARGIN;
    const x1 = (viewport.w - x) / k + CULL_MARGIN;
    const y1 = (viewport.h - y) / k + CULL_MARGIN;
    return allEntities.filter((e) => {
      const p = POSITIONS.get(e.id);
      const h = HALF.get(e.id);
      if (!p || !h) return false;
      return p.x + h.hw >= x0 && p.x - h.hw <= x1 && p.y + h.hh >= y0 && p.y - h.hh <= y1;
    });
  }, [camera, viewport]);

  // Keep the array identity stable while the *set* of visible ids is unchanged,
  // so React reconciles nothing on most frames.
  const key = visible.map((e) => e.id).join('|');
  const keyRef = useRef(key);
  const listRef = useRef(visible);
  if (keyRef.current !== key || listRef.current.length !== visible.length) {
    keyRef.current = key;
    listRef.current = visible;
  }
  const stable = listRef.current;

  const onSelect = useCallback((id: string) => select(id), []);

  return (
    <>
      {stable.map((e) => (
        <Card
          key={e.id}
          entity={e}
          mode={mode}
          selected={selectedId === e.id}
          dimmed={resultSet.size > 0 && !resultSet.has(e.id)}
          isResult={resultSet.has(e.id)}
          showLabel={showLabel}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function Plane() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);

  // Measure the stage, wire the world element to the camera, fit the world.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    attachWorld(worldRef.current);
    const measure = () => {
      const r = stage.getBoundingClientRect();
      setViewport(r.width, r.height);
    };
    measure();
    fitWorld();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => { ro.disconnect(); attachWorld(null); };
  }, []);

  useGesture(
    {
      onDrag: ({ first, last, tap, movement: [mx, my], velocity: [vx, vy], direction: [dx, dy], memo }) => {
        if (tap) return memo;
        if (first) cancelCameraAnimations();
        const base = (first ? { x: cam.x, y: cam.y } : memo) as { x: number; y: number };
        cam.x = base.x + mx;
        cam.y = base.y + my;
        commit();
        // velocity is px/ms; convert to px/frame for the decay loop.
        if (last) startInertia(vx * dx * 16, vy * dy * 16);
        return base;
      },
      onWheel: ({ event, delta: [, dy] }) => {
        event.preventDefault();
        cancelCameraAnimations();
        zoomAbout(cam.k * Math.exp(-dy * 0.0015), event.clientX, event.clientY);
      },
      onPinch: ({ first, origin: [ox, oy], offset: [s], memo }) => {
        if (first) cancelCameraAnimations();
        // `offset[0]` is a multiplicative accumulator; anchor it to k at start.
        const base = (first ? cam.k / s : memo) as number;
        zoomAbout(base * s, ox, oy);
        return base;
      },
    },
    {
      target: stageRef,
      drag: { filterTaps: true, pointer: { touch: true } },
      wheel: { eventOptions: { passive: false } },
      pinch: { eventOptions: { passive: false } },
    },
  );

  // Keyboard: arrows nudge, +/- zoom, Escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const NUDGE = 80;
      switch (e.key) {
        case 'ArrowLeft': panBy(NUDGE, 0); break;
        case 'ArrowRight': panBy(-NUDGE, 0); break;
        case 'ArrowUp': panBy(0, NUDGE); break;
        case 'ArrowDown': panBy(0, -NUDGE); break;
        case '+': case '=': zoomByFactor(1.25); break;
        case '-': case '_': zoomByFactor(1 / 1.25); break;
        case 'Escape': clearAll(); return;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="p01-stage" ref={stageRef}>
      <div className="p01-world" ref={worldRef} style={{ width: WORLD, height: WORLD }}>
        <Territories />
        <WorldCards />
      </div>
      <div className="p01-scanlines scanlines" aria-hidden />
    </div>
  );
}
