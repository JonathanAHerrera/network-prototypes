import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { useDrag } from '@use-gesture/react';
import { entityImage, entityLabel } from '../../shared/data';
import { EntityCard } from '../../shared/ui';
import { buildGraph, nodeRadius, type GLink, type GNode } from './graphData';
import { useHub } from './store';

interface Transform {
  x: number;
  y: number;
  k: number;
}

export default function GraphView() {
  const result = useHub((s) => s.result);
  const runSearch = useHub((s) => s.runSearch);
  const selectedId = useHub((s) => s.selectedId);
  const setSelected = useHub((s) => s.setSelected);

  const graph = useMemo(() => buildGraph(result?.ids ?? []), [result]);
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => setExpanded([]), [graph]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const linkEls = useRef(new Map<string, SVGLineElement>());
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const tRef = useRef<Transform>({ x: 0, y: 0, k: 1 });

  /* ---- simulation ---- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !graph.nodes.length) return;

    const sim = forceSimulation<GNode, GLink>(graph.nodes)
      .force(
        'link',
        forceLink<GNode, GLink>(graph.links)
          .id((d) => d.id)
          .distance((l) => (l.kind === 'member' ? 120 : 180))
          .strength((l) => (l.kind === 'member' ? 0.55 : 0.16)),
      )
      .force('charge', forceManyBody<GNode>().strength(-400).distanceMax(900))
      .force('collide', forceCollide<GNode>().radius((d) => d.r + 8).iterations(2))
      .force('center', forceCenter(0, 0).strength(0.06))
      .alpha(1)
      .alphaDecay(0.022)
      .velocityDecay(0.38);
    simRef.current = sim;

    /* ---- zoom / pan ---- */
    const applyTransform = () => {
      const t = tRef.current;
      gRef.current?.setAttribute('transform', `translate(${t.x},${t.y}) scale(${t.k})`);
      if (layerRef.current) layerRef.current.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
    };

    const zb = d3zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.25, 2.2])
      .filter((e: Event) => e.type === 'wheel' || !(e.target as Element)?.closest?.('.p03-node'))
      .on('zoom', (e: { transform: Transform }) => {
        tRef.current = { x: e.transform.x, y: e.transform.y, k: e.transform.k };
        applyTransform();
      });
    const sel = select(container);
    sel.call(zb);
    const start = zoomIdentity.translate(container.clientWidth / 2, container.clientHeight / 2).scale(
      graph.nodes.length > 30 ? 0.62 : 0.82,
    );
    sel.call(zb.transform, start);

    /* ---- paint: mutate DOM directly, never re-render per tick ---- */
    const paint = () => {
      for (const n of graph.nodes) {
        const el = nodeEls.current.get(n.id);
        if (el) el.style.transform = `translate3d(${(n.x ?? 0).toFixed(1)}px, ${(n.y ?? 0).toFixed(1)}px, 0) translate(-50%, -50%)`;
      }
      for (const l of graph.links) {
        const el = linkEls.current.get(l.id);
        if (!el) continue;
        const s = l.source as GNode;
        const t = l.target as GNode;
        el.setAttribute('x1', String(s.x ?? 0));
        el.setAttribute('y1', String(s.y ?? 0));
        el.setAttribute('x2', String(t.x ?? 0));
        el.setAttribute('y2', String(t.y ?? 0));
      }
    };
    sim.on('tick', paint);
    paint();

    return () => {
      sim.on('tick', null);
      sim.stop();
      sel.on('.zoom', null);
      simRef.current = null;
    };
  }, [graph]);

  /* Expanding a neighbour changes its footprint → re-register collide + re-heat. */
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    for (const n of graph.nodes) n.r = nodeRadius(n.entity, n.primary || expanded.includes(n.id));
    sim.force('collide', forceCollide<GNode>().radius((d) => d.r + 8).iterations(2));
    sim.alpha(Math.max(sim.alpha(), 0.35)).restart();
  }, [expanded, graph]);

  const toggle = (id: string) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="p03-graph" ref={containerRef}>
      <svg className="p03-graph__links">
        <g ref={gRef}>
          {graph.links.map((l) => (
            <line
              key={l.id}
              ref={(el) => {
                if (el) linkEls.current.set(l.id, el);
                else linkEls.current.delete(l.id);
              }}
              className={`p03-link p03-link--${l.kind}`}
            />
          ))}
        </g>
      </svg>
      <div className="p03-graph__nodes" ref={layerRef}>
        {graph.nodes.map((n) => (
          <NodeView
            key={n.id}
            node={n}
            open={n.primary || expanded.includes(n.id)}
            selected={selectedId === n.id}
            simRef={simRef}
            tRef={tRef}
            register={(el) => {
              if (el) nodeEls.current.set(n.id, el);
              else nodeEls.current.delete(n.id);
            }}
            onTap={() => {
              if (n.primary || expanded.includes(n.id)) {
                // first click on an open node selects it; clicking the
                // already-selected node is what runs a new search.
                if (selectedId === n.id) {
                  runSearch(entityLabel(n.entity));
                } else {
                  setSelected(n.id);
                }
              } else {
                toggle(n.id);
                setSelected(n.id);
              }
            }}
          />
        ))}
      </div>
      <div className="p03-graph__legend mono">
        <span><i className="p03-legend__line p03-legend__line--member" /> member of</span>
        <span><i className="p03-legend__line p03-legend__line--sim" /> similar</span>
        <span>drag nodes · scroll to zoom · click twice to explore</span>
      </div>
    </div>
  );
}

function NodeView({
  node,
  open,
  selected,
  simRef,
  tRef,
  register,
  onTap,
}: {
  node: GNode;
  open: boolean;
  selected: boolean;
  simRef: React.RefObject<Simulation<GNode, GLink> | null>;
  tRef: React.RefObject<Transform>;
  register: (el: HTMLDivElement | null) => void;
  onTap: () => void;
}) {
  const dragged = useRef(false);
  const bind = useDrag(
    ({ first, last, movement: [mx, my], delta: [dx, dy], event }) => {
      event.stopPropagation();
      const k = tRef.current?.k || 1;
      if (first) {
        dragged.current = false;
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.22).restart();
      }
      if (Math.abs(mx) + Math.abs(my) > 4) dragged.current = true;
      node.fx = (node.fx ?? node.x ?? 0) + dx / k;
      node.fy = (node.fy ?? node.y ?? 0) + dy / k;
      if (last) {
        node.fx = null;
        node.fy = null;
        simRef.current?.alphaTarget(0);
      }
    },
    { pointer: { touch: true } },
  );

  return (
    <div
      {...bind()}
      onClick={(e) => {
        e.stopPropagation();
        if (!dragged.current) onTap();
      }}
      ref={register}
      className={`p03-node${open ? ' p03-node--open' : ' p03-node--small'}${selected ? ' is-selected' : ''}`}
      style={{ touchAction: 'none' }}
    >
      {open ? (
        <EntityCard entity={node.entity} compact selected={selected} />
      ) : (
        <>
          <img
            className="p03-node__avatar"
            src={entityImage(node.entity)}
            alt=""
            style={{ borderColor: node.entity.color }}
          />
          <span className="p03-node__label pixel">{entityLabel(node.entity)}</span>
        </>
      )}
    </div>
  );
}
