/**
 * 01-plane — right-hand detail panel for the selected entity.
 * Slides in with framer-motion; linked entities are compact cards that
 * select + fly on click.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { dataset, DOMAIN_COLORS, entityImage, entityLabel } from '../../shared/data';
import type { Entity } from '../../shared/data';
import { Chip, EntityCard } from '../../shared/ui';
import { flyTo, select, usePlane } from './store';

function linkedOf(e: Entity): Entity[] {
  const ids = e.kind === 'person' ? e.projectIds : e.memberIds;
  return ids.map((id) => dataset.byId[id]).filter(Boolean);
}

export function DetailPanel() {
  const selectedId = usePlane((s) => s.selectedId);
  const entity = selectedId ? dataset.byId[selectedId] : undefined;

  return (
    <AnimatePresence>
      {entity && (
        <motion.aside
          key="p01-panel"
          className="p01-panel"
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 26 }}
        >
          <button className="p01-panel__close pixel" onClick={() => select(null, false)} aria-label="close">
            ✕
          </button>

          <img className="p01-panel__img" src={entityImage(entity)} alt="" />
          <h2 className="p01-panel__name pixel">{entityLabel(entity)}</h2>

          <div className="p01-panel__meta">
            <span className="mono">{entity.city}</span>
            <Chip color={DOMAIN_COLORS[entity.domain]}>{entity.domain}</Chip>
          </div>

          {entity.kind === 'person' ? (
            <p className="p01-panel__body">{entity.bio}</p>
          ) : (
            <>
              <p className="p01-panel__tagline mono">{entity.tagline}</p>
              <p className="p01-panel__body">{entity.description}</p>
            </>
          )}

          <div className="p01-panel__chips">
            {entity.tags.map((t) => <Chip key={t}>{t}</Chip>)}
          </div>

          {entity.kind === 'person' ? (
            <>
              <h3 className="p01-panel__h pixel">looking for</h3>
              <p className="p01-panel__body">{entity.lookingFor}</p>
              <h3 className="p01-panel__h pixel">skills</h3>
              <div className="p01-panel__chips">
                {entity.skills.map((s) => <Chip key={s}>{s}</Chip>)}
              </div>
            </>
          ) : (
            <>
              <h3 className="p01-panel__h pixel">status</h3>
              <p className="p01-panel__body mono">{entity.status}</p>
              <h3 className="p01-panel__h pixel">needs</h3>
              <div className="p01-panel__chips">
                {entity.needs.map((n) => <Chip key={n}>{n}</Chip>)}
              </div>
            </>
          )}

          <h3 className="p01-panel__h pixel">
            {entity.kind === 'person' ? 'linked projects' : 'members'}
          </h3>
          <div className="p01-panel__linked">
            {linkedOf(entity).map((l) => (
              <EntityCard
                key={l.id}
                entity={l}
                compact
                onClick={() => { select(l.id, false); flyTo([l.id]); }}
              />
            ))}
            {linkedOf(entity).length === 0 && (
              <p className="p01-panel__body p01-empty mono">no links yet</p>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
