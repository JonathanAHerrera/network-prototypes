import { Suspense, useEffect, useState } from 'react';
import { PROTOTYPES } from './prototypes/registry';
import './App.css';

function readHash() {
  const id = location.hash.replace('#', '');
  return Math.max(0, PROTOTYPES.findIndex((p) => p.id === id));
}

export default function App() {
  const [i, setI] = useState(readHash);
  const [open, setOpen] = useState(false);
  useEffect(() => { location.hash = PROTOTYPES[i].id; }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === ']') setI((x) => (x + 1) % PROTOTYPES.length);
      if (e.key === '[') setI((x) => (x - 1 + PROTOTYPES.length) % PROTOTYPES.length);
    };
    const onHash = () => setI(readHash());
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', onHash); };
  }, []);
  const P = PROTOTYPES[i];
  return (
    <div className="shell">
      <div className="shell__stage">
        <Suspense fallback={<div className="shell__loading pixel">loading {P.name}…</div>}>
          <P.Component key={P.id} />
        </Suspense>
      </div>
      <div className={`switcher${open ? ' switcher--open' : ''}`}>
        <button className="switcher__toggle pixel" onClick={() => setOpen((o) => !o)} title="[ / ] to cycle">
          ◆ {P.name}
        </button>
        {open && (
          <div className="switcher__menu">
            {PROTOTYPES.map((p, idx) => (
              <button key={p.id} className={`switcher__item${idx === i ? ' is-active' : ''}`} onClick={() => { setI(idx); setOpen(false); }}>
                <span className="pixel">{p.name}</span>
                <span className="switcher__blurb">{p.blurb}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
