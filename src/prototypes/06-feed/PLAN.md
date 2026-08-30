# 06-feed — "Daily Feed" plan

## Files
- `index.tsx` — default export `Prototype`; composes `useFeed` + `FeedCard` + `ProjectItem` + `ComposeSheet` + rails.
- `feed.ts` — pure logic: day seed, ranking, selection, local template fallback, AI enrichment, localStorage memory.
- `feed.css` — all styles scoped under `.feed06`.

## Day / memory
- `dayKey = new Date().toDateString()`; `seed = hash(dayKey + ':' + dayOffset)`; day N = `dayOffset + 1` stored in `localStorage['feed06.day']`.
- "new day ☀" → `dayOffset++` (new seed, new set). Reload within a day → same set (deterministic mulberry32 PRNG from seed).
- `localStorage['feed06.seen'] = { [id]: 'skip' | 'hi' }`. Seen people/projects excluded from future feeds. Small "reset memory" in the hint line for demos.
- `localStorage['feed06.shown'] = { [id]: lastDayOffsetShown }`, written for every id of every built feed. Shown-but-not-acted-on ids take a fatigue penalty (not an exclusion), so "new day" always deals a fresh set. `resetMemory()` clears seen + shown + day.

## Ranking formula (people)
```
interest  = 1 - clamp(simDistance(p, mePos)/0.6)        // mePos: centroid of people in me.domain sharing me.tags, else domain centroid
tagOverlap= |p.tags ∩ me.tags| / |me.tags|
geo       = 1 - clamp(log10(1 + km)/4)                  // ~1 at 0km, ~0.5 at 100km, ~0 at 10k km
score     = 0.30*interest + 0.20*tagOverlap + 0.17*p.activeScore + 0.15*geo + 0.18*rand(seed)
            + fatigue                                   // -0.35 if shown on the previous day
                                                        // offset, -0.15 if shown within 3
```
Selection: sort by score, greedy pick with a diversity cap (max 3 per domain, relaxed to fill). Exclude seen. Up to 8 people + up to 2 projects (projects: same formula on tags/needs vs me.tags; "looking for someone like you" when `needs` overlaps me.tags/domain). Projects are inserted at positions ~4 and ~8.

## AI enrichment
`callAI(prompt, { schema, max_tokens: 1500 })` with schema:
```json
{ "type":"object","properties":{"items":{"type":"array","items":{"type":"object",
  "properties":{"id":{"type":"string"},"why":{"type":"string"},"opener":{"type":"string"}},
  "required":["id","why","opener"],"additionalProperties":false}}},
  "required":["items"],"additionalProperties":false }
```
Prompt: the chosen rows (id, name, city, tags, skills/needs, lookingFor, km) + instruction: one ≤14-word "why you two" line, one friendly 1–2 sentence opener in first person from "You" in Austin; for projects the opener is a note to the team. Uses shared `SYSTEM`.
Fallback (offline / error / missing ids): local template from shared tags, same domain, city/distance, lookingFor. Show "offline · templated" hint.

## UI
- Vertical `scroll-snap-type: y mandatory` column; mobile = full-screen cards, desktop = 520px centered column. Cards pop in with staggered framer-motion spring.
- Card: Tamagotchi shell frame around pixel avatar (blink/wave keyframes only on active card via IntersectionObserver), name, city · km, why line, tag chips, mini project squares, [👋 say hi] [skip].
- Say hi → compose sheet (textarea prefilled with opener, "send" marks 'hi' + confetti-ish wiggle). Skip marks 'skip', advances scroll.
- Right rail: "day N" + progress dots (active/seen states). Bottom-left dismissable hint. Empty state "you've met everyone — new day?".
