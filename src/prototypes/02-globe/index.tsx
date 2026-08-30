import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial, LineBasicMaterial, Color } from 'three';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';

import {
  allEntities,
  dataset,
  DOMAIN_COLORS,
  entityLabel,
  me,
  type Entity,
} from '../../shared/data';
import { search, type SearchResult } from '../../shared/ai';
import { EntityCard, SearchBar } from '../../shared/ui';
import { LAND_FEATURES, landColor, type LandFeature } from './continents';
import './globe.css';

/* ------------------------------------------------------------------ consts */

const HINT_KEY = 'p02-hint-dismissed';
const SHEET_ALT = 1.1;
const HOME_ALT = 2.2;

/** Stable identity — re-creating this array would re-create every marker DOM node. */
const MARKERS: Entity[] = allEntities;

/** Solid material: no remote textures, so the globe works fully offline. */
const GLOBE_MATERIAL = new MeshPhongMaterial({
  color: '#0f1440',
  emissive: '#0b0d24',
  shininess: 5,
});

/** Module-scope so the hexed-polygons layer never sees a new accessor identity. */
const landColorAcc = (d: object) => landColor(d as LandFeature);

/** Hides markers on the far side of the globe so they don't show through. */
const visMod = (el: HTMLElement, isVisible: boolean) => el.classList.toggle('p02-marker--hidden', !isVisible);

/* ------------------------------------------------------------ star backdrop */

/** Deterministic PRNG so the star field is identical between reloads. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintStars(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const rand = mulberry32(0x5eed);
  const count = Math.round((w * h) / 3200);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const r = rand();
    const size = r > 0.94 ? 2 : 1;
    ctx.fillStyle =
      r > 0.97 ? 'rgba(255,210,63,0.75)'
        : r > 0.9 ? 'rgba(127,178,255,0.85)'
          : `rgba(232,236,255,${(0.18 + rand() * 0.5).toFixed(2)})`;
    ctx.fillRect(x, y, size, size);
  }
}

/* ------------------------------------------------------------- error guard */

/**
 * WebGL can be missing (headless CI, blocked GPU). Without this, three throws
 * during render and React unmounts the whole prototype to a blank screen.
 */
class GlobeBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn('[02-globe] globe failed to start', err); this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/* ------------------------------------------------------------------- helper */

function linkedTo(e: Entity): Entity[] {
  const ids = e.kind === 'person' ? e.projectIds : e.memberIds;
  return ids.map((id) => dataset.byId[id]).filter(Boolean);
}

/* ---------------------------------------------------------------- component */

