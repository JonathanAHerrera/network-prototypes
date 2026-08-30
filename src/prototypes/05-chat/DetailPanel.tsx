import { useRef } from 'react';
import { motion } from 'framer-motion';
import { EntityCard, Chip } from '../../shared/ui';
import { entityLabel, geoDistanceKm, me } from '../../shared/data';
import type { Entity } from '../../shared/data';
import { linkedEntities } from './ask';

export function DetailPanel({
  entity,
  onAsk,
  onClose,
}: {
  entity: Entity;
  onAsk: (q: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const links = linkedEntities(entity);
  const isPerson = entity.kind === 'person';
  const dist = Math.round(geoDistanceKm(entity, me));

  return (
    <motion.div
      className="p05-detail"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      onAnimationComplete={(def) => {
        if (def === 'exit') return;
        panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }}
      ref={panelRef}
    >
      <div className="p05-detail__inner">
        <div className="p05-detail__head">
          <span className="p05-detail__name pixel" style={{ color: entity.color }}>
            {entityLabel(entity)}
          </span>
          <span className="p05-detail__meta mono">
            {entity.city}, {entity.country} · {dist.toLocaleString()}km from {me.city} ·{' '}
            {isPerson ? `looking for ${entity.lookingFor}` : entity.status}
          </span>
          <button className="p05-x" onClick={onClose} aria-label="close details" title="close (esc)">
            ×
          </button>
        </div>

        <p className="p05-detail__body mono">{isPerson ? entity.bio : entity.description}</p>

        <div className="hp-chips p05-detail__tags">
          {entity.tags.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
          {(isPerson ? entity.skills : entity.needs).slice(0, 3).map((s) => (
            <Chip key={s} color={entity.color}>
              {isPerson ? s : `needs ${s}`}
            </Chip>
          ))}
        </div>

        {links.length > 0 && (
          <>
            <div className="p05-detail__label pixel">{isPerson ? 'ON THESE PROJECTS' : 'THE CREW'}</div>
            <div className="p05-detail__links">
              {links.map((l) => (
                <EntityCard
                  key={l.id}
                  entity={l}
                  compact
                  onClick={() => onAsk(`tell me about ${entityLabel(l)}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default DetailPanel;
