/**
 * 06-feed — "Daily Feed"
 *
 * A once-a-day, snap-scrolling column of people (and two projects) you should
 * meet. Deterministic per day, remembers who you've already met, and asks
 * Claude for the "why you two" line — falling back to local templates offline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { dataset, entityImage, entityLabel, me, DOMAIN_COLORS } from '../../shared/data';
import type { Entity } from '../../shared/data';
import { Button, Chip } from '../../shared/ui';
import {
  buildFeed,
  enrichFeed,
  loadDayOffset,
  loadSeen,
  loadShown,
  localEnrichAll,
  relatedIds,
  rememberShown,
  resetMemory,
  saveDayOffset,
  saveSeen,
  seedFor,
  type Enrichment,
  type FeedRow,
  type Mark,
  type SeenMap,
} from './feed';
import './feed.css';

const CONFETTI = ['✦', '✧', '★', '♥', '✚', '◆'];

export default function Prototype() {
  const reduce = useReducedMotion();
  const [dayOffset, setDayOffset] = useState(loadDayOffset);
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [localMap, setLocalMap] = useState<Record<string, Enrichment>>({});
  const [aiMap, setAiMap] = useState<Record<string, Enrichment> | null>(null);
  const [offline, setOffline] = useState(false);
  const [marks, setMarks] = useState<SeenMap>({});
  const [active, setActive] = useState(0);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(true);
  const [nonce, setNonce] = useState(0);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const celebrateTimer = useRef<number | undefined>(undefined);

  const seed = useMemo(() => seedFor(dayOffset), [dayOffset]);
  const day = dayOffset + 1;

  /* ---------------------------------------------------------- generate */
  useEffect(() => {
    let alive = true;
    setRows(null);
    setAiMap(null);
    setMarks({});
    setActive(0);
    setSheetFor(null);

    const seen = loadSeen();
    const shown = loadShown();
    const next = buildFeed(seed, seen, shown, dayOffset);
    // remember who was on screen today, so tomorrow's feed can move past them
    rememberShown(next, dayOffset);
    const local = localEnrichAll(next, seed);
    if (!alive) return;
    setRows(next);
    setLocalMap(local);
    cardRefs.current = [];
    scrollerRef.current?.scrollTo({ top: 0 });

    if (!next.length) {
      setAiMap({});
      return;
    }
    enrichFeed(next, seed).then((res) => {
      if (!alive) return;
      setAiMap(res.map);
      setOffline(res.offline);
    });
    return () => {
      alive = false;
    };
  }, [seed, dayOffset, nonce]);

  useEffect(() => () => window.clearTimeout(celebrateTimer.current), []);

  /* ------------------------------------------------------ active card */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !rows?.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        let best: { i: number; ratio: number } | null = null;
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const i = Number((en.target as HTMLElement).dataset.index);
          if (!Number.isFinite(i)) continue;
          if (!best || en.intersectionRatio > best.ratio) best = { i, ratio: en.intersectionRatio };
        }
        if (best) setActive(best.i);
      },
      { root: scroller, threshold: [0.35, 0.6, 0.9] },
    );
    cardRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [rows]);

  /* --------------------------------------------------------- actions */
  const scrollTo = useCallback(
    (i: number) => {
      const el = cardRefs.current[i];
      if (!el) return;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      setActive(i);
    },
    [reduce],
  );

  const mark = useCallback(
    (id: string, value: Mark) => {
      const seen = loadSeen();
      seen[id] = value;
      saveSeen(seen);
      setMarks((m) => ({ ...m, [id]: value }));
    },
    [],
  );

  const advance = useCallback(
    (from: number) => {
      const total = (rows?.length ?? 0) + 1; // + end card
      window.setTimeout(() => scrollTo(Math.min(from + 1, total - 1)), reduce ? 0 : 220);
    },
    [rows, scrollTo, reduce],
  );

  const openSheet = useCallback(
    (id: string) => {
      const copy = (aiMap ?? localMap)[id];
      setDraft(copy?.opener ?? '');
      setSheetFor(id);
    },
    [aiMap, localMap],
  );

  const send = useCallback(() => {
    if (!sheetFor || !rows) return;
    const i = rows.findIndex((r) => r.id === sheetFor);
    mark(sheetFor, 'hi');
    setCelebrate(sheetFor);
    window.clearTimeout(celebrateTimer.current);
    celebrateTimer.current = window.setTimeout(() => setCelebrate(null), 1100);
    setSheetFor(null);
    if (i >= 0) advance(i);
  }, [sheetFor, rows, mark, advance]);

  const skip = useCallback(
    (i: number) => {
      const row = rows?.[i];
      if (!row) return;
      mark(row.id, 'skip');
      advance(i);
    },
    [rows, mark, advance],
  );

  const newDay = useCallback(() => {
    setDayOffset((d) => {
      const next = d + 1;
      saveDayOffset(next);
      return next;
    });
  }, []);

  /** Wipe the demo memory and rebuild from day 1. `nonce` forces the effect to
   *  re-run even when the day offset was already 0. */
  const forget = useCallback(() => {
    resetMemory();
    setDayOffset(0);
    setNonce((n) => n + 1);
  }, []);

  /* -------------------------------------------------------- keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && sheetFor) {
        setSheetFor(null);
        e.preventDefault();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (sheetFor) return;
      const total = rows?.length ?? 0;
      if (!total) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        scrollTo(Math.min(active + 1, total));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        scrollTo(Math.max(active - 1, 0));
      } else if (e.key === 'h') {
        const row = rows?.[active];
        if (row) {
          e.preventDefault();
          openSheet(row.id);
        }
      } else if (e.key === 's') {
        if (active < total) {
          e.preventDefault();
          skip(active);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, rows, sheetFor, scrollTo, openSheet, skip]);

  /* ------------------------------------------------------------ render */
  const enrich = aiMap ?? null;
  const thinking = rows !== null && rows.length > 0 && aiMap === null;
  const sheetRow = rows?.find((r) => r.id === sheetFor) ?? null;

  return (
    <div className={`feed06${reduce ? ' feed06--still' : ''}`}>
      <div className="feed06__top">
        <Button primary onClick={newDay} title="regenerate with a new day seed">
          new day ☀
        </Button>
        <span className="feed06__brand pixel">daily feed</span>
      </div>

      {rows === null ? (
        <div className="feed06__boot">
          <div className="feed06__bootdot" />
          <span className="pixel">dealing today's cards…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="feed06__empty">
          <div className="feed06__emptyart pixel">◕‿◕</div>
          <h2 className="pixel">you've met everyone — new day?</h2>
          <p className="mono">the network resets its suggestions each day.</p>
          <div className="feed06__emptyrow">
            <Button primary onClick={newDay}>
              new day ☀
            </Button>
            <Button ghost onClick={forget}>
              reset memory
            </Button>
          </div>
        </div>
      ) : (
        <div className="feed06__scroller" ref={scrollerRef}>
          {rows.map((row, i) => (
            <section
              key={row.id}
              className="feed06__slot"
              data-index={i}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
            >
              <FeedCard
                row={row}
                index={i}
                active={i === active}
                copy={enrich?.[row.id] ?? localMap[row.id]}
                thinking={thinking}
                marked={marks[row.id]}
                celebrating={celebrate === row.id}
                reduce={!!reduce}
                onHi={() => openSheet(row.id)}
                onSkip={() => skip(i)}
              />
            </section>
          ))}
          <section
            className="feed06__slot"
            data-index={rows.length}
            ref={(el) => {
              cardRefs.current[rows.length] = el;
            }}
          >
            <div className="feed06__endcard">
              <div className="feed06__emptyart pixel">✓</div>
              <h2 className="pixel">that's day {day}</h2>
              <p className="mono">
                {Object.keys(marks).length} of {rows.length} answered. come back tomorrow — or skip
                ahead.
              </p>
              <Button primary onClick={newDay}>
                new day ☀
              </Button>
            </div>
          </section>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="feed06__rail">
          <span className="feed06__railday pixel">day {day}</span>
          <div className="feed06__dots">
            {rows.map((row, i) => (
              <button
                key={row.id}
                className={`feed06__dot${i === active ? ' is-active' : ''}${
                  marks[row.id] ? ` is-${marks[row.id]}` : ''
                }${row.kind === 'project' ? ' is-project' : ''}`}
                onClick={() => scrollTo(i)}
                title={`${entityLabel(row.entity)}${marks[row.id] ? ` · ${marks[row.id]}` : ''}`}
                aria-label={entityLabel(row.entity)}
              />
            ))}
          </div>
          <span className="feed06__railcount mono">
            {Math.min(active + 1, rows.length)}/{rows.length}
          </span>
        </div>
      )}

      <AnimatePresence>
        {sheetRow && (
          <ComposeSheet
            key="sheet"
            row={sheetRow}
            value={draft}
            reduce={!!reduce}
            onChange={setDraft}
            onClose={() => setSheetFor(null)}
            onSend={send}
          />
        )}
      </AnimatePresence>

      {hintOpen && (
        <div className="feed06__hint mono">
          <span>j/k move · h say hi · s skip · esc close</span>
          {offline && <span className="feed06__badge">offline · templated</span>}
          <button className="feed06__link" onClick={forget}>
            reset memory
          </button>
          <button className="feed06__x" onClick={() => setHintOpen(false)} aria-label="dismiss hint">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ card */

function FeedCard({
  row,
  index,
  active,
  copy,
  thinking,
  marked,
  celebrating,
  reduce,
  onHi,
  onSkip,
}: {
  row: FeedRow;
  index: number;
  active: boolean;
  copy?: Enrichment;
  thinking: boolean;
  marked?: Mark;
  celebrating: boolean;
  reduce: boolean;
  onHi: () => void;
  onSkip: () => void;
}) {
  const e = row.entity;
  const accent = DOMAIN_COLORS[e.domain];
  const isPerson = e.kind === 'person';
  const km = Math.round(row.km);
  const related = relatedIds(e, 3);

  return (
    <motion.article
      className={`feed06__card${active ? ' is-active' : ''}${marked ? ` is-${marked}` : ''}${
        celebrating ? ' is-celebrating' : ''
      }`}
      style={{ '--accent': accent } as React.CSSProperties}
      initial={reduce ? false : { opacity: 0, y: 26, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        reduce
          ? { duration: 0 }
          : { type: 'spring', stiffness: 260, damping: 22, delay: Math.min(index, 7) * 0.06 }
      }
    >
      <header className="feed06__cardtop">
        <span className="feed06__kind pixel" style={{ background: accent }}>
          {isPerson ? 'person' : 'project'}
        </span>
        {row.looking && <span className="feed06__looking pixel">looking for someone like you</span>}
      </header>

      <div className="feed06__shell">
        <div className={`feed06__screen${isPerson ? '' : ' feed06__screen--square'}`}>
          <img className="feed06__avatar" src={entityImage(e)} alt="" draggable={false} />
          {isPerson && (
            <>
              <span className="feed06__blink" />
              <span className="feed06__wave">👋</span>
            </>
          )}
        </div>
        <div className="feed06__shellpips">
          <i /> <i /> <i />
        </div>
      </div>

      <h2 className="feed06__name pixel">{entityLabel(e)}</h2>
      <div className="feed06__meta mono">
        {e.city} · {km < 1 ? 'here' : `${km.toLocaleString()} km`} ·{' '}
        {isPerson ? e.lookingFor : e.status}
      </div>

      <div className="feed06__why">
        {thinking ? (
          <span className="feed06__shimmer" />
        ) : (
          <p className="mono">
            <b className="pixel">{isPerson ? 'why you two' : 'why this project'}</b>
            {copy?.why ?? '—'}
          </p>
        )}
      </div>

      <div className="feed06__chips">
        {e.tags.slice(0, 3).map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
        {!isPerson && e.needs[0] && <Chip color={accent}>needs {e.needs[0]}</Chip>}
      </div>

      {related.length > 0 && (
        <div className="feed06__related">
          <span className="feed06__relatedlabel mono">{isPerson ? 'on' : 'crew'}</span>
          {related.map((id) => {
            const r: Entity = dataset.byId[id];
            return (
              <span key={id} className="feed06__mini" title={entityLabel(r)}>
                <img src={entityImage(r)} alt="" />
              </span>
            );
          })}
        </div>
      )}

      <footer className="feed06__actions">
        <Button primary onClick={onHi} disabled={!!marked}>
          👋 say hi
        </Button>
        <Button ghost onClick={onSkip} disabled={!!marked}>
          skip
        </Button>
        {marked && <span className="feed06__marked pixel">{marked === 'hi' ? 'sent ✓' : 'skipped'}</span>}
      </footer>

      {celebrating && (
        <div className="feed06__confetti" aria-hidden>
          {CONFETTI.map((c, i) => (
            <span key={i} style={{ '--i': i } as React.CSSProperties}>
              {c}
            </span>
          ))}
        </div>
      )}
    </motion.article>
  );
}

/* --------------------------------------------------------------- sheet */

function ComposeSheet({
  row,
  value,
  reduce,
  onChange,
  onClose,
  onSend,
}: {
  row: FeedRow;
  value: string;
  reduce: boolean;
  onChange: (v: string) => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => ref.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, []);
  const label = entityLabel(row.entity);
  return (
    <>
      <motion.div
        className="feed06__scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.18 }}
        onClick={onClose}
      />
      <motion.div
        className="feed06__sheet"
        role="dialog"
        aria-label={`say hi to ${label}`}
        initial={reduce ? false : { y: '100%' }}
        animate={{ y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: '100%' }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }}
      >
        <div className="feed06__sheethead">
          <span className="pixel">say hi to {label}</span>
          <button className="feed06__x" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>
        <textarea
          ref={ref}
          className="feed06__textarea mono"
          value={value}
          rows={5}
          onChange={(ev) => onChange(ev.target.value)}
          onKeyDown={(ev) => {
            ev.stopPropagation(); // don't let [ / ] switch prototypes while typing
            if (ev.key === 'Escape') onClose();
            if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) onSend();
          }}
        />
        <div className="feed06__sheetfoot">
          <span className="mono">from {me.name} · {me.city}</span>
          <div className="feed06__sheetbtns">
            <Button ghost onClick={onClose}>
              cancel
            </Button>
            <Button primary onClick={onSend} disabled={!value.trim()}>
              send ▶
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