export default function Prototype() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const stripRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const markerEls = useRef(new Map<string, HTMLDivElement>());
  const draggingRef = useRef(false);
  const openRef = useRef(false);
  const idxRef = useRef(0);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [glError, setGlError] = useState(false);
  const [hintOff, setHintOff] = useState(() => {
    try { return sessionStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
  });

  /* ------------------------------------------------------------ measurement */

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (starsRef.current && size.w > 0 && size.h > 0) paintStars(starsRef.current, size.w, size.h);
  }, [size.w, size.h]);

  /* ------------------------------------------------------------------- fly */

  const flyTo = useCallback((e: Entity, altitude = SHEET_ALT) => {
    // The bottom sheet covers the bottom 40% of the screen, and pointOfView
    // centres the target in the full viewport — so nudge the target latitude
    // north for sheet flights, keeping the marker in the visible upper area.
    const lat = altitude === SHEET_ALT ? Math.min(89, Math.max(-89, e.lat - 9)) : e.lat;
    globeRef.current?.pointOfView({ lat, lng: e.lng, altitude }, 1500);
  }, []);

  /* --------------------------------------------------------------- markers */

  // Held in a ref so `htmlElement` can stay referentially stable: three-globe
  // wipes and rebuilds every CSS2D node whenever that prop's identity changes.
  const onMarkerRef = useRef<(e: Entity) => void>(() => {});

  const makeMarker = useCallback((d: object) => {
    const e = d as Entity;
    // Wrapper is positioned by CSS2DRenderer (it overwrites inline transform
    // every frame); the inner glyph carries our own scale/glow transforms.
    const el = document.createElement('div');
    el.className = `p02-marker p02-marker--${e.kind}`;
    el.title = entityLabel(e);
    const glyph = document.createElement('i');
    glyph.style.background = DOMAIN_COLORS[e.domain];
    el.appendChild(glyph);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onMarkerRef.current(e);
    });
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    markerEls.current.set(e.id, el);
    return el;
  }, []);

  const latAcc = useCallback((d: object) => (d as Entity).lat, []);
  const lngAcc = useCallback((d: object) => (d as Entity).lng, []);

  // Toggle classes directly on the cached nodes — never re-feed htmlElementsData.
  useEffect(() => {
    const hits = new Set(entities.map((e) => e.id));
    const selId = entities[idx]?.id;
    const active = open && hits.size > 0;
    markerEls.current.forEach((el, id) => {
      el.classList.toggle('p02-marker--dim', active && !hits.has(id));
      el.classList.toggle('p02-marker--hit', active && hits.has(id) && id !== selId);
      el.classList.toggle('p02-marker--sel', active && id === selId);
    });
  }, [entities, idx, open]);

  /* ----------------------------------------------------------------- rings */

  const rings = useMemo(() => (open ? entities : []), [open, entities]);
  const ringColor = useCallback(
    (d: object) => {
      const c = new Color(DOMAIN_COLORS[(d as Entity).domain]);
      const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
      return (t: number) => `rgba(${rgb},${(1 - t).toFixed(2)})`;
    },
    [],
  );

  /* ----------------------------------------------------------- auto-rotate */

  const listenersBound = useRef(false);

  const applyRotate = useCallback((on: boolean) => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = on;
    controls.autoRotateSpeed = 0.5;
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyRotate(!open && !draggingRef.current);
  }, [ready, open, applyRotate]);

  const onGlobeReady = useCallback(() => {
    setReady(true);
    const g = globeRef.current;
    if (!g) return;
    g.pointOfView({ lat: me.lat, lng: me.lng, altitude: HOME_ALT }, 0);
    const controls = g.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    if (!listenersBound.current) {
      listenersBound.current = true;
      controls.addEventListener('start', () => {
        draggingRef.current = true;
        controls.autoRotate = false;
      });
      controls.addEventListener('end', () => {
        draggingRef.current = false;
        controls.autoRotate = !openRef.current;
      });
    }
    // Graticules ship as light grey; tint them to the prototype's blue.
    try {
      g.scene().traverse((o) => {
        const mat = (o as unknown as { material?: LineBasicMaterial }).material;
        if (mat instanceof LineBasicMaterial) mat.color.set('#2f6bff');
      });
    } catch { /* purely cosmetic */ }
  }, []);

  useEffect(() => { openRef.current = open; }, [open]);

  /* ----------------------------------------------------------------- flows */

  const openWith = useCallback(
    (list: Entity[], res: SearchResult) => {
      setEntities(list);
      setResult(res);
      idxRef.current = 0;
      setIdx(0);
      setOpen(true);
      if (list.length) flyTo(list[0]);
    },
    [flyTo],
  );

  const onSearch = useCallback(
    async (q: string) => {
      // Search leaves focus in the input, which makes the keydown handler
      // ignore ArrowLeft/Right (it skips INPUT targets) — blur it so the
      // just-submitted search can immediately be cycled with arrow keys.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setBusy(true);
      try {
        const r = await search(q, { limit: 12 });
        setOffline(r.offline);
        const list = r.ids.map((id) => dataset.byId[id]).filter(Boolean);
        openWith(list, r);
      } catch (err) {
        console.warn('[02-globe] search failed', err);
        openWith([], {
          ids: [], intent: 'chat', offline: true,
          summary: 'Search hiccuped — try again.',
        });
      } finally {
        setBusy(false);
      }
    },
    [openWith],
  );

  const onMarker = useCallback(
    (e: Entity) => {
      const links = linkedTo(e);
      const noun = e.kind === 'person' ? 'linked project' : 'member';
      openWith([e, ...links], {
        ids: [e.id, ...links.map((x) => x.id)],
        intent: 'mixed',
        offline: false,
        summary: links.length
          ? `${entityLabel(e)} + ${links.length} ${noun}${links.length === 1 ? '' : 's'}`
          : `${entityLabel(e)} — no links yet`,
      });
    },
    [openWith],
  );
  useEffect(() => { onMarkerRef.current = onMarker; }, [onMarker]);

  const close = useCallback(() => {
    setOpen(false);
    setEntities([]);
    setResult(null);
    idxRef.current = 0;
    setIdx(0);
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (!entities.length) return;
      const next = (idxRef.current + delta + entities.length) % entities.length;
      idxRef.current = next;
      setIdx(next);
      flyTo(entities[next]);
    },
    [entities, flyTo],
  );

  /* -------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const inInput = target?.tagName === 'INPUT';
      if (ev.key === 'Escape') {
        if (inInput) target?.blur();
        if (openRef.current) { ev.preventDefault(); close(); }
        return;
      }
      // An emptied search bar still holds focus — don't let that trap the
      // arrow keys while the sheet is open.
      const emptyInput = inInput && (target as HTMLInputElement).value === '';
      if ((inInput && !emptyInput) || !openRef.current) return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); step(1); }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, step]);

  /* --------------------------------------------------- keep card in view */

  useEffect(() => {
    if (!open) return;
    const id = entities[idx]?.id;
    if (!id) return;
    cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [idx, entities, open]);

  const onDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > 80) close();
    },
    [close],
  );

  const dismissHint = useCallback(() => {
    setHintOff(true);
    try { sessionStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
  }, []);

  const status = busy ? 'thinking…' : offline ? 'offline' : undefined;

  /* ------------------------------------------------------------------ view */

  return (
    <div className="p02" ref={wrapRef}>
      <canvas className="p02__stars" ref={starsRef} />
      <div className="p02__twinkle" />

      <div className="p02__globe">
        {size.w > 0 && size.h > 0 && !glError && (
          <GlobeBoundary onError={() => setGlError(true)}>
          <Globe
            ref={globeRef}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl={null}
            bumpImageUrl={null}
            showGlobe
            showGraticules
            globeMaterial={GLOBE_MATERIAL}
            atmosphereColor="#2f6bff"
            atmosphereAltitude={0.22}
            onGlobeReady={onGlobeReady}
            /* land — hexed polygons give the dithered pixel look */
            hexPolygonsData={LAND_FEATURES}
            hexPolygonGeoJsonGeometry="geometry"
            hexPolygonResolution={3}
            hexPolygonMargin={0.35}
            hexPolygonAltitude={0.007}
            hexPolygonColor={landColorAcc}
            hexPolygonsTransitionDuration={0}
            /* markers */
            htmlElementsData={MARKERS}
            htmlLat={latAcc}
            htmlLng={lngAcc}
            htmlAltitude={0.012}
            htmlElement={makeMarker}
            htmlTransitionDuration={0}
            htmlElementVisibilityModifier={visMod}
            /* result pulses */
            ringsData={rings}
            ringLat={latAcc}
            ringLng={lngAcc}
            ringColor={ringColor}
            ringAltitude={0.012}
            ringMaxRadius={5}
            ringPropagationSpeed={2}
            ringRepeatPeriod={900}
          />
          </GlobeBoundary>
        )}
        {glError && (
          <div className="p02__glfail pixel">
            this view needs WebGL — the rest of the prototype still works
          </div>
        )}
      </div>

      <div className="p02__legend">
        <div className="p02__legend-row">
          <i className="p02__legend-swatch p02__legend-swatch--person" /> person
        </div>
        <div className="p02__legend-row">
          <i className="p02__legend-swatch p02__legend-swatch--project" /> project
        </div>
      </div>

      <div className="p02__search">
        <SearchBar
          onSearch={onSearch}
          busy={busy}
          status={status}
          placeholder="ask the globe — climate projects, people near me…"
          style={{ width: '100%' }}
        />
      </div>

      {!hintOff && (
        <div className="p02__hint mono">
          <span>
            type a question <b>▶</b>&nbsp; click a marker &nbsp;·&nbsp; <b>←</b> <b>→</b> cycle &nbsp;·&nbsp; <b>esc</b> close
          </span>
          <button className="p02__hint-x" onClick={dismissHint} aria-label="dismiss hint">×</button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="p02__sheet"
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.45 }}
            onDragEnd={onDragEnd}
          >
            <div className="p02__grab" />
            <div className="p02__head">
              <div className="p02__summary">{result?.summary ?? ''}</div>
              <div className="p02__nav">
                <span className="p02__count">
                  {entities.length ? `${idx + 1} / ${entities.length}` : '0 / 0'}
                </span>
                <button
                  className="p02__btn"
                  onClick={() => step(-1)}
                  disabled={entities.length < 2}
                  aria-label="previous result"
                >
                  ◀
                </button>
                <button
                  className="p02__btn"
                  onClick={() => step(1)}
                  disabled={entities.length < 2}
                  aria-label="next result"
                >
                  ▶
                </button>
                <button className="p02__btn p02__btn--close" onClick={close} aria-label="close">×</button>
              </div>
            </div>

            {entities.length === 0 ? (
              <div className="p02__empty">
                Nothing found — try &ldquo;climate projects&rdquo; or &ldquo;people near me&rdquo;
              </div>
            ) : (
              <div className="p02__strip" ref={stripRef}>
                {entities.map((e, i) => (
                  <div
                    key={e.id}
                    ref={(node) => {
                      if (node) cardRefs.current.set(e.id, node);
                      else cardRefs.current.delete(e.id);
                    }}
                  >
                    <EntityCard
                      entity={e}
                      compact
                      selected={i === idx}
                      onClick={() => { idxRef.current = i; setIdx(i); flyTo(e); }}
                    />
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!ready && !glError && (
        <div className="p02__boot">
          <span>booting globe…</span>
        </div>
      )}
    </div>
  );
}
