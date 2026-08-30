/**
 * 01-plane — one entity on the plane.
 *
 * Memoised and positioned by its CENTRE (translate(-50%,-50%)) so swapping
 * between mini / compact / full representations never shifts the layout.
 */
import { memo } from 'react';
import { EntityCard } from '../../shared/ui';
import { entityLabel } from '../../shared/data';
import type { Entity } from '../../shared/data';
import { POSITIONS } from './layout';

export type CardMode = 'mini' | 'compact' | 'full';

interface Props {
  entity: Entity;
  mode: CardMode;
  selected: boolean;
  dimmed: boolean;
  isResult: boolean;
  /** Mini-card labels only fade in once we're zoomed past ~0.3. */
  showLabel: boolean;
  onSelect: (id: string) => void;
}

function CardImpl({ entity, mode, selected, dimmed, isResult, showLabel, onSelect }: Props) {
  const p = POSITIONS.get(entity.id);
  if (!p) return null;
  const cls = [
    'p01-card',
    `p01-card--${mode}`,
    selected ? 'is-selected' : '',
    dimmed ? 'is-dim' : '',
    isResult ? 'is-result' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} style={{ left: p.x, top: p.y }} onClick={() => onSelect(entity.id)}>
      {selected && <div className="p01-card__marker pixel" aria-hidden>▼</div>}
      <div className="p01-card__inner">
        {mode === 'mini' ? (
          <div className="p01-mini" title={entityLabel(entity)}>
            <span
              className={`p01-mini__dot p01-mini__dot--${entity.kind}`}
              style={{ background: entity.color }}
            />
            <span className={`p01-mini__label pixel${showLabel ? ' is-on' : ''}`}>
              {entityLabel(entity)}
            </span>
          </div>
        ) : (
          <EntityCard entity={entity} compact={mode === 'compact'} selected={selected} />
        )}
      </div>
    </div>
  );
}

export const Card = memo(CardImpl);
