import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EntityCard, Button } from '../../shared/ui';
import { dataset } from '../../shared/data';
import { Mascot } from './Mascot';
import type { Mood } from './Mascot';
import { DetailPanel } from './DetailPanel';
import { useChat } from './useChat';
import { STARTERS } from './ask';
import type { Turn } from './ask';
import './chat.css';

export default function Prototype() {
  const { turns, busy, offline, send, clear } = useChat();
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState(true);
  /** one expanded entity per assistant turn: turnId -> entityId */
  const [expanded, setExpanded] = useState<Record<string, string>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const ask = useCallback(
    (q: string) => {
      setDraft('');
      void send(q);
      taRef.current?.focus();
    },
    [send],
  );

  /* auto-grow the composer */
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  }, [draft]);

  /* autofocus */
  useEffect(() => { taRef.current?.focus(); }, []);

  /* auto-scroll to the newest turn */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: turns.length > 2 ? 'smooth' : 'auto' });
    });
    return () => cancelAnimationFrame(id);
  }, [turns, busy]);

  /* esc closes any open detail panel */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded({});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // keep "[" / "]" from flipping prototypes while typing
    e.stopPropagation();
    if (e.key === 'Escape') { setExpanded({}); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!busy && draft.trim()) ask(draft);
    }
  };

  const toggleCard = (turnId: string, entityId: string) =>
    setExpanded((prev) => {
      const next = { ...prev };
      if (next[turnId] === entityId) delete next[turnId];
      else next[turnId] = entityId;
      return next;
    });

  return (
    <div className="p05">
      <header className="p05-header">
        <div className="p05-header__brand">
          <Mascot mood={busy ? 'thinking' : 'idle'} size={26} />
          <div className="p05-header__text">
            <span className="p05-title pixel glow">HOPA</span>
            <span className="p05-sub mono">your pocket network critter</span>
          </div>
        </div>
        <Button ghost onClick={clear} disabled={!turns.length} title="clear transcript">
          ⟲ CLEAR
        </Button>
      </header>

      <div className="p05-scroll" ref={scrollRef}>
        <div className="p05-col">
          {turns.length === 0 ? (
            <div className="p05-empty">
              <Mascot mood="idle" size={132} />
              <h1 className="p05-empty__title pixel glow">ask me about the network</h1>
              <p className="p05-empty__sub mono">
                {dataset.people.length} humans · {dataset.projects.length} projects · one very small critter
              </p>
              <div className="p05-starters">
                {STARTERS.map((s) => (
                  <button key={s} className="p05-starter mono" onClick={() => ask(s)}>
                    <span className="p05-starter__arrow pixel">▸</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((t) =>
              t.role === 'user' ? (
                <motion.div
                  key={t.id}
                  className="p05-user"
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <div className="p05-user__bubble mono">{t.text}</div>
                </motion.div>
              ) : (
                <AssistantTurn
                  key={t.id}
                  turn={t}
                  expandedId={expanded[t.id]}
                  onToggleCard={(eid) => toggleCard(t.id, eid)}
                  onCloseCard={() => toggleCard(t.id, expanded[t.id] ?? '')}
                  onAsk={ask}
                />
              ),
            )
          )}
          <div className="p05-spacer" />
        </div>
      </div>

      <div className="p05-composer-wrap">
        <form
          className="p05-composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && draft.trim()) ask(draft);
          }}
        >
          <textarea
            ref={taRef}
            className="p05-input mono"
            value={draft}
            rows={1}
            placeholder="talk to hopa…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="message hopa"
          />
          <button
            type="submit"
            className="p05-send pixel"
            disabled={busy || !draft.trim()}
            aria-label="send"
          >
            {busy ? '···' : '▶'}
          </button>
        </form>
      </div>

      {hint && (
        <div className="p05-hint mono">
          enter to send · shift+enter newline · click a card for details
          {offline && <span className="p05-hint__off"> · offline mode</span>}
          <button className="p05-x p05-x--hint" onClick={() => setHint(false)} aria-label="dismiss hint">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AssistantTurn({
  turn,
  expandedId,
  onToggleCard,
  onCloseCard,
  onAsk,
}: {
  turn: Extract<Turn, { role: 'assistant' }>;
  expandedId?: string;
  onToggleCard: (entityId: string) => void;
  onCloseCard: () => void;
  onAsk: (q: string) => void;
}) {
  const [justLanded, setJustLanded] = useState(false);
  const wasPending = useRef(turn.pending);

  useEffect(() => {
    if (wasPending.current && !turn.pending && !turn.error) {
      setJustLanded(true);
      const id = window.setTimeout(() => setJustLanded(false), 900);
      wasPending.current = turn.pending;
      return () => window.clearTimeout(id);
    }
    wasPending.current = turn.pending;
  }, [turn.pending, turn.error]);

  const mood: Mood = turn.pending ? 'thinking' : turn.error ? 'error' : justLanded ? 'happy' : 'idle';
  const cards = turn.ids.map((id) => dataset.byId[id]).filter(Boolean);
  const expanded = expandedId ? dataset.byId[expandedId] : undefined;

  return (
    <motion.div
      className={`p05-bot${turn.error ? ' p05-bot--error' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <div className="p05-bot__avatar">
        <Mascot mood={mood} size={30} />
      </div>

      <div className="p05-bot__body">
        <div className="p05-panel">
          {turn.pending ? (
            <span className="p05-typing mono">
              hopa is thinking<i>.</i><i>.</i><i>.</i>
            </span>
          ) : (
            <p className="p05-reply mono">{turn.text}</p>
          )}
          {turn.offline && !turn.pending && <span className="p05-offline pixel">OFFLINE</span>}
        </div>

        {cards.length > 0 && (
          <div className="p05-strip" role="list">
            {cards.map((e, i) => (
              <motion.div
                key={e.id}
                role="listitem"
                className="p05-strip__item"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: Math.min(i, 8) * 0.045, ease: 'easeOut' }}
              >
                <EntityCard
                  entity={e}
                  compact
                  selected={expandedId === e.id}
                  onClick={() => onToggleCard(e.id)}
                />
              </motion.div>
            ))}
          </div>
        )}

        <AnimatePresence initial={false}>
          {expanded && <DetailPanel key={expanded.id} entity={expanded} onAsk={onAsk} onClose={onCloseCard} />}
        </AnimatePresence>

        {turn.error && turn.retryOf && (
          <div className="p05-chips">
            <button className="p05-chipbtn p05-chipbtn--retry mono" onClick={() => onAsk(turn.retryOf!)}>
              ↻ retry
            </button>
          </div>
        )}

        {!turn.pending && !turn.error && turn.followUps.length > 0 && (
          <div className="p05-chips">
            {turn.followUps.slice(0, 3).map((f) => (
              <button key={f} className="p05-chipbtn mono" onClick={() => onAsk(f)}>
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
