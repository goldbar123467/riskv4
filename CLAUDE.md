# CLAUDE.md

Handbook for Claude (and any other agent) working in this repository. Read this
in full before editing — the invariants here are what keep the engine honest
and the Vercel build green.

Companion docs: [`PERSONA.md`](./PERSONA.md) is the design voice.
[`SPEC.md`](./SPEC.md) is the rules + architecture contract. This file is the
engineering handbook: commands, layout, invariants, and pitfalls.

---

## What this project is

**Catan — The Cartographer's Edition.** A single-page Settlers of Catan game
you play against three AI opponents in the browser. No backend, no accounts,
no network. All state lives in React + `localStorage`.

- **Stack:** TypeScript 5, Next.js 14 App Router, React 18. No runtime deps
  beyond React/Next.
- **Deployment:** Vercel. `vercel.json` pins framework detection; no env vars.
- **Entry point:** `app/page.tsx` (client component) mounts `<Board/>` +
  `<Sidebar/>` + modals/toasts.

---

## Quickstart

```bash
npm install
npm run dev          # http://localhost:3000
npm run type-check   # tsc --noEmit
npm run lint         # eslint (next/core-web-vitals)
npm run smoke        # AI-only auto-play sanity (scripts/smoke.ts)
npm run build        # next build (Vercel parity)
npm run gate         # all four, sequential, short-circuits on failure
```

Every change must pass `npm run gate` before it ships. CI runs the same
sequence via `.github/workflows/ci.yml`.

---

## Repo layout (and why each piece exists)

```
app/                  Next.js App Router shell
  layout.tsx          Root HTML; preloads Cormorant / Inter / JetBrains Mono
  page.tsx            'use client' — wires useGame() to Board/Sidebar/modals
  globals.css         Design tokens + resets (see PERSONA.md §Design principles)

src/game/             Pure engine. No React. No DOM. No window access.
  types.ts            Shared contract (Resource, Action, GameState, …)
  board.ts            Hex geometry, canonical Tile/Vertex/Edge IDs, ports
  setup.ts            initialState(seed, personalities) + snake-order helpers
  rules.ts            canDo(state, action, actorId) → Legality   ← SINGLE TRUTH
  actions.ts          reduce(state, action) → state              ← SINGLE TRUTH
  dev-cards.ts        25-card deck + draw
src/ai/               Pure AI. Consumes engine; never mutates.
  agent.ts            decide(state, actorId) → Action (always legal)
  heuristics.ts       Scoring (vertex value, robber target, bank trade, …)
  personalities.ts    Four archetype weight bundles + color mapping
src/components/       Thin React renders; dispatch actions, no game logic
  Board.tsx           SVG hex board
  Sidebar.tsx         Phase header, roster, resources, controls
  Modals.tsx          Discard / robber-steal / bank / dev / monopoly / YoP / victory
  Toasts.tsx          Transient event notifications
  Log.tsx             Scrolling action log (engine is authoritative)
src/hooks/
  useGame.ts          useReducer + localStorage + AI setTimeout loop
src/lib/
  random.ts           Mulberry32 PRNG (rngStep + makeRng + shuffle)
scripts/
  gate.mjs            Runs type-check → lint → smoke → build
  smoke.ts            All-AI auto-play up to 4000 actions; asserts legality
.github/workflows/ci.yml  Runs scripts/gate.mjs on PR + push
```

Path alias: `@/*` → `./src/*` (see `tsconfig.json`).

---

## Core invariants — do not break these

These are the rules that keep the codebase predictable. If you need to change
one, treat it as an architectural decision and propose it explicitly.

1. **`src/game/` is pure.** No React imports. No DOM access. No `window` or
   `localStorage`. No `Date.now()` or `Math.random()` — all randomness flows
   through `src/lib/random.ts` (seeded mulberry32). A new seed makes a new
   game; the same seed + same action sequence replays exactly.

