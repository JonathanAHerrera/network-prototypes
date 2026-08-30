# 03 Hub — spinning network globe → intent-routed view

**Landing:** a 2D-canvas "network globe" (hand-rolled 3D projection, no three.js) of every
`status === 'active'` project plus its members, laid out on a sphere (Fibonacci spread for
projects, members clustered around their project). Slow tilted auto-spin with drag inertia,
domain-coloured pixel-glow nodes (squares = projects, circles = people), faint blue member→project
edges, yellow "blip" pulses travelling along edges, front-facing labels, hover tooltip.
Below it: pixel tagline + the shared AI `SearchBar` + example chips.

**On search** → `search(query)` and route by intent:
- `intent === 'nearby'` or the query looks location-ish (`near me`, `nearby`, `local`, `in <city>`) → **Map view**:
  equirectangular dot-grid world generated from ~34 hand-written land polygons (`world.ts`, no tiles/fetches),
  auto-framed, wheel/drag pan-zoom (clamped to the world), pulsing domain-coloured markers, "you · austin",
  card strip with km chips and two-way hover highlighting.
- otherwise → **Graph view**: d3-force graph — result ids as compact `EntityCard`s, 1-hop neighbours as
  small avatar chips (click to expand), membership links (solid) + domain/similarity links (dashed),
  d3-zoom pan/zoom, drag nodes, click a selected card again to search for it.

Both views keep the search bar on top (re-search re-routes), show the AI summary, an `offline` chip when
the local fallback was used, "◀ back to hub", and the globe shrinks (framer-motion spring) into a
72 px orb top-left that keeps spinning; click it or press `Esc` to return home. Empty/error states and a
dismissable hint (bottom-left) included.

## Files
| file | role |
|---|---|
| `index.tsx` | root, routing, orb transition, topbar, states, hint |
| `store.ts` | zustand: view/query/result/busy/error/selectedId, `runSearch`, `goHome` |
| `graphData.ts` | sphere layout (`SPHERE`) and `buildGraph()` for the force graph |
| `NetworkGlobe.tsx` | canvas globe (full-size + `mini` orb mode) |
| `GraphView.tsx` / `MapView.tsx` / `world.ts` | the two result views |
| `hub.css` | all styles, scoped under `.p03-hub` |

## Try
`robotics projects` → graph · `climate people near me` → map · `asdf` → empty state · drag the globe · click a globe node.
