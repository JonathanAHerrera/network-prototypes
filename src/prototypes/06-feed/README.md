# 06 · Daily Feed

Every "day" the network deals you up to **10 cards** — 8 people you might want to chat with plus 2 projects that are
"looking for someone like you" — in a vertical, snap-scrolling column (full-screen cards on phones, a 520px column on
desktop). Each card is a Tamagotchi-shell avatar, name, city + km from Austin, a one-line **why you two**, tags, mini
squares for the projects they're on, and two chunky actions: **👋 say hi** (opens a compose sheet with an AI-drafted,
editable opener) and **skip**.

## Files
- `index.tsx` — `Prototype` (feed, rail, hint, empty/loading/end states), `FeedCard`, `ComposeSheet`.
- `feed.ts` — pure logic: day seed + PRNG, ranking, diverse selection, memory, local template copy, Claude enrichment.
- `feed.css` — all styles scoped under `.feed06`.
- `PLAN.md` — ranking formula, prompt + JSON schema.

## How it works
- **Day**: `seed = hash(new Date().toDateString() + ':' + dayOffset)`; `dayOffset` lives in `localStorage['feed06.day']`.
  Same day + same memory ⇒ identical feed on reload. **new day ☀** bumps the offset for a fresh set.
- **Ranking** (people and projects alike): `0.30·interest + 0.20·tagOverlap + 0.17·activeScore + 0.15·geo + 0.18·seededJitter`,
  minus a fatigue penalty for ids shown on recent days (`feed06.shown`). `interest` is similarity-space distance
  (`simDistance`) to a derived "me" position (centroid of software people sharing my tags); `geo` is a log-scaled
  `geoDistanceKm`. Greedy pick with a max-3-per-domain cap (1 for projects) so a day never turns into ten robotics people.
- **Memory**: `feed06.seen = { id: 'hi' | 'skip' }` — greeted/skipped entities never come back; **reset memory** wipes everything.
- **Copy**: `callAI` with a `{ items: [{ id, why, opener }] }` schema writes the why-line and opener per card; cards render
  immediately with a shimmer and fill in when Claude answers. With no `ANTHROPIC_API_KEY` (or on error) the local template
  engine takes over, using shared tags/skills/needs, domain, distance bucket and `lookingFor`, and the hint shows
  **offline · templated**.

## Controls
`j`/`k` or arrows move · `h` say hi · `s` skip · `esc` close the sheet · `⌘/Ctrl+Enter` sends · click a rail dot to jump.
Rail dots: yellow = active, green = greeted, dim = skipped, square = project.

## Notes
- Hard offline path is the one exercised in this repo (no key), so the templates are written to read well, not as a stub.
- Shared-shell observations (not fixed here): `App.tsx` only ignores `[`/`]` for `INPUT`, not `TEXTAREA` — the sheet stops
  propagation locally; `me` has no `pos` and `me.tags` don't all exist as entity tags (`community organizing` is a skill).
