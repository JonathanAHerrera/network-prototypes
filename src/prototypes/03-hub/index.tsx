import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button, Chip, SearchBar } from '../../shared/ui';
import NetworkGlobe from './NetworkGlobe';
import GraphView from './GraphView';
import MapView from './MapView';
import { SPHERE } from './graphData';
import { useHub } from './store';
import './hub.css';

const ORB = 72;
const SPRING = { type: 'spring', stiffness: 140, damping: 22, mass: 0.9 } as const;

export default function Prototype() {
  const view = useHub((s) => s.view);
  const busy = useHub((s) => s.busy);
  const error = useHub((s) => s.error);
  const result = useHub((s) => s.result);
  const runSearch = useHub((s) => s.runSearch);
  const goHome = useHub((s) => s.goHome);

  const [hint, setHint] = useState(true);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Escape backs out to the hub. Leave '[' / ']' alone — the app-level
  // switcher owns those. Ignore while typing into an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape' && view !== 'hub') goHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, goHome]);

  const isHub = view === 'hub';
  const globeSize = Math.max(220, Math.round(Math.min(vp.h * 0.62, 560)));
  const stackH = globeSize + 14 + 24 + 48 + 64;
  const hubTop = Math.max(20, Math.round((vp.h - stackH) / 2));
  const orbPose = isHub
    ? { x: (vp.w - globeSize) / 2, y: hubTop, scale: 1 }
    : { x: 18, y: 14, scale: ORB / globeSize };

  const status = busy ? 'asking the network…' : result?.offline ? 'offline mode' : undefined;
  const empty = !busy && !error && result != null && result.ids.length === 0;

  return (
    <div className={`p03-hub p03-hub--${view}`}>
      <div className="p03-hub__grid" aria-hidden />

      {/* The globe never unmounts — it just travels between hub and top-left orb. */}
      <motion.div
        className={`p03-orbwrap${isHub ? '' : ' p03-orbwrap--mini'}`}
        style={{ width: globeSize, height: globeSize }}
        initial={false}
        animate={orbPose}
        transition={SPRING}
        onClick={isHub ? undefined : goHome}
        title={isHub ? undefined : 'back to the hub'}
      >
        <div className="p03-orbwrap__ring" style={{ opacity: isHub ? 1 : 0 }} aria-hidden />
        <NetworkGlobe
          size={globeSize}
          interactive={isHub}
          mini={!isHub}
          speed={isHub ? 1 : 2.4}
          onClickNode={(n) => runSearch(n.label)}
        />
      </motion.div>

      <AnimatePresence initial={false} mode="wait">
        {isHub ? (
          <motion.div
            key="landing"
            className="p03-landing"
            style={{ top: hubTop + globeSize + 12 }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25 }}
          >
            <div className="p03-hud mono">
              ● {SPHERE.projectCount} active projects · {SPHERE.peopleCount} people
              <span className="p03-hud__tick" /> live
            </div>
            <div className="p03-tagline pixel glow">what are you looking for?</div>
            <SearchBar onSearch={runSearch} busy={busy} status={status} autoFocus style={{ width: '100%', maxWidth: 640 }} />
            <div className="p03-examples mono">
              {['climate people near me', 'robotics projects', 'who can teach kids to code'].map((q) => (
                <button key={q} type="button" onClick={() => runSearch(q)}>
                  {q}
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="results"
            className="p03-results"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28 }}
          >
            <div className="p03-topbar">
              <Button ghost onClick={goHome}>
                ◀ back to hub
              </Button>
              <SearchBar onSearch={runSearch} busy={busy} status={status} style={{ flex: '1 1 320px', maxWidth: 460 }} />
              <div className="p03-summary mono">{error ? '' : result?.summary}</div>
              {result?.offline && <Chip>offline</Chip>}
              <Chip color="#2f6bff">{view === 'map' ? 'map' : 'graph'}</Chip>
            </div>

            <div className="p03-stage">
              {error ? (
                <div className="p03-note">
                  <div className="pixel">something broke</div>
                  <div className="mono">{error}</div>
                  <Button primary onClick={goHome}>
                    back to hub
                  </Button>
                </div>
              ) : empty ? (
                <div className="p03-note">
                  <div className="pixel">nothing found — try 'robots near me'</div>
                  <Button primary onClick={() => runSearch('robots near me')}>
                    try it
                  </Button>
                </div>
              ) : view === 'map' ? (
                <MapView />
              ) : (
                <GraphView />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {busy && <div className="p03-busy pixel">◐ asking the network…</div>}

      {hint && (
        <div className="p03-hint mono">
          drag the globe · type to search · 'near me' opens the map
          <button type="button" aria-label="dismiss hint" onClick={() => setHint(false)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
