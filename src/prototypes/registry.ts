import { lazy, type LazyExoticComponent, type ComponentType } from 'react';

export interface PrototypeMeta {
  id: string;
  name: string;
  blurb: string;
  Component: LazyExoticComponent<ComponentType>;
}

/** Order here = order in the switcher. Each folder default-exports a full-screen component. */
export const PROTOTYPES: PrototypeMeta[] = [
  { id: 'plane',   name: '01 Plane',        blurb: 'Pannable 2D similarity plane',             Component: lazy(() => import('./01-plane')) },
  { id: 'globe',   name: '02 Globe',        blurb: 'AI flies the globe to results',            Component: lazy(() => import('./02-globe')) },
  { id: 'hub',     name: '03 Hub',          blurb: 'Spinning network → graph or map',          Component: lazy(() => import('./03-hub')) },
  { id: 'graph',   name: '04 Graph',        blurb: 'Graph that reorganizes per question',      Component: lazy(() => import('./04-graph')) },
  { id: 'chat',    name: '05 Chat',         blurb: 'LLM chat answering with cards',            Component: lazy(() => import('./05-chat')) },
  { id: 'feed',    name: '06 Feed',         blurb: 'Daily people-you-should-meet',             Component: lazy(() => import('./06-feed')) },
  { id: 'mini',    name: '07 Mini-net',     blurb: 'Answer-centred exploration network',       Component: lazy(() => import('./07-mini-network')) },
];
