/**
 * 01-plane — UI store + camera controller.
 *
 * The camera deliberately lives OUTSIDE React: `cam` is a mutable module
 * singleton written straight to the world element's `transform` inside rAF, so
 * pan/zoom never costs a React render. A throttled (one-per-frame) copy is
 * pushed into zustand purely so culling + the minimap can react to it.
 */
import { animate } from 'framer-motion';
import { create } from 'zustand';
import { bboxOf, POSITIONS, WORLD } from './layout';

export interface Camera { x: number; y: number; k: number }
export interface Results { ids: string[]; summary: string; offline: boolean; cursor: number }

export const MIN_K = 0.15;
export const MAX_K = 2.2;
/** Culling margin around the viewport, in world px. */
export const CULL_MARGIN = 200;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ store */

interface PlaneState {
  /** Throttled mirror of `cam` — read this in React, never write it directly. */
  camera: Camera;
  viewport: { w: number; h: number };
  selectedId: string | null;
  results: Results | null;
  busy: boolean;
  error: string | null;
  hintDismissed: boolean;
  setCamera: (c: Camera) => void;
  setViewportState: (w: number, h: number) => void;
  setSelected: (id: string | null) => void;
  setResults: (r: Results | null) => void;
  setCursor: (i: number) => void;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  dismissHint: () => void;
  reset: () => void;
}

export const usePlane = create<PlaneState>((set) => ({
  camera: { x: 0, y: 0, k: 1 },
  viewport: { w: 1, h: 1 },
  selectedId: null,
  results: null,
  busy: false,
  error: null,
  hintDismissed: false,
  setCamera: (c) =>
    set((s) =>
      s.camera.x === c.x && s.camera.y === c.y && s.camera.k === c.k ? s : { camera: c },
    ),
  setViewportState: (w, h) =>
    set((s) => (s.viewport.w === w && s.viewport.h === h ? s : { viewport: { w, h } })),
  setSelected: (id) => set({ selectedId: id }),
  setResults: (r) => set({ results: r }),
  setCursor: (i) => set((s) => (s.results ? { results: { ...s.results, cursor: i } } : s)),
  setBusy: (b) => set({ busy: b }),
  setError: (e) => set({ error: e }),
  dismissHint: () => set({ hintDismissed: true }),
  // NB: the camera is intentionally left alone — <Plane/> re-fits it on mount.
  reset: () => set({ selectedId: null, results: null, busy: false, error: null }),
}));

/* ----------------------------------------------------------------- camera */

/** Live camera. Mutated in place; never put this object into React state. */
export const cam: Camera = { x: 0, y: 0, k: 1 };

let worldEl: HTMLElement | null = null;
let vw = 1;
let vh = 1;
let miniBoost = 1;

export function attachWorld(el: HTMLElement | null) {
  worldEl = el;
  if (el) applyTransform();
}

export function setViewport(w: number, h: number) {
  vw = w; vh = h;
  usePlane.getState().setViewportState(w, h);
}

export const getViewport = () => ({ w: vw, h: vh });

/**
 * Write the camera to the DOM. Also publishes a `--p01-mini-boost` custom
 * property so far-zoom mini cards can grow back a little without a re-render;
 * only written when it actually moves, since it triggers a descendant recalc.
 */
