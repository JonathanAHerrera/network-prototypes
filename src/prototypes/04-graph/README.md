# 04-graph — "Reorganizing Graph"

The whole network (~120 nodes: 80 people + ~40 projects) as one force-directed
graph that visibly re-arranges itself in answer to a typed question, instead
of filtering it down to a result list — clusters, splits along a spectrum, or
pulls into a bullseye around the best matches, using the same nodes.

## How to use it

Route: `#graph` (or `[` / `]` to cycle prototypes).

- Drag empty space to pan, wheel to zoom-to-cursor.
- Drag a node to reposition (pins it while dragging, releases on pointer-up).
- Hover a node to highlight its neighbours and dim everything else.
- Click a node for a popover (name/bio/tags/link count) with a "focus" button
  that centers and zooms to it.
- Type a question, or click an example chip:
  - "who could help with solar in Africa" → **radial** (best matches at
    centre, connections ringed outward).
  - "compare hardware vs software people" → **axis** (spectrum from a left
    label to a right label).
  - "group projects by what they need" → **cluster** (labelled groups on a
    ring).
- "↺ reset" (top-left, once a plan is active) returns to the default
  domain-cluster view.

## Architecture

Three layers share one pan/zoom transform: a DPR-aware `<canvas>` (z1) draws
edges, domain/group hulls, and result glow rings; an HTML `<div>` layer (z2)
holds absolutely-positioned `EntityCard compact` nodes; a second top
`<canvas>` (z5, `pointer-events: none`) draws layout labels in screen space so
pixel text never blurs under zoom or hides behind cards.

Simulation: `d3-force` (`forceManyBody`, `forceLink` — strong for project
membership, weak k=2 nearest-neighbour similarity edges — `forceCollide`,
plus per-mode `forceX`/`forceY`/`forceRadial`). Node positions are written
straight to DOM refs (`translate3d`) from a `requestAnimationFrame` loop on
every tick — no React re-render per tick — gated by a `dirtyRef` flag.
Re-planning (`applyPlan` in `index.tsx`, `applyLayout` in `layout.ts`) never
recreates the simulation — it swaps the `mx`/`my`/`mr` forces on the existing
instance and reheats it (`alpha(0.6).restart()`), so layouts animate smoothly
instead of resetting.

## AI flow

1. `search(query, {limit: 14})` (shared `src/shared/ai`) → `ids`, `summary`,
   `offline`.
2. If not offline: `callAI(buildPrompt(query, ids), {schema: PLAN_SCHEMA,
   max_tokens: 1500})` asks Claude for a `LayoutPlan` — `mode`
   (cluster/axis/radial), a `summary`, and mode payload (`groups`;
   `axisLabel`+`scores`; or `centerIds`). `scores` is `{id, score}[]`, not a
   map (strict JSON schema can't express dynamic keys), converted to a
   `Record` after validation.
3. `parsePlan` (zod) validates the response, drops unknown ids, caps sizes
   (max 6 groups, 12 centerIds), and rejects a mode with no usable payload
   (e.g. cluster with no groups).
4. Offline, a validation failure, or a thrown error fall back to
   `localPlan(query, ids)`, mode chosen by keyword (`pickMode`):
   `compare`/`vs`/`versus`/`spectrum`/`between` → **axis** (split the query on
   the comparator, score entities by keyword hits per side, normalize to
   `[-1, 1]`); `group`/`by`/`categor*`/`kind(s)`/`type(s)`/`sort`/`bucket` →
   **cluster** (pool result ids plus keyword/activity-scored extras, grouped
   by `domain`); anything else → **radial** (`centerIds` = top 8 results).
5. The result id set (search ids ∪ everything the plan references) drives
   glow rings; non-matches shrink to scale 0.55 / opacity 0.35.

## File map

- `index.tsx` — component, simulation setup, rAF draw loop, pan/zoom/drag,
  popover, search orchestration.
- `layout.ts` — `buildGraph()`, `LayoutPlan` type + `PLAN_SCHEMA`,
  `buildPrompt()`, `parsePlan()` (zod), `localPlan()`, `applyLayout()`
  (per-mode forces + `Geometry` for drawing).
- `graph.css` — all styles, scoped under `.p04`.

## Force-tuning notes

Base: `forceManyBody(-95, distanceMax 300)`, `forceCollide(r+4)`, membership
links distance 78/strength 0.45, similarity links distance 130/strength 0.05,
`velocityDecay 0.35`, `alphaDecay 0.02`. Default mode centres domains on a
0.52·R ring (strength 0.3). Cluster tightens to a 0.33·R ring (strength 0.3
for members, weak 0.05 outward pull for the rest). Axis pulls scored ids
toward `cx + score·0.4w` (strength 0.5); unscored ids drift to a weak band
below centre. Radial uses `forceRadial` r=0 (0.6) for centers, r=0.2·R (0.35)
for 1-hop neighbours, r=0.44·R (0.25) for everyone else.

## Known limitations

- No `ANTHROPIC_API_KEY` is configured on this machine, so the Claude
  `callAI` layout-plan path is untested end-to-end — only the offline
  `localPlan` path has actually run. The proxy/schema plumbing looks correct
  by inspection but needs verification once a key is available.
- Label placement is a heuristic, not collision-aware: labels are pushed
  outward from the group centroid by `max(farthest point, 90) + pad`, then
  clamped inside the viewport — dense/overlapping clusters can still crowd.
- The local planner is coarse: axis scoring depends on a fixed set of
  comparator words, and cluster grouping is always by `domain`, so nuanced or
  domain-crossing groupings Claude could produce aren't available offline.
