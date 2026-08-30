import { useState, type FormEvent, type ReactNode } from 'react';
import type { Entity } from '../data';
import { entityImage, entityLabel } from '../data';
import './ui.css';

/** Person = circle, Project = square. Pass `compact` for dense layouts. */
export function EntityCard({ entity, selected, compact, onClick, children, style }: {
  entity: Entity; selected?: boolean; compact?: boolean; onClick?: () => void; children?: ReactNode; style?: React.CSSProperties;
}) {
  const isPerson = entity.kind === 'person';
  return (
    <div
      className={`hp-card hp-card--${entity.kind}${selected ? ' hp-card--selected' : ''}`}
      style={{ width: compact ? (isPerson ? 120 : 150) : (isPerson ? 170 : 220), cursor: onClick ? 'pointer' : 'default', ...style }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <img className="hp-card__img" src={entityImage(entity)} alt="" />
      <div className="hp-card__title">{entityLabel(entity)}</div>
      {!compact && (
        <div className="hp-card__sub">
          {isPerson ? `${entity.city} · ${entity.lookingFor}` : `${entity.city} · ${entity.status}`}
        </div>
      )}
      {!compact && (
        <div className="hp-chips">
          {entity.tags.slice(0, isPerson ? 2 : 3).map((t) => <span key={t} className="hp-chip">{t}</span>)}
        </div>
      )}
      {children}
    </div>
  );
}

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  return <span className="hp-chip" style={color ? { background: color, color: '#fff' } : undefined}>{children}</span>;
}

export function Button({ children, primary, ghost, ...rest }: { children: ReactNode; primary?: boolean; ghost?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`hp-btn${primary ? ' hp-btn--primary' : ''}${ghost ? ' hp-btn--ghost' : ''}`} {...rest}>{children}</button>;
}

/** AI search bar. Calls onSearch(query); shows a status string while busy. */
export function SearchBar({ onSearch, placeholder = 'ask the network anything…', busy, status, style, autoFocus }: {
  onSearch: (q: string) => void; placeholder?: string; busy?: boolean; status?: string; style?: React.CSSProperties; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); if (q.trim()) onSearch(q.trim()); };
  return (
    <form className="hp-search" onSubmit={submit} style={style}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      {status && <span className="hp-search__status">{status}</span>}
      <button type="submit" disabled={busy} aria-label="search">{busy ? '…' : '▶'}</button>
    </form>
  );
}
