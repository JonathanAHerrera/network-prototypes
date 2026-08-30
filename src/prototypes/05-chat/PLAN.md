# 05-chat — plan

## Concept
A normal LLM chat, but the assistant is "Hopa", a Tamagotchi-style pixel mascot living in a device frame. Every assistant turn = short pixel-font reply + strip of EntityCards + follow-up chips.

## Files (all inside src/prototypes/05-chat/)
- `index.tsx` — default export `Prototype`: layout (centered 760px column), transcript state, composer, hint line.
- `chat.css` — everything scoped under `.p05`.
- `Mascot.tsx` — SVG/CSS pixel mascot in device frame; props `mood: 'idle'|'thinking'|'happy'|'error'`. Idle blink (every ~3–5s), "..." pixels while thinking, bounce on happy, sweat-drop on error. Pure CSS keyframes + framer-motion for bounce.
- `useChat.ts` — transcript state (sessionStorage key `p05-chat`), `send(text)`, `clear()`, `busy`, `error`, `offline`.
- `ask.ts` — `askHopa(turns, question)` → `{reply, ids, followUps, offline}`; Claude via `callAI` else `localSearch` fallback.
- `DetailPanel.tsx` — inline expanded entity detail (bio/description, tags, linked entities as compact cards; click → "tell me about X").

## Data model
```ts
type Turn =
  | { role: 'user'; id: string; text: string }
  | { role: 'assistant'; id: string; text: string; ids: string[]; followUps: string[]; offline?: boolean; error?: boolean };
```

## Prompt (callAI, system = shared SYSTEM + persona addendum)
system: `${SYSTEM}\n\nYou are Hopa, a friendly pixel mascot. Reply in 1–2 short sentences (max ~160 chars), playful but useful. Always return 1–8 ids that your reply refers to, ordered best first. Give 3 short follow-up questions the user might ask next (max 5 words each, e.g. "show me their projects", "who's nearby?", "narrow to Africa"). Use only catalogue ids.`

prompt:
```
Conversation so far (oldest first):
USER: ...
HOPA: ... [ids: p3,j7]
...
USER: <new question>
Answer the last USER message. Resolve references like "their", "them", "that project" against the ids in the previous HOPA turns.
```
Only the last 8 turns are included, each truncated to ~300 chars.

schema:
```json
{ "type":"object",
  "properties":{
    "reply":{"type":"string"},
    "ids":{"type":"array","items":{"type":"string"}},
    "followUps":{"type":"array","items":{"type":"string"}} },
  "required":["reply","ids","followUps"], "additionalProperties":false }
```
max_tokens 600. Filter ids by `dataset.byId`; cap 8.

## Offline fallback
`localSearch(question, 8)`; if question is a follow-up pattern ("their projects", "who's nearby", "tell me about X") resolve against last assistant ids locally (members/projectIds/geo). Templated reply: `Found N … — top: X.` Follow-ups from a small template list based on the kinds returned. Show `offline` hint.

## UX details
- Enter sends, Shift+Enter newline; textarea auto-grows.
- Empty state: mascot big + 3 starter prompt buttons.
- Card click → toggles inline DetailPanel under the strip (one open at a time per turn).
- Follow-up chip click → sends as user message. Mini-card click → sends "tell me about X".
- Clear chat pixel button in header; confirm not needed (prototype).
- Auto-scroll to bottom on new turn; keep scroll if user scrolled up? Keep simple: always scroll on new turn.
- Hint bottom-left, dismissable (localStorage? no — state only). "Enter to send · Shift+Enter newline · click a card for details" + " · offline mode" when relevant.
