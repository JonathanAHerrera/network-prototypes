/**
 * 01-plane — floating chrome: search bar, result toast, zoom controls, hint.
 * Everything here is `position: fixed` above the stage and keeps the top-right
 * ~200px free for the app's prototype switcher.
 */
import { useCallback } from 'react';
import { search } from '../../shared/ai';
import { Button, SearchBar } from '../../shared/ui';
import {
  clearAll, fitWorld, flyTo, gotoResult, select, usePlane, zoomByFactor,
} from './store';

export function Hud() {
  const busy = usePlane((s) => s.busy);
  const error = usePlane((s) => s.error);
  const results = usePlane((s) => s.results);
  const hintDismissed = usePlane((s) => s.hintDismissed);
  const dismissHint = usePlane((s) => s.dismissHint);

  const onSearch = useCallback(async (q: string) => {
    const s = usePlane.getState();
    s.setBusy(true);
    s.setError(null);
    try {
      const r = await search(q, { limit: 8 });
      s.setResults({ ids: r.ids, summary: r.summary, offline: r.offline, cursor: 0 });
      if (r.ids.length) {
        select(r.ids[0], false);
        // Frame the whole answer when it's small, otherwise land on the best hit.
        flyTo(r.ids.length <= 3 ? r.ids : [r.ids[0]]);
      } else {
        s.setSelected(null);
      }
    } catch {
      s.setResults(null);
      s.setError('search failed — try again');
    } finally {
      s.setBusy(false);
    }
  }, []);

  const total = results?.ids.length ?? 0;
  const cursor = results?.cursor ?? 0;

  return (
    <>
      <div className="p01-searchwrap">
        <SearchBar
          onSearch={onSearch}
          busy={busy}
          status={busy ? 'thinking…' : results?.offline ? 'offline' : undefined}
          placeholder="ask the plane anything…"
        />

        {(results || error) && (
          <div className="p01-toast">
            <button className="p01-toast__x pixel" onClick={clearAll} aria-label="clear results">✕</button>
            {error ? (
              <p className="p01-toast__summary">{error}</p>
            ) : (
              <>
                <p className="p01-toast__summary">
                  {results?.summary}
                  {results?.offline && <span className="p01-toast__offline mono">offline</span>}
                </p>
                {total > 0 && (
                  <div className="p01-toast__nav">
                    <Button onClick={() => gotoResult(cursor - 1)}>◀ prev</Button>
                    <span className="p01-toast__count pixel">{cursor + 1}/{total}</span>
                    <Button primary onClick={() => gotoResult(cursor + 1)}>next ▶</Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="p01-controls">
        <div className="p01-zoom">
          <Button onClick={() => zoomByFactor(1.25)} aria-label="zoom in">+</Button>
          <Button onClick={() => zoomByFactor(1 / 1.25)} aria-label="zoom out">−</Button>
          <Button ghost onClick={() => fitWorld(true)}>⌂ fit</Button>
        </div>
        {!hintDismissed && (
          <div className="p01-hint mono">
            drag to pan · wheel/pinch to zoom · click a card · ↑↓←→ nudge · ask the bar above
            <button className="p01-hint__x" onClick={dismissHint} aria-label="dismiss hint">✕</button>
          </div>
        )}
      </div>
    </>
  );
}
