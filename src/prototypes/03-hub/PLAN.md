# 03-hub plan

Landing = spinning network globe (2D canvas with 3D projection — cheaper/crisper than r3f for pixel-glow dots) of ACTIVE projects + their members, edges member→project, blips along edges, tilted axis auto-spin, drag to spin, hover tooltip, front-facing labels. Below: pixel tagline + `SearchBar`.

On search → `search(query)`; route:
- `intent === 'nearby'` or /near me|nearby|local|around here|close to me|\bin [A-Z]/ → **Location view** (canvas equirectangular dot-grid world + markers + card strip).
- else → **Graph view** (d3-force: results big `EntityCard compact`, 1-hop neighbours small; edges = membership + domain-similarity; drag/pan/zoom).
Both: sticky SearchBar top (re-routes), AI summary, "◀ back to hub", orb (mini globe) top-left that keeps spinning; click → home. Hint bottom-left (dismissable), offline hint, empty state.

## Files
- `store.ts` — zustand: `view: 'hub'|'graph'|'map'`, `query`, `result: SearchResult|null`, `busy`, `error`, `hover`, actions `runSearch(q)`, `goHome()`.
- `graphData.ts` — pure: active projects + members → sphere nodes/edges; result ids → graph nodes/links.
- `NetworkGlobe.tsx` — canvas globe, props `size`, `spin`, `interactive`, `onHover`.
- `GraphView.tsx`, `MapView.tsx`, `world.ts` (dot-grid land approximation), `index.tsx` (routing + framer-motion transition), `hub.css` (all scoped under `.p03-hub`).

## Steps
1. opus: build everything per contract above (single agent — the state contract is small; parallelism not worth the merge risk).
2. Review; sonnet polish (CSS, hint, micro-anim); sonnet visual verify via browse skill.
3. README.
