# 04-graph — "Reorganizing Graph" plan

## Architecture
- `index.tsx` — full-screen component, root class `.p04`. Files: `index.tsx` (state + UI), `layout.ts` (plan types, local fallback, force configs), `graph.css`.
- Rendering: **canvas** (device-pixel-ratio aware) for edges, domain hulls, group/axis labels (pixel font), result glow rings. **HTML overlay** of absolutely positioned `EntityCard compact` nodes inside a transformed `<div>` (same pan/zoom transform as the canvas). 120 nodes → positions written to DOM via refs on every simulation tick (no React re-render per tick; `transform: translate3d`).
- Simulation: `d3-force` — `forceManyBody`, `forceLink` (membership strong, similarity k=2 weak), `forceCollide`, plus mode forces. Default mode = domain clusters (forceX/forceY to per-domain centres arranged on a ring; soft convex hull per domain drawn on canvas + label).
- Pan/zoom: wheel zoom-to-cursor + drag on empty stage; node drag via pointer events (fix node while dragging, `alphaTarget(0.3)`).
- Hover: highlight neighbours, dim others. Click: popover with name/bio/tags/link count + "focus" button.

## Layout-plan schema (JSON, given to callAI)
```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["cluster", "axis", "radial"] },
    "summary": { "type": "string" },
    "groups": { "type": "array", "items": { "type": "object",
      "properties": { "label": {"type":"string"}, "ids": {"type":"array","items":{"type":"string"}} },
      "required": ["label","ids"], "additionalProperties": false } },
    "axisLabel": { "type": "object", "properties": { "left": {"type":"string"}, "right": {"type":"string"} },
      "required": ["left","right"], "additionalProperties": false },
    "scores": { "type": "array", "items": { "type":"object",
      "properties": { "id": {"type":"string"}, "score": {"type":"number"} },
      "required": ["id","score"], "additionalProperties": false } },
    "centerIds": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["mode", "summary"],
  "additionalProperties": false
}
```
(`scores` is an array of `{id, score}` because strict JSON schemas cannot express dynamic keys; converted to `Record<string, number>` client side. Scores in [-1, 1]: -1 = fully left, +1 = fully right.)

## Flow on search
1. `setBusy`, call `search(query, {limit: 14})` → `ids`, `summary`, `offline`.
2. If not offline: `callAI(prompt, {schema, max_tokens: 1500})` where prompt =
   ```
   Query: "<query>"
   Search results (best first): <ids>
   Design a graph layout that best answers this query.
   - "radial": use when the question asks who/what could help / is relevant. centerIds = the best results (ring 0); everything else arranged outward.
   - "axis": use when the query compares two things (compare / vs / versus / spectrum). Give axisLabel {left,right} and a score in [-1,1] for every relevant id (-1 = fully left, 1 = fully right). Include ~20-40 ids.
   - "cluster": use when the query asks to group / categorise / "by". Give 3-6 labelled groups with ids (each id in one group only).
   summary: one playful sentence (<= 120 chars) explaining the layout.
   Only use ids from the catalogue.
   ```
   System = shared `SYSTEM`.
3. Validate plan (`zod`), drop unknown ids. On error or offline → `localPlan(query, ids)`: keyword mode pick ("compare|vs|versus" → axis, "group|by |categor|kind" → cluster, else radial). Local axis scores: split query on the comparator, score each result by keyword match count on each side (normalise to [-1,1]); local clusters: group result ids by domain (label = domain); local radial: centerIds = top 8 results.
4. Apply plan: compute per-node target positions & forces, reheat `alpha(0.6)`; do **not** re-create the simulation. Result set = plan ids ∪ search ids → `isResult` glow ring; others scale 0.55 + opacity 0.35.
5. Reset button → default mode, clears results, `alpha(0.6)`.

## Mode force configs
- **cluster**: groups placed on a ring around centre (radius ~ 0.3 min(w,h)); `forceX/forceY` strength 0.25 towards group centre for members; non-members drift to outer ring (weak, 0.05). Group labels + hull drawn on canvas.
- **axis**: `forceX` to `cx + score * 0.4w` strength 0.5 for scored ids; `forceY` to centre 0.08; unscored → `forceY` to bottom band (weak). Axis line + left/right labels on canvas.
- **radial**: `forceRadial` r=0 for centerIds (strength 0.6), r=R1 for 1-hop neighbours of centre, r=R2 for the rest; concentric pixel rings on canvas.
- **default**: domain cluster centres on ring; strength 0.12; domain hulls (d3 `polygonHull` with padding) + labels.

## Chips
"who could help with solar in Africa" (radial) · "compare hardware vs software people" (axis) · "group projects by what they need" (cluster)

## Hint
bottom-left: "drag to pan · wheel to zoom · drag nodes · hover to see links · ask a question to reorganize" — dismissable (×). Offline hint appended when `offline`.
