# 07 Mini-network

Every query grows a small self-contained network: the best answer(s) sit at the centre, three concentric rings hold progressively looser-but-related entities. Click a node → detail panel → **re-centre on this** rebuilds the network around it (pure membership + similarity, no AI call). Breadcrumbs track the trail.

## Files
- `buildNetwork.ts` — pure ring assignment + edges (`buildFromSearch`, `buildFromCentre`). Ring 0 = top 1–3 hits; ring 1 = remaining hits + membership neighbours; ring 2 = nearest by `simDistance`; ring 3 = wildcards from other domains sharing ≥1 tag. Cap 30 nodes; each node carries a `why` string for tooltips.
- `useForceLayout.ts` — d3-force (`forceRadial` per ring, collide, weak links) + DPR-aware canvas renderer in a ref-driven rAF loop; staggered spring intro; pan/zoom/hit-test.
- `index.tsx` — search bar + AI summary + offline chip, breadcrumbs, tooltip, framer-motion detail panel, empty/error/loading states, dismissable hint.
- `mini.css` — all styles under `.p07`.

## Interactions
Hover = tooltip + edge highlight · click = panel · re-centre = exploration loop · scroll = zoom · drag empty space = pan · double-click = reset · Esc = close.
