/**
 * 01-plane — 170x170 overview map. Dots are static (memoised once); only the
 * yellow viewport rect and the blinking selection re-render with the camera.
 */
import { memo, useCallback, useRef } from 'react';
import { allEntities, DOMAIN_COLORS, DOMAINS } from '../../shared/data';
import { centerOnWorld, usePlane } from './store';
import { DOMAIN_CENTROIDS, POSITIONS, WORLD } from './layout';

const SIZE = 170;
const S = SIZE / WORLD;

const Dots = memo(function Dots() {
  return (
    <g>
      {DOMAINS.map((d) => {
        const c = DOMAIN_CENTROIDS[d];
        return (
          <circle key={d} cx={c.x * S} cy={c.y * S} r={450 * S}
            fill={DOMAIN_COLORS[d]} opacity={0.16} />
        );
      })}
      {allEntities.map((e) => {
        const p = POSITIONS.get(e.id);
        if (!p) return null;
        return e.kind === 'person' ? (
          <circle key={e.id} cx={p.x * S} cy={p.y * S} r={1.9} fill={e.color} />
        ) : (
          <rect key={e.id} x={p.x * S - 2} y={p.y * S - 2} width={4} height={4} fill={e.color} />
        );
      })}
    </g>
  );
});

export function MiniMap() {
  const camera = usePlane((s) => s.camera);
  const viewport = usePlane((s) => s.viewport);
  const selectedId = usePlane((s) => s.selectedId);
  const panelOpen = !!selectedId;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);

  const jump = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    centerOnWorld(((clientX - r.left) / r.width) * WORLD, ((clientY - r.top) / r.height) * WORLD);
  }, []);

  // Viewport rectangle, in world px scaled down to the map.
  const vx = (-camera.x / camera.k) * S;
  const vy = (-camera.y / camera.k) * S;
  const vw = (viewport.w / camera.k) * S;
  const vh = (viewport.h / camera.k) * S;

  const sel = selectedId ? POSITIONS.get(selectedId) : undefined;

  return (
    <div className={`p01-minimap${panelOpen ? ' is-shifted' : ''}`}>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          jump(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => { if (dragging.current) jump(e.clientX, e.clientY); }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <rect x={0} y={0} width={SIZE} height={SIZE} fill="#0d1030" />
        <Dots />
        {sel && <circle className="p01-minimap__sel" cx={sel.x * S} cy={sel.y * S} r={4.5} />}
        <rect className="p01-minimap__view" x={vx} y={vy} width={vw} height={vh} />
      </svg>
      <div className="p01-minimap__cap pixel">map</div>
    </div>
  );
}
