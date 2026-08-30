/**
 * 07 Mini-network — every query grows a small self-contained network.
 * Answer at the centre, rings outward = progressively looser but still related.
 * Click any node to re-centre; breadcrumbs track the exploration trail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { search, type SearchResult } from '../../shared/ai';
import { DOMAIN_COLORS, dataset, entityLabel } from '../../shared/data';
import type { Entity } from '../../shared/data';
import { Button, Chip, EntityCard, SearchBar } from '../../shared/ui';
import { buildFromCentre, buildFromSearch, RING_LABELS, type Network } from './buildNetwork';
import { useForceLayout } from './useForceLayout';
import './mini.css';

const SAMPLES = ['solar microgrids', 'robotics people near me', 'food projects in Berlin'];

interface Crumb {
  label: string;
  icon: string;
  net: Network;
}

function memberIdsOf(e: Entity): string[] {
  return e.kind === 'person' ? e.projectIds : e.memberIds;
}

export default function Prototype() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [network, setNetwork] = useState<Network | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(true);

  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);
  const { hoveredId } = useForceLayout({
    canvasRef,
    wrapRef,
    tooltipRef,
    network,
    selectedId,
    onSelect: handleSelect,
  });

  const nodeById = useMemo(
    () => new Map((network?.nodes ?? []).map((n) => [n.id, n])),
    [network],
  );
  const hovered = hoveredId ? nodeById.get(hoveredId) : undefined;
  const selected = selectedId ? nodeById.get(selectedId) : undefined;

  /* ------------------------------------------------------------ actions */

  const runSearch = useCallback(async (q: string) => {
    setBusy(true);
    setError(null);
    setSelectedId(null);
    try {
      const r = await search(q, { limit: 12 });
      setResult(r);
      if (!r.ids.length) {
        setNetwork(null);
        setTrail([]);
        return;
      }
      const net = buildFromSearch(r.ids);
      setNetwork(net);
      setTrail([{ label: q, icon: '🔍', net }]);
    } catch (e) {
      setError((e as Error).message || 'search failed');
      setNetwork(null);
      setTrail([]);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const recentre = useCallback((id: string) => {
    const entity = dataset.byId[id];
    if (!entity) return;
    const net = buildFromCentre(id);
    if (!net.nodes.length) return;
    setNetwork(net);
    setSelectedId(null);
    setTrail((t) => [...t, { label: entityLabel(entity), icon: entity.kind === 'person' ? '●' : '■', net }]);
  }, []);

  const gotoCrumb = useCallback(
    (i: number) => {
      const crumb = trail[i];
      if (!crumb) return;
      setNetwork(crumb.net);
      setSelectedId(null);
      setTrail(trail.slice(0, i + 1));
    },
    [trail],
  );

  /** Panel membership link: select it if it's on stage, otherwise re-centre. */
  const followLink = useCallback(
    (id: string) => {
      if (nodeById.has(id)) setSelectedId(id);
      else recentre(id);
    },
    [nodeById, recentre],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* -------------------------------------------------------------- render */

  const showStageEmpty = !network && !busy;

  return (
    <div className="p07">
      <div className="p07__stage" ref={wrapRef}>
        <canvas className="p07__canvas" ref={canvasRef} />

        {showStageEmpty && (
          <div className="p07__blank">
            {error ? (
              <>
                <div className="p07__blank-title pixel">something broke</div>
                <div className="p07__blank-sub mono">{error}</div>
                <div className="p07__samples">
                  {SAMPLES.map((s) => (
                    <Button key={s} onClick={() => runSearch(s)}>{s}</Button>
                  ))}
                </div>
              </>
            ) : result && !result.ids.length ? (
              <>
                <div className="p07__blank-title pixel">no network to grow</div>
                <div className="p07__blank-sub mono">{result.summary}</div>
                <div className="p07__samples">
                  {SAMPLES.map((s) => (
                    <Button key={s} onClick={() => runSearch(s)}>{s}</Button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="p07__blank-title pixel glow">type a question to grow a network</div>
                <div className="p07__blank-sub mono">
                  your answer lands in the middle · everything else orbits by how related it is
                </div>
                <div className="p07__samples">
                  {SAMPLES.map((s) => (
                    <Button key={s} onClick={() => runSearch(s)}>{s}</Button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {busy && !network && <div className="p07__thinking pixel">growing your network…</div>}
      </div>

      {/* ---------------------------------------------------------- header */}
      <div className={`p07__header${selected ? ' has-panel' : ''}`}>
        <div className="p07__headcol">
          <SearchBar
            autoFocus
            onSearch={runSearch}
            busy={busy}
            status={busy ? 'thinking…' : undefined}
            placeholder="ask the network anything…"
          />
          {(result || error) && (
            <div className="p07__summary mono">
              {error ? `⚠ ${error}` : result?.summary}
              {result?.offline && <span className="p07__offline"><Chip>offline</Chip></span>}
            </div>
          )}
          {trail.length > 0 && (
            <div className="p07__crumbs">
              {trail.map((c, i) => (
                <button
                  key={`${c.label}-${i}`}
                  className={`p07__crumb pixel${i === trail.length - 1 ? ' is-current' : ''}`}
                  onClick={() => gotoCrumb(i)}
                  title={`back to ${c.label}`}
                >
                  <span className="p07__crumb-icon">{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- tooltip */}
      <div ref={tooltipRef} className={`p07__tip${hovered ? ' is-on' : ''}`}>
        {hovered && (
          <>
            <div className="p07__tip-name pixel">{entityLabel(hovered.entity)}</div>
            <div className="p07__tip-kind mono">
              {hovered.entity.kind === 'person' ? '● person' : '■ project'} · {hovered.entity.domain} ·{' '}
              {RING_LABELS[hovered.ring]}
            </div>
            <div className="p07__tip-why">{hovered.why}</div>
          </>
        )}
      </div>

      {/* ----------------------------------------------------------- panel */}
      <AnimatePresence>
        {selected && (
          <motion.aside
            className="p07__panel"
            key="panel"
            initial={{ x: 380, opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 380, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
          >
            <button className="p07__panel-close pixel" onClick={() => setSelectedId(null)} aria-label="close">
              ✕
            </button>
            <div className="p07__panel-body">
              <div className="p07__panel-card">
                <EntityCard entity={selected.entity} selected />
              </div>

              <div className="p07__panel-ring pixel" style={{ background: DOMAIN_COLORS[selected.entity.domain] }}>
                {RING_LABELS[selected.ring]} · {selected.entity.domain}
              </div>

              <p className="p07__panel-why mono">{selected.why}</p>

              <p className="p07__panel-text">
                {selected.entity.kind === 'person' ? selected.entity.bio : selected.entity.description}
              </p>

              <div className="p07__panel-chips">
                {selected.entity.tags.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>

              <div className="p07__panel-section pixel">
                {selected.entity.kind === 'person' ? 'projects' : 'members'}
              </div>
              <ul className="p07__links">
                {memberIdsOf(selected.entity).length === 0 && (
                  <li className="p07__link-empty mono">no links yet</li>
                )}
                {memberIdsOf(selected.entity).map((id) => {
                  const e = dataset.byId[id];
                  if (!e) return null;
                  return (
                    <li key={id}>
                      <button className="p07__link" onClick={() => followLink(id)}>
                        <span className="p07__link-dot" style={{ background: e.color }} />
                        {entityLabel(e)}
                        <span className="p07__link-hint mono">
                          {nodeById.has(id) ? 'on stage' : 're-centre'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <Button primary onClick={() => recentre(selected.id)} style={{ width: '100%', marginTop: 14 }}>
                ◎ re-centre on this
              </Button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------ hint */}
      {hintOpen && (
        <div className="p07__hint mono">
          hover a node for why it's here · click to open · re-centre to explore · scroll to zoom
          <button className="p07__hint-x" onClick={() => setHintOpen(false)} aria-label="dismiss hint">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
