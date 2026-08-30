# 02-globe — plan

**Stack:** react-globe.gl (three underneath), shared `search()`, `EntityCard`, `SearchBar`, framer-motion for the sheet.

**Files**
- `index.tsx` — full-screen component; owns state (query, result, selected index, sheet open, loading, busy).
- `continents.ts` — small hand-simplified continents GeoJSON (bundled, no network) rendered via `hexPolygonsData` → dithered/pixel land look, fully offline.
- `globe.css` — all styles scoped under `.p02`.

**Globe look:** solid navy sphere material (no unpkg textures), hex-polygon land tinted per continent in muted blue/lime, `atmosphereColor` electric blue, custom star-speckle canvas/CSS backdrop, slow auto-rotate when idle (`controls().autoRotate`).

**Markers:** `htmlElementsData` — people = circle, projects = square, colored by `DOMAIN_COLORS[domain]`, thick ink border, hard shadow. Result set gets pulsing `ringsData`; non-results dim to 25% opacity.

**Flow**
1. Search → `search(q, {limit: 12})` → sheet opens with cards strip + summary + "n / N" + prev/next; globe `pointOfView({lat,lng,altitude:1.2}, 1500)` to top result.
2. Card click / arrow keys / prev-next → fly to that entity, sheet stays open.
3. Marker click → sheet with that entity + linked members/projects.
4. Close (× / swipe-down / Esc) → clear rings, undim, resume auto-rotate.

**States:** loading overlay until `onGlobeReady`, busy status in SearchBar, empty-result message in sheet, `offline` hint, dismissable bottom-left hint line.

**Verify:** tsc + build; headless screenshot via browse skill if available.
