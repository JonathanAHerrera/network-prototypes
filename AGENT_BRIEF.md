# Hopamine search-prototype brief (read fully before writing code)

Seven interaction models for searching a network of **people** (circle cards) and **impact projects** (square cards) live side-by-side in one Vite + React + TypeScript app. A switcher button (top-right) and `[` / `]` keys flip between them. Each prototype owns one folder under `src/prototypes/NN-name/` and default-exports a full-screen React component from `index.tsx`. **Only edit inside your own folder** unless a shared bug blocks you (then fix it minimally and say so in your report).

## Run / verify
- `npm run dev` (port 5173, may already be running — reuse it; do NOT start a second server if 5173 responds). `npm run build` and `npx tsc -p tsconfig.app.json --noEmit` must pass before you report done.
- **Do NOT run `npm install`.** Everything below is already installed. If you truly need another package, say so in your final report instead.

## Installed & available
react 19, framer-motion, @use-gesture/react, zustand, d3 + d3-force, three + @react-three/fiber + @react-three/drei, react-globe.gl, zod, @anthropic-ai/sdk (server side only).

## Shared layer — USE IT, don't reinvent
- `src/shared/data` — `dataset` ({people, projects, byId}), `allEntities`, `me` (demo user in Austin), `entityLabel()`, `entityImage()`, `simDistance()` (similarity-space distance from `entity.pos` in [0,1]²; nearby = similar interests, domains are arranged in a semantic ring), `geoDistanceKm()`, `DOMAINS`, `DOMAIN_COLORS`. Entities have `lat/lng`, `tags`, `domain`, `color`, `activeScore`, membership links (`person.projectIds`, `project.memberIds`).
- `src/shared/ai` — `search(query, {limit})` → `{ids, summary, intent: people|projects|mixed|nearby|chat, offline}`. Calls Claude through the dev-server proxy when `ANTHROPIC_API_KEY` is in `.env`, otherwise falls back to `localSearch()` transparently. Also `callAI(prompt, {system, schema, max_tokens})` for custom prompts (pass a JSON schema for structured output) and `SYSTEM` (the catalogue system prompt you can extend). Always design for both modes; show a tiny "offline" hint when `result.offline` is true.
- `src/shared/ui` — `EntityCard` (circle/square, `compact`, `selected`, `onClick`), `SearchBar` (`onSearch`, `busy`, `status`), `Button`, `Chip`. CSS tokens in `src/index.css` (`--bg`, `--panel`, `--ink`, `--blue`, `--yellow`, `--pink`, `--green`, fonts `--font-pixel` (Silkscreen), `--font-mono` (VT323), `--font-body` (Nunito)); utility classes `.pixel`, `.mono`, `.glow`, `.scanlines`.

## Aesthetic (non-negotiable)
Tamagotchi × pixel-cyber: deep navy background, cream cards with thick ink borders and hard offset shadows, electric-blue glows, pixel-art critter avatars (already generated), chunky rounded buttons, VT323/Silkscreen type, playful micro-animations (bounce, blink, wiggle). Think Ed's hacking screensaver + Tamagotchi shell + kawaii sprout mascots. Delightful, not corporate. Dark stage, light cards. Keep it crisp (`image-rendering: pixelated` for sprites).

## Quality bar
Smooth 60fps interactions, keyboard + trackpad friendly, no console errors, loading/empty/error states, and an obvious on-screen hint of how to use the prototype (one line, bottom-left, dismissable). Scope your CSS under a class prefixed with your prototype id so styles never leak.
