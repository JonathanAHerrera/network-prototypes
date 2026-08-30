/**
 * 01-plane — domain "territories": one soft radial blob + pixel label per
 * domain centroid. Pure static geometry, so this renders exactly once.
 */
import { memo } from 'react';
import { DOMAIN_COLORS, DOMAINS } from '../../shared/data';
import { DOMAIN_CENTROIDS } from './layout';

/** Blob diameter in world px. */
const BLOB = 900;

function TerritoriesImpl() {
  return (
    <div className="p01-territories" aria-hidden>
      {DOMAINS.map((d) => {
        const c = DOMAIN_CENTROIDS[d];
        const color = DOMAIN_COLORS[d];
        return (
          <div key={d} className="p01-territory" style={{ left: c.x, top: c.y }}>
            <div
              className="p01-territory__blob"
              style={{
                width: BLOB,
                height: BLOB,
                background: `radial-gradient(circle, ${color}2e 0%, ${color}14 45%, transparent 70%)`,
              }}
            />
            <div className="p01-territory__label pixel">{d}</div>
          </div>
        );
      })}
    </div>
  );
}

export const Territories = memo(TerritoriesImpl);
