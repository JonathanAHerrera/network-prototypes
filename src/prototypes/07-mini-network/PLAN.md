# 07 Mini-network — plan

**Idea:** every query yields a small self-contained network. Answer at the centre, rings outward = progressively looser but still-related entities. Click any node → "re-centre" builds a new mini-network around it (no AI call). Breadcrumbs track the exploration trail.

## Files
- `index.tsx` — component: search bar + summary, breadcrumbs, canvas network, detail panel, hint.
- `buildNetwork.ts` — pure ring-assignment + edge builder (`buildFromSearch(ids)`, `buildFromCentre(id)`), unit-testable.
- `useForceLayout.ts` — d3-force sim (forceRadial per ring, collide, weak link), rAF canvas draw.
- `mini.css` — all styles scoped under `.p07`.

## Ring assignment (cap ~30 nodes)
Input: ordered `ids` from `search()` (or a single centre id when re-centring).
1. **Ring 0 "your answer"** — top 1–3 ids (3 if search; 1 if re-centre).
2. **Ring 1 "close"** — remaining search ids (up to ~8) + direct membership neighbours of ring 0 (person.projectIds / project.memberIds). Cap 10, prefer search results, then neighbours ordered by activeScore.
3. **Ring 2 "adjacent"** — for each unplaced entity compute min `simDistance` to any ring-1 node (fallback ring 0); take nearest ~10, excluding entities from ring 0/1.
4. **Ring 3 "wildcard"** — entities whose `domain` differs from every ring-0 domain but share ≥1 tag with any ring-0/1 node; pick up to 5, sorted by tag-overlap count then activeScore, plus a seeded shuffle so the set feels serendipitous.
Every node stores `why`: `{ ring, sharedTags, viaMember?: id, simTo?: id }` for the tooltip ("shares 'solar', 'microgrids'" / "member of X" / "top result").

## Edges
- **membership** (solid, ink-on-dark) between any two placed nodes linked by projectIds/memberIds.
- **similarity** (dashed, faint) — for ring-2 nodes to their nearest ring-1 anchor; for ring-1 nodes to nearest ring-0.
- **ring** (very faint) — ring-3 node to the node it shares most tags with.

## Layout / render
- d3-force: `forceRadial(ringRadius[ring], cx, cy).strength(0.9)`, `forceCollide(r+4)`, `forceManyBody(-30)`, `forceLink` distance by ring. Nodes spawn at centre with velocity 0 and a per-ring `spawnDelay` (stagger ~120ms/ring) — they are held at the centre (fx/fy) until their delay passes, then released → spring outward.
- Canvas 2D, devicePixelRatio aware. Node radius by ring: 34/24/17/13. Circle (person) / rounded square (project), avatar drawn via preloaded `Image` clipped inside, thick ink border, glow of `entity.color` (stronger for ring 0, pulsing for hovered/selected). Dotted ring guides + tiny Silkscreen labels at 45°.
- Fit to viewport: ring radii derived from `min(w,h)`. Pan/zoom via wheel + drag (transform matrix), double-click to reset.
- Hit test on pointer move (nearest node within radius) → hover state; click → select.

## UI states
- Idle empty stage with prompt text; loading (busy search bar + "thinking…"); empty (no ids) message; offline hint chip when `result.offline`.
- Summary line under search bar (mono font).
- Breadcrumb chips top: `query` → centre names; clicking re-runs that snapshot (stored in an array of networks).
- Detail panel (right, framer-motion slide) with EntityCard + bio/description, tags, membership links (clickable → select), "re-centre on this" primary button, close (Esc).
- Hint bottom-left, dismissable (×), stored in state only.
