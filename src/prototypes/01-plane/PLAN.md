# 01-plane — build plan

Full-screen infinitely pannable/zoomable 2D similarity plane. People = circle cards, projects = square cards.

## Files (all inside `src/prototypes/01-plane/`)
- `index.tsx` — default export `Prototype`; composes everything, owns camera + UI state (zustand store in `store.ts`).
- `store.ts` — zustand store: `camera {x,y,k}`, `selectedId`, `results {ids, summary, offline, cursor}`, `busy`, `hintDismissed`, actions (`flyTo`, `select`, `setResults`, `nextResult`, `clear`).
- `layout.ts` — pure: scale `entity.pos` → WORLD (4000×4000, padding), then `d3-force` collide pass (forceX/forceY to anchor near pos, strong collide radius by card kind) run synchronously at module load (`sim.tick(N)`), returns `Map<id,{x,y}>` + domain centroids for territories.
- `Plane.tsx` — the stage: `@use-gesture/react` `useGesture` (drag→pan w/ inertia via velocity + rAF decay, wheel→zoom to cursor, pinch→zoom), arrow-key nudge; renders a single transformed `<div>` world layer; culls cards outside viewport (+margin) using camera state; low zoom (< ~0.45) renders `MiniCard` (colored dot + label), higher zoom renders `EntityCard compact/full`.
- `Territories.tsx` — soft radial-gradient blobs per domain centroid (DOMAIN_COLORS, low alpha) + pixel-font domain labels, rendered once in world layer (cheap, absolutely positioned divs).
- `Card.tsx` — wraps `EntityCard` with hover wobble, `selected` ring + blinking pixel cursor, dimmed state when results active and not in results.
- `DetailPanel.tsx` — right side-panel for selected entity: bio/description, tags (Chip), linked members/projects as compact `EntityCard`s that `flyTo` + select.
- `MiniMap.tsx` — 160×160 corner canvas/SVG: dots per entity colored by domain, viewport rect, click→jump.
- `Hud.tsx` — floating `SearchBar` (top-center), result toast (cream, summary + "→ next", offline hint, clear ✕), bottom-left dismissable hint, zoom +/- buttons.
- `plane.css` — everything scoped under `.p01`.

## Camera / animation
- Camera = `{x, y, k}` world-origin translation + scale; world div `transform: translate(x,y) scale(k)`. Pan/zoom write directly to a ref + `requestAnimationFrame` transform update for 60fps; React state only synced (throttled) for culling + minimap.
- `flyTo(ids)` — compute bounding box of targets, pick k to fit (clamped), spring-animate camera with framer-motion `animate()` on a MotionValue or a small custom spring loop.

## Search flow
`SearchBar.onSearch` → `busy` → `search(q, {limit: 8})` → set results, `flyTo(results[0])`, select it; toast shows summary, `n/N`, next ▶ hops cursor and flies; ✕ clears. Non-result cards get `opacity .35`.

## Delight
Hover wobble keyframes, `.scanlines` overlay on stage, blinking pixel cursor `▮` on selected card, bouncing marker above selected card, grid background in world.
