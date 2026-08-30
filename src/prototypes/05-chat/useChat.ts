import { useCallback, useEffect, useRef, useState } from 'react';
import { askHopa, followUpsFor } from './ask';
import type { Turn } from './ask';

const KEY = 'p05-chat';

function load(): Turn[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is Turn =>
        t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string',
    );
  } catch {
    return [];
  }
}

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export function useChat() {
  const [turns, setTurns] = useState<Turn[]>(load);
  const [busy, setBusy] = useState(false);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const inflight = useRef(0);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns.filter((t) => t.role === 'user' || !t.pending)));
    } catch {
      /* private mode / quota — transcript just won't persist */
    }
  }, [turns]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const history = turnsRef.current.filter((t) => t.role === 'user' || !t.pending);
    const userTurn: Turn = { role: 'user', id: nextId(), text };
    const pendingId = nextId();
    const pending: Turn = { role: 'assistant', id: pendingId, text: '', ids: [], followUps: [], pending: true };
    setTurns([...history, userTurn, pending]);
    setBusy(true);
    const ticket = ++inflight.current;

    try {
      const a = await askHopa(history, text);
      if (ticket !== inflight.current) return;
      setTurns((prev) =>
        prev.map((t) =>
          t.id === pendingId
            ? {
                role: 'assistant',
                id: pendingId,
                text: a.reply,
                ids: a.ids,
                followUps: a.followUps.length ? a.followUps : followUpsFor(a.ids),
                offline: a.offline,
              }
            : t,
        ),
      );
    } catch (e) {
      if (ticket !== inflight.current) return;
      const msg = (e as Error).message || 'unknown error';
      setTurns((prev) =>
        prev.map((t) =>
          t.id === pendingId
            ? {
                role: 'assistant',
                id: pendingId,
                text: `Oof — my antenna glitched (${msg}). Give it another go?`,
                ids: [],
                followUps: [],
                error: true,
                retryOf: text,
              }
            : t,
        ),
      );
    } finally {
      if (ticket === inflight.current) setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    inflight.current++;
    setBusy(false);
    setTurns([]);
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);

  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant' && !t.pending);
  const offline = Boolean(lastAssistant && lastAssistant.role === 'assistant' && lastAssistant.offline);

  return { turns, busy, offline, send, clear };
}
