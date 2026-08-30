# 01 — Plane

An infinitely pannable / zoomable 2D "similarity plane". Every **person is a circle card**, every **project a square card**, placed by `entity.pos` (semantic-space coordinate) so neighbours share interests. Ten soft domain territories (DOMAIN_COLORS) give the map its geography.

## How it works

| File | Role |
|---|---|
| `layout.ts` | Scales `pos` into a 4000×4000 world, then a one-off synchronous `d3-force` pass (forceX/Y anchors + forceCollide) removes overlaps while keeping cards near their semantic spot. Exports `POSITIONS`, `DOMAIN_CENTROIDS`, `bboxOf`. |
| `store.ts` | zustand UI state (selection, results, busy, hint) **plus** the camera. The live camera `{x,y,k}` is a module singleton written straight to the world div's `transform` inside rAF; a throttled copy is published to zustand once per frame for culling and the minimap. Also `flyTo` (framer-motion spring), inertia, `zoomAbout`, `fitWorld`. |
| `Plane.tsx` | The stage. `@use-gesture/react` drag (pointer + touch, inertia on release), wheel zoom about the cursor, pinch zoom; arrow keys nudge, `+`/`-` zoom, `Esc` clears. `<WorldCards/>` culls to the viewport (+200px) and picks a card representation by zoom: `k<0.45` mini dot, `<0.9` compact `EntityCard`, otherwise full. |
| `Card.tsx` | Memoised, centre-positioned card wrapper: hover wobble, result glow ring, selected pulse ring + bouncing `▼` marker + blinking `▮` cursor, dimmed state. |
| `Territories.tsx` | Static radial-gradient blobs + pixel labels per domain centroid. |
| `Hud.tsx` | Shared `SearchBar` → `search(q,{limit:8})`; result toast (summary, `n/N`, prev/next, offline badge, ✕), zoom buttons, dismissable hint. |
| `DetailPanel.tsx` | Sliding side panel: bio/description, domain chip, tags, skills/needs, linked members/projects as compact cards that select + fly. |
| `MiniMap.tsx` | 170px SVG overview with viewport rectangle; click/drag to jump. Shifts left while the panel is open. |
| `plane.css` | All styles, scoped under `.p01`. |

## How to use

- **Drag / swipe** to pan, **wheel or pinch** to zoom, **arrow keys** to nudge, `+` / `-` to zoom, `⌂ fit` to see everything.
- **Click a card** to open its detail panel; click linked cards to hop around.
- **Ask the search bar** ("people into robots", "food projects near me"). The camera flies to the top hit, results glow, everything else dims; use **prev / next** to step through hits, **✕** or `Esc` to clear.
- The **minimap** (bottom-right) shows where you are; click it to jump.
- Works offline: without `ANTHROPIC_API_KEY` the local scorer answers and the toast shows an "offline" badge.

## Known gaps

- Plain (non-ctrl) wheel zooms rather than pans; trackpad users may expect two-finger pan.
- Cards are not keyboard-focusable (no tab navigation between cards).
- Card positions are resolved once at module load; no live re-layout.
- `oxlint` could not run in this environment (missing native binding) — verified with `tsc` + `vite build` instead.
