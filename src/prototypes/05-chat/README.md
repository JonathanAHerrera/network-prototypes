# 05 · Chat — "Hopa"

A plain LLM chat whose assistant is a Tamagotchi-style pixel critter living in a device shell, and whose answers arrive as **cards**.

Open `http://localhost:5173/#chat`.

## How to use
- Type in the composer. **Enter** sends, **Shift+Enter** inserts a newline. Three starter prompts sit on the empty state.
- Each assistant turn = short reply + horizontally scrollable strip of `EntityCard`s (people = circles, projects = squares) + 3 follow-up chips.
- Click a card to expand an inline detail panel (bio/description, tags, skills/needs, distance from Austin, linked entities). Click a linked mini card to auto-ask "tell me about X". **Esc** closes the panel.
- `⟲ CLEAR` wipes the transcript. Transcript persists in `sessionStorage` (`p05-chat`).
- Hint line bottom-left (dismissable); it appends "offline mode" when the local fallback answered.

## Files
| file | role |
|---|---|
| `index.tsx` | layout, transcript rendering, composer, hint |
| `useChat.ts` | transcript state, sessionStorage, in-flight cancellation on clear, error turns |
| `ask.ts` | `askHopa()` — Claude via `callAI` with transcript + JSON schema; `resolveOffline()` fallback; follow-up chip generation |
| `Mascot.tsx` | 16×16 pixel-map sprite in an egg shell; moods `idle` / `thinking` / `happy` / `error` |
| `DetailPanel.tsx` | inline expanded entity |
| `chat.css` | all styles, scoped under `.p05` |
| `PLAN.md` | the plan, exact prompt and schema |

## Online vs offline
- **Online** (`ANTHROPIC_API_KEY` in `.env`): system = shared `SYSTEM` + Hopa persona; prompt = last 8 turns (each ≤300 chars, assistant turns annotated with `[ids: …]`) + the new question; schema `{ reply, ids, followUps }`; ids validated against `dataset.byId`, capped at 8.
- **Offline** (`no_api_key`): `resolveOffline()` resolves follow-ups against the previous assistant turn's ids — "tell me about X" (name match), "their projects" (`person.projectIds`), "who's on these" (`project.memberIds`), "who's nearby" (geo sort), "narrow to <city/country/region/domain/tag/kind>" (facet filter, widens to the whole dataset if empty), "more like these" (`simDistance`), else `localSearch`.
- Any other API error → error turn, mascot sweat-drop, `↻ retry` chip.

## Mascot moods
`idle` randomized blink 3–5s + slow float · `thinking` sway + yellow "..." pixels (typing indicator) · `happy` bounce when a reply lands · `error` shake + sweat drop.
