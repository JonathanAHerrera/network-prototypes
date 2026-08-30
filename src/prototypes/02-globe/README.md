# 02 — Globe

Full-screen 3D globe (react-globe.gl) where every person (circle) and project (square) is a marker at its lat/lng, coloured by domain. Ask the AI search bar a question and the globe flies to the top result while a bottom sheet slides up with the result cards and the AI summary.

## Files
- `index.tsx` — the prototype (search flow, sheet, markers, keyboard, auto-rotate).
- `continents.ts` — bundled hand-simplified landmass GeoJSON (26 chunks) + two-tone dither colour fn. No network textures: the globe is fully offline.
- `globe.css` — all styles scoped under `.p02`.

## Interactions
- Type a question, Enter → `search(q, {limit: 12})`; sheet opens, globe flies to result 1 (1.5s), results get pulsing rings, non-results dim.
- Card click / `←` `→` / prev-next buttons cycle results and fly the globe; counter shows `n / N`.
- Click a marker (no search) → sheet with that entity + its linked members/projects.
- `×`, `Esc`, or dragging the sheet down > 80px closes it; auto-rotate resumes.
- Bottom-left hint line is dismissable (sessionStorage). "offline" status shows in the search bar when the local fallback ran.

## Implementation notes
- Marker DOM nodes are created once (`htmlElementsData` / `htmlElement` have stable identity); dim/hit/selected states are class toggles on cached nodes, so state changes never rebuild the CSS2D layer.
- `htmlElementVisibilityModifier` hides markers on the far side of the globe.
- Fly target is offset ~9° south so the marker sits above the 40vh sheet.
- `ringAltitude` is raised above the hex land layer or the rings are occluded.
- A `GlobeBoundary` error boundary keeps the search bar + sheet usable when WebGL is unavailable.
- `hexPolygonColor` is per-feature in three-globe, so continents are split into chunks to get a two-tone look.