2. **Double-gate every transition.** `rules.ts::canDo(state, action, actor)`
   is called twice for every action: once by the UI (to enable/disable
   buttons) and once by `actions.ts::reduce` (which throws on illegal input).
   When you add a new action kind, add a case to both — not one.

3. **Action is a discriminated union on `kind`.** See `types.ts`. Add new
   actions by extending the union; both `canDo` and `reduce` must exhaustively
   switch. The `default: const _never: never = action` pattern in `reduce`
   catches missing cases at compile time — keep it.

4. **IDs are strings, not objects.** `TileId`, `VertexId`, `EdgeId` are
   canonicalized string keys ("T:x,z" / "V:x,z,N" / "E:x,z,N"). Three tiles
   share a corner, two tiles share an edge; the canonicalizer in `board.ts`
   picks a single tile as the owner of each so lookups are stable. Never
   invent a new ID format.

5. **The log is authoritative.** Every state-changing `reduce` path appends
   one `LogEntry`. If the UI ever disagrees with the log, the UI is wrong.
   Write log entries in past tense, ≤ 1 sentence, with the actor name.

6. **Components render, they do not decide.** No `if (state.phase === …)
   then trigger an action` logic inside a component lifecycle — that belongs
   in `useGame.ts` (AI loop) or in the user-driven `dispatch` path in
   `app/page.tsx`. Components may inspect state; they must not mutate it.

7. **The AI never returns an illegal action.** `agent.ts::gate()` runs
   `canDo` on every candidate before returning; fall-through is `END_TURN`.
   If you see a smoke-test "illegal action from AI" error, fix the AI
   (usually by extending a validator), not the engine.

8. **`useGame`'s AI loop is a single `setTimeout`.** One pending timer at a
   time, cleared on every state change. Do not add parallel timers or
   `setInterval`s. The 700 ms cadence is tuned for reading the log; keep it.

9. **Save on every transition.** `useGame` serializes `state` to
   `localStorage['catan:save']` in an effect keyed on `state`. `New Game`
   clears the key and reseeds. Do not move persistence elsewhere.

10. **No SSR for the game shell.** `app/page.tsx` is `'use client'`.
    Anything touching the game state must stay client-side. Server Components
    are fine for static wrappers but cannot import `useGame`.

---

## Mental model for common changes

### Adding a new action (example: a trade-with-player)

1. Extend the `Action` union in `src/game/types.ts`.
2. Add a case to `canDo` in `src/game/rules.ts` (validate phase, turn,
   resources, target).
3. Add a case to `reduce` in `src/game/actions.ts` (spend/grant, write log,
   `applyRecomputes`, `checkVictory`).
4. Extend `agent.ts` if AIs should use it; add heuristics to `heuristics.ts`.
5. Add a dispatcher path in `app/page.tsx` and/or a button in `Sidebar.tsx` /
   a modal in `Modals.tsx`.
6. Run `npm run smoke` several times — random AI play catches most
   regressions.

### Tuning an AI archetype

`src/ai/personalities.ts` exports four archetypes (`QUILL`, `GRIM`,
`BRACKEN`, `SAFFRON`). Each has a `weights` bundle in `[0..1]`:

- `wheat`, `ore`, `wood`, `brick`, `sheep` — production desire
- `cityBias`, `devBias`, `roadBias` — build-mix preference
- `aggression` — probability of targeting the VP leader with robber/knight

Tune these and re-run `npm run smoke` (ideally with several seeds via
`SMOKE_SEED=<n> npm run smoke`). Each change should keep the auto-play
legal and terminate; winners should vary across seeds.

### Editing the board or ports

Board construction lives in `src/game/board.ts::createStandardBoard`. The
terrain pool (19 tiles), number pool (18 tokens), and `PORT_TEMPLATE` (9 coastal
ports) are constants. The shuffle is seeded — the same seed gives the same
board. If you change pool sizes you must also update `SPEC.md`.