function applyTransform() {
  if (!worldEl) return;
  worldEl.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.k})`;
  const boost = clamp(0.55 / cam.k, 1, 2.6);
  if (Math.abs(boost - miniBoost) > 0.02) {
    miniBoost = boost;
    worldEl.style.setProperty('--p01-mini-boost', boost.toFixed(2));
  }
}

let pubRaf = 0;
/** Push a copy of the camera into React state, at most once per frame. */
function publish() {
  if (pubRaf) return;
  pubRaf = requestAnimationFrame(() => {
    pubRaf = 0;
    usePlane.getState().setCamera({ x: cam.x, y: cam.y, k: cam.k });
  });
}

/** Keep at least a sliver of the world on screen so the user can't get lost. */
function clampPan() {
  const w = WORLD * cam.k;
  cam.x = clamp(cam.x, vw * 0.15 - w, vw * 0.85);
  cam.y = clamp(cam.y, vh * 0.15 - w, vh * 0.85);
}

export function commit() {
  clampPan();
  applyTransform();
  publish();
}

export function panBy(dx: number, dy: number) {
  cancelCameraAnimations();
  cam.x += dx; cam.y += dy;
  commit();
}

/** Zoom keeping the world point under (sx, sy) pinned to that screen point. */
export function zoomAbout(nextK: number, sx: number, sy: number) {
  const k = clamp(nextK, MIN_K, MAX_K);
  const wx = (sx - cam.x) / cam.k;
  const wy = (sy - cam.y) / cam.k;
  cam.x = sx - wx * k;
  cam.y = sy - wy * k;
  cam.k = k;
  commit();
}

/** Zoom about the viewport centre (used by the +/- buttons and keys). */
export function zoomByFactor(f: number) {
  cancelCameraAnimations();
  zoomAbout(cam.k * f, vw / 2, vh / 2);
}

export function worldRect() {
  return {
    x0: -cam.x / cam.k,
    y0: -cam.y / cam.k,
    x1: (vw - cam.x) / cam.k,
    y1: (vh - cam.y) / cam.k,
  };
}

/* -------------------------------------------------------- inertia + flyTo */

let inertiaRaf = 0;
let flyStop: (() => void) | null = null;

export function cancelCameraAnimations() {
  if (inertiaRaf) { cancelAnimationFrame(inertiaRaf); inertiaRaf = 0; }
  if (flyStop) { flyStop(); flyStop = null; }
}

/** Decaying pan after a flick. vx/vy are px per frame. */
export function startInertia(vx: number, vy: number) {
  cancelCameraAnimations();
  let x = vx, y = vy;
  const step = () => {
    x *= 0.92; y *= 0.92;
    if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) { inertiaRaf = 0; return; }
    cam.x += x; cam.y += y;
    commit();
    inertiaRaf = requestAnimationFrame(step);
  };
  inertiaRaf = requestAnimationFrame(step);
}

export interface FlyOpts {
  /** Keep the current zoom level and only recentre. */
  keepZoom?: boolean;
  /** Zoom level to snap to if `keepZoom` and we're currently too far out. */
  minK?: number;
}

/** Spring the camera so `ids` are framed (or just centred, with `keepZoom`). */
export function flyTo(ids: string[], opts: FlyOpts = {}) {
  const box = bboxOf(ids);
  if (!box) return;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;

  let k: number;
  if (opts.keepZoom) {
    k = Math.max(cam.k, opts.minK ?? 0);
  } else if (ids.length === 1) {
    k = 1.2;
  } else {
    const bw = Math.max(1, box.x1 - box.x0);
    const bh = Math.max(1, box.y1 - box.y0);
    k = clamp(Math.min(vw / bw, vh / bh) * 0.8, 0.5, 1.4);
  }
  k = clamp(k, MIN_K, MAX_K);

  const to = { x: vw / 2 - cx * k, y: vh / 2 - cy * k, k };
  animateCameraTo(to);
}

/** Centre a world point without changing zoom (minimap drag). */
export function centerOnWorld(wx: number, wy: number, animated = false) {
  const to = { x: vw / 2 - wx * cam.k, y: vh / 2 - wy * cam.k, k: cam.k };
  if (animated) animateCameraTo(to);
  else { cancelCameraAnimations(); cam.x = to.x; cam.y = to.y; commit(); }
}

/** Fit the whole world into the viewport (initial camera + ⌂ button). */
export function fitWorld(animated = false) {
  const k = clamp(Math.min(vw / WORLD, vh / WORLD) * 0.95, MIN_K, MAX_K);
  const to = { x: (vw - WORLD * k) / 2, y: (vh - WORLD * k) / 2, k };
  if (animated) animateCameraTo(to);
  else { cancelCameraAnimations(); cam.x = to.x; cam.y = to.y; cam.k = k; commit(); }
}

function animateCameraTo(to: Camera) {
  cancelCameraAnimations();
  const from = { x: cam.x, y: cam.y, k: cam.k };
  const ctrl = animate(0, 1, {
    type: 'spring',
    stiffness: 120,
    damping: 20,
    restDelta: 0.0005,
    onUpdate: (t) => {
      cam.x = from.x + (to.x - from.x) * t;
      cam.y = from.y + (to.y - from.y) * t;
      cam.k = clamp(from.k + (to.k - from.k) * t, MIN_K, MAX_K);
      applyTransform();
      publish();
    },
    onComplete: () => { flyStop = null; commit(); },
  });
  flyStop = () => ctrl.stop();
}

/* --------------------------------------------------------------- actions */

/** Select a card and glide to it (keeps zoom, but nudges in if far out). */
export function select(id: string | null, fly = true) {
  usePlane.getState().setSelected(id);
  if (id && fly && POSITIONS.has(id)) flyTo([id], { keepZoom: true, minK: 0.9 });
}

/** Jump the result cursor and fly to that entity. */
export function gotoResult(index: number) {
  const { results, setCursor } = usePlane.getState();
  if (!results || !results.ids.length) return;
  const n = results.ids.length;
  const i = ((index % n) + n) % n;
  setCursor(i);
  select(results.ids[i], false);
  flyTo([results.ids[i]]);
}

/** Escape / ✕ — drop results, selection and dimming. */
export function clearAll() {
  const s = usePlane.getState();
  s.setResults(null);
  s.setSelected(null);
  s.setError(null);
}

/** Reset everything on mount (module singletons survive prototype swaps). */
export function resetPlane() {
  cancelCameraAnimations();
  usePlane.getState().reset();
}