### Adding UI state vs. game state

If it survives a refresh, it's **game state** → goes in `GameState` and flows
through `reduce`. If it's transient (selected build mode, open modal, hover
target), it's **UI state** → `useState` in `app/page.tsx` or the component.
Never mirror game state into UI state.

---

## Styling & design tokens

Design tokens (colors, spacing, type scale) live in `app/globals.css`. The
voice is set by `PERSONA.md`:

- **Typography:** `Cormorant Garamond` for titles, `Inter` for body, `JetBrains
  Mono` for numerals. Don't mix roles.
- **Accent:** `#d97706` / `#f59e0b` amber. Marks current player, current phase,
  primary CTA. Resource palette is secondary.
- **Background:** radial `#142440 → #0a1628` with 40px grid lines at 2% white.
- **Mobile (< 900px):** column layout, board on top (58vh), sidebar tabbed,
  44px min tap target, no hover-dependent affordances.

When writing user-facing text: ≤ 7 words for buttons, ≤ 1 sentence for helper
text, ≤ 2 sentences for toasts. Victory screen is a single serif line.

---

## Testing — what we have and what we don't

**There is no unit test framework installed.** The sanity gate is the
`scripts/smoke.ts` AI-only auto-play: it constructs an initial state, forces
all four seats to AI, and plays up to 4000 actions through `decide → canDo →
reduce`. Any illegal-action emission crashes the script. Any wedge (no winner
+ no progress) is visible in the logs.

To reproduce a failure locally:

```bash
SMOKE_SEED=1234567 npm run smoke
```

For UI work: `npm run dev`, play a game end-to-end, watch the log. There is
no browser-automation harness — type-check + lint + smoke + build + manual
spot-check is the contract.

---

## Pipeline gate — what CI enforces

`scripts/gate.mjs` runs four stages, in order, failing fast:

| Stage      | Command                | Must pass with                     |
|------------|------------------------|------------------------------------|
| type-check | `tsc --noEmit`         | 0 errors                           |
| lint       | `next lint` / eslint   | 0 warnings                         |
| smoke      | `tsx scripts/smoke.ts` | no illegal-action exit; terminates |
| build      | `next build`           | 0 errors (Vercel parity)           |

CI (GitHub Actions) runs the same script on every PR and push to `main` or
`claude/**`. If `npm run gate` passes locally, CI should pass too.

---

## Pitfalls (learned the hard way)

- **Do not call `reduce` with an illegal action "just to see what happens."**
  It throws, and the UI has no recovery path. Always `canDo` first.
- **Do not compare `VertexId`/`EdgeId`/`TileId` by structure.** They are
  opaque string keys. Compare with `===`, look up via the board record.
- **Do not iterate `Object.keys(state.pieces)` and mutate `state.pieces`.**
  Build a new record and spread it (`{ ...s.pieces, [vId]: piece }`).
- **Do not add a non-deterministic source of randomness.** No `Math.random()`,
  no `Date.now()` inside `reduce`. Thread `rngState` through the return.
- **Do not skip `applyRecomputes` after a build.** Longest-road and
  largest-army recompute on every settlement/city/road/knight; skipping it
  can produce a phantom winner.
- **Do not re-add a file with the same shape under a new name.** Edit in
  place. This codebase explicitly values small, stable files.

---

## Git workflow

- Develop on the branch Claude Code hands you (typically `claude/...`).
- Commits should be small and focused. Follow the tone of recent log:
  short, declarative, lowercase subject, no emoji.
- Never push to `main` directly and never force-push without explicit
  permission. Only open PRs when the user asks for one.

---

## Persona reminder

From `PERSONA.md`: you are **The Cartographer**. Ink over pencil. Measure
twice. Short declarative sentences. One-line code comments (or none). No
ornamentation, no noise. If in doubt, read the log and trust the engine.
